"use client";

import { useEffect, useState } from "react";
import { useWizard } from "@/store/wizard";
import { score } from "@/lib/score";
import type { PlanResult, PlanQuote } from "@/store/wizard";

export default function StepLoading() {
  const zip = useWizard((s) => s.zip);
  const yr = useWizard((s) => s.yr);
  const med = useWizard((s) => s.med);
  const drgs = useWizard((s) => s.drgs);
  const mailOrder = useWizard((s) => s.mailOrder);
  const setResults = useWizard((s) => s.setResults);
  const setLoading = useWizard((s) => s.setLoading);

  const [stepIdx, setStepIdx] = useState(0);

  const steps = [
    `📍 Searching plans in ZIP ${zip}…`,
    "🏥 Loading real 2026 CMS Medicare plan data…",
    med ? "⭐ Filtering D-SNP Dual Eligible plans…" : "📋 Filtering Medicare Advantage plans…",
    "🩺 Matching your doctor networks…",
    "💊 Matching your drug formularies…",
    "⚡ Scoring plans by YOUR priorities…",
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setStepIdx((i) => Math.min(i + 1, steps.length));
    }, 380);
    return () => clearInterval(interval);
  }, [steps.length]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const url = new URL("/api/plans", window.location.origin);
        url.searchParams.set("zip", zip);
        url.searchParams.set("year", String(yr));
        if (med !== null) url.searchParams.set("medicaid", String(med));
        const planRes = await fetch(url.toString());
        if (!planRes.ok) {
          if (!cancelled) setResults([], {});
          return;
        }
        const planData = (await planRes.json()) as {
          plans: PlanResult[];
          countyName?: string | null;
        };
        const plans: PlanResult[] = planData.plans ?? [];
        const countyName: string | null = planData.countyName ?? null;

        let quotes: Record<string, PlanQuote> = {};
        if (drgs.length && plans.length) {
          const drugPayload = drgs.map((d) => ({
            rxcui: d.rxcui ?? null,
            ndc: d.ndc ?? null,
            scdRxCuis: d.scdRxCuis ?? [],
            fillsPerYear: d.fillsPerYear,
            name: d.n,
          }));
          const allIds = plans.map((p) => p.id);
          const CHUNK = 150;
          const chunks: string[][] = [];
          for (let i = 0; i < allIds.length; i += CHUNK) {
            chunks.push(allIds.slice(i, i + CHUNK));
          }
          const responses = await Promise.all(
            chunks.map((ids) =>
              fetch("/api/plans/quote", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  year: yr,
                  planIds: ids,
                  drugs: drugPayload,
                  options: {
                    pharmacy: mailOrder ? "mail" : "preferred_retail",
                    estimateMode: "naive",
                  },
                }),
              })
                .then((r) => (r.ok ? r.json() : null))
                .catch(() => null),
            ),
          );
          for (const qd of responses) {
            if (qd?.plans) Object.assign(quotes, qd.plans);
          }
        }

        // Wait long enough for the loading animation to feel intentional
        await new Promise((r) => setTimeout(r, Math.max(0, steps.length * 380 + 600)));
        if (cancelled) return;
        setResults(plans, quotes, countyName);
      } catch {
        if (!cancelled) {
          setResults([], {});
          setLoading(false);
        }
      }
    }
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zip, yr, med]);

  return (
    <div className="pnl act card">
      <div className="lw">
        <div className="lr" />
        <div className="lt">Searching plans in your area…</div>
        <div className="ls2">Loading real 2026 CMS Medicare plan data…</div>
        <div className="lss">
          {steps.map((s, i) => (
            <div
              key={i}
              className={`li${stepIdx > i ? " sh" : ""}${stepIdx > i + 1 ? " dn" : ""}`}
              style={stepIdx > i ? { opacity: 1, transform: "translateX(0)" } : undefined}
            >
              <div className="ld" />
              <span>{s}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Re-export so future imports work; score is currently used in StepResults
export { score };
