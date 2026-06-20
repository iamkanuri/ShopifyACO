import { useState } from "react";
import { Link, navigate } from "../router";
import { useConfig } from "../config";

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
        <h1>See if AI recommends your store</h1>
        <p className="hero-sub">
          We ask ChatGPT, Gemini, and Perplexity what shoppers ask — and show whether they
          send buyers to you or your competitors.
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
        <div className="hero-trust">Free · no signup · {miniPrompts} prompts across 3 AI assistants</div>
      </section>

      {/* Quiet secondary content below the fold. */}
      <section className="land-section">
        <h2>How it works</h2>
        <div className="steps">
          {[
            ["1", "Enter your store", "Just your URL — we fill in the rest."],
            ["2", "We ask the AI assistants", `${miniPrompts} real shopper prompts across ChatGPT, Gemini, and Perplexity.`],
            ["3", "See your verdict", "Whether AI recommends you, who wins instead, and what to fix."],
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
            ["Does this guarantee AI will recommend me?", "No. We measure your current visibility and show concrete, honest fixes. AI answers vary; treat results as directional market intelligence."],
            ["Which AI engines are scanned?", "ChatGPT (OpenAI), Gemini (Google), and Perplexity — all with live web grounding."],
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
