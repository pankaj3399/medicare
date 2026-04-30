"use client";

import { useWizard } from "@/store/wizard";

const LABELS = ["Location", "Coverage", "Doctors", "Medications", "Priorities", "Results"];

export default function ProgressRail() {
  const step = useWizard((s) => s.step);
  const loading = useWizard((s) => s.loading);
  const goStep = useWizard((s) => s.goStep);
  const fill = [0, 20, 40, 60, 80, 100][step - 1];

  return (
    <div className="pw">
      <div className="pt">
        <div className="pl">
          <div className="plf" style={{ width: `${loading ? 100 : fill}%` }} />
        </div>
        <div className="pss">
          {LABELS.map((label, i) => {
            const idx = (i + 1) as 1 | 2 | 3 | 4 | 5 | 6;
            const isActive = idx === step;
            const isDone = idx < step || (loading && idx <= 5);
            return (
              <div
                key={label}
                className={`ps${isActive ? " act" : ""}${isDone ? " dn" : ""}`}
                onClick={() => idx < step && goStep(idx)}
                role="button"
              >
                <div className="pd">{idx}</div>
                <div className="plbl">{label}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
