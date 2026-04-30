"use client";

import { useEffect, useRef, useState } from "react";
import { useWizard, type Doctor } from "@/store/wizard";
import { searchDoctors } from "@/lib/npi";

export default function StepDoctors() {
  const docs = useWizard((s) => s.docs);
  const addDoctor = useWizard((s) => s.addDoctor);
  const removeDoctor = useWizard((s) => s.removeDoctor);
  const goStep = useWizard((s) => s.goStep);

  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Doctor[]>([]);
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(-1);
  const [loading, setLoading] = useState(false);
  const ddRef = useRef<HTMLDivElement | null>(null);
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
      const used = docs.map((d) => d.id);
      const results = await searchDoctors(q, used);
      setHits(results);
      setLoading(false);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, docs]);

  const pick = (d: Doctor) => {
    addDoctor(d);
    setQ("");
    setHits([]);
    setOpen(false);
  };

  const addManual = () => {
    const v = q.trim();
    if (!v) return;
    addDoctor({
      id: `c_${Date.now()}`,
      n: v,
      s: "Provider",
      net: "",
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
        <h2>Who are your doctors?</h2>
        <p>
          Search any provider by name — powered by CMS NPI Registry with 6M+ licensed US
          providers.
        </p>
      </div>
      <div className="cb">
        <div className="sw">
          <div className="sr">
            <div className="siw">
              <span className="sil">👨‍⚕️</span>
              <input
                className="si"
                type="text"
                inputMode="search"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="words"
                spellCheck={false}
                placeholder="Type any doctor name — e.g. Smith, Dr. Johnson, cardiologist…"
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
              <div ref={ddRef} className={`dd${open ? " open" : ""}`}>
                {loading && (
                  <div className="dde">
                    <span className="ddspin" /> Searching…
                  </div>
                )}
                {!loading && hits.length > 0 && (
                  <>
                    <div className="dd-sl">
                      Doctors &amp; Providers
                      <span className="dd-src">via CMS NPI Registry</span>
                    </div>
                    {hits.map((h, i) => (
                      <div
                        key={h.id}
                        className={`ddi${hl === i ? " hl" : ""}`}
                        onMouseDown={() => pick(h)}
                      >
                        <div className="ddav doc">👨‍⚕️</div>
                        <div className="ddinf">
                          <div
                            className="ddn"
                            dangerouslySetInnerHTML={{
                              __html: highlight(h.n, q),
                            }}
                          />
                          <div className="ddd">
                            {h.s}
                            {h.net ? ` · ${h.net}` : ""}
                          </div>
                        </div>
                        <span className="ddb ac">Verified</span>
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
        {!docs.length ? (
          <div className="te">
            <div className="ei">🩺</div>
            <div>Your doctors will appear here</div>
            <div style={{ fontSize: 12, marginTop: 3, color: "var(--i3)" }}>
              Searches all 6 million US licensed providers in real time
            </div>
          </div>
        ) : (
          <div className="tl2" style={{ display: "flex" }}>
            {docs.map((d) => (
              <div key={d.id} className="tag doc">
                <span>👨‍⚕️</span>
                {d.n}
                <button className="tx" onClick={() => removeDoctor(d.id)} type="button">
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="cal bl">
          <span className="cali">💡</span>
          <div>
            <strong style={{ fontWeight: 600 }}>Tip:</strong> Type a last name for best
            results. E.g. "Smith" or "Johnson". Results come from the live CMS NPI database.
          </div>
        </div>
      </div>
      <div className="cf">
        <button className="bbk" onClick={() => goStep(2)}>
          ← Back
        </button>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button className="bsk" onClick={() => goStep(4)}>
            Skip
          </button>
          <button className="bnx teal" onClick={() => goStep(4)}>
            Next: Medications
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

function highlight(text: string, q: string): string {
  if (!q.trim()) return escape(text);
  try {
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return escape(text).replace(
      new RegExp(`(${safe})`, "gi"),
      "<mark>$1</mark>",
    );
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
