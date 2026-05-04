"use client";

import { useEffect, useRef, useState } from "react";
import { useWizard, type Drug, type DrugForm, type DaysSupply } from "@/store/wizard";
import { searchDrugs } from "@/lib/rxsearch";
import { parseStrengthForm } from "@/lib/drugFields";

const TIER_LABEL = ["", "Tier 1 — Generic", "Tier 2 — Preferred Brand", "Tier 3 — Non-Preferred", "Tier 4 — Specialty"];
const TIER_SHORT = ["", "Tier 1", "Tier 2", "Tier 3", "Tier 4"];
const TIER_CLASS = ["", "t1", "t2", "t3", "t4"];

const FORM_OPTIONS: DrugForm[] = [
  "Tablet",
  "Capsule",
  "Liquid",
  "Injection",
  "Inhaler",
  "Patch",
  "Topical",
  "Drops",
  "Other",
];

const DAYS_OPTIONS: DaysSupply[] = [30, 60, 90];

export default function StepDrugs() {
  const drgs = useWizard((s) => s.drgs);
  const addDrug = useWizard((s) => s.addDrug);
  const removeDrug = useWizard((s) => s.removeDrug);
  const setDrugFields = useWizard((s) => s.setDrugFields);
  const goStep = useWizard((s) => s.goStep);

  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Drug[]>([]);
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(-1);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) {
      setHits([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    setOpen(true);
    debounceRef.current = setTimeout(async () => {
      const used = drgs.map((d) => d.id);
      const results = await searchDrugs(q, used);
      setHits(results);
      setLoading(false);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, drgs]);

  const pick = async (d: Drug) => {
    addDrug(d);
    setQ("");
    setHits([]);
    setOpen(false);
    if (d.rxcui) {
      try {
        const res = await fetch("/api/drugs/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rxcui: d.rxcui }),
        });
        if (res.ok) {
          const data = await res.json();
          const patch: Parameters<typeof setDrugFields>[1] = {};
          if (Array.isArray(data.scdRxCuis)) patch.scdRxCuis = data.scdRxCuis;
          if (!d.strength || !d.form) {
            const ttyMap = (data.ttyMap ?? {}) as Record<string, string>;
            for (const label of Object.values(ttyMap)) {
              const parsed = parseStrengthForm(label);
              if (!d.strength && parsed.strength) patch.strength = parsed.strength;
              if (!d.form && parsed.form) patch.form = parsed.form;
              if (patch.strength && patch.form) break;
            }
          }
          if (Object.keys(patch).length) setDrugFields(d.id, patch);
        }
      } catch {
        // resolve is best-effort; quote will fall back to ingredient rxcui
      }
    }
  };

  const addManual = () => {
    const v = q.trim();
    if (!v) return;
    addDrug({
      id: `c_${Date.now()}`,
      n: v,
      d: "",
      u: "Prescription medication",
      t: 2,
      e: "Varies",
      fillsPerYear: 12,
    });
    setQ("");
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHl((h) => Math.min(h + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHl((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (hl >= 0 && hits[hl]) pick(hits[hl]);
      else addManual();
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="pnl act card">
      <div className="ch">
        <h2>What medications do you take?</h2>
        <p>Search any drug — brand, generic, or condition. Powered by NIH RxNorm + FDA databases.</p>
      </div>
      <div className="cb">
        <div className="sw">
          <div className="sr">
            <div className="siw">
              <span className="sil">💊</span>
              <input
                className="si"
                type="text"
                inputMode="search"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="words"
                spellCheck={false}
                placeholder="Search any drug — Adderall, Ozempic, Lisinopril, Xanax, Humira…"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setHl(-1);
                }}
                onKeyDown={onKey}
                onFocus={() => q && setOpen(true)}
              />
              {q && (
                <button
                  type="button"
                  className="scl"
                  style={{ display: "flex" }}
                  onClick={() => setQ("")}
                >
                  ✕
                </button>
              )}
              <div className={`dd${open ? " open" : ""}`}>
                {loading && (
                  <div className="dde">
                    <span className="ddspin" /> Searching…
                  </div>
                )}
                {!loading && hits.length > 0 && (
                  <>
                    <div className="dd-sl">
                      Medications
                      <span className="dd-src">via NIH RxNorm + FDA</span>
                    </div>
                    {hits.map((h, i) => (
                      <div
                        key={h.id}
                        className={`ddi${hl === i ? " hl" : ""}`}
                        onMouseDown={() => pick(h)}
                      >
                        <div className="ddav drg">💊</div>
                        <div className="ddinf">
                          <div
                            className="ddn"
                            dangerouslySetInnerHTML={{
                              __html:
                                highlight(h.n, q) +
                                (h.strength
                                  ? ` <span style="font-weight:500;color:var(--i2);font-size:13px">${escape(h.strength)}</span>`
                                  : h.d
                                    ? ` <span style="font-weight:400;color:var(--i3);font-size:12px">${escape(h.d.substring(0, 35))}</span>`
                                    : ""),
                            }}
                          />
                          <div className="ddd">
                            {h.u} · Est. {h.e}
                          </div>
                        </div>
                        <span className={`ddb ${TIER_CLASS[h.t] ?? "t2"}`}>
                          {TIER_LABEL[h.t] ?? "Rx Drug"}
                        </span>
                      </div>
                    ))}
                  </>
                )}
                {!loading && !hits.length && q && (
                  <div className="dde">
                    No results found — tap "+ Add" to add manually
                  </div>
                )}
              </div>
            </div>
            <button className="badd" onClick={addManual} type="button">
              + Add
            </button>
          </div>
        </div>
        {!drgs.length ? (
          <div className="te">
            <div className="ei">💊</div>
            <div>Your medications will appear here</div>
            <div style={{ fontSize: 12, marginTop: 3, color: "var(--i3)" }}>
              Searches NIH RxNorm + FDA — every approved drug including controlled substances
            </div>
          </div>
        ) : (
          <div className="drglist">
            {drgs.map((d) => (
              <DrugCard
                key={d.id}
                drug={d}
                onChange={(patch) => setDrugFields(d.id, patch)}
                onRemove={() => removeDrug(d.id)}
              />
            ))}
          </div>
        )}
        <div className="cal tl">
          <span className="cali">💡</span>
          <div>
            <strong style={{ fontWeight: 600 }}>Add dosage & quantity for accurate pricing.</strong>{" "}
            Like UnitedHealthcare's plan tool, we use your strength, fill quantity, and days supply
            to estimate real annual drug cost on each plan — not just the tier.
          </div>
        </div>
      </div>
      <div className="cf">
        <button className="bbk" onClick={() => goStep(3)}>
          ← Back
        </button>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button className="bsk" onClick={() => goStep(5)}>
            Skip
          </button>
          <button className="bnx teal" onClick={() => goStep(5)}>
            Next: Your Priorities
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function DrugCard({
  drug,
  onChange,
  onRemove,
}: {
  drug: Drug;
  onChange: (patch: Parameters<ReturnType<typeof useWizard.getState>["setDrugFields"]>[1]) => void;
  onRemove: () => void;
}) {
  const tier = TIER_CLASS[drug.t] ?? "t2";
  const tierLabel = TIER_SHORT[drug.t] ?? "Rx";
  const strength = drug.strength ?? "";
  const form = drug.form ?? "Tablet";
  const quantity = drug.quantity ?? 30;
  const daysSupply = drug.daysSupply ?? 30;
  const sub = drug.d ? drug.d.substring(0, 40) : "";

  return (
    <div className="drugcard">
      <div className="drugcard-head">
        <span className="drugcard-emoji">💊</span>
        <span className="drugcard-name">{drug.n}</span>
        {strength && <span className="drugcard-sub">{strength}</span>}
        {!strength && sub && <span className="drugcard-sub">{sub}</span>}
        <span className={`ddb drugcard-tier ${tier}`}>{tierLabel}</span>
        <button
          type="button"
          className="drugcard-x"
          onClick={onRemove}
          aria-label={`Remove ${drug.n}`}
        >
          ✕
        </button>
      </div>
      <div className="drugcard-grid">
        <div className="drugcard-field">
          <label htmlFor={`dose-${drug.id}`}>Dosage</label>
          <input
            id={`dose-${drug.id}`}
            type="text"
            value={strength}
            placeholder="e.g. 10mg"
            onChange={(e) => onChange({ strength: e.target.value })}
          />
        </div>
        <div className="drugcard-field">
          <label htmlFor={`form-${drug.id}`}>Form</label>
          <select
            id={`form-${drug.id}`}
            value={form}
            onChange={(e) => onChange({ form: e.target.value as DrugForm })}
          >
            {FORM_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <div className="drugcard-field">
          <label htmlFor={`qty-${drug.id}`}>Quantity</label>
          <input
            id={`qty-${drug.id}`}
            type="number"
            min={1}
            max={365}
            value={quantity}
            onChange={(e) => onChange({ quantity: parseInt(e.target.value, 10) || 30 })}
          />
        </div>
        <div className="drugcard-field">
          <label htmlFor={`days-${drug.id}`}>Days Supply</label>
          <select
            id={`days-${drug.id}`}
            value={daysSupply}
            onChange={(e) => onChange({ daysSupply: parseInt(e.target.value, 10) as DaysSupply })}
          >
            {DAYS_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n} days
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

function highlight(text: string, q: string): string {
  if (!q.trim()) return escape(text);
  try {
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return escape(text).replace(new RegExp(`(${safe})`, "gi"), "<mark>$1</mark>");
  } catch {
    return escape(text);
  }
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
