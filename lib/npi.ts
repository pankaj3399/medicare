import type { Doctor } from "@/store/wizard";

type NPIResult = {
  number: string;
  basic?: {
    first_name?: string;
    last_name?: string;
    organization_name?: string;
    credential?: string;
  };
  addresses?: { city?: string; state?: string }[];
  taxonomies?: { primary?: boolean; desc?: string }[];
};

const DOCTOR_CREDENTIALS = [
  "MD",
  "DO",
  "DDS",
  "DMD",
  "DPM",
  "OD",
  "PharmD",
  "NP",
  "PA",
  "APRN",
];

function mapResult(r: NPIResult, type: 1 | 2): Doctor {
  if (type === 2) {
    const addr = r.addresses?.[0];
    return {
      id: `npi_${r.number}`,
      n: r.basic?.organization_name ?? "Unknown Org",
      s:
        r.taxonomies?.find((t) => t.primary)?.desc ?? "Healthcare Organization",
      net: addr ? [addr.city, addr.state].filter(Boolean).join(", ") : "",
      npi: r.number,
    };
  }
  const b = r.basic ?? {};
  const addr = r.addresses?.[0];
  const tax = r.taxonomies?.find((t) => t.primary);
  const cred = (b.credential ?? "").replace(/,/g, "").trim();
  const isDr = DOCTOR_CREDENTIALS.some((c) => cred.includes(c));
  const nameParts = [
    isDr ? "Dr." : "",
    b.first_name ?? "",
    b.last_name ?? "",
    cred ? `, ${cred}` : "",
  ];
  const nm = nameParts.filter(Boolean).join(" ").replace(" ,", ",").trim();
  return {
    id: `npi_${r.number}`,
    n: nm || "Unknown Provider",
    s: tax?.desc ?? "Healthcare Provider",
    net: addr ? [addr.city, addr.state].filter(Boolean).join(", ") : "",
    npi: r.number,
  };
}

export async function searchDoctors(
  query: string,
  used: string[],
): Promise<Doctor[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  let groups: { type: 1 | 2; results: NPIResult[] }[] = [];
  try {
    const res = await fetch(`/api/doctors?q=${encodeURIComponent(q)}`);
    if (!res.ok) return [];
    const data = await res.json();
    groups = data.groups ?? [];
  } catch {
    return [];
  }

  const seen = new Set<string>();
  const out: Doctor[] = [];
  for (const g of groups) {
    if (!g.results.length) continue;
    for (const item of g.results) {
      const mapped = mapResult(item, g.type);
      if (seen.has(mapped.id) || used.includes(mapped.id)) continue;
      seen.add(mapped.id);
      out.push(mapped);
      if (out.length >= 9) break;
    }
    if (out.length >= 9) break;
  }
  return out;
}
