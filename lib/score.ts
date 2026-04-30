import type {
  PlanResult,
  PlanQuote,
  Priority,
  Weights,
} from "@/store/wizard";

export type ScoreInput = {
  med: boolean | null;
  otcMin: number;
  prios: Priority[];
  weights: Weights;
  docCount: number;
  drugCount: number;
  userState: string;
};

const has = (prios: Priority[], p: Priority) => prios.includes(p);

export function score(
  plan: PlanResult,
  quote: PlanQuote | undefined,
  input: ScoreInput,
): number {
  let s = 50;

  if (input.userState && plan.state === input.userState) s += 25;
  else if (plan.state === "NATIONAL") s += 8;

  if (input.med === true && plan.isDsnp) s += 25;
  else if (input.med === true && !plan.isDsnp) s -= 15;
  else if (input.med === false && plan.isDsnp) return 0;

  const otc = plan.otc ?? 0;
  if (input.med === true && otc < input.otcMin) s -= 8;

  if (has(input.prios, "premium") && plan.premiumMonthly === 0) {
    s += input.weights.premium * 1.5;
  }
  if (has(input.prios, "oop")) {
    s += ((8000 - (plan.moop ?? 8000)) / 1200) * input.weights.oop;
  }
  if (has(input.prios, "otc")) {
    s += (otc / 120) * (input.weights.otc * 0.3);
  }
  const extras = plan.extras ?? [];
  if (
    has(input.prios, "dental") &&
    extras.some((e) => /dental.*\$?[1-3],/i.test(e))
  ) {
    s += input.weights.dental * 2;
  }
  if (
    has(input.prios, "fitness") &&
    extras.some((e) => /silver|tivity|one\s*pass/i.test(e))
  ) {
    s += input.weights.fitness;
  }
  if (
    has(input.prios, "transport") &&
    extras.some((e) => /ride|transport/i.test(e))
  ) {
    s += input.weights.transport * 1.5;
  }
  if (
    has(input.prios, "telehealth") &&
    extras.some((e) => /telehealth/i.test(e))
  ) {
    s += input.weights.telehealth;
  }
  if (input.docCount && has(input.prios, "doctors")) {
    s += Math.min(12, input.docCount * 3);
  }
  if (input.drugCount && has(input.prios, "drugs")) {
    s += Math.min(12, input.drugCount * 3);
    if (quote) {
      // lower annual drug cost → bigger boost
      const cost = quote.annualEstimate;
      const drugBoost =
        cost <= 0
          ? input.weights.drugs * 1.6
          : cost < 600
            ? input.weights.drugs * 1.0
            : cost < 1500
              ? input.weights.drugs * 0.4
              : -input.weights.drugs * 0.6;
      s += drugBoost;
      // any drug not covered → penalize
      const uncovered = quote.drugs.filter((d) => !d.covered).length;
      if (uncovered > 0) s -= uncovered * 4;
    }
  }
  s += (plan.starOverall ?? 3) * 1.5;
  return Math.min(99, Math.max(50, Math.round(s)));
}
