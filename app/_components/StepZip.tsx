"use client";

import { useState } from "react";
import { useWizard } from "@/store/wizard";

export default function StepZip() {
  const zip = useWizard((s) => s.zip);
  const yr = useWizard((s) => s.yr);
  const setZip = useWizard((s) => s.setZip);
  const goStep = useWizard((s) => s.goStep);
  const [local, setLocal] = useState(zip);
  const [year, setYear] = useState(yr);
  const [err, setErr] = useState(false);

  const next = () => {
    if (local.length !== 5) {
      setErr(true);
      return;
    }
    setErr(false);
    setZip(local, year);
    goStep(2);
  };

  return (
    <div className="pnl act card">
      <div className="ch">
        <h2>Where do you live?</h2>
        <p>
          Your ZIP code determines which plans are available. We cover FL, TX, CA, NY and more.
        </p>
      </div>
      <div className="cb">
        <div className="zg">
          <div className="fw" style={{ flex: "0 0 180px" }}>
            <label className="fl">ZIP Code *</label>
            <input
              className="fi"
              type="tel"
              placeholder="e.g. 33101"
              maxLength={5}
              value={local}
              onChange={(e) => setLocal(e.target.value.replace(/[^0-9]/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && next()}
            />
            {err && (
              <div style={{ color: "var(--red)", fontSize: 12, marginTop: 5 }}>
                Please enter a valid 5-digit ZIP
              </div>
            )}
          </div>
          <div className="fw" style={{ flex: "0 0 160px" }}>
            <label className="fl">Plan Year</label>
            <select
              className="fi"
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value, 10))}
            >
              <option value={2026}>2026 Plans</option>
            </select>
          </div>
          <div className="fw">
            <label className="fl">Currently on</label>
            <select className="fi" defaultValue="orig">
              <option value="orig">Original Medicare (A &amp; B)</option>
              <option value="ma">A Medicare Advantage plan</option>
              <option value="not">Not yet enrolled</option>
            </select>
          </div>
        </div>
        <div className="cal bl" style={{ marginTop: 20 }}>
          <span className="cali">💡</span>
          <div>
            Plan availability, premiums, and OTC card amounts all vary by ZIP code. We find
            every plan available in your specific county.
          </div>
        </div>
      </div>
      <div className="cf">
        <div style={{ fontSize: 13, color: "var(--i3)" }}>Step 1 of 5</div>
        <button className="bnx teal" onClick={next}>
          Next: Coverage Type
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
