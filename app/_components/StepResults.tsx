"use client";

import { useEffect, useMemo, useState } from "react";
import { useWizard, type PlanResult } from "@/store/wizard";
import { score } from "@/lib/score";
import PlanCard from "./PlanCard";
import {
  getCachedAcceptance,
  prefetchAcceptance,
  useAcceptanceCacheTick,
} from "./useDoctorAcceptance";

type SortKey = "match" | "premium" | "oop" | "stars" | "otc" | "drugs";

export default function StepResults() {
  const zip = useWizard((s) => s.zip);
  const state = useWizard((s) => s.state);
  const countyName = useWizard((s) => s.countyName);
  const med = useWizard((s) => s.med);
  const otcMin = useWizard((s) => s.otcMin);
  const docs = useWizard((s) => s.docs);
  const drgs = useWizard((s) => s.drgs);
  const prios = useWizard((s) => s.prios);
  const w = useWizard((s) => s.w);
  const plans = useWizard((s) => s.plans);
  const quotes = useWizard((s) => s.quotes);
  const cmp = useWizard((s) => s.cmp);
  const toggleCompare = useWizard((s) => s.toggleCompare);
  const setEnroll = useWizard((s) => s.setEnroll);
  const goStep = useWizard((s) => s.goStep);

  const [sort, setSort] = useState<SortKey>("match");
  const [verifiableOnly, setVerifiableOnly] = useState(false);

  const VERIFIABLE_PARENT_ORGS = useMemo(() => new Set(["Humana Inc."]), []);

  const verifiableCount = useMemo(
    () =>
      plans.filter(
        (p) => p.parentOrg && VERIFIABLE_PARENT_ORGS.has(p.parentOrg),
      ).length,
    [plans, VERIFIABLE_PARENT_ORGS],
  );

  const ranked = useMemo(() => {
    const scored = plans
      .map((p) => ({
        plan: p,
        match: score(p, quotes[p.id], {
          med,
          otcMin,
          prios,
          weights: w,
          docCount: docs.length,
          drugCount: drgs.length,
          userState: state,
        }),
      }))
      .filter((x) => x.match > 0)
      .filter((x) =>
        !verifiableOnly ||
        (x.plan.parentOrg ? VERIFIABLE_PARENT_ORGS.has(x.plan.parentOrg) : false),
      );
    const isVerifiable = (parentOrg?: string | null) =>
      parentOrg ? VERIFIABLE_PARENT_ORGS.has(parentOrg) : false;
    const userHasNpi = docs.some((d) => d.npi);

    if (sort === "premium") scored.sort((a, b) => a.plan.premiumMonthly - b.plan.premiumMonthly);
    else if (sort === "oop") scored.sort((a, b) => a.plan.moop - b.plan.moop);
    else if (sort === "stars") scored.sort((a, b) => (b.plan.starOverall ?? 0) - (a.plan.starOverall ?? 0));
    else if (sort === "otc") scored.sort((a, b) => (b.plan.otc ?? 0) - (a.plan.otc ?? 0));
    else if (sort === "drugs") scored.sort((a, b) => (quotes[a.plan.id]?.annualEstimate ?? Infinity) - (quotes[b.plan.id]?.annualEstimate ?? Infinity));
    else if (userHasNpi && !verifiableOnly) {
      // Best Match with a real doctor added: lift verifiable-carrier plans to
      // the top while preserving relative match-score order within each group.
      scored.sort((a, b) => {
        const av = isVerifiable(a.plan.parentOrg) ? 1 : 0;
        const bv = isVerifiable(b.plan.parentOrg) ? 1 : 0;
        if (av !== bv) return bv - av;
        return b.match - a.match;
      });
    }
    else scored.sort((a, b) => b.match - a.match);
    return scored;
  }, [plans, quotes, sort, med, otcMin, prios, w, docs.length, drgs.length, state, verifiableOnly, VERIFIABLE_PARENT_ORGS]);

  // Pre-warm the doctor-acceptance cache for ALL verifiable-carrier plans
  // when the user has NPI-bearing doctors added. After cache hits, this is
  // free; first run is paced by the carrier API but every result lands in
  // the module cache and feeds the summary below.
  const verifiablePlans = useMemo(
    () =>
      ranked
        .map((x) => x.plan)
        .filter((p) => p.parentOrg && VERIFIABLE_PARENT_ORGS.has(p.parentOrg)),
    [ranked, VERIFIABLE_PARENT_ORGS],
  );
  const npiDocs = useMemo(
    () => docs.filter((d) => !!d.npi) as { id: string; n: string; npi: string }[],
    [docs],
  );

  useEffect(() => {
    if (npiDocs.length === 0) return;
    for (const p of verifiablePlans) {
      const planKey = `${p.contractId}-${p.planId}-${p.segmentId}`;
      for (const d of npiDocs) prefetchAcceptance(d.npi, planKey);
    }
  }, [verifiablePlans, npiDocs]);

  // Re-render whenever any acceptance result lands so the summary updates live.
  useAcceptanceCacheTick();

  const coverageSummary = useMemo(() => {
    if (npiDocs.length === 0 || verifiablePlans.length === 0) return null;
    let plansAllCovered = 0;
    let plansAnyCovered = 0;
    let resultsKnown = 0;
    const total = verifiablePlans.length * npiDocs.length;
    const docsCoveredSomewhere = new Set<string>();
    for (const p of verifiablePlans) {
      const planKey = `${p.contractId}-${p.planId}-${p.segmentId}`;
      let allYes = true;
      let anyYes = false;
      let allKnown = true;
      for (const d of npiDocs) {
        const status = getCachedAcceptance(d.npi, planKey);
        if (!status) {
          allYes = false;
          allKnown = false;
          continue;
        }
        resultsKnown++;
        if (status.inNetwork === "yes") {
          anyYes = true;
          docsCoveredSomewhere.add(d.npi);
        } else {
          allYes = false;
        }
      }
      if (allKnown && allYes) plansAllCovered++;
      if (anyYes) plansAnyCovered++;
    }
    return {
      plansAllCovered,
      plansAnyCovered,
      docsCovered: docsCoveredSomewhere.size,
      docsTotal: npiDocs.length,
      plansTotal: verifiablePlans.length,
      progress: total > 0 ? resultsKnown / total : 1,
    };
  }, [npiDocs, verifiablePlans]);

  const enroll = (p: PlanResult) =>
    setEnroll({
      id: p.id,
      nm: p.name,
      cr: p.carrier,
      pm: p.premiumMonthly === 0 ? "$0" : `$${p.premiumMonthly}`,
      ty: p.isDsnp ? "D-SNP" : p.type,
    });

  const PRIO_LABEL: Record<string, string> = {
    doctors: "Doctor access",
    drugs: "Drug coverage",
    otc: "OTC card size",
    premium: "Low premium",
    oop: "Low out-of-pocket",
    dental: "Dental & vision",
    fitness: "Fitness benefits",
    transport: "Transportation",
    telehealth: "Telehealth",
  };

  return (
    <div className="pnl act" style={{ display: "block" }}>
      <div className="rtb">
        <div>
          <div className="rti">
            Found <span>{ranked.length}</span> plans near you
          </div>
          <div className="rm">
            2026 Medicare Advantage plans in {state || "your area"} (ZIP {zip}) — ranked by your priorities
          </div>
        </div>
        <div className="stbs">
          <button className={`stb${sort === "match" ? " on" : ""}`} onClick={() => setSort("match")}>
            Best Match
          </button>
          {drgs.length > 0 && (
            <button className={`stb${sort === "drugs" ? " on" : ""}`} onClick={() => setSort("drugs")}>
              Lowest Drug Cost
            </button>
          )}
          {med && (
            <button className={`stb${sort === "otc" ? " on" : ""}`} onClick={() => setSort("otc")}>
              Highest OTC
            </button>
          )}
          <button className={`stb${sort === "premium" ? " on" : ""}`} onClick={() => setSort("premium")}>
            Lowest Premium
          </button>
          <button className={`stb${sort === "oop" ? " on" : ""}`} onClick={() => setSort("oop")}>
            Lowest OOP
          </button>
          <button className={`stb${sort === "stars" ? " on" : ""}`} onClick={() => setSort("stars")}>
            CMS Stars
          </button>
          {docs.some((d) => d.npi) && verifiableCount > 0 && (
            <button
              className={`stb${verifiableOnly ? " on" : ""}`}
              onClick={() => setVerifiableOnly((v) => !v)}
              title="Show only plans where we can auto-verify your doctors against the carrier's directory"
            >
              {verifiableOnly ? "✓ " : ""}Doctor-verifiable ({verifiableCount})
            </button>
          )}
        </div>
      </div>
      {drgs.length > 0 && (
        <div className="iraban">
          ⚠️ Drug cost estimates exclude the 2026 Part D deductible and the $2,100 catastrophic-coverage cap. Real annual cost may be lower — confirm with your licensed advisor before enrolling.
        </div>
      )}
      {coverageSummary && (
        <div
          style={{
            margin: "12px 0 16px",
            padding: "14px 18px",
            borderRadius: 12,
            background: "rgba(16,150,90,0.06)",
            border: "1px solid rgba(16,150,90,0.18)",
            display: "flex",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 24 }}>👥</div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: "#0f7c4a" }}>
              {coverageSummary.docsCovered === coverageSummary.docsTotal
                ? `All ${coverageSummary.docsTotal} of your doctor${coverageSummary.docsTotal === 1 ? "" : "s"} are in-network for at least one plan here.`
                : coverageSummary.docsCovered > 0
                  ? `${coverageSummary.docsCovered} of your ${coverageSummary.docsTotal} doctors are in-network for at least one plan here.`
                  : `None of your ${coverageSummary.docsTotal} doctors were found in-network for the verifiable plans here.`}
            </div>
            <div style={{ fontSize: 12, color: "var(--i2)", marginTop: 3 }}>
              {coverageSummary.plansAllCovered > 0
                ? `${coverageSummary.plansAllCovered} of ${coverageSummary.plansTotal} verifiable plans cover all your doctors.`
                : `${coverageSummary.plansAnyCovered} of ${coverageSummary.plansTotal} verifiable plans cover at least one of your doctors.`}
              {coverageSummary.progress < 1 &&
                ` Checking… ${Math.round(coverageSummary.progress * 100)}% complete.`}
            </div>
          </div>
        </div>
      )}
      <div className="rl2">
        <div className="plst">
          {ranked.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--i2)" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
              <div style={{ fontFamily: "'Fraunces',serif", fontSize: 22, marginBottom: 10 }}>
                No plans found for ZIP {zip}
              </div>
              <p style={{ fontSize: 14, lineHeight: 1.7 }}>
                We&apos;re expanding our database.{" "}
                <a href="https://www.medicare.gov/plan-compare" target="_blank" rel="noreferrer" style={{ color: "var(--teal)" }}>
                  Visit Medicare.gov
                </a>{" "}
                to see all plans in your area, then call us to help you compare.
              </p>
            </div>
          ) : (
            ranked.map(({ plan, match }, i) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                match={match}
                quote={quotes[plan.id]}
                isBest={i === 0 && sort === "match"}
                isInCompare={cmp.includes(plan.id)}
                doctors={docs}
                drugs={drgs}
                countyName={countyName}
                onCompareToggle={toggleCompare}
                onEnroll={enroll}
              />
            ))
          )}
        </div>
        <div className="sdb">
          <div className="sdt">Your Profile</div>
          <div className="sdsc">
            <div className="sdl">Location &amp; Coverage</div>
            <div className="sdts">
              {med ? (
                <>
                  <span className="sdt2 med">✓ Medicare + Medicaid</span>
                  <span className="sdt2 otc">🛒 OTC ${otcMin.toLocaleString()}+/yr</span>
                </>
              ) : (
                <span className="sdt2 doc">✓ Medicare Only</span>
              )}
              <span className="sdt2 doc">📍 {zip} ({state})</span>
            </div>
          </div>
          <div className="sdsc">
            <div className="sdl">Doctors Added</div>
            <div className="sdts">
              {docs.length === 0 ? (
                <span className="sdn">None added</span>
              ) : (
                docs.map((d) => (
                  <span key={d.id} className="sdt2 doc">
                    👨‍⚕️ {d.n.split(",")[0].split(" ").slice(-1)[0]}
                  </span>
                ))
              )}
            </div>
          </div>
          <div className="sdsc">
            <div className="sdl">Medications Added</div>
            <div className="sdts">
              {drgs.length === 0 ? (
                <span className="sdn">None added</span>
              ) : (
                drgs.map((d) => (
                  <span key={d.id} className="sdt2 drg">
                    💊 {d.n}
                  </span>
                ))
              )}
            </div>
          </div>
          <div className="sdsc">
            <div className="sdl">Your Priorities</div>
            <div style={{ fontSize: 13, color: "var(--i2)", lineHeight: 1.8 }}>
              {prios.length > 0
                ? prios.map((p) => `✓ ${PRIO_LABEL[p]}`).join(" · ")
                : "None selected"}
            </div>
          </div>
          <a className="sde" onClick={() => goStep(1)}>
            ✏️ Edit your search
          </a>
          <div className="exc">
            <strong>How we score plans</strong>
            Match % blends your state, drug formulary fit, OTC &amp; extras, CMS star rating, and your stated priorities. Doctor network is listed but not yet verified — confirm with the carrier before enrolling.
          </div>
        </div>
      </div>
    </div>
  );
}
