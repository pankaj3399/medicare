#!/usr/bin/env node
/**
 * Walk every enabled carrier in `carrierFhirEndpoints`, pull their
 * `InsurancePlan` resources via FHIR, join each one to a row in `plans` by
 * (parentOrg + plan name / contractId), and upsert the resulting
 * (contractId, planId, segmentId) → networkId mapping into `planNetworkMap`.
 *
 * Also:
 *  - ensures a TTL index on doctorPlanAcceptance.ttlExpiresAt so cache
 *    entries auto-evict.
 *  - ensures a unique index on planNetworkMap composite key.
 *
 * Usage:
 *   node scripts/syncPlanNetworks.mjs
 *   node scripts/syncPlanNetworks.mjs --carrier="Humana Inc."
 *
 * Env:
 *   MONGODB_URI, MONGODB_DB, CMS_FORMULARY_YEAR (default 2026)
 */

import { MongoClient } from "mongodb";
import { MONGODB_URI, MONGODB_DB, scrub } from "./_env.mjs";
const YEAR = parseInt(process.env.CMS_FORMULARY_YEAR || "2026", 10);
const ONLY_CARRIER = (() => {
  const arg = process.argv.find((a) => a.startsWith("--carrier="));
  return arg ? arg.slice("--carrier=".length).replace(/^"|"$/g, "") : null;
})();

const TIMEOUT_MS = 15_000;
const MAX_PAGES = 50;

function joinUrl(base, path) {
  const b = base.endsWith("/") ? base : base + "/";
  const p = path.startsWith("/") ? path.slice(1) : path;
  return b + p;
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
    for (const e of bundle.entry ?? []) {
      if (e.resource) out.push(e.resource);
    }
    pages++;
    const next = bundle.link?.find((l) => l.relation === "next")?.url;
    url = next || null;
  }
  return out;
}

function normalizeName(s) {
  if (!s) return "";
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractNetworkIds(insurancePlan) {
  const refs = insurancePlan.network ?? [];
  return refs
    .map((r) => {
      const ref = r.reference ?? "";
      // Standard PDEX uses Network/<id>; some carriers (Humana) point at Organization/<id>.
      for (const prefix of ["Network/", "Organization/"]) {
        const idx = ref.lastIndexOf(prefix);
        if (idx >= 0) return { id: ref.slice(idx + prefix.length), kind: prefix.replace("/", "") };
      }
      return null;
    })
    .filter(Boolean);
}

function extractPlanIdentifiers(insurancePlan) {
  const ids = insurancePlan.identifier ?? [];
  return ids.map((i) => String(i.value ?? "").trim()).filter(Boolean);
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
    return { upserts: 0, skipped: true };
  }
  console.log(`[sync]   pulled ${resources.length} InsurancePlan resources`);

  // Pre-load plans for this carrier so we can match in memory.
  const carrierPlans = await plans
    .find({ year: YEAR, parentOrg: carrier.parentOrg })
    .project({ contractId: 1, planId: 1, segmentId: 1, name: 1 })
    .toArray();

  if (carrierPlans.length === 0) {
    console.warn(`[sync]   no plans in DB for parentOrg "${carrier.parentOrg}" — nothing to map`);
    return { upserts: 0, skipped: false };
  }

  const byName = new Map();
  const byContract = new Map();
  for (const p of carrierPlans) {
    if (p.name) byName.set(normalizeName(p.name), p);
    if (p.contractId) {
      const arr = byContract.get(p.contractId) ?? [];
      arr.push(p);
      byContract.set(p.contractId, arr);
    }
  }

  // Build a precise lookup for "<contractId>-<planId>-<segmentId>" keys, both
  // with literal segmentIds and with the common "0" → "000" zero-pad variant.
  const byKey = new Map();
  function normSegment(s) {
    if (s == null) return "000";
    const str = String(s);
    return str.length < 3 ? str.padStart(3, "0") : str;
  }
  for (const p of carrierPlans) {
    const k1 = `${p.contractId}-${p.planId}-${p.segmentId}`;
    const k2 = `${p.contractId}-${p.planId}-${normSegment(p.segmentId)}`;
    if (!byKey.has(k1)) byKey.set(k1, p);
    if (!byKey.has(k2)) byKey.set(k2, p);
  }

  const ops = [];
  let scanned = 0;
  for (const ip of resources) {
    scanned++;
    if (scanned % 500 === 0) {
      console.log(`[sync]   scanned ${scanned}/${resources.length}, queued ${ops.length} ops so far`);
    }
    const networkRefs = extractNetworkIds(ip);
    if (networkRefs.length === 0) continue;
    const primary = networkRefs[0];

    const ipName = normalizeName(ip.name ?? "");
    const ipIdents = extractPlanIdentifiers(ip);

    const matches = new Set();

    // Only exact (contract, plan, segment) matches. Never fall back to
    // "all plans under this contract" — that explodes into millions of bogus
    // rows for carriers that publish one InsurancePlan per plan-segment.
    for (const ident of ipIdents) {
      const full = ident.match(/^([A-Z]\d{4})-(\d{1,3})-(\d{1,3})(?:-(\d{4}))?$/);
      if (full) {
        const [, c, p, s] = full;
        const key = `${c}-${p}-${normSegment(s)}`;
        if (byKey.has(key)) matches.add(byKey.get(key));
      }
    }

    const allNetworkIds = Array.from(new Set(networkRefs.map((r) => r.id)));
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

  console.log(`[sync]   matched ${ops.length} (plan, network) pairs — bulk-writing to Mongo…`);
  let upserts = 0;
  const CHUNK = 500;
  for (let i = 0; i < ops.length; i += CHUNK) {
    const chunk = ops.slice(i, i + CHUNK);
    const r = await planNetworkMap.bulkWrite(chunk, { ordered: false });
    upserts += (r.upsertedCount ?? 0) + (r.modifiedCount ?? 0);
    console.log(`[sync]   bulk progress: ${Math.min(i + CHUNK, ops.length)}/${ops.length}`);
  }

  console.log(`[sync]   upserted ${upserts} mappings`);
  return { upserts, skipped: false };
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

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  try {
    await ensureIndexes(client);

    const filter = { enabled: true };
    if (ONLY_CARRIER) filter.parentOrg = ONLY_CARRIER;

    const carriers = await client
      .db(MONGODB_DB)
      .collection("carrierFhirEndpoints")
      .find(filter)
      .toArray();

    if (carriers.length === 0) {
      console.warn("[sync] no enabled carriers found — run `npm run seed:carriers` first");
      return;
    }

    let total = 0;
    let skipped = 0;
    for (const c of carriers) {
      const r = await syncCarrier(client, c);
      total += r.upserts;
      if (r.skipped) skipped++;
    }
    console.log(`[sync] done. total upserts: ${total}, carriers skipped: ${skipped}`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("[syncPlanNetworks] failed:", scrub(err));
  process.exit(1);
});
