"use client";

import { useEffect, useState } from "react";
import { useWizard } from "@/store/wizard";
import type { Broker } from "./Wizard";

export default function EnrollModal({ broker }: { broker: Broker }) {
  const cur = useWizard((s) => s.cur);
  const setEnroll = useWizard((s) => s.setEnroll);
  const zip = useWizard((s) => s.zip);
  const state = useWizard((s) => s.state);
  const med = useWizard((s) => s.med);
  const otcMin = useWizard((s) => s.otcMin);
  const docs = useWizard((s) => s.docs);
  const drgs = useWizard((s) => s.drgs);
  const prios = useWizard((s) => s.prios);

  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [time, setTime] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ ref: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (cur) {
      document.body.style.overflow = "hidden";
      setDone(null);
      setErr("");
    } else {
      document.body.style.overflow = "";
    }
  }, [cur]);

  if (!cur) return null;

  const close = () => {
    setEnroll(null);
  };

  const formatPhone = (v: string) => {
    const digits = v.replace(/\D/g, "");
    if (digits.length >= 10) return digits.replace(/(\d{3})(\d{3})(\d{4}).*/, "($1) $2-$3");
    if (digits.length >= 6) return digits.replace(/(\d{3})(\d{3})(\d*)/, "($1) $2-$3");
    if (digits.length >= 3) return digits.replace(/(\d{3})(\d*)/, "($1) $2");
    return digits;
  };

  const submit = async () => {
    if (!first.trim()) return setErr("Please enter your first name.");
    if (!last.trim()) return setErr("Please enter your last name.");
    if (phone.replace(/\D/g, "").length < 10)
      return setErr("Please enter a valid 10-digit phone number.");
    setErr("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first,
          last,
          phone,
          email,
          bestTime: time,
          selectedPlanId: cur.id,
          snapshot: {
            zip,
            state,
            medicaid: med,
            otcMin,
            doctors: docs.map((d) => ({ name: d.n, npi: d.npi })),
            drugs: drgs.map((d) => ({
              rxcui: d.rxcui,
              name: d.n,
              fillsPerYear: d.fillsPerYear,
            })),
            priorities: prios,
            planName: cur.nm,
            carrier: cur.cr,
            premium: cur.pm,
            type: cur.ty,
          },
        }),
      });
      if (!res.ok) {
        setErr("Something went wrong. Please call us directly.");
      } else {
        const data = await res.json();
        setDone({ ref: data.ref ?? "P4M-" });
      }
    } catch {
      setErr("Network error. Please call us directly.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="eov open" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="emod">
        <div className="emhd">
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".8px", color: "var(--i3)", marginBottom: 4 }}>
              {cur.cr}
            </div>
            <div style={{ fontFamily: "'Fraunces',serif", fontSize: 19, fontWeight: 700 }}>
              {cur.nm}
            </div>
          </div>
          <button className="ecl" onClick={close} type="button">✕</button>
        </div>
        {!done ? (
          <>
            <div className="embd">
              <div className="elh">
                <div className="eli">🎉</div>
                <div>
                  <div style={{ fontFamily: "'Fraunces',serif", fontSize: 19, fontWeight: 700, marginBottom: 5 }}>
                    Great choice!
                  </div>
                  <div style={{ fontSize: 14, color: "var(--i2)", lineHeight: 1.6 }}>
                    A licensed Plan4me advisor will call you within{" "}
                    <strong>2 business hours</strong> to walk you through your plan options
                    and complete your enrollment — at no cost to you.
                  </div>
                </div>
              </div>
              <div className="eform">
                <div className="efr">
                  <div className="efg">
                    <label className="efl">First Name *</label>
                    <input className="efi" type="text" autoComplete="given-name" placeholder="John" value={first} onChange={(e) => setFirst(e.target.value)} />
                  </div>
                  <div className="efg">
                    <label className="efl">Last Name *</label>
                    <input className="efi" type="text" autoComplete="family-name" placeholder="Smith" value={last} onChange={(e) => setLast(e.target.value)} />
                  </div>
                </div>
                <div className="efg">
                  <label className="efl">Phone Number *</label>
                  <input
                    className="efi"
                    type="tel"
                    autoComplete="tel"
                    placeholder="(555) 123-4567"
                    value={phone}
                    onChange={(e) => setPhone(formatPhone(e.target.value))}
                  />
                </div>
                <div className="efg">
                  <label className="efl">Email Address</label>
                  <input className="efi" type="email" autoComplete="email" placeholder="john@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="efg">
                  <label className="efl">Best Time to Call</label>
                  <select className="efi" value={time} onChange={(e) => setTime(e.target.value)}>
                    <option value="">Any time is fine</option>
                    <option>Morning (8am–12pm)</option>
                    <option>Afternoon (12pm–5pm)</option>
                    <option>Evening (5pm–8pm)</option>
                  </select>
                </div>
              </div>
              <div className="ecb">
                <div className="ecor">— or call us directly —</div>
                <a className="ecbtn" href={broker.tel}>📞 Call {broker.phone}</a>
                <div style={{ fontSize: 12, color: "var(--i3)", marginTop: 8 }}>
                  Mon–Fri 8am–8pm · Sat 9am–5pm EST
                </div>
              </div>
              <div className="edis">
                By submitting you agree to be contacted by a licensed Medicare insurance agent.
                Plan4me is a licensed insurance agency. NPN: {broker.npn}. Not affiliated with the US government.
              </div>
              {err && (
                <div style={{ color: "var(--red)", fontSize: 13, textAlign: "center", marginTop: 8 }}>
                  {err}
                </div>
              )}
            </div>
            <div className="emft">
              <button className="bbk" onClick={close} type="button">← Back</button>
              <button className="bnx teal" onClick={submit} disabled={submitting} type="button">
                {submitting ? "Submitting…" : "Request Free Callback"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="embd" style={{ textAlign: "center", padding: "48px 24px" }}>
              <div style={{ fontSize: 64, marginBottom: 20 }}>✅</div>
              <div style={{ fontFamily: "'Fraunces',serif", fontSize: 24, fontWeight: 700, marginBottom: 10 }}>
                You&apos;re all set!
              </div>
              <div style={{ fontSize: 14, color: "var(--i2)", lineHeight: 1.7, maxWidth: 360, margin: "0 auto 24px" }}>
                A licensed advisor will call <strong>{phone}</strong> within 2 business hours
                to complete enrollment in <strong>{cur.nm}</strong>.
              </div>
              <div className="cfbx">
                <div className="cfr"><span>📋</span><span>Plan: <strong>{cur.nm}</strong></span></div>
                <div className="cfr"><span>📞</span><span>Phone: <strong>{phone}</strong></span></div>
                <div className="cfr"><span>⏰</span><span>Best time: <strong>{time || "Any time"}</strong></span></div>
                <div className="cfr"><span>🆔</span><span>Reference #: <strong>{done.ref}</strong></span></div>
              </div>
            </div>
            <div className="emft" style={{ justifyContent: "center" }}>
              <button className="bnx teal" onClick={close} type="button">
                Done — Back to Plans
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
