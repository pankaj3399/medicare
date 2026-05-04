#!/usr/bin/env node
/**
 * Build public/data/zipCounty.json from the US Census 2020 ZCTA→County
 * relationship file. Public domain, free, no API key.
 *
 * Source:
 *   https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt
 *
 * Output (compact, keyed by ZIP):
 *   { "85257": { "c": "Maricopa", "s": "AZ" }, ... }
 *
 * Usage:
 *   node scripts/buildZipCounty.mjs            # skip if file exists
 *   node scripts/buildZipCounty.mjs --force    # rebuild
 *
 * Env:
 *   ZIP_COUNTY_FILE   optional path to a pre-downloaded copy of the file
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(REPO_ROOT, "public", "data");
const OUT_FILE = path.join(OUT_DIR, "zipCounty.json");
const SRC_URL =
  "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt";

const FORCE = process.argv.includes("--force");

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

const stripSuffix = (n) =>
  n.replace(
    /\s+(County|Parish|Borough|Census Area|Municipality|Municipio|City and Borough|City)\s*$/i,
    "",
  ).trim();

async function loadSource() {
  const local = process.env.ZIP_COUNTY_FILE;
  if (local && existsSync(local)) {
    console.log(`[zipCounty] reading local: ${local}`);
    return readFileSync(local, "utf8");
  }
  console.log(`[zipCounty] downloading: ${SRC_URL}`);
  const res = await fetch(SRC_URL);
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText}`);
  return await res.text();
}

async function main() {
  if (existsSync(OUT_FILE) && !FORCE) {
    console.log(`[zipCounty] exists (use --force to rebuild): ${OUT_FILE}`);
    return;
  }

  const text = await loadSource();
  const lines = text.split(/\r?\n/);
  const header = lines[0].replace(/^﻿/, "").split("|");
  const I_ZIP = header.indexOf("GEOID_ZCTA5_20");
  const I_CFIPS = header.indexOf("GEOID_COUNTY_20");
  const I_CNAME = header.indexOf("NAMELSAD_COUNTY_20");
  const I_AREA = header.indexOf("AREALAND_PART");
  if (I_ZIP < 0 || I_CFIPS < 0 || I_CNAME < 0) {
    throw new Error("unexpected header layout — Census schema changed?");
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
    out[zip] = { c: stripSuffix(name), s };
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(out));
  const sizeKb = Math.round(JSON.stringify(out).length / 1024);
  console.log(`[zipCounty] wrote ${Object.keys(out).length} zips → ${OUT_FILE} (${sizeKb} KB)`);
}

main().catch((e) => {
  console.error("[zipCounty] FAILED:", e);
  process.exit(1);
});
