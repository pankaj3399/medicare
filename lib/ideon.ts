const BASE = "https://api.ideonapi.com";
const VERSION = "v7";

export class IdeonError extends Error {
  status: number;
  bodySnippet: string;
  constructor(status: number, bodySnippet: string) {
    super(`Ideon ${status}: ${bodySnippet}`);
    this.status = status;
    this.bodySnippet = bodySnippet;
  }
}

async function ideonFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const key = process.env.IDEON_API_KEY;
  if (!key) throw new IdeonError(500, "missing IDEON_API_KEY");

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      "Vericred-Api-Key": key,
      "Accept-Version": VERSION,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new IdeonError(res.status, text.slice(0, 500));
  }
  return res.json();
}

export type IdeonCounty = {
  countyName: string;
  fips: string;
  state: string;
};

type ZipCountiesPayload = {
  counties?: Array<{ name: string; fips_code: string; state_code: string }>;
};

export async function ideonZipCounties(zip: string): Promise<IdeonCounty[]> {
  const data = (await ideonFetch(
    `/zip_counties?zip_prefix=${encodeURIComponent(zip)}`,
    { method: "GET" },
  )) as ZipCountiesPayload;
  return (data.counties ?? []).map((c) => ({
    countyName: c.name,
    fips: c.fips_code,
    state: c.state_code,
  }));
}

export type IdeonMedAdvSearchArgs = {
  zip: string;
  fips: string;
  enrollmentDate: string;
};

export type IdeonMedAdvSearchResult = {
  plans: unknown[];
  meta?: { total?: number };
};

export async function ideonSearchMedicareAdvantage(
  args: IdeonMedAdvSearchArgs,
): Promise<IdeonMedAdvSearchResult> {
  const body = {
    zip_code: args.zip,
    fips_code: args.fips,
    enrollment_date: args.enrollmentDate,
  };
  const data = (await ideonFetch("/plans/medadv/search", {
    method: "POST",
    body: JSON.stringify(body),
  })) as IdeonMedAdvSearchResult;
  return {
    plans: Array.isArray(data.plans) ? data.plans : [],
    meta: data.meta,
  };
}

export const IDEON_VERSION = VERSION;

// ----- Mapping Ideon plans → existing PlanResult shape ---------------------

import type { PlanResult } from "@/store/wizard";

type IdeonPlan = {
  id?: string;
  name?: string;
  plan_type?: string;
  carrier_name?: string;
  carrier?: { name?: string };
  premium_health?: number;
  premium_drug?: number;
  star_rating_overall?: number | null;
  benefits?: Record<string, string | undefined>;
  identifiers?: Array<{ type?: string; value?: string }>;
  audience?: string;
};

// Ideon benefit strings look like: "In-Network: $0 / Out-of-Network: 100%".
// We only care about the in-network half.
function inNetworkPart(s: string | undefined): string {
  if (!s) return "";
  const m = s.match(/In-Network:\s*([^/|]+)/i);
  return (m ? m[1] : s).trim();
}

// Pull the highest-cost dollar amount from a string fragment (handles ranges
// like "$0-$30" by returning the upper bound). Returns 0 when no $ found.
function parseDollar(s: string | undefined): number | null {
  const part = inNetworkPart(s);
  if (!part) return null;
  if (/not covered|not applicable|n\/a|unlimited/i.test(part)) return null;
  const matches = Array.from(part.matchAll(/\$([\d,]+(?:\.\d+)?)/g));
  if (matches.length === 0) return null;
  const nums = matches.map((m) => parseFloat(m[1].replace(/,/g, "")));
  return Math.max(...nums);
}

function parsePercent(s: string | undefined): number | null {
  const part = inNetworkPart(s);
  if (!part) return null;
  const m = part.match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? parseFloat(m[1]) : null;
}

// MOOP can also say "Unlimited" — treat that as 0 (UI shows "$0" but it's a known limitation of the trial mapping).
function parseMoop(s: string | undefined): number {
  const v = parseDollar(s);
  return v ?? 0;
}

function parseDeductible(s: string | undefined): number {
  const v = parseDollar(s);
  return v ?? 0;
}

function splitMedicarePlanId(value: string): {
  contractId: string;
  planId: string;
  segmentId: string;
} {
  // medicare_plan_id is "H4152-004-0" (contract-plan-segment).
  const parts = value.split("-");
  return {
    contractId: parts[0] ?? "",
    planId: parts[1] ?? "",
    segmentId: parts[2] ?? "0",
  };
}

export function mapIdeonPlan(
  p: IdeonPlan,
  ctx: { year: number; state: string; countyFips: string; countyName: string | null },
): PlanResult | null {
  const medId = p.identifiers?.find((i) => i.type === "medicare_plan_id")?.value;
  if (!medId) return null;
  const { contractId, planId, segmentId } = splitMedicarePlanId(medId);
  if (!contractId || !planId) return null;

  const carrier = p.carrier_name ?? p.carrier?.name ?? "Unknown";
  const benefits = p.benefits ?? {};
  const name = p.name ?? `${contractId}-${planId}`;
  const isDsnp = /D-?SNP|Dual/i.test(name);
  const snp = /SNP/i.test(name)
    ? isDsnp
      ? "D-SNP"
      : /C-?SNP|Chronic/i.test(name)
        ? "C-SNP"
        : "SNP"
    : null;

  const premium = (p.premium_health ?? 0) + (p.premium_drug ?? 0);

  return {
    id: `${ctx.year}-${contractId}-${planId}-${segmentId}`,
    year: ctx.year,
    contractId,
    planId,
    segmentId,
    name,
    carrier,
    type: p.plan_type ?? "",
    snp,
    isDsnp,
    formularyId: `${contractId}-${planId}`,
    premiumMonthly: premium,
    deductibleTotal: parseDeductible(benefits.deductible_annual_medical),
    moop: parseMoop(benefits.medical_moop),
    starOverall: p.star_rating_overall ?? null,
    state: ctx.state,
    countyFips: ctx.countyFips,
    otc: 0,
    otcCats: [],
    extras: [],
    whyChoose: [],
    parentOrg: null,
    countyName: ctx.countyName,
    pcpCopay: parseDollar(benefits.doctor_visit_primary),
    pcpCoinsurance:
      parseDollar(benefits.doctor_visit_primary) === null
        ? parsePercent(benefits.doctor_visit_primary)
        : null,
    specialistCopay: parseDollar(benefits.doctor_visit_specialist),
    specialistCoinsurance:
      parseDollar(benefits.doctor_visit_specialist) === null
        ? parsePercent(benefits.doctor_visit_specialist)
        : null,
  };
}
