import { NextResponse } from "next/server";
import { z } from "zod";
import { copayForTier, mockTierForDrug } from "@/lib/drugs";
import { findPlansByIds } from "@/lib/plansFromMongo";
import type { PlanQuote, DrugQuote } from "@/store/wizard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  year: z.number().int().min(2025).max(2030),
  planIds: z.array(z.string()).min(1).max(60),
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

  const out: Record<string, PlanQuote> = {};
  for (const planId of body.planIds) {
    const plan = planLookup.get(planId);
    if (!plan || !plan.formularyId) {
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
    const drugQuotes: DrugQuote[] = [];
    let annualTotal = 0;
    const notes: string[] = [];
    for (const d of body.drugs) {
      const lookupKey =
        (d.scdRxCuis && d.scdRxCuis[0]) ?? d.rxcui ?? null;
      const tierInfo = mockTierForDrug(plan.formularyId, lookupKey, d.ndc ?? null);
      if (!tierInfo.covered) {
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
      let monthly = copayForTier(tierInfo.tier, plan.isDsnp, body.options.pharmacy);
      if (isInsulin(d.name) && monthly > 35) {
        monthly = 35;
        notes.push(`Insulin $35/month cap applied to ${d.name}`);
      }
      const monthsPerFill = body.options.pharmacy === "mail" ? 3 : 1;
      const billable = Math.max(1, Math.round(d.fillsPerYear / monthsPerFill));
      const annual = monthly * billable * monthsPerFill;
      annualTotal += annual;
      drugQuotes.push({
        rxcui: d.rxcui ?? 0,
        name: d.name,
        covered: true,
        tier: tierInfo.tier,
        priorAuth: tierInfo.priorAuth,
        stepTherapy: false,
        monthlyCopay: monthly,
        annualCopay: annual,
        matchedNdc: tierInfo.matchedNdc,
      });
    }
    if (plan.isDsnp) notes.push("D-SNP plan: $0 cost-sharing assumed for dual-eligibles");
    out[planId] = {
      planId,
      annualEstimate: annualTotal,
      monthlyAvg: Math.round(annualTotal / 12),
      drugs: drugQuotes,
      notes,
      warnings:
        body.options.estimateMode === "naive"
          ? ["Naive estimate excludes 2026 Part D deductible and $2,100 catastrophic cap"]
          : [],
    };
  }

  return NextResponse.json({
    year: body.year,
    plans: out,
    generatedAt: new Date().toISOString(),
  });
}
