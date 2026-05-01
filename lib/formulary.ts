import {
  planFormularyMapCol,
  formularyDrugsCol,
  tierCostsCol,
  type FormularyDrugDoc,
  type TierCostDoc,
} from "@/lib/mongo";

export type Pharmacy = "preferred_retail" | "standard_retail" | "mail";

export type PlanKey = {
  contractId: string;
  planId: string;
  segmentId: string;
};

export type DrugLookupInput = {
  rxcui: number | null;
  scdRxCuis?: number[];
  ndc?: string | null;
  name?: string | null;
};

export type ResolvedTier = {
  tier: number;
  priorAuth: boolean;
  stepTherapy: boolean;
  matchedRxcui: number;
  matchedNdc: string | null;
};

export type ResolvedCopay = {
  monthly: number;
  daysSupply: number;
  costType: "copay" | "coinsurance" | "unknown";
};

// CMS COVERAGE_LEVEL in the CY2026 PUF beneficiary cost file:
//   0 = Deductible phase
//   1 = Initial coverage (Pre-ICL)   ← we use this
//   3 = Catastrophic / Post-ICL phase
// (The 2026 Part D redesign eliminated the donut-hole gap level.)
const INITIAL_COVERAGE = 1;

// CMS DAYS_SUPPLY: 1 = 30-day, 2 = 60-day, 3 = 90-day. Pick by pharmacy choice.
function preferredDaysSupply(pharmacy: Pharmacy): number {
  return pharmacy === "mail" ? 3 : 1;
}

export async function getFormularyIds(
  year: number,
  keys: PlanKey[],
): Promise<Map<string, string>> {
  if (keys.length === 0) return new Map();
  const col = await planFormularyMapCol();
  const docs = await col
    .find({ year, $or: keys.map((k) => ({ contractId: k.contractId, planId: k.planId, segmentId: k.segmentId })) })
    .project({ _id: 0, contractId: 1, planId: 1, segmentId: 1, formularyId: 1 })
    .toArray();
  const out = new Map<string, string>();
  for (const d of docs) {
    out.set(`${d.contractId}-${d.planId}-${d.segmentId}`, d.formularyId as string);
  }
  return out;
}

export async function lookupTiers(
  year: number,
  formularyIds: string[],
  drug: DrugLookupInput,
): Promise<Map<string, ResolvedTier>> {
  if (formularyIds.length === 0) return new Map();
  let seedCandidates = uniqInt(
    [drug.rxcui ?? null, ...(drug.scdRxCuis ?? [])].filter(
      (x): x is number => x != null && Number.isFinite(x),
    ),
  );

  // If the user added the drug manually (no rxcui), resolve it by name
  // via RxNorm so we still produce a real formulary lookup.
  if (seedCandidates.length === 0 && drug.name) {
    const fromName = await rxcuisFromName(drug.name);
    if (fromName.length > 0) seedCandidates = fromName;
  }

  if (seedCandidates.length === 0) return new Map();

  // CMS formulary files key on the SCD-level RxCUI. The client may have
  // sent a BN, IN, or SBD code, so expand each seed via RxNorm to capture
  // every related concept (ingredient + all strengths/forms).
  const candidates = await expandRxcuis(seedCandidates);

  const col = await formularyDrugsCol();
  const docs = await col
    .find({
      year,
      formularyId: { $in: formularyIds },
      rxcui: { $in: candidates },
    })
    .project({ _id: 0 })
    .toArray() as FormularyDrugDoc[];

  // Group by formularyId; pick the lowest-tier match per formulary
  // (CMS files list one row per RxCUI per formulary, but multi-strength
  // matches via scdRxCuis can produce ties — pick the cheapest tier).
  const byFormulary = new Map<string, ResolvedTier>();
  for (const d of docs) {
    if (d.tier == null) continue;
    const cur = byFormulary.get(d.formularyId);
    if (!cur || d.tier < cur.tier) {
      byFormulary.set(d.formularyId, {
        tier: d.tier,
        priorAuth: !!d.priorAuth,
        stepTherapy: !!d.stepTherapy,
        matchedRxcui: d.rxcui,
        matchedNdc: d.ndc ?? null,
      });
    }
  }
  return byFormulary;
}

export async function lookupCopays(
  year: number,
  keys: PlanKey[],
  tier: number,
  pharmacy: Pharmacy,
): Promise<Map<string, ResolvedCopay>> {
  if (keys.length === 0) return new Map();
  const wantDays = preferredDaysSupply(pharmacy);
  const col = await tierCostsCol();
  const docs = await col
    .find({
      year,
      coverageLevel: INITIAL_COVERAGE,
      tier,
      $or: keys.map((k) => ({
        contractId: k.contractId,
        planId: k.planId,
        segmentId: k.segmentId,
      })),
    })
    .project({ _id: 0 })
    .toArray() as TierCostDoc[];

  // Group by plan key, prefer the requested days-supply but fall back to
  // any available row (some plans only publish 30-day pricing).
  const grouped = new Map<string, TierCostDoc[]>();
  for (const d of docs) {
    const k = `${d.contractId}-${d.planId}-${d.segmentId}`;
    const arr = grouped.get(k) ?? [];
    arr.push(d);
    grouped.set(k, arr);
  }

  const out = new Map<string, ResolvedCopay>();
  for (const [k, rows] of grouped) {
    const exact = rows.find((r) => r.daysSupply === wantDays);
    const pick = exact ?? rows[0];
    if (!pick) continue;
    out.set(k, normalizeCopay(pick, pharmacy));
  }
  return out;
}

function normalizeCopay(row: TierCostDoc, pharmacy: Pharmacy): ResolvedCopay {
  // CMS COST_TYPE: 1 = copay (flat $), 2 = coinsurance (%).
  // We prefer the pharmacy-channel-appropriate column, falling back to
  // standard retail when mail isn't published.
  const useMail = pharmacy === "mail" && row.mailPrefAmt != null;
  const type = useMail ? row.mailPrefType : row.prefType ?? row.stdType;
  const amt = useMail ? row.mailPrefAmt : row.prefAmt ?? row.stdAmt;
  const factor = pharmacy === "mail" && !useMail ? 3 : 1; // 90-day at retail ≈ 3x 30-day copay

  if (amt == null) {
    return { monthly: 0, daysSupply: row.daysSupply, costType: "unknown" };
  }
  if (type === 2) {
    // Coinsurance percent — we don't have drug-price data, so we
    // approximate at $0 and flag costType so callers can warn.
    return { monthly: 0, daysSupply: row.daysSupply, costType: "coinsurance" };
  }

  // 30-day equivalent
  let monthly = amt * factor;
  if (row.daysSupply === 3) monthly = amt / 3; // 90-day fill → per-month
  if (row.daysSupply === 2) monthly = amt / 2; // 60-day fill → per-month

  return {
    monthly: Math.round(monthly * 100) / 100,
    daysSupply: row.daysSupply,
    costType: "copay",
  };
}

function uniqInt(xs: number[]): number[] {
  return Array.from(new Set(xs));
}

// In-memory cache of RxNorm expansions. Keyed by seed rxcui → set of related
// rxcuis (ingredient, all SCDs, all SBDs, BN). Cleared on server restart;
// good enough since Next.js dev/prod processes are long-lived.
const expansionCache = new Map<number, number[]>();
const nameCache = new Map<string, number[]>();

async function rxcuisFromName(rawName: string): Promise<number[]> {
  const name = rawName.trim().toLowerCase();
  if (!name) return [];
  const cached = nameCache.get(name);
  if (cached) return cached;

  // Try the exact /drugs.json name match first (covers brands and generics).
  try {
    const res = await fetch(
      `https://rxnav.nlm.nih.gov/REST/drugs.json?name=${encodeURIComponent(rawName)}`,
    );
    if (res.ok) {
      const d = await res.json();
      const groups = d?.drugGroup?.conceptGroup ?? [];
      for (const tty of ["SBD", "SCD", "BN", "IN"]) {
        const g = groups.find((x: { tty: string }) => x.tty === tty);
        if (!g?.conceptProperties?.length) continue;
        const id = parseInt(g.conceptProperties[0].rxcui, 10);
        if (Number.isFinite(id)) {
          nameCache.set(name, [id]);
          return [id];
        }
      }
    }
  } catch {
    // fall through to approximate match
  }

  // Fallback: approximate match for typos / partial names.
  try {
    const res = await fetch(
      `https://rxnav.nlm.nih.gov/REST/approximateTerm.json?term=${encodeURIComponent(rawName)}&maxEntries=4`,
    );
    if (res.ok) {
      const d = await res.json();
      const cands = d?.approximateGroup?.candidate ?? [];
      for (const c of cands) {
        const id = parseInt(c.rxcui, 10);
        if (Number.isFinite(id)) {
          nameCache.set(name, [id]);
          return [id];
        }
      }
    }
  } catch {
    // give up — caller will treat drug as not covered
  }

  nameCache.set(name, []);
  return [];
}

async function expandRxcuis(seeds: number[]): Promise<number[]> {
  const out = new Set<number>(seeds);
  await Promise.all(
    seeds.map(async (seed) => {
      try {
        for (const id of await expandOne(seed)) out.add(id);
      } catch {
        // RxNorm hiccup — fall through with whatever seeds we have.
      }
    }),
  );
  return Array.from(out);
}

async function expandOne(seed: number): Promise<number[]> {
  const cached = expansionCache.get(seed);
  if (cached) return cached;

  // Step 1: walk to the ingredient(s) for this rxcui. From an IN seed,
  // related?tty=IN returns the same code; from a BN/SBD/SCD seed, it
  // returns the ingredient(s).
  const inUrl = `https://rxnav.nlm.nih.gov/REST/rxcui/${seed}/related.json?tty=IN`;
  const inRes = await fetch(inUrl);
  const ingredients: number[] = [];
  if (inRes.ok) {
    const data = await inRes.json();
    for (const g of data?.relatedGroup?.conceptGroup ?? []) {
      for (const c of g?.conceptProperties ?? []) {
        const id = parseInt(c.rxcui, 10);
        if (Number.isFinite(id)) ingredients.push(id);
      }
    }
  }
  if (ingredients.length === 0) ingredients.push(seed);

  // Step 2: from each ingredient, collect every related SCD/SBD/BN.
  const all = new Set<number>([seed, ...ingredients]);
  await Promise.all(
    ingredients.map(async (ing) => {
      const url = `https://rxnav.nlm.nih.gov/REST/rxcui/${ing}/related.json?tty=SCD+SBD+BN`;
      const r = await fetch(url);
      if (!r.ok) return;
      const d = await r.json();
      for (const g of d?.relatedGroup?.conceptGroup ?? []) {
        for (const c of g?.conceptProperties ?? []) {
          const id = parseInt(c.rxcui, 10);
          if (Number.isFinite(id)) all.add(id);
        }
      }
    }),
  );

  const list = Array.from(all);
  expansionCache.set(seed, list);
  return list;
}

export function parsePlanId(id: string): PlanKey | null {
  const parts = id.split("-");
  if (parts.length < 4) return null;
  // CMS Landscape CSV stores segmentId as "0", but the Part D PUF uses "000".
  // Normalize to the zero-padded form so formulary/tier-cost lookups hit.
  return {
    contractId: parts[1],
    planId: parts[2].padStart(3, "0"),
    segmentId: parts[3].padStart(3, "0"),
  };
}
