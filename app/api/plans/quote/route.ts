import { NextResponse } from "next/server";
import { z } from "zod";
import { copayForTier, mockTierForDrug } from "@/lib/drugs";
import { findPlansByIds } from "@/lib/plansFromMongo";
import {
  getFormularyIds,
  lookupCopays,
  lookupTiers,
  parsePlanId,
  type Pharmacy,
  type PlanKey,
} from "@/lib/formulary";
import type { PlanQuote, DrugQuote } from "@/store/wizard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  year: z.number().int().min(2025).max(2030),
  planIds: z.array(z.string()).min(1).max(200),
  drugs: z.array(
    z.object({
      rxcui: z.number().int().nullable().optional(),
      ndc: z.string().nullable().optional(),
      scdRxCuis: z.array(z.number().int()).optional(),
      fillsPerYear: z.number().min(1).max(24),
      name: z.string().min(1),
    }),
  ),
  options: z
    .object({
      pharmacy: z
        .enum(["preferred_retail", "standard_retail", "mail"])
        .default("preferred_retail"),
      estimateMode: z.enum(["naive", "three_phase"]).default("naive"),
    })
    .default({ pharmacy: "preferred_retail", estimateMode: "naive" }),
});

const INSULIN_KEYWORDS = [
  "insulin",
  "lantus",
  "humalog",
  "novolog",
  "tresiba",
  "basaglar",
  "toujeo",
  "fiasp",
  "admelog",
];

function isInsulin(name: string): boolean {
  const k = name.toLowerCase();
  return INSULIN_KEYWORDS.some((w) => k.includes(w));
}

export async function POST(request: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch (e) {
    return NextResponse.json(
      { error: "invalid_body", details: e instanceof Error ? e.message : "" },
      { status: 400 },
    );
  }

  let planLookup: Awaited<ReturnType<typeof findPlansByIds>>;
  try {
    planLookup = await findPlansByIds(body.planIds, body.year);
  } catch (err) {
    console.error("[/api/plans/quote] mongo lookup failed:", err);
    return NextResponse.json(
      { error: "db_error", message: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }

  const pharmacy: Pharmacy = body.options.pharmacy;

  // Build the set of plan keys we'll need for formulary + tier-cost lookups.
  const planKeys: PlanKey[] = [];
  for (const id of body.planIds) {
    const k = parsePlanId(id);
    if (k) planKeys.push(k);
  }

  // 1) Resolve each plan's formulary id (CMS plan information file).
  let formularyByPlanKey = new Map<string, string>();
  let cmsDataAvailable = false;
  try {
    formularyByPlanKey = await getFormularyIds(body.year, planKeys);
    cmsDataAvailable = formularyByPlanKey.size > 0;
  } catch (err) {
    console.warn("[/api/plans/quote] formulary lookup failed (using heuristic):", err);
  }

  // 2) For each drug, resolve tier on every relevant formulary in one round-trip.
  const allFormularyIds = Array.from(new Set([...formularyByPlanKey.values()]));
  const tierMatrix = new Map<
    number, // drug index
    Map<string, { tier: number; priorAuth: boolean; stepTherapy: boolean; matchedNdc: string | null }>
  >();
  if (cmsDataAvailable) {
    for (let di = 0; di < body.drugs.length; di++) {
      const d = body.drugs[di];
      try {
        const tiers = await lookupTiers(body.year, allFormularyIds, {
          rxcui: d.rxcui ?? null,
          scdRxCuis: d.scdRxCuis,
          ndc: d.ndc ?? null,
          name: d.name,
        });
        tierMatrix.set(di, tiers);
      } catch (err) {
        console.warn("[/api/plans/quote] tier lookup failed for drug:", d.name, err);
      }
    }
  }

  // 3) Pre-fetch tier copays per (plan, tier) — group calls by tier number.
  const copayByPlanAndTier = new Map<string, Map<number, { monthly: number; costType: string }>>();
  if (cmsDataAvailable) {
    const neededTiers = new Set<number>();
    for (const m of tierMatrix.values()) {
      for (const t of m.values()) neededTiers.add(t.tier);
    }
    for (const tier of neededTiers) {
      try {
        const copays = await lookupCopays(body.year, planKeys, tier, pharmacy);
        for (const [k, copay] of copays) {
          const planMap = copayByPlanAndTier.get(k) ?? new Map<number, { monthly: number; costType: string }>();
          planMap.set(tier, { monthly: copay.monthly, costType: copay.costType });
          copayByPlanAndTier.set(k, planMap);
        }
      } catch (err) {
        console.warn("[/api/plans/quote] copay lookup failed for tier:", tier, err);
      }
    }
  }

  const out: Record<string, PlanQuote> = {};
  let coinsuranceSeen = false;

  for (const planId of body.planIds) {
    const plan = planLookup.get(planId);
    if (!plan) {
      out[planId] = {
        planId,
        annualEstimate: 0,
        monthlyAvg: 0,
        drugs: [],
        notes: ["Plan not found"],
        warnings: [],
      };
      continue;
    }

    const key = parsePlanId(planId);
    const planLookupKey = key ? `${key.contractId}-${key.planId}-${key.segmentId}` : "";
    const formularyId = formularyByPlanKey.get(planLookupKey) ?? plan.formularyId ?? null;
    const usedHeuristic = !cmsDataAvailable || !formularyByPlanKey.has(planLookupKey);

    const drugQuotes: DrugQuote[] = [];
    let annualTotal = 0;
    const notes: string[] = [];

    for (let di = 0; di < body.drugs.length; di++) {
      const d = body.drugs[di];

      let tier: number | null = null;
      let priorAuth = false;
      let stepTherapy = false;
      let matchedNdc: string | null = null;
      let covered = false;

      if (cmsDataAvailable && !usedHeuristic) {
        const tiers = tierMatrix.get(di);
        const hit = formularyId ? tiers?.get(formularyId) : undefined;
        if (hit) {
          tier = hit.tier;
          priorAuth = hit.priorAuth;
          stepTherapy = hit.stepTherapy;
          matchedNdc = hit.matchedNdc;
          covered = true;
        }
      } else if (formularyId) {
        const lookupKey = (d.scdRxCuis && d.scdRxCuis[0]) ?? d.rxcui ?? null;
        const fallback = mockTierForDrug(formularyId, lookupKey, d.ndc ?? null);
        if (fallback.covered) {
          tier = fallback.tier;
          priorAuth = fallback.priorAuth;
          matchedNdc = fallback.matchedNdc;
          covered = true;
        }
      }

      if (!covered || tier == null) {
        drugQuotes.push({
          rxcui: d.rxcui ?? 0,
          name: d.name,
          covered: false,
          tier: null,
          priorAuth: false,
          stepTherapy: false,
          monthlyCopay: 0,
          annualCopay: 0,
          matchedNdc: null,
        });
        continue;
      }

      // D-SNP plans charge $0 cost-share to dual-eligibles.
      let monthly: number;
      if (plan.isDsnp) {
        monthly = 0;
      } else if (cmsDataAvailable && !usedHeuristic) {
        const tierMap = copayByPlanAndTier.get(planLookupKey);
        const copay = tierMap?.get(tier);
        if (!copay) {
          // CMS file didn't publish a price for this tier on this plan
          // (rare — usually means the plan lists the drug but the cost
          // schedule omits the tier). Fall back to the heuristic ladder.
          monthly = copayForTier(tier, plan.isDsnp, pharmacy);
        } else {
          monthly = copay.monthly;
          if (copay.costType === "coinsurance") {
            coinsuranceSeen = true;
            monthly = copayForTier(tier, plan.isDsnp, pharmacy); // best-effort fallback
          }
        }
      } else {
        monthly = copayForTier(tier, plan.isDsnp, pharmacy);
      }

      if (isInsulin(d.name) && monthly > 35) {
        monthly = 35;
        notes.push(`Insulin $35/month cap applied to ${d.name}`);
      }

      const monthsPerFill = pharmacy === "mail" ? 3 : 1;
      const billable = Math.max(1, Math.round(d.fillsPerYear / monthsPerFill));
      const annual = monthly * billable * monthsPerFill;
      annualTotal += annual;

      drugQuotes.push({
        rxcui: d.rxcui ?? 0,
        name: d.name,
        covered: true,
        tier,
        priorAuth,
        stepTherapy,
        monthlyCopay: monthly,
        annualCopay: annual,
        matchedNdc,
      });
    }

    if (plan.isDsnp) notes.push("D-SNP plan: $0 cost-sharing assumed for dual-eligibles");
    if (usedHeuristic && cmsDataAvailable) {
      notes.push("Plan not found in CMS formulary file — estimate uses heuristic tier ladder");
    } else if (!cmsDataAvailable) {
      notes.push("CMS formulary data not seeded — estimate uses heuristic tier ladder");
    }

    const warnings: string[] = [];
    if (body.options.estimateMode === "naive") {
      warnings.push(
        "Naive estimate excludes 2026 Part D deductible and $2,100 catastrophic cap",
      );
    }
    if (coinsuranceSeen) {
      warnings.push(
        "One or more drugs use coinsurance pricing — actual cost depends on the drug's negotiated price",
      );
    }

    out[planId] = {
      planId,
      annualEstimate: Math.round(annualTotal),
      monthlyAvg: Math.round(annualTotal / 12),
      drugs: drugQuotes,
      notes,
      warnings,
    };
  }

  return NextResponse.json({
    year: body.year,
    plans: out,
    cmsFormularyAvailable: cmsDataAvailable,
    generatedAt: new Date().toISOString(),
  });
}
