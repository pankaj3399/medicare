#!/usr/bin/env node
/**
 * Seed (or reindex) MongoDB formulary collections from the CMS Part D
 * "Prescription Drug Plan Formulary, Pharmacy Network, and Pricing Information Files."
 *
 *   Download:
 *     https://www.cms.gov/medicare/prescription-drug-coverage/prescriptiondrugcovgenin/formularyandpharmacynetworkinformationfiles
 *
 *   Files used (pipe-delimited, no headers in older releases — auto-detected):
 *     - basic drugs formulary file.txt   → collection `formularyDrugs`
 *     - plan information.txt             → collection `planFormularyMap`
 *     - beneficiary cost file.txt        → collection `tierCosts`
 *
 * Usage:
 *   node scripts/seedFormulary.mjs
 *   node scripts/seedFormulary.mjs --reindex
 *
 * Env:
 *   MONGODB_URI                 connection string
 *   MONGODB_DB                  database name (default: plan4me)
 *   CMS_FORMULARY_DIR           folder containing the 3 .txt files
 *   CMS_FORMULARY_YEAR          contract year (default: 2026)
 */

import { createReadStream, existsSync } from "node:fs";
import { readdirSync } from "node:fs";
import { parse } from "csv-parse";
import { MongoClient } from "mongodb";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const MONGODB_DB = process.env.MONGODB_DB || "plan4me";
const YEAR = parseInt(process.env.CMS_FORMULARY_YEAR || "2026", 10);
const DIR =
  process.env.CMS_FORMULARY_DIR ||
  path.resolve(__dirname, "..", "..", "..", "..", "Downloads", `CY${YEAR}_Formulary`);

const BATCH_SIZE = 5000;

// CMS publishes files with slightly inconsistent names across years
// (spaces vs underscores, "basic drugs" vs "basic_drugs", etc.).
// Resolve by case-insensitive prefix match.
function resolveFile(prefix) {
  if (!existsSync(DIR)) return null;
  const files = readdirSync(DIR);
  const normalized = prefix.toLowerCase().replace(/[\s_]+/g, "");
  for (const f of files) {
    const n = f.toLowerCase().replace(/[\s_]+/g, "");
    if (n.startsWith(normalized)) return path.join(DIR, f);
  }
  return null;
}

function num(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}
function int(v) {
  const n = num(v);
  return n == null ? null : Math.trunc(n);
}
function yn(v) {
  if (v == null) return null;
  const s = String(v).trim().toUpperCase();
  if (s === "Y" || s === "YES" || s === "1") return true;
  if (s === "N" || s === "NO" || s === "0") return false;
  return null;
}
function str(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}
function pad(s, len) {
  if (s == null) return null;
  const x = String(s).trim();
  return x.length >= len ? x : x.padStart(len, "0");
}

// CMS Part D files carry a header row in CY2025+ releases. We parse by
// header name and pick fields by a list of acceptable aliases — CMS has
// renamed columns between years (e.g. COST_AMT_PREF_MIN vs COST_MIN_AMT_PREF,
// COST_TYPE_MAILPREF vs COST_TYPE_MAIL_PREF).
function pick(row, ...keys) {
  for (const k of keys) {
    if (row[k] != null && row[k] !== "") return row[k];
  }
  return null;
}

async function streamPipeDelimited(filePath, onRecord) {
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
  let count = 0;
  for await (const row of parser) {
    await onRecord(row);
    count++;
  }
  return count;
}

async function rebuildIndexes(db) {
  const fc = db.collection("formularyDrugs");
  const pm = db.collection("planFormularyMap");
  const tc = db.collection("tierCosts");

  for (const col of [fc, pm, tc]) {
    const existing = await col.indexes();
    for (const ix of existing) {
      if (ix.name === "_id_") continue;
      console.log(`[indexes] ${col.collectionName}: dropping ${ix.name}`);
      await col.dropIndex(ix.name).catch(() => {});
    }
  }

  await Promise.all([
    fc.createIndex(
      { year: 1, formularyId: 1, rxcui: 1 },
      { name: "formulary_drug_pk" },
    ),
    pm.createIndex(
      { year: 1, contractId: 1, planId: 1, segmentId: 1 },
      { name: "plan_pk", unique: true },
    ),
    tc.createIndex(
      {
        year: 1,
        contractId: 1,
        planId: 1,
        segmentId: 1,
        coverageLevel: 1,
        tier: 1,
        daysSupply: 1,
      },
      { name: "tier_cost_pk" },
    ),
  ]);

  console.log("[indexes] active:");
  for (const col of [fc, pm, tc]) {
    const ix = await col.indexes();
    console.log(`  ${col.collectionName}: ${ix.map((i) => i.name).join(", ")}`);
  }
}

async function seedFormulary(db) {
  const filePath = resolveFile("basicdrugsformulary");
  if (!filePath) {
    console.warn(`[seed] formulary file not found in ${DIR} — skipping`);
    return;
  }
  console.log(`[seed] formulary: ${filePath}`);
  const col = db.collection("formularyDrugs");
  await col.drop().catch(() => {});

  let buf = [];
  let total = 0;
  await streamPipeDelimited(filePath, async (r) => {
    const formularyId = str(pick(r, "FORMULARY_ID"));
    const rxcui = int(pick(r, "RXCUI"));
    if (!formularyId || rxcui == null) return;
    buf.push({
      year: int(pick(r, "CONTRACT_YEAR")) ?? YEAR,
      formularyId,
      rxcui,
      ndc: str(pick(r, "NDC")),
      tier: int(pick(r, "TIER_LEVEL_VALUE", "TIER")),
      quantityLimit: yn(pick(r, "QUANTITY_LIMIT_YN")) ?? false,
      quantityAmount: num(pick(r, "QUANTITY_LIMIT_AMOUNT")),
      quantityDays: num(pick(r, "QUANTITY_LIMIT_DAYS")),
      priorAuth: yn(pick(r, "PRIOR_AUTHORIZATION_YN")) ?? false,
      stepTherapy: yn(pick(r, "STEP_THERAPY_YN")) ?? false,
    });
    if (buf.length >= BATCH_SIZE) {
      await col.insertMany(buf, { ordered: false });
      total += buf.length;
      buf = [];
      if (total % 100000 === 0) console.log(`[seed]   formularyDrugs: ${total.toLocaleString()}`);
    }
  });
  if (buf.length) {
    await col.insertMany(buf, { ordered: false });
    total += buf.length;
  }
  console.log(`[seed] formularyDrugs: ${total.toLocaleString()} rows`);
}

async function seedPlanInfo(db) {
  const filePath = resolveFile("planinformation");
  if (!filePath) {
    console.warn(`[seed] plan information file not found in ${DIR} — skipping`);
    return;
  }
  console.log(`[seed] planInfo: ${filePath}`);
  const col = db.collection("planFormularyMap");
  await col.drop().catch(() => {});

  // CMS plan information file repeats each plan once per county served, so
  // dedupe by (contractId, planId, segmentId) before insert.
  const seen = new Map();
  await streamPipeDelimited(filePath, async (r) => {
    const contractId = str(pick(r, "CONTRACT_ID"));
    const planId = pad(pick(r, "PLAN_ID"), 3);
    const segmentId = pad(pick(r, "SEGMENT_ID"), 3) ?? "000";
    const formularyId = str(pick(r, "FORMULARY_ID"));
    if (!contractId || !planId || !formularyId) return;
    const key = `${contractId}-${planId}-${segmentId}`;
    if (seen.has(key)) return;
    seen.set(key, {
      year: YEAR,
      contractId,
      planId,
      segmentId,
      formularyId,
      premium: num(pick(r, "PREMIUM")),
      deductible: num(pick(r, "DEDUCTIBLE")),
      icl: num(pick(r, "ICL")),
    });
  });

  const docs = Array.from(seen.values());
  let total = 0;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const slice = docs.slice(i, i + BATCH_SIZE);
    await col.insertMany(slice, { ordered: false });
    total += slice.length;
  }
  console.log(`[seed] planFormularyMap: ${total.toLocaleString()} rows`);
}

async function seedBeneficiaryCost(db) {
  const filePath = resolveFile("beneficiarycost");
  if (!filePath) {
    console.warn(`[seed] beneficiary cost file not found in ${DIR} — skipping`);
    return;
  }
  console.log(`[seed] beneficiaryCost: ${filePath}`);
  const col = db.collection("tierCosts");
  await col.drop().catch(() => {});

  let buf = [];
  let total = 0;
  await streamPipeDelimited(filePath, async (r) => {
    const contractId = str(pick(r, "CONTRACT_ID"));
    const planId = pad(pick(r, "PLAN_ID"), 3);
    const segmentId = pad(pick(r, "SEGMENT_ID"), 3) ?? "000";
    const tier = int(pick(r, "TIER"));
    if (!contractId || !planId || tier == null) return;
    buf.push({
      year: YEAR,
      contractId,
      planId,
      segmentId,
      coverageLevel: int(pick(r, "COVERAGE_LEVEL")) ?? 0,
      tier,
      daysSupply: int(pick(r, "DAYS_SUPPLY")) ?? 1,
      // CMS COST_TYPE codes: 1 = $ copay, 2 = % coinsurance, 0 = no charge / N/A
      prefType: int(pick(r, "COST_TYPE_PREF")),
      prefAmt: num(pick(r, "COST_AMT_PREF")),
      prefMin: num(pick(r, "COST_AMT_PREF_MIN", "COST_MIN_AMT_PREF")),
      prefMax: num(pick(r, "COST_AMT_PREF_MAX", "COST_MAX_AMT_PREF")),
      stdType: int(pick(r, "COST_TYPE_NONPREF")),
      stdAmt: num(pick(r, "COST_AMT_NONPREF")),
      mailPrefType: int(pick(r, "COST_TYPE_MAIL_PREF", "COST_TYPE_MAILPREF")),
      mailPrefAmt: num(pick(r, "COST_AMT_MAIL_PREF", "COST_AMT_MAILPREF")),
      specialty: yn(pick(r, "TIER_SPECIALTY_YN")) ?? false,
      dedApplies: yn(pick(r, "DED_APPLIES_YN")) ?? false,
    });
    if (buf.length >= BATCH_SIZE) {
      await col.insertMany(buf, { ordered: false });
      total += buf.length;
      buf = [];
      if (total % 100000 === 0) console.log(`[seed]   tierCosts: ${total.toLocaleString()}`);
    }
  });
  if (buf.length) {
    await col.insertMany(buf, { ordered: false });
    total += buf.length;
  }
  console.log(`[seed] tierCosts: ${total.toLocaleString()} rows`);
}

async function main() {
  const reindexOnly = process.argv.includes("--reindex");

  console.log(`[seed] Mongo: ${MONGODB_URI}  db=${MONGODB_DB}`);
  console.log(`[seed] year:  ${YEAR}`);
  if (!reindexOnly) console.log(`[seed] dir:   ${DIR}`);

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(MONGODB_DB);

  if (reindexOnly) {
    await rebuildIndexes(db);
    await client.close();
    console.log("[seed] reindex done.");
    return;
  }

  if (!existsSync(DIR)) {
    console.error(
      `[seed] CMS_FORMULARY_DIR not found: ${DIR}\n` +
        `Download the formulary zip from cms.gov, unzip it, and either move it to ` +
        `${DIR} or set CMS_FORMULARY_DIR.`,
    );
    await client.close();
    process.exit(1);
  }

  await seedPlanInfo(db);
  await seedFormulary(db);
  await seedBeneficiaryCost(db);

  console.log("[seed] creating indexes...");
  await rebuildIndexes(db);

  console.log("[seed] sample: first 3 plans + their formulary tier for RXCUI 197361 (atorvastatin 20mg)...");
  const sample = await db
    .collection("planFormularyMap")
    .aggregate([
      { $match: { year: YEAR } },
      { $limit: 3 },
      {
        $lookup: {
          from: "formularyDrugs",
          let: { fid: "$formularyId" },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ["$formularyId", "$$fid"] }, { $eq: ["$rxcui", 197361] }] } } },
          ],
          as: "atorva",
        },
      },
    ])
    .toArray();
  console.log(JSON.stringify(sample, null, 2));

  await client.close();
  console.log("[seed] done.");
}

main().catch((e) => {
  console.error("[seed] FAILED:", e);
  process.exit(1);
});
