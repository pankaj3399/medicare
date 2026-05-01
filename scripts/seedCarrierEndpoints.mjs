#!/usr/bin/env node
/**
 * Seed all carrier-directory data the in-network check needs:
 *
 *   1. Upserts `carrierFhirEndpoints` from config/carrierFhir.json.
 *   2. For every enabled carrier, pulls `InsurancePlan` resources via FHIR and
 *      writes (contractId, planId, segmentId) → networkIds[] into
 *      `planNetworkMap` so the request-time check can map a plan to networks.
 *   3. Ensures indexes (uniqueness on the composite key, TTL on the cache).
 *
 * Usage:
 *   node scripts/seedCarrierEndpoints.mjs
 *   node scripts/seedCarrierEndpoints.mjs --carrier="Humana Inc."
 *
 * Env (required, no defaults):
 *   MONGODB_URI, MONGODB_DB
 * Optional:
 *   CMS_FORMULARY_YEAR (default 2026)
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const { MONGODB_URI, MONGODB_DB } = process.env;
if (!MONGODB_URI || !MONGODB_DB) {
  console.error("[seed] MONGODB_URI and MONGODB_DB must both be set. Aborting.");
  process.exit(1);
}

const scrub = (err) =>
  (err instanceof Error ? err.message : String(err)).replace(
    /(mongodb(?:\+srv)?:\/\/)[^@/]+@/gi,
    "$1<credentials-redacted>@",
  );

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(__dirname, "..", "config", "carrierFhir.json");

const YEAR = parseInt(process.env.CMS_FORMULARY_YEAR || "2026", 10);
const ONLY_CARRIER = (() => {
  const arg = process.argv.find((a) => a.startsWith("--carrier="));
  return arg ? arg.slice("--carrier=".length).replace(/^"|"$/g, "") : null;
})();

const TIMEOUT_MS = 15_000;
const MAX_PAGES = 50;

function joinUrl(base, p) {
  const b = base.endsWith("/") ? base : base + "/";
  const x = p.startsWith("/") ? p.slice(1) : p;
  return b + x;
}

async function fhirFetch(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/fhir+json, application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`FHIR ${res.status} ${res.statusText} for ${url}`);
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function fetchAllPages(base, resource, params = {}) {
  const out = [];
  const search = new URLSearchParams(params).toString();
  let url = joinUrl(base, resource) + (search ? `?${search}` : "");
  let pages = 0;
  while (url && pages < MAX_PAGES) {
    const bundle = await fhirFetch(url);
    if (!bundle || bundle.resourceType !== "Bundle") break;
    for (const e of bundle.entry ?? []) if (e.resource) out.push(e.resource);
    pages++;
    const next = bundle.link?.find((l) => l.relation === "next")?.url;
    url = next || null;
  }
  return out;
}

function normSegment(s) {
  if (s == null) return "000";
  const str = String(s);
  return str.length < 3 ? str.padStart(3, "0") : str;
}

function extractNetworkRefs(insurancePlan) {
  const refs = insurancePlan.network ?? [];
  return refs
    .map((r) => {
      const ref = r.reference ?? "";
      // Standard PDEX uses Network/<id>; Humana points at Organization/<id>.
      for (const prefix of ["Network/", "Organization/"]) {
        const idx = ref.lastIndexOf(prefix);
        if (idx >= 0) return { id: ref.slice(idx + prefix.length), kind: prefix.replace("/", "") };
      }
      return null;
    })
    .filter(Boolean);
}

function extractPlanIdentifiers(insurancePlan) {
  return (insurancePlan.identifier ?? [])
    .map((i) => String(i.value ?? "").trim())
    .filter(Boolean);
}

async function seedEndpoints(client, entries) {
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
  console.log(`[seed] upserted ${upserts} carrier endpoints`);
}

async function ensureIndexes(client) {
  const db = client.db(MONGODB_DB);
  await db
    .collection("planNetworkMap")
    .createIndex({ contractId: 1, planId: 1, segmentId: 1 }, { unique: true });
  await db.collection("planNetworkMap").createIndex({ parentOrg: 1 });
  await db
    .collection("doctorPlanAcceptance")
    .createIndex({ npi: 1, contractId: 1, planId: 1, segmentId: 1 }, { unique: true });
  await db
    .collection("doctorPlanAcceptance")
    .createIndex({ ttlExpiresAt: 1 }, { expireAfterSeconds: 0 });
}

async function syncCarrier(client, carrier) {
  const db = client.db(MONGODB_DB);
  const plans = db.collection("plans");
  const planNetworkMap = db.collection("planNetworkMap");

  console.log(`[sync] ${carrier.parentOrg} ← ${carrier.fhirBase}`);

  let resources;
  try {
    resources = await fetchAllPages(carrier.fhirBase, "InsurancePlan", { _count: "200" });
  } catch (err) {
    console.warn(`[sync]   skipping (${err.message})`);
    return;
  }
  console.log(`[sync]   pulled ${resources.length} InsurancePlan resources`);

  const carrierPlans = await plans
    .find({ year: YEAR, parentOrg: carrier.parentOrg })
    .project({ contractId: 1, planId: 1, segmentId: 1 })
    .toArray();
  if (carrierPlans.length === 0) {
    console.warn(`[sync]   no plans in DB for parentOrg "${carrier.parentOrg}" — nothing to map`);
    return;
  }

  const byKey = new Map();
  for (const p of carrierPlans) {
    const k = `${p.contractId}-${p.planId}-${normSegment(p.segmentId)}`;
    if (!byKey.has(k)) byKey.set(k, p);
  }

  const ops = [];
  let scanned = 0;
  for (const ip of resources) {
    scanned++;
    if (scanned % 500 === 0) {
      console.log(`[sync]   scanned ${scanned}/${resources.length}, queued ${ops.length}`);
    }
    const networkRefs = extractNetworkRefs(ip);
    if (networkRefs.length === 0) continue;
    const primary = networkRefs[0];
    const allNetworkIds = Array.from(new Set(networkRefs.map((r) => r.id)));

    const matches = new Set();
    for (const ident of extractPlanIdentifiers(ip)) {
      const m = ident.match(/^([A-Z]\d{4})-(\d{1,3})-(\d{1,3})(?:-(\d{4}))?$/);
      if (!m) continue;
      const [, c, pid, s] = m;
      const k = `${c}-${pid}-${normSegment(s)}`;
      if (byKey.has(k)) matches.add(byKey.get(k));
    }

    for (const plan of matches) {
      ops.push({
        updateOne: {
          filter: {
            contractId: plan.contractId,
            planId: plan.planId,
            segmentId: plan.segmentId,
          },
          update: {
            $set: {
              year: YEAR,
              contractId: plan.contractId,
              planId: plan.planId,
              segmentId: plan.segmentId,
              parentOrg: carrier.parentOrg,
              networkIds: allNetworkIds,
              networkRefKind: primary.kind,
              networkName: ip.name ?? null,
              lastSyncedAt: new Date(),
            },
            $unset: { networkId: "" },
          },
          upsert: true,
        },
      });
    }
  }

  console.log(`[sync]   matched ${ops.length} (plan, network) pairs — bulk-writing…`);
  let upserts = 0;
  const CHUNK = 500;
  for (let i = 0; i < ops.length; i += CHUNK) {
    const r = await planNetworkMap.bulkWrite(ops.slice(i, i + CHUNK), { ordered: false });
    upserts += (r.upsertedCount ?? 0) + (r.modifiedCount ?? 0);
    console.log(`[sync]   bulk progress: ${Math.min(i + CHUNK, ops.length)}/${ops.length}`);
  }
  console.log(`[sync]   upserted ${upserts} mappings`);
}

async function main() {
  const raw = readFileSync(CONFIG_PATH, "utf8");
  const entries = JSON.parse(raw);
  if (!Array.isArray(entries)) throw new Error("carrierFhir.json must be an array");

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  try {
    await seedEndpoints(client, entries);
    await ensureIndexes(client);

    const filter = { enabled: true };
    if (ONLY_CARRIER) filter.parentOrg = ONLY_CARRIER;
    const carriers = await client
      .db(MONGODB_DB)
      .collection("carrierFhirEndpoints")
      .find(filter)
      .toArray();

    for (const c of carriers) await syncCarrier(client, c);
    console.log("[seed] done");
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("[seed] failed:", scrub(err));
  process.exit(1);
});
