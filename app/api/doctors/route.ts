import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const words = q.split(/\s+/);
  const queries: Record<string, string>[] = [];
  if (words.length >= 2) {
    queries.push({
      enumeration_type: "NPI-1",
      first_name: words[0],
      last_name: words.slice(1).join(" "),
    });
    queries.push({
      enumeration_type: "NPI-1",
      last_name: words[0],
      first_name: words.slice(1).join(" "),
    });
  } else {
    queries.push({ enumeration_type: "NPI-1", last_name: q });
    queries.push({ enumeration_type: "NPI-1", first_name: q });
  }
  queries.push({ enumeration_type: "NPI-2", organization_name: q });

  const responses = await Promise.allSettled(
    queries.map((params) => {
      const search = new URLSearchParams({ version: "2.1", limit: "8", ...params });
      return fetch(`https://npiregistry.cms.hhs.gov/api/?${search}`, {
        headers: { Accept: "application/json" },
      }).then((r) => (r.ok ? r.json() : { results: [] }));
    }),
  );

  const groups = responses.map((r, i) => ({
    type: queries[i].enumeration_type === "NPI-2" ? 2 : 1,
    results: r.status === "fulfilled" ? (r.value?.results ?? []) : [],
  }));

  return NextResponse.json(
    { groups },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
  );
}
