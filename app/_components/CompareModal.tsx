"use client";

import { useWizard } from "@/store/wizard";

function fmtMoney(n: number): string {
  return n === 0 ? "$0" : `$${Math.round(n).toLocaleString()}`;
}

export default function CompareModal() {
  const cmp = useWizard((s) => s.cmp);
  const plans = useWizard((s) => s.plans);
  const quotes = useWizard((s) => s.quotes);

  const close = () => {
    document.getElementById("compare-modal")?.classList.remove("open");
    document.body.style.overflow = "";
  };

  const selected = cmp.map((id) => plans.find((p) => p.id === id)).filter(Boolean) as typeof plans;

  if (selected.length < 2) {
    return (
      <div id="compare-modal" className="mov" onClick={(e) => e.target === e.currentTarget && close()}>
        <div className="mmod" />
      </div>
    );
  }

  const minMoop = Math.min(...selected.map((p) => p.moop));
  const maxOtc = Math.max(...selected.map((p) => p.otc ?? 0));

  return (
    <div id="compare-modal" className="mov" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="mmod">
        <div className="mmh">
          <h3>Side-by-Side Comparison</h3>
          <button className="mmc" onClick={close} type="button">✕</button>
        </div>
        <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <table className="cmt">
            <thead>
              <tr>
                <th></th>
                {selected.map((p) => (
                  <th key={p.id} style={{ fontSize: 11, color: "var(--i2)" }}>
                    {p.carrier}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Plan</td>
                {selected.map((p) => (
                  <td key={p.id}>
                    <div className="ctc">{p.carrier}</div>
                    <div className="ctn">{p.name}</div>
                    <span className={`pty ${(p.isDsnp ? "dsnp" : p.type ?? "HMO").toLowerCase()}`}>
                      {p.isDsnp ? "D-SNP" : p.type}
                    </span>
                  </td>
                ))}
              </tr>
              <tr>
                <td>Monthly Premium</td>
                {selected.map((p) => (
                  <td key={p.id}>
                    <span className={p.premiumMonthly === 0 ? "cb2" : ""}>
                      {fmtMoney(p.premiumMonthly)}
                    </span>
                  </td>
                ))}
              </tr>
              <tr>
                <td>Deductible</td>
                {selected.map((p) => (
                  <td key={p.id}>{fmtMoney(p.deductibleTotal)}</td>
                ))}
              </tr>
              <tr>
                <td>Max Out-of-Pocket</td>
                {selected.map((p) => (
                  <td key={p.id}>
                    <span className={p.moop === minMoop ? "cb2" : ""}>{fmtMoney(p.moop)}</span>
                  </td>
                ))}
              </tr>
              <tr>
                <td>OTC Card / Year</td>
                {selected.map((p) => (
                  <td key={p.id}>
                    <span className={(p.otc ?? 0) === maxOtc && maxOtc > 0 ? "cb2" : ""}>
                      ${(p.otc ?? 0).toLocaleString()}/yr
                    </span>
                  </td>
                ))}
              </tr>
              <tr>
                <td>Est. Annual Drug Cost</td>
                {selected.map((p) => {
                  const q = quotes[p.id];
                  return (
                    <td key={p.id}>
                      {q ? fmtMoney(q.annualEstimate) : "—"}
                    </td>
                  );
                })}
              </tr>
              <tr>
                <td>CMS Stars</td>
                {selected.map((p) => (
                  <td key={p.id}>
                    {p.starOverall ? `★ ${p.starOverall}` : "—"}
                  </td>
                ))}
              </tr>
              <tr>
                <td>Extra Benefits</td>
                {selected.map((p) => (
                  <td key={p.id} style={{ fontSize: 12 }}>
                    {(p.extras ?? []).slice(0, 6).map((e) => <div key={e}>+ {e}</div>)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
