"use client";

import { useEffect, useRef, useState } from "react";
import { useWizard, type Drug } from "@/store/wizard";
import { searchDrugs } from "@/lib/rxsearch";

const TIER_LABEL = ["", "Tier 1 — Generic", "Tier 2 — Preferred Brand", "Tier 3 — Non-Preferred", "Tier 4 — Specialty"];
const TIER_CLASS = ["", "t1", "t2", "t3", "t4"];

export default function StepDrugs() {
  const drgs = useWizard((s) => s.drgs);
  const addDrug = useWizard((s) => s.addDrug);
  const removeDrug = useWizard((s) => s.removeDrug);
  const setDrugFills = useWizard((s) => s.setDrugFills);
  const setDrugSCDs = useWizard((s) => s.setDrugSCDs);
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
          if (Array.isArray(data.scdRxCuis)) setDrugSCDs(d.id, data.scdRxCuis);
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
                              __html: highlight(h.n, q) + (h.d
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
          <div className="tl2" style={{ display: "flex" }}>
            {drgs.map((d) => (
              <DrugTag key={d.id} drug={d} onChange={(v) => setDrugFills(d.id, v)} onRemove={() => removeDrug(d.id)} />
            ))}
          </div>
        )}
        <div className="cal tl">
          <span className="cali">💡</span>
          <div>
            <strong style={{ fontWeight: 600 }}>Drug tiers matter:</strong> Tier 1 generics
            cost $0–$10/mo. Tier 4 specialty drugs can cost hundreds. We factor this into your
            match score.
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

function DrugTag({
  drug,
  onChange,
  onRemove,
}: {
  drug: Drug;
  onChange: (v: number) => void;
  onRemove: () => void;
}) {
  return (
    <div className="tag drg">
      <span>💊</span>
      {drug.n}
      <span className="fillstep" title="How many times you pick up this prescription each year. Most people pick monthly = 12 fills.">
        <button
          type="button"
          aria-label="Fewer fills"
          onClick={() => onChange(drug.fillsPerYear - 1)}
        >
          −
        </button>
        <input
          type="number"
          min={1}
          max={24}
          value={drug.fillsPerYear}
          onChange={(e) => onChange(parseInt(e.target.value, 10) || 12)}
        />
        <button
          type="button"
          aria-label="More fills"
          onClick={() => onChange(drug.fillsPerYear + 1)}
        >
          +
        </button>
        <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 2 }}>fills/yr</span>
      </span>
      <button className="tx" onClick={onRemove} type="button">
        ✕
      </button>
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
