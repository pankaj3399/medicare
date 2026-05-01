import { NextResponse } from "next/server";
import { checkAcceptance } from "@/lib/fhir/checkAcceptance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parsePlanKey(planKey: string): { contractId: string; planId: string; segmentId: string } | null {
  const parts = planKey.split("-");
  if (parts.length !== 3) return null;
  const [contractId, planId, segmentId] = parts;
  if (!contractId || !planId || !segmentId) return null;
  return { contractId, planId, segmentId };
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ npi: string; planKey: string }> },
) {
  const { npi, planKey } = await ctx.params;

  if (!/^\d{10}$/.test(npi)) {
    return NextResponse.json({ error: "invalid NPI" }, { status: 400 });
  }
  const parsed = parsePlanKey(planKey);
  if (!parsed) {
    return NextResponse.json(
      { error: "planKey must be contractId-planId-segmentId" },
      { status: 400 },
    );
  }

  try {
    const result = await checkAcceptance({ npi, ...parsed });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json(
      { inNetwork: "unknown", source: "fhir", reason: msg },
      { status: 200 },
    );
  }
}
