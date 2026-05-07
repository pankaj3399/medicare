import { NextResponse } from "next/server";
import { findPlansByZip } from "@/lib/plansFromMongo";
import {
  IdeonError,
  ideonSearchMedicareAdvantage,
  ideonZipCounties,
  mapIdeonPlan,
} from "@/lib/ideon";
import { zipToState, type PlanResult } from "@/store/wizard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IdeonPlan = Parameters<typeof mapIdeonPlan>[0];

async function fetchIdeonPlans(
  zip: string,
  year: number,
): Promise<{
  plans: PlanResult[];
  state: string;
  countyFips: string;
  countyName: string | null;
} | null> {
  if (!process.env.IDEON_API_KEY) return null;

  const counties = await ideonZipCounties(zip);
  if (counties.length === 0) return null;
  const c = counties[0];

  const { plans } = await ideonSearchMedicareAdvantage({
    zip,
    fips: c.fips,
    enrollmentDate: `${year}-01-01`,
  });

  const seen = new Set<string>();
  const mapped: PlanResult[] = [];
  for (const raw of plans as IdeonPlan[]) {
    const r = mapIdeonPlan(raw, {
      year,
      state: c.state,
      countyFips: c.fips,
      countyName: c.countyName,
    });
    if (!r) continue;
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    mapped.push(r);
  }
  mapped.sort((a, b) => (b.starOverall ?? 0) - (a.starOverall ?? 0));

  return {
    plans: mapped,
    state: c.state,
    countyFips: c.fips,
    countyName: c.countyName,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const zip = url.searchParams.get("zip") ?? "";
  const yearStr = url.searchParams.get("year") ?? "2026";
  const medicaidStr = url.searchParams.get("medicaid");

  if (!/^\d{5}$/.test(zip)) {
    return NextResponse.json(
      { error: "invalid_zip", message: "ZIP must be 5 digits" },
      { status: 400 },
    );
  }
  const year = parseInt(yearStr, 10);
  if (!Number.isFinite(year) || year < 2025 || year > 2030) {
    return NextResponse.json({ error: "invalid_year" }, { status: 400 });
  }
  const medicaid = medicaidStr === null ? null : medicaidStr === "true";

  let source: "ideon" | "mongo" = "mongo";
  let result: {
    plans: PlanResult[];
    state: string;
    countyFips: string;
    countyName: string | null;
  } | null = null;

  try {
    const ideon = await fetchIdeonPlans(zip, year);
    if (ideon && ideon.plans.length > 0) {
      result = ideon;
      source = "ideon";
    }
  } catch (err) {
    if (err instanceof IdeonError) {
      console.warn(
        `[plans] ideon failed status=${err.status}, falling back to mongo. snippet=${err.bodySnippet.slice(0, 200)}`,
      );
    } else {
      console.warn(
        `[plans] ideon unexpected, falling back to mongo: ${err instanceof Error ? err.message : "unknown"}`,
      );
    }
  }

  if (!result) {
    try {
      const mongoResult = await findPlansByZip(zip, year, medicaid);
      result = {
        plans: mongoResult.plans,
        state: mongoResult.state || zipToState(zip),
        countyFips: mongoResult.countyFips,
        countyName: mongoResult.countyName,
      };
      source = "mongo";
    } catch (err) {
      console.error("[/api/plans] mongo query failed:", err);
      return NextResponse.json(
        { error: "db_error", message: err instanceof Error ? err.message : "unknown" },
        { status: 500 },
      );
    }
  }

  let plans = result.plans;
  if (source === "ideon" && medicaid === false) {
    plans = plans.filter((p) => !p.isDsnp);
  }

  return NextResponse.json(
    {
      zip,
      countyFips: result.countyFips,
      countyName: result.countyName,
      state: result.state,
      year,
      source,
      count: plans.length,
      plans,
      generatedAt: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control":
          source === "ideon"
            ? "no-store"
            : "public, s-maxage=300, stale-while-revalidate=600",
      },
    },
  );
}
