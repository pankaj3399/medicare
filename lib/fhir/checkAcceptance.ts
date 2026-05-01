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
  | "inNetwork"
  | "source"
  | "reason"
  | "checkedAt"
  | "acceptingPatients"
  | "practiceLocations"
>;

const NEWPT_EXT = "http://hl7.org/fhir/us/davinci-pdex-plan-net/StructureDefinition/newpatients";

type RoleShape = {
  extension?: { url?: string; extension?: { url?: string; valueCodeableConcept?: { coding?: { code?: string; system?: string }[] } }[]; valueCodeableConcept?: { coding?: { code?: string; system?: string }[] } }[];
  location?: { display?: string; reference?: string }[];
};

function extractAcceptingPatients(role: FhirResource): "yes" | "no" | "existing" | "unknown" {
  const extensions = (role as unknown as RoleShape).extension ?? [];
  for (const ext of extensions) {
    if (ext.url !== NEWPT_EXT) continue;
    const inner = ext.extension ?? [];
    for (const sub of inner) {
      const coding = sub.valueCodeableConcept?.coding ?? [];
      for (const c of coding) {
        if (c.code === "newpt") return "yes";
        if (c.code === "nopt") return "no";
        if (c.code === "existptonly") return "existing";
      }
    }
    const coding = ext.valueCodeableConcept?.coding ?? [];
    for (const c of coding) {
      if (c.code === "newpt") return "yes";
      if (c.code === "nopt") return "no";
      if (c.code === "existptonly") return "existing";
    }
  }
  return "unknown";
}

function extractPracticeLocations(role: FhirResource): string[] {
  const locations = (role as unknown as RoleShape).location ?? [];
  return locations
    .map((l) => l.display)
    .filter((d): d is string => typeof d === "string" && d.trim().length > 0);
}

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
    acceptingPatients: hit.acceptingPatients ?? null,
    practiceLocations: hit.practiceLocations ?? [],
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
        acceptingPatients: r.acceptingPatients ?? null,
        practiceLocations: r.practiceLocations ?? [],
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
        // Combine across all matching roles: prefer "yes" → "existing" → "no" → "unknown"
        // for accepting-patients; union all distinct practice locations.
        const ranks = { yes: 3, existing: 2, no: 1, unknown: 0 } as const;
        let bestAccepting: "yes" | "no" | "existing" | "unknown" = "unknown";
        const locs = new Set<string>();
        for (const role of roles) {
          const a = extractAcceptingPatients(role);
          if (ranks[a] > ranks[bestAccepting]) bestAccepting = a;
          for (const loc of extractPracticeLocations(role)) locs.add(loc);
        }
        result = {
          inNetwork: "yes",
          source: "fhir",
          reason: null,
          acceptingPatients: bestAccepting,
          practiceLocations: Array.from(locs).slice(0, 4),
          checkedAt: new Date(),
        };
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
