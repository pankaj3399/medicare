#!/usr/bin/env node
/**
 * One-shot data setup. Runs three steps in order:
 *
 *   1. Build  public/data/zipCounty.json from the US Census 2020 ZCTA→County
 *      relationship file (free, public domain, no API key).
 *   2. Seed   PCP & Specialist copays from config/planCostSharing.json onto
 *      the `plans` collection (manual overlay, fast).
 *   3. Seed   PCP & Specialist copays from a CMS PBP Section B file onto the
 *      `plans` collection (bulk, only runs if CMS_PBP_DIR is set/exists).
 *
 * Usage:
 *   node scripts/setupZipsAndCopays.mjs                # all applicable steps
 *   node scripts/setupZipsAndCopays.mjs --force-zip    # rebuild zipCounty.json
 *   node scripts/setupZipsAndCopays.mjs --skip-zip --skip-overlay --skip-bulk   # toggle
 *
 * Env (read from .env.local automatically if not set in shell):
 *   MONGODB_URI                connection string
 *   MONGODB_DB                 database name (default: plan4me)
 *   ZIP_COUNTY_FILE            optional path to a pre-downloaded Census file
 *   PLAN_COST_SHARING_FILE     overlay JSON (default: config/planCostSharing.json)
 *   CMS_PBP_DIR                folder containing the PBP Section B file
 *   CMS_PBP_YEAR               contract year (default: 2026)
 */

import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import { parse } from "csv-parse";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// Load .env.local if env vars not already set in shell.
const ENV_FILE = path.resolve(REPO_ROOT, ".env.local");
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const args = new Set(process.argv.slice(2));
const SKIP_ZIP = args.has("--skip-zip");
const SKIP_OVERLAY = args.has("--skip-overlay");
const SKIP_BULK = args.has("--skip-bulk");
const FORCE_ZIP = args.has("--force-zip");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const MONGODB_DB = process.env.MONGODB_DB || "plan4me";

// ─── Step 1: build ZIP→county dataset ───────────────────────────────────────

const ZIP_OUT_DIR = path.join(REPO_ROOT, "public", "data");
const ZIP_OUT_FILE = path.join(ZIP_OUT_DIR, "zipCounty.json");
const ZIP_SRC_URL =
  "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt";

const STATE_FIPS_TO_ABBR = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO",
  "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI",
  "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
  "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
  "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
  "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
  "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
  "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA",
  "54": "WV", "55": "WI", "56": "WY", "60": "AS", "66": "GU", "69": "MP",
  "72": "PR", "78": "VI",
};

const stripCountySuffix = (n) =>
  n.replace(
    /\s+(County|Parish|Borough|Census Area|Municipality|Municipio|City and Borough|City)\s*$/i,
    "",
  ).trim();

async function loadZipSource() {
  const local = process.env.ZIP_COUNTY_FILE;
  if (local && existsSync(local)) {
    console.log(`[zipCounty] reading local: ${local}`);
    return readFileSync(local, "utf8");
  }
  console.log(`[zipCounty] downloading: ${ZIP_SRC_URL}`);
  const res = await fetch(ZIP_SRC_URL);
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText}`);
  return await res.text();
}

async function step1_buildZipCounty() {
  if (SKIP_ZIP) {
    console.log("[zipCounty] skipped (--skip-zip)");
    return;
  }
  if (existsSync(ZIP_OUT_FILE) && !FORCE_ZIP) {
    console.log(`[zipCounty] exists (use --force-zip to rebuild): ${ZIP_OUT_FILE}`);
    return;
  }

  const text = await loadZipSource();
  const lines = text.split(/\r?\n/);
  const header = lines[0].replace(/^﻿/, "").split("|");
  const I_ZIP = header.indexOf("GEOID_ZCTA5_20");
  const I_CFIPS = header.indexOf("GEOID_COUNTY_20");
  const I_CNAME = header.indexOf("NAMELSAD_COUNTY_20");
  const I_AREA = header.indexOf("AREALAND_PART");
  if (I_ZIP < 0 || I_CFIPS < 0 || I_CNAME < 0) {
    throw new Error("[zipCounty] unexpected header layout — Census schema changed?");
  }

  // Pick the county with the largest land area per ZIP (ZCTAs that span
  // multiple counties get attributed to the dominant one).
  const best = new Map();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split("|");
    const zip = cols[I_ZIP];
    const fips = cols[I_CFIPS];
    const name = cols[I_CNAME];
    if (!zip || !fips || !name) continue;
    const area = parseInt(cols[I_AREA] || "0", 10) || 0;
    const cur = best.get(zip);
    if (!cur || area > cur.area) best.set(zip, { area, fips, name });
  }

  const out = {};
  for (const [zip, { fips, name }] of best) {
    const s = STATE_FIPS_TO_ABBR[fips.slice(0, 2)];
    if (!s) continue;
    out[zip] = { c: stripCountySuffix(name), s };
  }

  mkdirSync(ZIP_OUT_DIR, { recursive: true });
  writeFileSync(ZIP_OUT_FILE, JSON.stringify(out));
  const sizeKb = Math.round(JSON.stringify(out).length / 1024);
  console.log(`[zipCounty] wrote ${Object.keys(out).length} zips → ${ZIP_OUT_FILE} (${sizeKb} KB)`);
}

// ─── Step 2: seed manual copay overlay ──────────────────────────────────────

const OVERLAY_FILE =
  process.env.PLAN_COST_SHARING_FILE ||
  path.resolve(REPO_ROOT, "config", "planCostSharing.json");

function parseOverlayKey(key) {
  // "2026-H0609-027-000" → segmentIds matches both "0" and "000" since the
  // plans collection has been seeded with both formats.
  const m = String(key || "").match(/^(\d{4})-([A-Z0-9]{5})-(\d{1,3})-(\d{1,3})$/i);
  if (!m) return null;
  return {
    year: parseInt(m[1], 10),
    contractId: m[2].toUpperCase(),
    planId: m[3].padStart(3, "0"),
    segmentIds: Array.from(new Set([String(parseInt(m[4], 10)), m[4].padStart(3, "0")])),
  };
}

const num = (v) => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

async function step2_seedOverlay(plansCol) {
  if (SKIP_OVERLAY) {
    console.log("[overlay] skipped (--skip-overlay)");
    return;
  }
  if (!existsSync(OVERLAY_FILE)) {
    console.warn(`[overlay] file not found, skipping: ${OVERLAY_FILE}`);
    return;
  }

  const raw = JSON.parse(readFileSync(OVERLAY_FILE, "utf8"));
  const entries = Array.isArray(raw.plans) ? raw.plans : [];
  if (entries.length === 0) {
    console.warn(`[overlay] no entries in ${OVERLAY_FILE}, skipping`);
    return;
  }
  console.log(`[overlay] file: ${OVERLAY_FILE}  entries: ${entries.length}`);

  const ops = [];
  for (const e of entries) {
    const ids = parseOverlayKey(e.key);
    if (!ids) {
      console.warn(`[overlay] skipping bad key: ${e.key}`);
      continue;
    }
    ops.push({
      updateMany: {
        filter: {
          year: ids.year,
          contractId: ids.contractId,
          planId: ids.planId,
          segmentId: { $in: ids.segmentIds },
        },
        update: {
          $set: {
            pcpCopayInNetwork: num(e.pcpCopay),
            pcpCoinsuranceInNetwork: num(e.pcpCoinsurance),
            specialistCopayInNetwork: num(e.specialistCopay),
            specialistCoinsuranceInNetwork: num(e.specialistCoinsurance),
          },
        },
      },
    });
  }

  if (ops.length === 0) {
    console.warn("[overlay] no valid entries");
    return;
  }
  const res = await plansCol.bulkWrite(ops, { ordered: false });
  console.log(
    `[overlay] matched ${res.matchedCount} county rows, modified ${res.modifiedCount}`,
  );
}

// ─── Step 3: bulk seed from CMS PBP Section B ───────────────────────────────

const PBP_YEAR = parseInt(process.env.CMS_PBP_YEAR || "2026", 10);
const PBP_DIR =
  process.env.CMS_PBP_DIR ||
  path.resolve(REPO_ROOT, "..", "..", "..", "Downloads", `CY${PBP_YEAR}_PBP`);

const BULK_SIZE = 500;
const str = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
};
const pad = (s, len) => {
  if (s == null) return null;
  const x = String(s).trim();
  return x.length >= len ? x : x.padStart(len, "0");
};
const pickField = (row, ...keys) => {
  for (const k of keys) if (row[k] != null && row[k] !== "") return row[k];
  return null;
};

function resolveSectionB(dir) {
  if (!existsSync(dir)) return null;
  for (const f of readdirSync(dir)) {
    const n = f.toLowerCase();
    if (n.includes("sec") && /\bb\b|_b[._]/i.test(n)) return path.join(dir, f);
    if (n.startsWith("pbp") && n.includes("_b")) return path.join(dir, f);
  }
  return null;
}

function splitBid(raw) {
  if (!raw) return null;
  const compact = String(raw).trim().replace(/[\s-]/g, "");
  if (compact.length < 8) return null;
  return {
    contractId: compact.slice(0, 5),
    planId: compact.slice(5, 8),
    segmentId: compact.length >= 11 ? compact.slice(8, 11) : "000",
  };
}

function extractIds(r) {
  const fromBid = splitBid(pickField(r, "BID_ID", "BIDID", "BID"));
  if (fromBid) return fromBid;
  const contractId = str(pickField(r, "CONTRACT_ID", "CONTRACTID", "CONTRACT"));
  const planId = pad(pickField(r, "PLAN_ID", "PLANID", "PLAN"), 3);
  const segmentId = pad(pickField(r, "SEGMENT_ID", "SEGMENTID", "SEGMENT"), 3) ?? "000";
  if (!contractId || !planId) return null;
  return { contractId, planId, segmentId };
}

function extractCostSharing(r) {
  return {
    pcpCopayInNetwork: num(pickField(r,
      "PBP_B7A_COPAY_MIN_PCP", "PBP_B7A_COPAY_PCP", "PBP_B7A_COPAY_MIN", "PBP_B7a_COPAY_MIN_PCP")),
    pcpCoinsuranceInNetwork: num(pickField(r,
      "PBP_B7A_COIN_MIN_PCP", "PBP_B7A_COIN_PCP", "PBP_B7A_COINS_MIN_PCP", "PBP_B7A_COINS_PCP")),
    specialistCopayInNetwork: num(pickField(r,
      "PBP_B7B_COPAY_MIN_SPC_PHYS", "PBP_B7B_COPAY_MIN_SPEC", "PBP_B7B_COPAY_SPEC", "PBP_B7B_COPAY_MIN")),
    specialistCoinsuranceInNetwork: num(pickField(r,
      "PBP_B7B_COIN_MIN_SPC_PHYS", "PBP_B7B_COIN_MIN_SPEC", "PBP_B7B_COIN_SPEC", "PBP_B7B_COINS_MIN_SPEC")),
  };
}

const isAllNull = (o) => Object.values(o).every((v) => v == null);

async function step3_seedBulkPbp(plansCol) {
  if (SKIP_BULK) {
    console.log("[seedPbp] skipped (--skip-bulk)");
    return;
  }
  if (!existsSync(PBP_DIR)) {
    console.log(
      `[seedPbp] skipped — CMS_PBP_DIR not found (${PBP_DIR}). ` +
        `Set CMS_PBP_DIR to a folder with the PBP Section B file to enable bulk seeding.`,
    );
    return;
  }
  const filePath = resolveSectionB(PBP_DIR);
  if (!filePath) {
    console.log(`[seedPbp] skipped — no PBP Section B file found in ${PBP_DIR}`);
    return;
  }
  console.log(`[seedPbp] file: ${filePath}  year: ${PBP_YEAR}`);

  const byPlan = new Map();
  let rows = 0;
  const parser = createReadStream(filePath).pipe(
    parse({
      delimiter: "|",
      columns: true,
      bom: true,
      relax_quotes: true,
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true,
    }),
  );
  for await (const r of parser) {
    rows++;
    const ids = extractIds(r);
    if (!ids) continue;
    const cs = extractCostSharing(r);
    if (isAllNull(cs)) continue;
    const key = `${ids.contractId}-${ids.planId}-${ids.segmentId}`;
    if (!byPlan.has(key)) byPlan.set(key, { ...ids, ...cs });
  }
  console.log(`[seedPbp] parsed ${rows.toLocaleString()} rows → ${byPlan.size.toLocaleString()} unique plans`);

  if (byPlan.size === 0) {
    console.warn(
      `[seedPbp] no PCP/specialist fields extracted. The CY${PBP_YEAR} PBP file ` +
        `likely uses different column names. Add the exact B7a/B7b column names to extractCostSharing().`,
    );
    return;
  }

  let matched = 0, updated = 0, buf = [];
  for (const p of byPlan.values()) {
    buf.push({
      updateMany: {
        filter: { year: PBP_YEAR, contractId: p.contractId, planId: p.planId, segmentId: p.segmentId },
        update: {
          $set: {
            pcpCopayInNetwork: p.pcpCopayInNetwork,
            pcpCoinsuranceInNetwork: p.pcpCoinsuranceInNetwork,
            specialistCopayInNetwork: p.specialistCopayInNetwork,
            specialistCoinsuranceInNetwork: p.specialistCoinsuranceInNetwork,
          },
        },
      },
    });
    if (buf.length >= BULK_SIZE) {
      const res = await plansCol.bulkWrite(buf, { ordered: false });
      matched += res.matchedCount;
      updated += res.modifiedCount;
      buf = [];
    }
  }
  if (buf.length) {
    const res = await plansCol.bulkWrite(buf, { ordered: false });
    matched += res.matchedCount;
    updated += res.modifiedCount;
  }
  console.log(`[seedPbp] matched ${matched.toLocaleString()} county rows, modified ${updated.toLocaleString()}`);
}

// ─── Driver ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("──── setupZipsAndCopays ────");
  await step1_buildZipCounty();

  if (SKIP_OVERLAY && SKIP_BULK) {
    console.log("[setup] both Mongo steps skipped — done.");
    return;
  }

  console.log(`[setup] Mongo: ${MONGODB_URI}  db=${MONGODB_DB}`);
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  try {
    const plans = client.db(MONGODB_DB).collection("plans");
    await step2_seedOverlay(plans);
    await step3_seedBulkPbp(plans);
  } finally {
    await client.close();
  }
  console.log("[setup] done.");
}

main().catch((e) => {
  console.error("[setup] FAILED:", e);
  process.exit(1);
});
