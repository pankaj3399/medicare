export type FhirBundle = {
  resourceType: "Bundle";
  entry?: { resource?: FhirResource }[];
  link?: { relation: string; url: string }[];
};

export type FhirResource = {
  resourceType: string;
  id?: string;
  identifier?: { system?: string; value?: string }[];
  [key: string]: unknown;
};

export type FetchFhirOptions = {
  timeoutMs?: number;
  retries?: number;
};

const NPI_SYSTEM = "http://hl7.org/fhir/sid/us-npi";
const DEFAULT_TIMEOUT = 8000;
const DEFAULT_RETRIES = 1;

function joinUrl(base: string, path: string): string {
  const b = base.endsWith("/") ? base : base + "/";
  const p = path.startsWith("/") ? path.slice(1) : path;
  return b + p;
}

async function fetchJson(url: string, opts: FetchFhirOptions): Promise<FhirBundle | FhirResource | null> {
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  const retries = opts.retries ?? DEFAULT_RETRIES;

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/fhir+json, application/json" },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error(`FHIR ${res.status} ${res.statusText} for ${url}`);
      }
      return (await res.json()) as FhirBundle | FhirResource;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("FHIR fetch failed");
}

export async function fhirGet(
  base: string,
  resourcePath: string,
  params: Record<string, string> = {},
  opts: FetchFhirOptions = {},
): Promise<FhirBundle | FhirResource | null> {
  const search = new URLSearchParams(params);
  const qs = search.toString();
  const url = joinUrl(base, resourcePath) + (qs ? `?${qs}` : "");
  return fetchJson(url, opts);
}

export async function fhirGetAllPages(
  base: string,
  resourcePath: string,
  params: Record<string, string> = {},
  opts: FetchFhirOptions = {},
  maxPages = 5,
): Promise<FhirResource[]> {
  const out: FhirResource[] = [];
  let result = await fhirGet(base, resourcePath, params, opts);
  let pages = 0;
  while (result && (result as FhirBundle).resourceType === "Bundle") {
    const bundle = result as FhirBundle;
    for (const e of bundle.entry ?? []) {
      if (e.resource) out.push(e.resource);
    }
    pages++;
    const next = bundle.link?.find((l) => l.relation === "next")?.url;
    if (!next || pages >= maxPages) break;
    result = await fetchJson(next, opts);
  }
  return out;
}

export function npiTokenParam(npi: string): string {
  return `${NPI_SYSTEM}|${npi}`;
}

export { NPI_SYSTEM };
