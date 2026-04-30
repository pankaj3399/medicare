"use client";

import { useState } from "react";
import { useWizard } from "@/store/wizard";

export default function CompareDrawer() {
  const cmp = useWizard((s) => s.cmp);
  const plans = useWizard((s) => s.plans);
  const toggleCompare = useWizard((s) => s.toggleCompare);
  const clearCompare = useWizard((s) => s.clearCompare);
  const [, setOpen] = useState(false);

  const open = () => {
    document.getElementById("compare-modal")?.classList.add("open");
    document.body.style.overflow = "hidden";
    setOpen(true);
  };

  return (
    <div className={`cmb${cmp.length >= 2 ? " up" : ""}`}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>Compare Plans</div>
        <div className="cmcs">
          {cmp.map((id) => {
            const p = plans.find((x) => x.id === id);
            if (!p) return null;
            return (
              <div key={id} className="cmc">
                {p.name.split(" ").slice(0, 3).join(" ")}
                <button onClick={() => toggleCompare(id)} type="button">×</button>
              </div>
            );
          })}
        </div>
      </div>
      <div className="cmr">
        <button className="bcc" onClick={clearCompare} type="button">
          Clear
        </button>
        <button className="bcn" onClick={open} type="button">
          Compare Now →
        </button>
      </div>
    </div>
  );
}
