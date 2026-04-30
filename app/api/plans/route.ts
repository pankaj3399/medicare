import { NextResponse } from "next/server";
import { findPlansByZip } from "@/lib/plansFromMongo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  try {
    const { plans, state, countyFips, countyName } = await findPlansByZip(
      zip,
      year,
      medicaid,
    );
    return NextResponse.json(
      {
        zip,
        countyFips,
        countyName,
        state,
        year,
        count: plans.length,
        plans,
        generatedAt: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      },
    );
  } catch (err) {
    console.error("[/api/plans] mongo query failed:", err);
    return NextResponse.json(
      { error: "db_error", message: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
