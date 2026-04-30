import Wizard from "./_components/Wizard";

const BROKER = {
  name: process.env.NEXT_PUBLIC_BROKER_NAME ?? "Your Name",
  npn: process.env.NEXT_PUBLIC_BROKER_NPN ?? "PENDING",
  phone: process.env.NEXT_PUBLIC_BROKER_PHONE ?? "(XXX) XXX-XXXX",
  tel: process.env.NEXT_PUBLIC_BROKER_TEL ?? "tel:+1XXXXXXXXXX",
  email: process.env.NEXT_PUBLIC_BROKER_EMAIL ?? "you@plan4me.ai",
};

export default function Home() {
  return (
    <>
      <nav className="navbar">
        <div className="logo">
          Plan<em>4me</em>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <a className="bp teal" href="#wizard-top">
            Get Started Free
          </a>
        </div>
      </nav>
      <div className="hero" id="wizard-top">
        <div className="chip">★ 2026 Medicare Advantage — Real Plan Data</div>
        <h1>
          Medicare Advantage,
          <br />
          planned <span className="it">for you</span>
        </h1>
        <p className="hsub">
          Enter your ZIP, doctors, and medications. We find every real Medicare
          Advantage plan in your area and rank them by what matters most to YOU.
        </p>
        <div className="tstrip">
          <div className="ti">
            <span className="ck">✓</span> Real plans by ZIP code
          </div>
          <div className="ti">
            <span className="ck">✓</span> 6M+ doctor search
          </div>
          <div className="ti">
            <span className="ck">✓</span> D-SNP &amp; OTC plans
          </div>
          <div className="ti">
            <span className="ck">✓</span> 100% free
          </div>
        </div>
      </div>
      <Wizard broker={BROKER} />
    </>
  );
}
