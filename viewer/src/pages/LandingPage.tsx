import { Link } from "../router";
import { useConfig } from "../config";
import { Pricing } from "../components/Pricing";

export function LandingPage() {
  const { brandName, miniPrompts } = useConfig();
  return (
    <div className="landing">
      {/* Hero */}
      <section className="hero-land">
        <div className="hero-badge">Free mini scan · no store login required</div>
        <h1>AI shoppers may already be choosing your competitor.</h1>
        <p className="hero-sub">
          Run a free mini scan across ChatGPT, Gemini, and Perplexity. See where your brand is
          recommended, where competitors win, and which buying prompts you disappear from.
        </p>
        <div className="hero-cta">
          <Link to="/scan" className="btn btn-primary lg">
            Run free mini scan
          </Link>
          <Link to="/demo" className="btn lg">
            View demo report
          </Link>
        </div>
        <div className="hero-engines">ChatGPT · Gemini · Perplexity</div>

        {/* Proof / example — make the value obvious before scrolling */}
        <div className="hero-proof card">
          <div className="hero-proof-head">
            <span className="dotpulse" /> Example scan
          </div>
          <div className="hero-proof-grid">
            <div className="hp-metric">
              <span className="hp-v">31%</span>
              <span className="hp-k">Mentioned</span>
            </div>
            <div className="hp-metric">
              <span className="hp-v hp-good">8%</span>
              <span className="hp-k">Recommended</span>
            </div>
            <div className="hp-metric">
              <span className="hp-v hp-name">All-Clad</span>
              <span className="hp-k">Strongest competitor</span>
            </div>
            <div className="hp-metric">
              <span className="hp-v hp-name">ChatGPT</span>
              <span className="hp-k">Weakest engine</span>
            </div>
          </div>
          <div className="hero-proof-insight">
            Insight: <b>Known, but rarely chosen.</b>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="land-section">
        <h2>How it works</h2>
        <div className="steps">
          {[
            ["1", "Tell us your store", "Brand, category, and a few competitors — that's it."],
            ["2", "We ask AI buyer-intent questions", `${miniPrompts} real shopper prompts across 3 engines.`],
            ["3", "Get your report", "Visibility score, competitor leaderboard, and a fix roadmap."],
          ].map(([n, t, d]) => (
            <div className="step" key={n}>
              <div className="step-n">{n}</div>
              <div className="step-t">{t}</div>
              <div className="step-d">{d}</div>
            </div>
          ))}
        </div>
      </section>

      {/* What you learn */}
      <section className="land-section">
        <h2>What you learn</h2>
        <div className="learn-grid">
          {[
            ["Recommendation rate", "How often AI actually picks you"],
            ["Mention rate", "How often you're named at all"],
            ["Strongest competitor", "Who AI recommends instead"],
            ["Weakest AI engine", "Where you're most invisible"],
            ["Lost buying prompts", "High-intent queries you miss"],
            ["Content & schema gaps", "What to fix so AI quotes you"],
          ].map(([t, d]) => (
            <div className="learn-card card" key={t}>
              <div className="learn-t">{t}</div>
              <div className="learn-d">{d}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Sample report */}
      <section className="land-section sample">
        <div>
          <h2>See a real report</h2>
          <p className="muted">
            A full scan of a real cookware brand vs its competitors — visibility score, the rival
            that beats it, lost prompts, and a prioritized fix roadmap.
          </p>
          <Link to="/demo" className="btn btn-primary">
            View demo report
          </Link>
        </div>
        <div className="sample-card card">
          <div className="sample-score">24<span>/100</span></div>
          <div className="sample-label">Example AI Visibility Score</div>
          <div className="sample-bars">
            <div><span style={{ width: "31%" }} /> Mention 31%</div>
            <div><span style={{ width: "8%", background: "var(--good)" }} /> Recommended 8%</div>
          </div>
        </div>
      </section>

      {/* AI Visibility Index promo */}
      <section className="land-section">
        <div className="index-promo">
          <h2>The AI Visibility Index</h2>
          <p>
            We're ranking whole categories by who AI actually recommends — cookware, supplements,
            skincare and more. See who wins, who's invisible, and where your brand lands.
          </p>
          <Link to="/index" className="btn btn-primary">
            Browse the Index
          </Link>
        </div>
      </section>

      {/* Pricing */}
      <section className="land-section">
        <h2>Pricing</h2>
        <Pricing />
      </section>

      {/* Trust / privacy */}
      <section className="land-section">
        <h2>Built to be honest</h2>
        <div className="trust-grid">
          {[
            ["No store login for the free scan", "Just enter your brand and competitors."],
            ["Cost-limited by design", "Scans are capped — we can't run away with spend."],
            ["Directional, not absolute", "AI answers vary by prompt, model, and time. We show n= everywhere."],
            ["Your data", "We store your email, scan inputs, and anonymous analytics — never sold."],
          ].map(([t, d]) => (
            <div className="trust-item" key={t}>
              <div className="trust-check">✓</div>
              <div>
                <b>{t}</b>
                <div className="muted">{d}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="land-section">
        <h2>FAQ</h2>
        <div className="faq">
          {[
            ["Is this SEO?", "No. SEO is about Google's ranked links. This measures whether AI assistants name and recommend you when shoppers ask what to buy — a different, newer surface."],
            ["Is this only for e-commerce stores?", "It works for any brand shoppers research through AI. The fix roadmap is most actionable for online stores with product pages."],
            ["Does this guarantee AI will recommend me?", "No. We measure your current visibility and show concrete, honest fixes. AI answers vary; treat results as market intelligence."],
            ["Which AI engines are scanned?", "ChatGPT (OpenAI), Gemini (Google), and Perplexity — all with live web grounding."],
            ["What do I do with the results?", "Start with the prioritized fix cards: comparison pages, buying guides for lost prompts, and product specs AI can quote. The full report includes the complete roadmap."],
          ].map(([q, a]) => (
            <details className="faq-item card" key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="land-section cta-band">
        <h2>Find out what AI says about your store</h2>
        <Link to="/scan" className="btn btn-primary lg">
          Run free mini scan
        </Link>
        <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>{brandName} · takes about a minute</div>
      </section>
    </div>
  );
}
