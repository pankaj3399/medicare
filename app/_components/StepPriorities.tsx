"use client";

import { useWizard, type Priority } from "@/store/wizard";

const TILES: {
  p: Priority;
  emoji: string;
  name: string;
  desc: string;
  className?: string;
  badge?: string;
}[] = [
  { p: "doctors", emoji: "🩺", name: "Doctor Access", desc: "Keep your providers in-network at lowest cost" },
  { p: "drugs", emoji: "💊", name: "Drug Coverage", desc: "Lowest copays on all your prescriptions" },
  { p: "otc", emoji: "🛒", name: "OTC Card", desc: "Maximize monthly OTC allowance", className: "otp", badge: "Popular" },
  { p: "premium", emoji: "💰", name: "Low Premium", desc: "Keep monthly costs as low as possible" },
  { p: "oop", emoji: "🛡️", name: "Low Out-of-Pocket", desc: "Protection from large unexpected bills" },
  { p: "dental", emoji: "🦷", name: "Dental & Vision", desc: "Comprehensive dental, glasses, hearing aids" },
  { p: "fitness", emoji: "🏋️", name: "Fitness Benefits", desc: "SilverSneakers, gym membership, wellness" },
  { p: "transport", emoji: "🚗", name: "Transportation", desc: "Free rides to doctor appointments" },
  { p: "telehealth", emoji: "📱", name: "Telehealth", desc: "$0 virtual doctor visits from home" },
];

const LABELS: Record<Priority, string> = {
  doctors: "🩺 Doctor Access",
  drugs: "💊 Drug Coverage",
  otc: "🛒 OTC Card",
  premium: "💰 Low Premium",
  oop: "🛡️ Low OOP",
  dental: "🦷 Dental & Vision",
  fitness: "🏋️ Fitness",
  transport: "🚗 Transportation",
  telehealth: "📱 Telehealth",
};

export default function StepPriorities() {
  const med = useWizard((s) => s.med);
  const prios = useWizard((s) => s.prios);
  const w = useWizard((s) => s.w);
  const togglePriority = useWizard((s) => s.togglePriority);
  const setWeight = useWizard((s) => s.setWeight);
  const mailOrder = useWizard((s) => s.mailOrder);
  const setMailOrder = useWizard((s) => s.setMailOrder);
  const goStep = useWizard((s) => s.goStep);
  const setLoading = useWizard((s) => s.setLoading);

  const run = () => {
    setLoading(true);
    goStep(6);
  };

  const has = (p: Priority) => prios.includes(p);

  return (
    <div className="pnl act card">
      <div className="ch">
        <h2>What matters most to you?</h2>
        <p>This is what sets Plan4me apart. Rank your priorities — we score every plan specifically for you.</p>
      </div>
      <div className="cb">
        {med === true && (
          <div className="dsnp-ban" style={{ marginInline: 0, display: "flex" }}>
            <div className="dsnp-ic">⭐</div>
            <div className="dsnp-tx">
              <strong>D-SNP plans ranked first for you</strong>
              <span>
                Because you have Medicaid, Dual Special Needs Plans appear at the top — built
                specifically for dual-eligible members.
              </span>
            </div>
          </div>
        )}
        <div className="pg">
          {TILES.map((t) => (
            <div
              key={t.p}
              className={`prc${t.className ? " " + t.className : ""}${has(t.p) ? " on" : ""}`}
              onClick={() => togglePriority(t.p)}
              role="button"
            >
              <div className="prck" />
              <div className="prem">{t.emoji}</div>
              <div className="prnm">
                {t.name}
                {t.badge && <span className="nb">{t.badge}</span>}
              </div>
              <div className="prds">{t.desc}</div>
            </div>
          ))}
        </div>
        <div className="ir">
          {prios.length > 0 && (
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--i2)", marginBottom: 10 }}>
              How important is each to you? (1=low, 10=critical)
            </div>
          )}
          {prios.map((p) => (
            <div className="ii" key={p}>
              <span className="il">{LABELS[p]}</span>
              <div className="itrk">
                <div className="ifl" style={{ width: `${w[p] * 10}%` }} />
                <input
                  type="range"
                  className="irng"
                  min={1}
                  max={10}
                  value={w[p]}
                  onChange={(e) => setWeight(p, parseInt(e.target.value, 10))}
                />
              </div>
              <span className="iv">{w[p]}</span>
            </div>
          ))}
        </div>
        {prios.includes("drugs") && (
          <div className="cal tl">
            <span className="cali">📦</span>
            <div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={mailOrder}
                  onChange={(e) => setMailOrder(e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: "var(--teal)" }}
                />
                <span style={{ fontWeight: 600 }}>Use 90-day mail-order pricing</span>
              </label>
              <div style={{ marginTop: 4, fontSize: 12 }}>
                Most chronic prescriptions are cheaper via mail-order. We&apos;ll re-quote with
                90-day mail-order copays.
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="cf">
        <button className="bbk" onClick={() => goStep(4)}>
          ← Back
        </button>
        <button className="bnx teal" onClick={run}>
          Find My Best Plans ✨
        </button>
      </div>
    </div>
  );
}
