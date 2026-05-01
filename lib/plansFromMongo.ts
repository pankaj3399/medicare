import type { Filter } from "mongodb";
import type { PlanResult } from "@/store/wizard";
import { plansCol, type PlanDoc } from "@/lib/mongo";
import { zipToState } from "@/store/wizard";

function planIdFor(p: PlanDoc): string {
  return `${p.year}-${p.contractId}-${p.planId}-${p.segmentId}`;
}

function formularyIdFor(p: PlanDoc): string {
  return `${p.contractId}-${p.planId}`;
}

function toResult(p: PlanDoc): PlanResult {
  return {
    id: planIdFor(p),
    year: p.year,
    contractId: p.contractId,
    planId: p.planId,
    segmentId: p.segmentId,
    name: p.name ?? `${p.contractId}-${p.planId}`,
    carrier: p.carrier ?? p.parentOrg ?? "Unknown",
    type: p.planType ?? p.contractCategory ?? "",
    snp: p.isSnp ? p.snpType ?? "SNP" : null,
    isDsnp: !!p.isDsnp,
    formularyId: formularyIdFor(p),
    premiumMonthly: p.consolidatedPremium ?? p.partDTotalPremium ?? 0,
    deductibleTotal: p.deductibleAnnual ?? 0,
    moop: p.moop ?? 0,
    starOverall: p.starOverall ?? p.starPartC ?? p.starPartD ?? null,
    state: p.state,
    countyFips: "00000",
    otc: 0,
    otcCats: [],
    extras: [],
    whyChoose: [],
    parentOrg: p.parentOrg ?? null,
    countyName: p.countyName ?? null,
  };
}

export async function findPlansByZip(
  zip: string,
  year: number,
  medicaid: boolean | null,
): Promise<{
  plans: PlanResult[];
  state: string;
  countyFips: string;
  countyName: string | null;
}> {
  const state = zipToState(zip);
  const col = await plansCol();

  const filter: Filter<PlanDoc> = { year };
  if (state && state !== "NATIONAL") filter.state = state;
  if (medicaid === false) filter.isDsnp = { $ne: true };

  const docs = await col
    .find(filter, {
      projection: {
        _id: 0,
        contractCategory: 1,
        year: 1,
        state: 1,
        countyName: 1,
        contractId: 1,
        planId: 1,
        segmentId: 1,
        carrier: 1,
        parentOrg: 1,
        name: 1,
        planType: 1,
        snpType: 1,
        isSnp: 1,
        isDsnp: 1,
        partDTotalPremium: 1,
        consolidatedPremium: 1,
        deductibleAnnual: 1,
        moop: 1,
        starOverall: 1,
        starPartC: 1,
        starPartD: 1,
        snpIndicator: 1,
      },
    })
    .limit(2000)
    .toArray();

  const seen = new Set<string>();
  const plans: PlanResult[] = [];
  let countyName: string | null = null;
  for (const d of docs) {
    const id = planIdFor(d);
    if (seen.has(id)) continue;
    seen.add(id);
    if (!countyName && d.countyName) countyName = d.countyName;
    plans.push(toResult(d));
  }
  plans.sort((a, b) => (b.starOverall ?? 0) - (a.starOverall ?? 0));

  return { plans, state, countyFips: "00000", countyName };
}

export async function findPlansByIds(
  ids: string[],
  year: number,
): Promise<Map<string, PlanResult>> {
  const col = await plansCol();
  const triples = ids
    .map((id) => {
      const parts = id.split("-");
      if (parts.length < 4) return null;
      const [y, contractId, planId, segmentId] = parts;
      if (parseInt(y, 10) !== year) return null;
      return { contractId, planId, segmentId };
    })
    .filter((x): x is { contractId: string; planId: string; segmentId: string } => !!x);

  if (triples.length === 0) return new Map();

  // The plans collection holds one row per plan-per-county, so a single
  // contract+plan+segment can match dozens of duplicate docs. Cap generously
  // so every requested plan gets at least one row — dedup happens below.
  const docs = await col
    .find({ year, $or: triples })
    .limit(triples.length * 100)
    .toArray();

  const out = new Map<string, PlanResult>();
  for (const d of docs) {
    const r = toResult(d);
    if (!out.has(r.id)) out.set(r.id, r);
  }
  return out;
}
