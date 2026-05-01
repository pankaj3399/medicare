#!/usr/bin/env node
/**
 * Seed the `carrierFhirEndpoints` collection from config/carrierFhir.json.
 *
 * Usage:
 *   node scripts/seedCarrierEndpoints.mjs
 *
 * Env:
 *   MONGODB_URI   connection string (default: mongodb://localhost:27017)
 *   MONGODB_DB    database name (default: plan4me)
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import { MONGODB_URI, MONGODB_DB, scrub } from "./_env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(__dirname, "..", "config", "carrierFhir.json");

async function main() {
  const raw = readFileSync(CONFIG_PATH, "utf8");
  const entries = JSON.parse(raw);
  if (!Array.isArray(entries)) throw new Error("carrierFhir.json must be an array");

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  try {
    const col = client.db(MONGODB_DB).collection("carrierFhirEndpoints");
    await col.createIndex({ parentOrg: 1 }, { unique: true });

    let upserts = 0;
    for (const e of entries) {
      if (!e.parentOrg || !e.fhirBase) continue;
      await col.updateOne(
        { parentOrg: e.parentOrg },
        {
          $set: {
            parentOrg: e.parentOrg,
            fhirBase: e.fhirBase,
            notes: e.notes ?? null,
            enabled: e.enabled !== false,
          },
        },
        { upsert: true },
      );
      upserts++;
    }
    console.log(`[seedCarrierEndpoints] upserted ${upserts} carrier endpoints`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("[seedCarrierEndpoints] failed:", scrub(err));
  process.exit(1);
});
