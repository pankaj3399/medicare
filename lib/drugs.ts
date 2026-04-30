// Drug tier + copay helpers. The CMS landscape CSV does not carry per-plan
// formulary data, so tiers are computed deterministically from formularyId +
// rxcui until a real Part D Formulary file is wired in.

export function mockTierForDrug(
  formularyId: string,
  rxcui: number | null,
  ndc: string | null,
): { covered: boolean; tier: number; priorAuth: boolean; matchedNdc: string | null } {
  const seed = (rxcui ?? hashString(ndc ?? formularyId)) % 100;
  const formularyHash = hashString(formularyId) % 7;
  if (seed % 20 === 0 && formularyHash > 1) {
    return { covered: false, tier: 0, priorAuth: false, matchedNdc: null };
  }
  let tier = 1;
  if (seed % 13 === 0) tier = 4;
  else if (seed % 7 === 0) tier = 3;
  else if (seed % 3 === 0) tier = 2;
  if ((formularyHash + tier) % 8 === 0 && tier < 4) tier++;
  return {
    covered: true,
    tier,
    priorAuth: tier === 4 && seed % 11 === 0,
    matchedNdc: ndc ?? null,
  };
}

const TIER_COPAY_30: Record<number, number> = { 1: 0, 2: 12, 3: 47, 4: 95 };
const TIER_COPAY_MAIL_90: Record<number, number> = { 1: 0, 2: 24, 3: 110, 4: 250 };

export function copayForTier(
  tier: number,
  isDsnp: boolean,
  pharmacy: "preferred_retail" | "standard_retail" | "mail",
): number {
  if (isDsnp) return 0;
  if (pharmacy === "mail") return TIER_COPAY_MAIL_90[tier] ?? 0;
  return TIER_COPAY_30[tier] ?? 0;
}

function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
