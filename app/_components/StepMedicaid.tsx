"use client";

import { useWizard } from "@/store/wizard";

const OTC_AMOUNTS = [500, 1000, 2000, 3000];
const OTC_CATEGORIES = [
  "💊 Vitamins & Supplements",
  "🩹 First Aid",
  "🦷 Dental Care",
  "👁️ Eye Care",
  "🧴 Personal Care",
  "🍎 Healthy Foods",
  "🏥 Medical Supplies",
  "💪 Fitness Items",
];

export default function StepMedicaid() {
  const med = useWizard((s) => s.med);
  const otcMin = useWizard((s) => s.otcMin);
  const setMed = useWizard((s) => s.setMed);
  const setOtcMin = useWizard((s) => s.setOtcMin);
  const goStep = useWizard((s) => s.goStep);

  return (
    <div className="pnl act card">
      <div className="ms">
        <div className="ms-ic">🏥</div>
        <div className="ms-ti">Do you have Medicaid?</div>
        <div className="ms-su">
          This is the most important question. Medicare + Medicaid together qualifies you for
          D-SNP plans with $0 copays and OTC cards up to $300/month.
        </div>
        <div className="ms-op">
          <div
            className={`mo${med === true ? " sel" : ""}`}
            onClick={() => setMed(true)}
            role="button"
          >
            <div className="mo-ic">✅</div>
            <div className="mo-ti">Yes, I have Medicaid</div>
            <div className="mo-ds">I have both Medicare and Medicaid (dual eligible)</div>
          </div>
          <div
            className={`mo${med === false ? " sel" : ""}`}
            onClick={() => setMed(false)}
            role="button"
          >
            <div className="mo-ic">🔵</div>
            <div className="mo-ti">No, Medicare only</div>
            <div className="mo-ds">I just have Medicare, or I'm not sure</div>
          </div>
        </div>
      </div>
      {med === true && (
        <>
          <div className="dsnp-ban">
            <div className="dsnp-ic">🎉</div>
            <div className="dsnp-tx">
              <strong>You likely qualify for a D-SNP plan!</strong>
              <span>
                Dual Special Needs Plans include $0 copays on everything, OTC cards worth
                $100–$300/month, free rides to appointments, dental, vision, and meals.
              </span>
            </div>
          </div>
          <div className="otc-wr">
            <div className="otc-bx">
              <div className="otc-hd">
                <div className="otc-bg">OTC Card</div>
                <div className="otc-ti">How much OTC card do you want?</div>
              </div>
              <p className="otc-ds">
                OTC cards work at CVS, Walgreens, Walmart and more for vitamins, first aid,
                personal care items and more. Set your minimum below.
              </p>
              <div className="otc-gr">
                {OTC_AMOUNTS.map((a) => (
                  <div
                    key={a}
                    className={`otc-am${otcMin === a ? " sel" : ""}`}
                    onClick={() => setOtcMin(a)}
                    role="button"
                  >
                    <div className="otc-av">${a.toLocaleString()}+</div>
                    <div className="otc-al">per year</div>
                  </div>
                ))}
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--i2)",
                  marginBottom: 9,
                }}
              >
                What do you use your OTC card for?
              </div>
              <OTCCategorySelector />
            </div>
          </div>
        </>
      )}
      <div className="cf">
        <button className="bbk" onClick={() => goStep(1)}>
          ← Back
        </button>
        {med !== null && (
          <button className="bnx teal" onClick={() => goStep(3)}>
            Next: Your Doctors
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
        )}
      </div>
    </div>
  );
}

function OTCCategorySelector() {
  return (
    <div className="otc-cs">
      {OTC_CATEGORIES.map((c) => (
        <span
          key={c}
          className="otc-ct"
          onClick={(e) => e.currentTarget.classList.toggle("sel")}
          role="button"
        >
          {c}
        </span>
      ))}
    </div>
  );
}
