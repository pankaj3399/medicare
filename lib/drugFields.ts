import type { DrugForm } from "@/store/wizard";

const STRENGTH_RE = /(\d+(?:\.\d+)?)\s*(MG|MCG|G|ML|UNIT|UNITS|IU|%)/i;

const FORM_KEYWORDS: Array<[RegExp, DrugForm]> = [
  [/inhal|inhaler|aerosol|hfa|metered/i, "Inhaler"],
  [/injection|injectable|prefilled|pen|syringe|vial|subcutaneous/i, "Injection"],
  [/patch|transdermal/i, "Patch"],
  [/cream|ointment|gel|topical|lotion/i, "Topical"],
  [/drops?|ophthalmic|otic/i, "Drops"],
  [/capsule|cap\b/i, "Capsule"],
  [/tablet|tab\b|odt/i, "Tablet"],
  [/solution|suspension|syrup|liquid|elixir/i, "Liquid"],
];

export function parseStrengthForm(d?: string | null): {
  strength?: string;
  form?: DrugForm;
} {
  if (!d) return {};
  const out: { strength?: string; form?: DrugForm } = {};

  const m = STRENGTH_RE.exec(d);
  if (m) {
    const num = m[1];
    const unit = m[2].toLowerCase().replace(/^units$/, "unit");
    out.strength = `${num}${unit}`;
  }

  for (const [re, form] of FORM_KEYWORDS) {
    if (re.test(d)) {
      out.form = form;
      break;
    }
  }

  return out;
}
