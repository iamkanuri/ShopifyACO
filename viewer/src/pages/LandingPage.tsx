import { useState } from "react";
import { Link, navigate } from "../router";
import { useConfig } from "../config";
import { ConnectShopify } from "../components/ConnectShopify";

export function LandingPage() {
  const { miniPrompts } = useConfig();
  const [url, setUrl] = useState("");

  function run(e?: React.FormEvent) {
    e?.preventDefault();
    const q = url.trim();
    navigate(q ? `/scan?url=${encodeURIComponent(q)}` : "/scan");
  }

  return (
    <div className="landing">
      {/* First screen = one thing only. */}
      <section className="hero-land">
        <h1>Turn AI shopping visibility into action</h1>
        <p className="hero-sub">
          We ask ChatGPT, Gemini, and Perplexity what shoppers ask — show whether they send buyers
          to you or your competitors — then diagnose why, fix it, and prove it worked.
        </p>
        <form className="hero-form" onSubmit={run}>
          <input
            type="text"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="yourstore.com"
            aria-label="Your store URL"
          />
          <button type="submit" className="btn btn-primary lg">
            Run free scan
          </button>
        </form>
        <div className="hero-ctas">
          <ConnectShopify className="as-link hero-connect" label="Connect Shopify" />
          <Link className="hero-seeapp" to="/app">See the app →</Link>
        </div>
        <div className="hero-trust">Free · {miniPrompts} shopper prompts across 3 AI assistants · instant on-screen report</div>
      </section>

      {/* Quiet secondary content below the fold. */}
      <section className="land-section">
        <h2>How it works</h2>
        <div className="steps">
          {[
            ["1", "Enter your store", "Just your URL — we fill in the rest."],
            ["2", "We ask the AI assistants", `${miniPrompts} real shopper prompts across ChatGPT, Gemini, and Perplexity.`],
            ["3", "See your verdict", "Whether AI recommends you, who wins instead, and where to improve."],
          ].map(([n, t, d]) => (
            <div className="step" key={n}>
              <div className="step-n">{n}</div>
              <div className="step-t">{t}</div>
              <div className="step-d">{d}</div>
            </div>
          ))}
        </div>
        <div style={{ textAlign: "center", marginTop: 28 }}>
          <Link to="/demo" className="btn">
            View a sample report
          </Link>
        </div>
      </section>

      <section className="land-section">
        <h2>FAQ</h2>
        <div className="faq">
          {[
            ["Is this SEO?", "No. SEO is about Google's ranked links. This measures whether AI assistants name and recommend you when shoppers ask what to buy — a different, newer surface."],
            ["Does this guarantee AI will recommend me?", "No. AisleLens measures a sample of your current visibility and identifies where competitors are being recommended instead. Results are directional because AI answers can change between prompts, assistants, and runs."],
            ["Which AI engines are scanned?", "We test ChatGPT, Gemini, and Perplexity. Your report shows whether live web search was available for each result."],
          ].map(([q, a]) => (
            <details className="faq-item card" key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
