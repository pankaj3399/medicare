import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type Doctor = {
  id: string;
  n: string;
  s: string;
  net: string;
  npi?: string;
};

export type Drug = {
  id: string;
  n: string;
  d: string;
  u: string;
  t: number;
  e: string;
  rxcui?: number;
  ndc?: string;
  fillsPerYear: number;
  scdRxCuis?: number[];
};

export type Priority =
  | "doctors"
  | "drugs"
  | "otc"
  | "premium"
  | "oop"
  | "dental"
  | "fitness"
  | "transport"
  | "telehealth";

export type Weights = Record<Priority, number>;

export type PlanResult = {
  id: string;
  year: number;
  contractId: string;
  planId: string;
  segmentId: string;
  name: string;
  carrier: string;
  type: string;
  snp: string | null;
  isDsnp: boolean;
  formularyId: string | null;
  premiumMonthly: number;
  deductibleTotal: number;
  moop: number;
  starOverall: number | null;
  state: string;
  countyFips: string;
  otc?: number;
  otcCats?: string[];
  extras?: string[];
  whyChoose?: string[];
  parentOrg?: string | null;
  countyName?: string | null;
};

export type DrugQuote = {
  rxcui: number;
  name: string;
  covered: boolean;
  tier: number | null;
  priorAuth: boolean;
  stepTherapy: boolean;
  monthlyCopay: number;
  annualCopay: number;
  matchedNdc: string | null;
};

export type PlanQuote = {
  planId: string;
  annualEstimate: number;
  monthlyAvg: number;
  drugs: DrugQuote[];
  notes: string[];
  warnings: string[];
};

export type EnrollContext = {
  id: string;
  nm: string;
  cr: string;
  pm: string;
  ty: string;
};

export type WizardState = {
  zip: string;
  yr: number;
  state: string;
  countyFips: string | null;
  countyName: string | null;
  med: boolean | null;
  otcMin: number;
  docs: Doctor[];
  drgs: Drug[];
  prios: Priority[];
  w: Weights;
  step: 1 | 2 | 3 | 4 | 5 | 6;
  loading: boolean;
  plans: PlanResult[];
  quotes: Record<string, PlanQuote>;
  cmp: string[];
  cur: EnrollContext | null;
  mailOrder: boolean;

  setZip: (zip: string, yr?: number) => void;
  setMed: (v: boolean) => void;
  setOtcMin: (n: number) => void;
  addDoctor: (d: Doctor) => void;
  removeDoctor: (id: string) => void;
  addDrug: (d: Drug) => void;
  removeDrug: (id: string) => void;
  setDrugFills: (id: string, fills: number) => void;
  setDrugSCDs: (id: string, scds: number[]) => void;
  togglePriority: (p: Priority) => void;
  setWeight: (p: Priority, v: number) => void;
  setMailOrder: (v: boolean) => void;
  goStep: (n: 1 | 2 | 3 | 4 | 5 | 6) => void;
  setLoading: (v: boolean) => void;
  setResults: (
    plans: PlanResult[],
    quotes: Record<string, PlanQuote>,
    countyName?: string | null,
  ) => void;
  toggleCompare: (id: string) => void;
  clearCompare: () => void;
  setEnroll: (c: EnrollContext | null) => void;
  reset: () => void;
};

const DEFAULT_WEIGHTS: Weights = {
  doctors: 5,
  drugs: 5,
  otc: 5,
  premium: 3,
  oop: 3,
  dental: 2,
  fitness: 2,
  transport: 2,
  telehealth: 2,
};

const initial: Omit<
  WizardState,
  | "setZip"
  | "setMed"
  | "setOtcMin"
  | "addDoctor"
  | "removeDoctor"
  | "addDrug"
  | "removeDrug"
  | "setDrugFills"
  | "setDrugSCDs"
  | "togglePriority"
  | "setWeight"
  | "setMailOrder"
  | "goStep"
  | "setLoading"
  | "setResults"
  | "toggleCompare"
  | "clearCompare"
  | "setEnroll"
  | "reset"
> = {
  zip: "",
  yr: 2026,
  state: "",
  countyFips: null,
  countyName: null,
  med: null,
  otcMin: 1000,
  docs: [],
  drgs: [],
  prios: ["doctors", "drugs"],
  w: { ...DEFAULT_WEIGHTS },
  step: 1,
  loading: false,
  plans: [],
  quotes: {},
  cmp: [],
  cur: null,
  mailOrder: false,
};

export const useWizard = create<WizardState>()(
  persist(
    (set, get) => ({
      ...initial,

      setZip: (zip, yr) =>
        set({
          zip,
          yr: yr ?? get().yr,
          state: zipToState(zip),
        }),

      setMed: (v) => {
        const prios = new Set(get().prios);
        if (v) prios.add("otc");
        else prios.delete("otc");
        set({ med: v, prios: Array.from(prios) });
      },

      setOtcMin: (n) => set({ otcMin: n }),

      addDoctor: (d) => {
        if (get().docs.some((x) => x.id === d.id)) return;
        set({ docs: [...get().docs, d] });
      },
      removeDoctor: (id) =>
        set({ docs: get().docs.filter((d) => d.id !== id) }),

      addDrug: (d) => {
        if (get().drgs.some((x) => x.id === d.id)) return;
        set({ drgs: [...get().drgs, { ...d, fillsPerYear: d.fillsPerYear ?? 12 }] });
      },
      removeDrug: (id) => set({ drgs: get().drgs.filter((d) => d.id !== id) }),
      setDrugFills: (id, fills) =>
        set({
          drgs: get().drgs.map((d) =>
            d.id === id
              ? { ...d, fillsPerYear: Math.max(1, Math.min(24, fills | 0)) }
              : d,
          ),
        }),
      setDrugSCDs: (id, scds) =>
        set({
          drgs: get().drgs.map((d) =>
            d.id === id ? { ...d, scdRxCuis: scds } : d,
          ),
        }),

      togglePriority: (p) => {
        const prios = new Set(get().prios);
        if (prios.has(p)) prios.delete(p);
        else prios.add(p);
        set({ prios: Array.from(prios) });
      },
      setWeight: (p, v) => set({ w: { ...get().w, [p]: v } }),
      setMailOrder: (v) => set({ mailOrder: v }),

      goStep: (n) => set({ step: n }),
      setLoading: (v) => set({ loading: v }),
      setResults: (plans, quotes, countyName) =>
        set({
          plans,
          quotes,
          loading: false,
          ...(countyName !== undefined ? { countyName } : {}),
        }),

      toggleCompare: (id) => {
        const set2 = new Set(get().cmp);
        if (set2.has(id)) set2.delete(id);
        else if (set2.size < 3) set2.add(id);
        set({ cmp: Array.from(set2) });
      },
      clearCompare: () => set({ cmp: [] }),

      setEnroll: (c) => set({ cur: c }),

      reset: () => set({ ...initial }),
    }),
    {
      name: "p4m-wizard",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        zip: s.zip,
        yr: s.yr,
        state: s.state,
        countyFips: s.countyFips,
        countyName: s.countyName,
        med: s.med,
        otcMin: s.otcMin,
        docs: s.docs,
        drgs: s.drgs,
        prios: s.prios,
        w: s.w,
        mailOrder: s.mailOrder,
      }),
      version: 1,
    },
  ),
);

export function zipToState(zip: string): string {
  const n = parseInt(zip, 10);
  if (!Number.isFinite(n)) return "";
  if (n >= 32004 && n <= 34997) return "FL";
  if (n >= 33000 && n <= 33999) return "FL";
  if (n >= 34000 && n <= 34999) return "FL";
  if (n >= 75001 && n <= 79999) return "TX";
  if (n >= 77001 && n <= 77999) return "TX";
  if (n >= 90001 && n <= 96162) return "CA";
  if (n >= 10001 && n <= 14975) return "NY";
  if (n >= 60001 && n <= 62999) return "IL";
  if (n >= 30001 && n <= 31999) return "GA";
  if (n >= 28001 && n <= 28999) return "NC";
  if (n >= 19001 && n <= 19640) return "PA";
  if (n >= 2001 && n <= 2999) return "MA";
  if (n >= 48001 && n <= 49999) return "MI";
  if (n >= 85001 && n <= 86999) return "AZ";
  return "NATIONAL";
}
