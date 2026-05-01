import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// NPI Registry treats trailing `*` as a wildcard; we use that to forgive minor
// spelling variations (e.g. "Steinm" matches "Steinmetz") and partial entries.
function wildcard(s: string): string {
  return s.length >= 2 && !s.endsWith("*") ? `${s}*` : s;
}

const STATE_RE = /^[A-Z]{2}$/;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const stateRaw = (url.searchParams.get("state") ?? "").trim().toUpperCase();
  // Only forward a 2-letter US state; ignore "NATIONAL" or anything malformed.
  const state = STATE_RE.test(stateRaw) ? stateRaw : null;

  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  // Direct NPI lookup: any 10-digit input bypasses name search and ignores state.
  if (/^\d{10}$/.test(q)) {
    const search = new URLSearchParams({ version: "2.1", number: q });
    const r = await fetch(`https://npiregistry.cms.hhs.gov/api/?${search}`, {
      headers: { Accept: "application/json" },
    });
    const data = r.ok ? await r.json() : { results: [] };
    const results = data.results ?? [];
    const groups = [
      { type: results[0]?.enumeration_type === "NPI-2" ? 2 : 1, results },
    ];
    return NextResponse.json(
      { groups },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
    );
  }

  const words = q.split(/\s+/);
  const queries: Record<string, string>[] = [];
  if (words.length >= 2) {
    queries.push({
      enumeration_type: "NPI-1",
      first_name: wildcard(words[0]),
      last_name: wildcard(words.slice(1).join(" ")),
    });
    queries.push({
      enumeration_type: "NPI-1",
      last_name: wildcard(words[0]),
      first_name: wildcard(words.slice(1).join(" ")),
    });
  } else {
    queries.push({ enumeration_type: "NPI-1", last_name: wildcard(q) });
    queries.push({ enumeration_type: "NPI-1", first_name: wildcard(q) });
  }
  queries.push({ enumeration_type: "NPI-2", organization_name: wildcard(q) });

  const runQueries = async (withState: boolean) => {
    const responses = await Promise.allSettled(
      queries.map((params) => {
        const merged = withState && state ? { ...params, state } : params;
        const search = new URLSearchParams({ version: "2.1", limit: "8", ...merged });
        return fetch(`https://npiregistry.cms.hhs.gov/api/?${search}`, {
          headers: { Accept: "application/json" },
        }).then((r) => (r.ok ? r.json() : { results: [] }));
      }),
    );
    return responses.map((r, i) => ({
      type: queries[i].enumeration_type === "NPI-2" ? (2 as const) : (1 as const),
      results: r.status === "fulfilled" ? (r.value?.results ?? []) : [],
    }));
  };

  // First pass: filter to the user's state if known. If that returns nothing,
  // fall back to a national search so users who travel or have an out-of-state
  // doctor still see results.
  let groups = await runQueries(state !== null);
  const totalLocal = groups.reduce((n, g) => n + g.results.length, 0);
  if (state && totalLocal === 0) {
    groups = await runQueries(false);
  }

  return NextResponse.json(
    { groups },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
  );
}
