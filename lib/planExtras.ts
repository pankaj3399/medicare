import overrides from "@/data/planExtras.json";
import type { PlanResult } from "@/store/wizard";

type Override = {
  otc?: number;
  otcCats?: string[];
  extras?: string[];
  whyChoose?: string[];
  carrierOtcLabel?: string;
};

const TABLE = overrides as Record<string, Override>;

const DSNP_DEFAULT: Override = {
  otc: 2400,
  otcCats: [
    "💊 Vitamins & Supplements",
    "🩹 First Aid",
    "🧴 Personal Care",
    "🏥 Medical Supplies",
  ],
  extras: [
    "Dental: cleanings, fillings, dentures",
    "Vision: eye exams + $200 frames allowance",
    "Hearing aids (low/no copay)",
    "Transportation: 24 one-way trips/yr",
    "Fitness: SilverSneakers gym membership",
    "Healthy food card (chronic-condition members)",
  ],
  whyChoose: ["$0 premium", "$0 PCP & specialist copays", "OTC + grocery card"],
};

export function enrichPlan(p: PlanResult): PlanResult {
  const key = `${p.contractId}-${p.planId}`;
  const ov = TABLE[key];
  const base: Override = p.isDsnp ? DSNP_DEFAULT : {};
  const merged: Override = { ...base, ...(ov ?? {}) };
  return {
    ...p,
    otc: merged.otc ?? p.otc ?? 0,
    otcCats: merged.otcCats ?? p.otcCats ?? [],
    extras: merged.extras ?? p.extras ?? [],
    whyChoose: merged.whyChoose ?? p.whyChoose ?? [],
  };
}
