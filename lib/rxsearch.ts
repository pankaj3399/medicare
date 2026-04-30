import type { Drug } from "@/store/wizard";

const USAGE_HINTS: Record<string, string> = {
  adderall: "ADHD treatment",
  xanax: "Anxiety / panic disorder",
  ambien: "Insomnia / sleep disorder",
  valium: "Anxiety / muscle relaxant",
  oxycontin: "Pain management (opioid)",
  percocet: "Pain (opioid combination)",
  vicodin: "Pain (opioid combination)",
  suboxone: "Opioid use disorder treatment",
  prozac: "Depression / anxiety (SSRI)",
  zoloft: "Depression / anxiety (SSRI)",
  lexapro: "Depression / anxiety (SSRI)",
  wellbutrin: "Depression / smoking cessation",
  cymbalta: "Depression / nerve pain",
  abilify: "Antipsychotic / depression add-on",
  seroquel: "Bipolar disorder / schizophrenia",
  synthroid: "Hypothyroidism",
  metformin: "Type 2 diabetes",
  insulin: "Diabetes management",
  ozempic: "Type 2 diabetes / weight loss (GLP-1)",
  wegovy: "Chronic weight management (GLP-1)",
  mounjaro: "Type 2 diabetes / weight loss",
  jardiance: "Type 2 diabetes / heart failure",
  farxiga: "Type 2 diabetes / heart failure",
  eliquis: "Blood thinner — AFib / DVT prevention",
  xarelto: "Blood thinner — AFib / DVT",
  warfarin: "Blood thinner (anticoagulant)",
  lipitor: "High cholesterol (statin)",
  crestor: "High cholesterol (statin)",
  lisinopril: "High blood pressure (ACE inhibitor)",
  losartan: "High blood pressure (ARB)",
  amlodipine: "High blood pressure / chest pain",
  metoprolol: "Heart failure / blood pressure (beta-blocker)",
  advair: "Asthma / COPD management",
  albuterol: "Asthma rescue inhaler",
  spiriva: "COPD management",
  humira: "Rheumatoid arthritis / Crohns disease",
  enbrel: "Rheumatoid arthritis / psoriasis",
  gabapentin: "Nerve pain / seizure disorder",
  lyrica: "Fibromyalgia / nerve pain",
  tramadol: "Moderate pain relief",
  prednisone: "Inflammation / autoimmune conditions",
  amoxicillin: "Bacterial infections (antibiotic)",
  azithromycin: "Bacterial infections (Z-pack antibiotic)",
  atorvastatin: "High cholesterol (generic Lipitor)",
  omeprazole: "Acid reflux / GERD",
  pantoprazole: "Acid reflux / stomach ulcers",
  sertraline: "Depression / anxiety (generic Zoloft)",
  levothyroxine: "Hypothyroidism (thyroid hormone)",
  hydrochlorothiazide: "High blood pressure / fluid retention",
  furosemide: "Fluid retention / heart failure",
  carvedilol: "Heart failure / high blood pressure",
};

function usageHint(name: string): string {
  const k = name.toLowerCase();
  for (const [key, val] of Object.entries(USAGE_HINTS)) {
    if (k.includes(key)) return val;
  }
  return "Prescription medication";
}

async function rxNormSearch(q: string, used: string[]): Promise<Drug[]> {
  try {
    const res = await fetch(
      `https://rxnav.nlm.nih.gov/REST/drugs.json?name=${encodeURIComponent(q)}`,
    );
    const data = await res.json();
    const groups = data?.drugGroup?.conceptGroup ?? [];
    const out: Drug[] = [];
    const seen = new Set<string>();
    for (const tty of ["SBD", "SCD", "BN", "IN"]) {
      const grp = groups.find((g: { tty: string }) => g.tty === tty);
      if (!grp?.conceptProperties) continue;
      for (const c of grp.conceptProperties) {
        const base = (c.name ?? "").split(" ")[0];
        if (!base || seen.has(base.toLowerCase())) continue;
        seen.add(base.toLowerCase());
        const id = `rxn_${c.rxcui}`;
        if (used.includes(id)) continue;
        const isBrand = ["SBD", "BN"].includes(tty);
        out.push({
          id,
          n: base,
          d: (c.name ?? "").split(" ").slice(1).join(" "),
          u: usageHint(base),
          t: isBrand ? 2 : 1,
          e: isBrand ? "Varies by plan" : "$0–$10/mo (est.)",
          rxcui: parseInt(c.rxcui, 10),
          fillsPerYear: 12,
        });
        if (out.length >= 6) break;
      }
      if (out.length >= 6) break;
    }
    if (!out.length) {
      const r2 = await fetch(
        `https://rxnav.nlm.nih.gov/REST/approximateTerm.json?term=${encodeURIComponent(q)}&maxEntries=8`,
      );
      const d2 = await r2.json();
      for (const c of d2?.approximateGroup?.candidate ?? []) {
        const base = (c.name ?? "").split(" ")[0];
        if (!base || seen.has(base.toLowerCase())) continue;
        seen.add(base.toLowerCase());
        out.push({
          id: `rxn_${c.rxcui}`,
          n: base,
          d: (c.name ?? "").split(" ").slice(1).join(" "),
          u: usageHint(base),
          t: 2,
          e: "Varies by plan",
          rxcui: parseInt(c.rxcui, 10),
          fillsPerYear: 12,
        });
        if (out.length >= 6) break;
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function fdaSearch(q: string, used: string[]): Promise<Drug[]> {
  try {
    const res = await fetch(
      `https://api.fda.gov/drug/ndc.json?search=brand_name:${encodeURIComponent(q)}*+generic_name:${encodeURIComponent(q)}*&limit=12`,
    );
    const data = await res.json();
    if (!data.results?.length) return [];
    const seen = new Set<string>();
    const out: Drug[] = [];
    for (const r of data.results) {
      const nm = r.brand_name || r.generic_name?.split(" ")[0] || "";
      if (!nm || seen.has(nm.toLowerCase())) continue;
      seen.add(nm.toLowerCase());
      const id = `ndc_${nm.toLowerCase().replace(/\s+/g, "_")}`;
      if (used.includes(id)) continue;
      const gen =
        !r.brand_name ||
        r.brand_name.toLowerCase() === r.generic_name?.toLowerCase().split(" ")[0];
      const sched = r.dea_schedule ?? "";
      const form = r.dosage_form ?? "";
      const route = (r.route ?? []).join(", ");
      const description = `${form}${route ? " · " + route : ""}${sched ? " · Schedule " + sched : ""}`
        .replace(/^· /, "")
        .trim();
      out.push({
        id,
        n: nm,
        d:
          r.generic_name && r.generic_name.toLowerCase() !== nm.toLowerCase()
            ? r.generic_name.split(";")[0].trim().substring(0, 40)
            : "",
        u: description || "Prescription medication",
        t: sched ? 3 : gen ? 1 : 2,
        e: sched ? "May need prior auth" : gen ? "$0–$10/mo (est.)" : "Varies by plan",
        ndc: r.product_ndc,
        fillsPerYear: 12,
      });
      if (out.length >= 6) break;
    }
    return out;
  } catch {
    return [];
  }
}

export async function searchDrugs(query: string, used: string[]): Promise<Drug[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const [rx, fda] = await Promise.allSettled([
    rxNormSearch(q, used),
    fdaSearch(q, used),
  ]);
  const seen = new Set<string>();
  const out: Drug[] = [];
  for (const r of [rx, fda]) {
    if (r.status !== "fulfilled" || !r.value.length) continue;
    for (const d of r.value) {
      const k = d.n.toLowerCase().split(" ")[0];
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(d);
    }
  }
  return out
    .sort((a, b) =>
      a.n.toLowerCase().startsWith(q.toLowerCase()) ? -1 : 1,
    )
    .slice(0, 9);
}
