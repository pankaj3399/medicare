"use client";

import type { PlanResult, PlanQuote, Drug } from "@/store/wizard";
import { useDoctorAcceptance } from "./useDoctorAcceptance";

export type PlanCardProps = {
  plan: PlanResult;
  match: number;
  quote?: PlanQuote;
  isBest: boolean;
  isInCompare: boolean;
  doctors: { id: string; n: string; npi?: string }[];
  drugs: Drug[];
  countyName?: string | null;
  onCompareToggle: (planId: string) => void;
  onEnroll: (plan: PlanResult) => void;
};

function fmtMoney(n: number): string {
  if (n === 0) return "$0";
  return `$${Math.round(n).toLocaleString()}`;
}

export default function PlanCard({
  plan,
  match,
  quote,
  isBest,
  isInCompare,
  doctors,
  drugs,
  countyName,
  onCompareToggle,
  onEnroll,
}: PlanCardProps) {
  const planKey = `${plan.contractId}-${plan.planId}-${plan.segmentId}`;
  const acceptance = useDoctorAcceptance(doctors, planKey);
  const npiDoctors = doctors.filter((d) => !!d.npi);
  const allDoctorsInNetwork =
    npiDoctors.length > 0 &&
    npiDoctors.every((d) => acceptance[d.npi!]?.inNetwork === "yes");
  const otc = plan.otc ?? 0;
  const otcMonthly = Math.round(otc / 12);
  const stars = renderStars(plan.starOverall ?? 0);
  const grClass = (plan.starOverall ?? 0) >= 4.5 ? "ga" : "gb";
  const tyClass = plan.isDsnp ? "dsnp" : (plan.type ?? "HMO").toLowerCase();
  const orgLabel = plan.parentOrg ?? plan.carrier;
  const cmsBanner = plan.contractId ? (
    <div className="rcb">
      <div className="rcl">✓ REAL {plan.year} CMS PLAN</div>
      <div className="rcr">
        Contract {plan.contractId}-{plan.planId} · {orgLabel}
      </div>
    </div>
  ) : null;
  const ribbon = plan.isDsnp
    ? <div className="prb pc">⭐ Dual Special Needs Plan (D-SNP) — Medicare + Medicaid Members</div>
    : allDoctorsInNetwork
      ? <div className="prb tc">✓ All your doctors are in-network</div>
      : isBest
        ? <div className="prb tc">🏆 Best Match for Your Profile{countyName ? ` in ${countyName}` : ""}</div>
        : null;

  const drugCoverage = drugs.length > 0 && quote
    ? quote.drugs.map((d) => (
        <span key={d.rxcui} className={`cp ${d.covered ? "ok" : "no"}`}>
          {d.covered ? "✓" : "✗"} {d.name}
          {d.covered ? ` (Tier ${d.tier ?? "-"} · ${fmtMoney(d.monthlyCopay)}/mo)` : " (not covered)"}
        </span>
      ))
    : drugs.length > 0
      ? drugs.map((d) => (
          <span key={d.id} className="cp ok">
            ✓ {d.n} (verify formulary tier)
          </span>
        ))
      : <>
          <span className="cp ok">✓ Part D prescription drug coverage included</span>
          <span className="cp ok">✓ Add your Rx above to check coverage tiers</span>
        </>;

  return (
    <div
      className={`pc2${isBest && !plan.isDsnp ? " best" : ""}${plan.isDsnp ? " dsnp" : ""}${isInCompare ? " scmp" : ""}`}
    >
      {ribbon}
      {cmsBanner}
      <div className="pbd">
        <div className="phd">
          <div>
            <div className="pcr">{plan.carrier}</div>
            <div className="pnm2">{plan.name}</div>
            <span className={`pty ${tyClass}`}>{plan.isDsnp ? "D-SNP" : plan.type}</span>
          </div>
          <div className={`mc3 ${grClass}`}>
            <div className="mp">{match}%</div>
            <div className="ml">match</div>
          </div>
        </div>
        <div className="mbr">
          <div className="mbl">
            <span>Profile match score</span>
            <strong>{match}% compatible</strong>
          </div>
          <div className="mbt">
            <div className="mbf" style={{ width: `${match}%` }} />
          </div>
        </div>
        <div className="mts">
          <div className="mt2">
            <div className={`mv${plan.premiumMonthly === 0 ? " fr" : ""}`}>
              {fmtMoney(plan.premiumMonthly)}
            </div>
            <div className="mk">Monthly Premium</div>
          </div>
          <div className="mt2">
            <div className="mv">{fmtMoney(plan.deductibleTotal)}</div>
            <div className="mk">Deductible</div>
          </div>
          <div className="mt2">
            <div className="mv">{fmtMoney(plan.moop)}</div>
            <div className="mk">Max Out-of-Pocket</div>
          </div>
          <div className="mt2">
            <div className={`mv${quote ? " fr" : ""}`}>
              {quote ? fmtMoney(quote.annualEstimate) : "—"}
            </div>
            <div className="mk">Est. Annual Drug Cost</div>
          </div>
        </div>
        {otc >= 600 && (
          <div className="otchl">
            <div className="ohi">🛒</div>
            <div>
              <div className="oha">${otc.toLocaleString()}/year OTC Card</div>
              <div className="ohl">${otcMonthly}/month · Usable at CVS, Walgreens, Walmart &amp; more</div>
              {plan.otcCats && plan.otcCats.length > 0 && (
                <div className="ohcs">
                  {plan.otcCats.slice(0, 5).map((c) => (
                    <span key={c} className="ohc">{c}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        {otc > 0 && otc < 600 && (
          <div style={{ marginBottom: 12 }}>
            <span className="cp ot">🛒 OTC Card: ${otc}/yr (${otcMonthly}/mo)</span>
          </div>
        )}
        <div className="cs">
          <div className="ct">Doctor Network</div>
          <div className="cps">
            {doctors.length > 0 ? (
              <>
                {(() => {
                  const shown = doctors.slice(0, 3);
                  type Bucket = "no_endpoint" | "not_listed" | "not_synced" | "transient" | "no_npi" | "loading";
                  const buckets = new Set<Bucket>();
                  let anyVerified = false;
                  const rows = shown.map((d) => {
                    const label = d.n.split(",")[0];
                    if (!d.npi) {
                      buckets.add("no_npi");
                      return (
                        <span key={d.id} className="cp par">
                          • {label}
                        </span>
                      );
                    }
                    const entry = acceptance[d.npi];
                    if (!entry) {
                      buckets.add("loading");
                      return (
                        <span key={d.id} className="cp par">
                          • {label}
                        </span>
                      );
                    }
                    const verifiedTag = (
                      tone: "ok" | "no",
                      text: string,
                    ) => (
                      <span
                        style={{
                          marginLeft: 8,
                          padding: "1px 7px",
                          borderRadius: 999,
                          fontSize: "0.78em",
                          fontWeight: 600,
                          letterSpacing: 0.2,
                          background:
                            tone === "ok"
                              ? "rgba(16,150,90,0.10)"
                              : "rgba(170,170,170,0.18)",
                          color: tone === "ok" ? "#0f7c4a" : "#666",
                          border:
                            tone === "ok"
                              ? "1px solid rgba(16,150,90,0.25)"
                              : "1px solid rgba(170,170,170,0.35)",
                        }}
                      >
                        {text}
                      </span>
                    );
                    if (entry.inNetwork === "yes") {
                      anyVerified = true;
                      const accepting = entry.acceptingPatients;
                      const acceptingLabel =
                        accepting === "yes"
                          ? "accepting new patients"
                          : accepting === "no"
                            ? "not accepting new patients"
                            : accepting === "existing"
                              ? "existing patients only"
                              : null;
                      const acceptingColor =
                        accepting === "yes"
                          ? "#0f7c4a"
                          : accepting === "no"
                            ? "#9a4a2a"
                            : "#6b6b6b";
                      const loc = entry.practiceLocations?.[0];
                      return (
                        <span
                          key={d.id}
                          className="cp par"
                          title={`Verified live against ${plan.carrier}'s public provider directory (CMS-9115-F).`}
                          style={{ flexDirection: "column", alignItems: "flex-start", gap: 2 }}
                        >
                          <span>
                            • {label}
                            {verifiedTag("ok", `✓ in-network · ${plan.carrier}`)}
                          </span>
                          {(acceptingLabel || loc) && (
                            <span
                              style={{
                                fontSize: "0.78em",
                                opacity: 0.85,
                                marginLeft: 12,
                                display: "flex",
                                gap: 8,
                                flexWrap: "wrap",
                              }}
                            >
                              {acceptingLabel && (
                                <span style={{ color: acceptingColor }}>
                                  {acceptingLabel}
                                </span>
                              )}
                              {loc && (
                                <span style={{ color: "#666" }}>
                                  · {loc}
                                </span>
                              )}
                            </span>
                          )}
                        </span>
                      );
                    }
                    if (entry.inNetwork === "no") {
                      anyVerified = true;
                      return (
                        <span
                          key={d.id}
                          className="cp par"
                          title={`Checked live against ${plan.carrier}'s public provider directory (CMS-9115-F).`}
                        >
                          • {label}
                          {verifiedTag("no", `not in ${plan.carrier} network`)}
                        </span>
                      );
                    }
                    const r = (entry.reason ?? "").toLowerCase();
                    if (r.includes("no fhir endpoint")) buckets.add("no_endpoint");
                    else if (r.includes("not found") || r.includes("not in")) buckets.add("not_listed");
                    else if (r.includes("not synced") || r.includes("mapping")) buckets.add("not_synced");
                    else if (r.includes("fhir error") || r.includes("aborted") || r.includes("timeout")) buckets.add("transient");
                    else buckets.add("no_endpoint");
                    return (
                      <span key={d.id} className="cp par" title={entry.reason ?? ""}>
                        • {label}
                      </span>
                    );
                  });
                  const carrier = plan.carrier;
                  const footer = (() => {
                    if (buckets.size === 0) return null;
                    const prefix = anyVerified ? "Other providers: " : "";
                    if (buckets.has("no_endpoint")) {
                      return `${prefix}${carrier} doesn't publish a public provider directory — call ${carrier} to confirm.`;
                    }
                    if (buckets.has("transient")) {
                      return `${prefix}${carrier}'s directory is temporarily unavailable — try again later or call to confirm.`;
                    }
                    if (buckets.has("not_synced")) {
                      return `${prefix}Network data for this plan is still being indexed.`;
                    }
                    if (buckets.has("not_listed")) {
                      return `${prefix}Not listed in ${carrier}'s directory — call to confirm.`;
                    }
                    if (buckets.has("no_npi")) {
                      return `${prefix}Manually-added providers can't be auto-checked — call ${carrier} to confirm.`;
                    }
                    if (buckets.has("loading")) {
                      return `${prefix}Checking ${carrier}'s directory…`;
                    }
                    return null;
                  })();
                  return (
                    <>
                      {rows}
                      {footer && <span className="cp par">{footer}</span>}
                    </>
                  );
                })()}
              </>
            ) : (
              <>
                <span className="cp ok">✓ {plan.carrier} provider network</span>
                <span className="cp ok">✓ Add your doctors above to verify</span>
              </>
            )}
          </div>
        </div>
        <div className="cs">
          <div className="ct">Drug Coverage</div>
          <div className="cps">{drugCoverage}</div>
        </div>
        {plan.extras && plan.extras.length > 0 && (
          <div className="cs">
            <div className="ct">Extra Benefits Included</div>
            <div className="cps">
              {plan.extras.map((e) => (
                <span key={e} className="cp ex">+ {e}</span>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="wr">
        <div className="wps">
          {(plan.whyChoose ?? []).map((w) => (
            <span key={w} className="wp">{w}</span>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div className="sr2">
            <span className="sts">{stars}</span>
            {plan.starOverall ? ` ${plan.starOverall} CMS Stars` : " Not yet rated"}
          </div>
          <div className="pbs">
            <button
              className={`bcm${isInCompare ? " add" : ""}`}
              onClick={() => onCompareToggle(plan.id)}
              type="button"
            >
              {isInCompare ? "✓ In Compare" : "+ Compare"}
            </button>
            <button className="ben" onClick={() => onEnroll(plan)} type="button">
              Enroll Now →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function renderStars(rating: number): string {
  if (!rating) return "☆☆☆☆☆";
  const full = Math.floor(rating);
  const half = rating % 1 >= 0.5 ? "½" : "";
  const empty = 5 - Math.ceil(rating);
  return "★".repeat(full) + half + "☆".repeat(empty);
}
