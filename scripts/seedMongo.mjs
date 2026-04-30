#!/usr/bin/env node
/**
 * Seed (or reindex) the MongoDB `plans` collection from the CMS CY2026 Landscape CSV.
 *
 * Full seed:
 *   node scripts/seedMongo.mjs
 *
 * Just rebuild indexes (no re-import):
 *   node scripts/seedMongo.mjs --reindex
 *
 * Env: MONGODB_URI, MONGODB_DB, CMS_LANDSCAPE_CSV
 */

import { createReadStream } from "node:fs";
import { parse } from "csv-parse";
import { MongoClient } from "mongodb";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const MONGODB_DB = process.env.MONGODB_DB || "plan4me";
const CSV_PATH =
  process.env.CMS_LANDSCAPE_CSV ||
  path.resolve(__dirname, "..", "..", "..", "..", "Downloads", "CY2026_Landscape_202603.csv");

const BATCH_SIZE = 2000;

function parseMoney(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s === "Not Applicable" || s === "N/A") return null;
  const negative = /^\(.*\)$/.test(s);
  const cleaned = s.replace(/[()$,\s]/g, "");
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

function parseStar(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s === "Not Applicable" || s === "N/A") return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function yn(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (s === "yes") return true;
  if (s === "no") return false;
  return null;
}

function clean(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s === "Not Applicable" || s === "N/A") return null;
  return s;
}

function transform(row) {
  const planType = clean(row["Plan Type"]) || "";
  const contractCategory = clean(row["Contract Category Type"]) || "";
  const snpIndicator = clean(row["Special Needs Plan (SNP) Indicator"]) || "No";
  const snpType = clean(row["SNP Type"]);
  const dsnpStatus = clean(row["Dual Eligible SNP (D-SNP) Integration Status"]);
  const isSnp = snpIndicator && snpIndicator.toLowerCase() !== "no";
  const isDsnp =
    isSnp &&
    ((snpType && /dual/i.test(snpType)) ||
      (dsnpStatus && dsnpStatus.toLowerCase() !== "not applicable"));

  return {
    year: parseInt(row["Contract Year"], 10),
    contractCategory,
    state: clean(row["State Territory Abbreviation"]),
    stateName: clean(row["State Territory Name"]),
    countyName: clean(row["County Name"]),
    contractId: clean(row["Contract ID"]),
    planId: clean(row["Plan ID"]),
    segmentId: clean(row["Segment ID"]) ?? "0",
    contractPlanId: clean(row["ContractPlanID"]),
    contractPlanSegmentId: clean(row["ContractPlanSegmentID"]),
    sanctioned: yn(row["Sanctioned Plan"]),
    parentOrg: clean(row["Parent Organization Name"]),
    contractName: clean(row["Contract Name"]),
    carrier: clean(row["Organization Marketing Name"]),
    orgType: clean(row["Organization Type"]),
    name: clean(row["Plan Name"]),
    planType,
    snpIndicator,
    snpType,
    snpInstitutionalType: clean(row["SNP Institutional Type"]),
    snpInstitutionalCategory: clean(row["SNP Institutional Category"]),
    dsnpIntegrationStatus: dsnpStatus,
    csnpConditionType: clean(row["Chronic or Disabling Condition SNP (C-SNP) Condition Type"]),
    zeroCostSharingDsnp: yn(row["Medicare Zero-Dollar Cost Sharing D-SNP Plan"]),
    isSnp: !!isSnp,
    isDsnp: !!isDsnp,
    partDCoverage: yn(row["Part D Coverage Indicator"]),
    nationalPdp: yn(row["National PDP"]),
    drugBenefitCategory: clean(row["Drug Benefit Category"]),
    drugBenefitType: clean(row["Drug Benefit Type"]),
    deductibleAnnual: parseMoney(row["Annual Part D Deductible Amount"]),
    partDPremium: parseMoney(row["Part D Basic Premium"]),
    partDSupplementalPremium: parseMoney(row["Part D Supplemental Premium"]),
    partDTotalPremium: parseMoney(row["Part D Total Premium"]),
    partDLowIncomePremium: parseMoney(row["Part D Low Income Beneficiary Premium Amount"]),
    partDOopThreshold: parseMoney(row["Part D Out-of-Pocket (OOP) Threshold"]),
    partCPremium: parseMoney(row["Part C Premium"]),
    consolidatedPremium: parseMoney(row["Monthly Consolidated Premium (Part C + D)"]),
    moop: parseMoney(row["In-Network Maximum Out-of-Pocket (MOOP) Amount"]),
    starPartC: parseStar(row["Part C Summary Star Rating"]),
    starPartD: parseStar(row["Part D Summary Star Rating"]),
    starOverall: parseStar(row["Overall Star Rating"]),
    maRegionCode: clean(row["MA Region Code"]),
    maRegion: clean(row["MA Region"]),
    pdpRegionCode: clean(row["PDP Region Code"]),
    pdpRegion: clean(row["PDP Region"]),
  };
}

const KEEP_INDEXES = new Set(["_id_", "year_state", "plan_pk"]);

async function rebuildIndexes(col) {
  const existing = await col.indexes();
  for (const ix of existing) {
    if (KEEP_INDEXES.has(ix.name)) continue;
    console.log(`[indexes] dropping ${ix.name}`);
    await col.dropIndex(ix.name);
  }
  // Only the two indexes the app actually queries:
  //   year+state           → findPlansByZip   (GET /api/plans)
  //   plan PK              → findPlansByIds   (POST /api/plans/quote)
  await Promise.all([
    col.createIndex({ year: 1, state: 1 }, { name: "year_state" }),
    col.createIndex(
      { year: 1, contractId: 1, planId: 1, segmentId: 1 },
      { name: "plan_pk" },
    ),
  ]);
  const after = await col.indexes();
  console.log(`[indexes] active: ${after.map((i) => i.name).join(", ")}`);
}

async function main() {
  const reindexOnly = process.argv.includes("--reindex");

  console.log(`[seed] Mongo: ${MONGODB_URI}  db=${MONGODB_DB}`);
  if (!reindexOnly) console.log(`[seed] CSV:   ${CSV_PATH}`);

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const col = client.db(MONGODB_DB).collection("plans");

  if (reindexOnly) {
    await rebuildIndexes(col);
    await client.close();
    console.log("[seed] reindex done.");
    return;
  }

  console.log("[seed] dropping existing collection...");
  await col.drop().catch((e) => {
    if (e?.codeName !== "NamespaceNotFound") throw e;
  });

  const parser = createReadStream(CSV_PATH).pipe(
    parse({
      columns: true,
      bom: true,
      skip_empty_lines: true,
      trim: true,
      relax_quotes: true,
      relax_column_count: true,
    }),
  );

  let buf = [];
  let total = 0;
  let skipped = 0;

  for await (const row of parser) {
    const doc = transform(row);
    if (!doc.state || !doc.contractId || !doc.planId || !Number.isFinite(doc.year)) {
      skipped++;
      continue;
    }
    buf.push(doc);
    if (buf.length >= BATCH_SIZE) {
      await col.insertMany(buf, { ordered: false });
      total += buf.length;
      buf = [];
      if (total % 20000 === 0) console.log(`[seed]  inserted ${total.toLocaleString()} rows...`);
    }
  }
  if (buf.length) {
    await col.insertMany(buf, { ordered: false });
    total += buf.length;
  }
  console.log(`[seed] inserted ${total.toLocaleString()} rows (${skipped} skipped)`);

  console.log("[seed] creating indexes...");
  await rebuildIndexes(col);

  console.log("[seed] sample query: 2026 FL D-SNP plans...");
  const sample = await col
    .find({ year: 2026, state: "FL", isDsnp: true })
    .limit(5)
    .project({ name: 1, carrier: 1, planType: 1, countyName: 1, starOverall: 1 })
    .toArray();
  console.log(JSON.stringify(sample, null, 2));

  await client.close();
  console.log("[seed] done.");
}

main().catch((e) => {
  console.error("[seed] FAILED:", e);
  process.exit(1);
});
