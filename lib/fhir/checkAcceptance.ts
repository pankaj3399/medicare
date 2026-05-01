import {
  carrierFhirEndpointsCol,
  doctorPlanAcceptanceCol,
  planNetworkMapCol,
  plansCol,
  type DoctorPlanAcceptanceDoc,
} from "../mongo";
import { fhirGetAllPages, npiTokenParam, type FhirResource } from "./client";

const TTL_MS = 24 * 60 * 60 * 1000;

export type AcceptanceResult = Pick<
  DoctorPlanAcceptanceDoc,
  "inNetwork" | "source" | "reason" | "checkedAt"
>;

export type AcceptanceQuery = {
  npi: string;
  contractId: string;
  planId: string;
  segmentId: string;
};

function unknown(reason: string): AcceptanceResult {
  return { inNetwork: "unknown", source: "fhir", reason, checkedAt: new Date() };
}

async function readCache(q: AcceptanceQuery): Promise<AcceptanceResult | null> {
  const col = await doctorPlanAcceptanceCol();
  const hit = await col.findOne({
    npi: q.npi,
    contractId: q.contractId,
    planId: q.planId,
    segmentId: q.segmentId,
  });
  if (!hit) return null;
  if (hit.ttlExpiresAt.getTime() < Date.now()) return null;
  return {
    inNetwork: hit.inNetwork,
    source: hit.source,
    reason: hit.reason ?? null,
    checkedAt: hit.checkedAt,
  };
}

async function writeCache(q: AcceptanceQuery, r: AcceptanceResult): Promise<void> {
  const col = await doctorPlanAcceptanceCol();
  await col.updateOne(
    { npi: q.npi, contractId: q.contractId, planId: q.planId, segmentId: q.segmentId },
    {
      $set: {
        npi: q.npi,
        contractId: q.contractId,
        planId: q.planId,
        segmentId: q.segmentId,
        inNetwork: r.inNetwork,
        source: r.source,
        reason: r.reason ?? null,
        checkedAt: r.checkedAt,
        ttlExpiresAt: new Date(Date.now() + TTL_MS),
      },
    },
    { upsert: true },
  );
}

async function resolvePlanNetwork(q: AcceptanceQuery): Promise<
  | {
      parentOrg: string;
      networkIds: string[];
      networkRefKind: "Network" | "Organization";
      fhirBase: string;
    }
  | { error: string }
> {
  const plans = await plansCol();
  const plan = await plans.findOne({
    contractId: q.contractId,
    planId: q.planId,
    segmentId: q.segmentId,
  });
  if (!plan) return { error: "plan not found" };
  if (!plan.parentOrg) return { error: "plan has no parentOrg" };

  const carriers = await carrierFhirEndpointsCol();
  const carrier = await carriers.findOne({ parentOrg: plan.parentOrg, enabled: true });
  if (!carrier) return { error: `no FHIR endpoint for ${plan.parentOrg}` };

  const map = await planNetworkMapCol();
  const mapping = await map.findOne({
    contractId: q.contractId,
    planId: q.planId,
    segmentId: q.segmentId,
  });
  if (!mapping) return { error: "plan→network mapping not synced yet" };

  if (!mapping.networkIds || mapping.networkIds.length === 0) {
    return { error: "plan→network mapping has no network ids" };
  }
  return {
    parentOrg: plan.parentOrg,
    networkIds: mapping.networkIds,
    networkRefKind: (mapping.networkRefKind ?? "Network") as "Network" | "Organization",
    fhirBase: carrier.fhirBase,
  };
}

function roleMatchesAnyNetwork(
  role: FhirResource,
  networkIds: string[],
  refKind: "Network" | "Organization",
): boolean {
  const networks = (role as unknown as { network?: { reference?: string }[] }).network ?? [];
  const orgRef = (role as unknown as { organization?: { reference?: string } }).organization?.reference ?? "";
  const matchOne = (ref: string) =>
    networkIds.some((id) => ref === `${refKind}/${id}` || ref.endsWith(`/${refKind}/${id}`));
  if (networks.some((n) => matchOne(n.reference ?? ""))) return true;
  if (refKind === "Organization" && matchOne(orgRef)) return true;
  return false;
}

export async function checkAcceptance(q: AcceptanceQuery): Promise<AcceptanceResult> {
  const cached = await readCache(q);
  if (cached) return cached;

  const resolved = await resolvePlanNetwork(q);
  if ("error" in resolved) {
    const r = unknown(resolved.error);
    await writeCache(q, r);
    return r;
  }

  let result: AcceptanceResult;
  try {
    // Two-step query: chained `practitioner.identifier=...` searches are very slow
    // on some carrier FHIR servers (Humana times out). Resolve the Practitioner
    // resource by NPI first, then fetch their roles by direct id reference.
    const practBundle = await fhirGetAllPages(
      resolved.fhirBase,
      "Practitioner",
      { identifier: npiTokenParam(q.npi), _count: "5" },
      { timeoutMs: 15_000, retries: 1 },
      1,
    );
    if (practBundle.length === 0) {
      result = {
        inNetwork: "no",
        source: "fhir",
        reason: "NPI not found in carrier directory",
        checkedAt: new Date(),
      };
    } else {
      const practitionerId = practBundle[0].id ?? "";
      // Server-side filter: comma-separated network ids tell the carrier to
      // return only roles where the practitioner is in any of these networks.
      // For Humana the `network` param refers to Organization ids; for standard
      // PDEX it refers to Network ids — same query shape works for both.
      const roles = await fhirGetAllPages(
        resolved.fhirBase,
        "PractitionerRole",
        {
          practitioner: practitionerId,
          network: resolved.networkIds.join(","),
          _count: "5",
        },
        { timeoutMs: 15_000, retries: 1 },
        1,
      );
      if (roles.length > 0) {
        result = { inNetwork: "yes", source: "fhir", reason: null, checkedAt: new Date() };
      } else {
        result = {
          inNetwork: "no",
          source: "fhir",
          reason: "practitioner is not in any of this plan's networks",
          checkedAt: new Date(),
        };
      }
    }
  } catch (err) {
    result = unknown(err instanceof Error ? `fhir error: ${err.message}` : "fhir error");
  }

  await writeCache(q, result);
  return result;
}
