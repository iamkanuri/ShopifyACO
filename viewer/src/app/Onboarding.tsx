import { Link } from "../router";
import { ConnectShopify } from "../components/ConnectShopify";

// First-run guide. Shown on the dashboard when the store isn't connected (demo) so a
// prospect/merchant sees the path: Connect → Sync catalog → Measure visibility →
// then diagnose/fix/verify. Each step links to the real action where one exists.
export function Onboarding() {
  const steps = [
    { n: 1, t: "Connect your store", d: "Install the app to read your catalog (read-only).", connect: true, cta: "Connect Shopify" },
    { n: 2, t: "Sync your catalog", d: "Pull your products so benchmarks and fixes can use them. Free.", to: "/app/catalog", cta: "Go to Catalog" },
    { n: 3, t: "Measure your visibility", d: "Run a benchmark across ChatGPT, Gemini and Perplexity.", to: "/app/measure", cta: "Run a benchmark" },
    { n: 4, t: "Diagnose · fix · verify", d: "See why competitors win, apply fixes, and prove they worked.", to: "/app/evidence", cta: "See the evidence" },
  ] as Array<{ n: number; t: string; d: string; cta: string; connect?: boolean; to?: string }>;
  return (
    <div className="card al-onboard">
      <div className="al-onboard-head">
        <h3>Get set up</h3>
        <p className="muted">You're viewing sample data. Four steps to your own live AI visibility.</p>
      </div>
      <div className="al-onboard-steps">
        {steps.map((s) => (
          <div key={s.n} className="al-onboard-step">
            <span className="al-onboard-n">{s.n}</span>
            <div className="al-onboard-body">
              <div className="al-onboard-t">{s.t}</div>
              <div className="muted al-onboard-d">{s.d}</div>
            </div>
            {s.connect ? <ConnectShopify className="btn btn-primary" label={s.cta} /> : <Link to={s.to!} className="btn">{s.cta}</Link>}
          </div>
        ))}
      </div>
    </div>
  );
}
