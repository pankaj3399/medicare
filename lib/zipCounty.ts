type Entry = { c: string; s: string };
type Dataset = Record<string, Entry>;

let cache: Dataset | null = null;
let inflight: Promise<Dataset> | null = null;

async function loadDataset(): Promise<Dataset> {
  if (cache) return cache;
  if (!inflight) {
    inflight = fetch("/data/zipCounty.json")
      .then((r) => {
        if (!r.ok) throw new Error(`zipCounty fetch failed: ${r.status}`);
        return r.json() as Promise<Dataset>;
      })
      .then((d) => {
        cache = d;
        return d;
      })
      .catch((e) => {
        inflight = null;
        throw e;
      });
  }
  return inflight;
}

export async function lookupCounty(
  zip: string,
): Promise<{ countyName: string; state: string } | null> {
  if (!/^\d{5}$/.test(zip)) return null;
  const data = await loadDataset();
  const e = data[zip];
  return e ? { countyName: e.c, state: e.s } : null;
}
