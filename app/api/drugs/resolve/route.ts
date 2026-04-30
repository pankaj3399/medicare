import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
// Cache the response on Vercel's edge for 24h to spare RxNorm.
export const revalidate = 86400;

const Body = z.object({
  rxcui: z.number().int().min(1),
});

export async function POST(request: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  // Map an "ingredient" RxCUI to its set of "Semantic Clinical Drug" RxCUIs.
  // The CMS formulary file keys on the SCD-level rxcui — not the ingredient.
  // We use RxNorm getRelatedByType, which is free and uncapped.
  try {
    const url = `https://rxnav.nlm.nih.gov/REST/rxcui/${body.rxcui}/related.json?tty=SCD+SBD`;
    const res = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) {
      return NextResponse.json(
        { rxcui: body.rxcui, scdRxCuis: [], ttyMap: {} },
        { headers: { "Cache-Control": "public, max-age=86400" } },
      );
    }
    const data = await res.json();
    const groups = data?.relatedGroup?.conceptGroup ?? [];
    const scdRxCuis: number[] = [];
    const ttyMap: Record<string, string> = {};
    for (const g of groups) {
      if (!Array.isArray(g.conceptProperties)) continue;
      for (const c of g.conceptProperties) {
        const id = parseInt(c.rxcui, 10);
        if (Number.isFinite(id) && !scdRxCuis.includes(id)) {
          scdRxCuis.push(id);
          ttyMap[String(id)] = c.name ?? "";
        }
      }
    }
    return NextResponse.json(
      { rxcui: body.rxcui, scdRxCuis, ttyMap },
      { headers: { "Cache-Control": "public, max-age=86400" } },
    );
  } catch {
    return NextResponse.json(
      { rxcui: body.rxcui, scdRxCuis: [], ttyMap: {} },
      { status: 200 },
    );
  }
}
