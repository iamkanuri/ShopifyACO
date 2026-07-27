import { useState } from "react";
import { Link, navigate } from "../router";
import { ConnectShopify } from "../components/ConnectShopify";
import {
  CATEGORY_BREAK,
  COFFEE_STANDARD_URL,
  DEMONSTRATION,
  EXAMPLE_TEST_URL,
  FAQ,
  HERO,
  HERO_TEST,
  HOW_IT_WORKS,
  RESULT_GLYPH,
  STANDARD_SECTION,
  type ResultState,
} from "../copy";

// The public front door. Two rules hold this page together:
//
//   • THE STANDARD LEADS. AisleLens publishes versioned buying standards — the
//     questions a competent buyer asks in a category, written as executable
//     tests — and runs them against real product pages. "AI buyers treat your
//     store like an API, we test it like one" is still true, and it is now the
//     second sentence, because the standard is the thing nobody else has.
//   • EVERY STRING LIVES IN ../copy.ts, so the real claim linter can be run
//     over it in test/siteCopy.test.ts. The site that sells claim discipline
//     passes its own check.

/** One assertion row in the test-runner visual. States mirror the real result
 *  vocabulary: proven (✓) · no blocking evidence (–) · not proven (✕) ·
 *  requires store access (○). The glyph is not decoration — it is half the
 *  signal, so the states survive colourblindness and a greyscale print. */
function Assertion({ state, label, i }: { state: ResultState; label: string; i: number }) {
  return (
    <div className={`asrt asrt-${state}`} style={{ animationDelay: `${0.15 + i * 0.16}s` }}>
      <span className="asrt-mark" aria-hidden>{RESULT_GLYPH[state]}</span>
      <span className="asrt-label">{label}</span>
    </div>
  );
}

/** The hero test-runner card — live-looking, terminal-calm. No charts, no
 *  percentages, no logos, no competitor bars. A mention tracker shows a league
 *  table; a QA tool shows assertions. */
function TestRunnerCard() {
  return (
    <div className="testcard" role="img" aria-label={HERO_TEST.ariaLabel}>
      <div className="testcard-head">
        <span className="tc-dot" aria-hidden /> {HERO_TEST.head}
      </div>
      <div className="testcard-task">{HERO_TEST.task}</div>
      <div className="testcard-asrts">
        {HERO_TEST.assertions.map((a, i) => (
          <Assertion key={a.label} state={a.state} label={a.label} i={i} />
        ))}
      </div>
      <div className="testcard-result">{HERO_TEST.result}</div>
      <div className="testcard-evidence">{HERO_TEST.evidence}</div>
      <div className="testcard-trace">{HERO_TEST.trace}</div>
    </div>
  );
}

export function LandingPage() {
  const [url, setUrl] = useState("");

  function run(e?: React.FormEvent) {
    e?.preventDefault();
    const q = url.trim();
    navigate(q ? `/test?url=${encodeURIComponent(q)}` : "/test");
  }

  return (
    <div className="landing">
      {/* First screen = the standard, then the test. */}
      <section className="hero-land">
        <div className="eyebrow">{HERO.eyebrow}</div>
        <h1>{HERO.headline}</h1>
        <p className="hero-sub">{HERO.sub}</p>
        <form className="hero-form" onSubmit={run}>
          <input
            type="text"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={HERO.inputPlaceholder}
            aria-label={HERO.inputLabel}
          />
          <button type="submit" className="btn btn-primary lg">
            {HERO.cta}
          </button>
        </form>
        <div className="hero-micro">{HERO.micro}</div>
        <div className="hero-ctas">
          {/* Plain <a>: /standards and /demo are both server-rendered documents, so the
              SPA router must not swallow them. */}
          <a className="hero-seeapp" href={COFFEE_STANDARD_URL}>{HERO.readStandard}</a>
          <a className="hero-seeapp" href={EXAMPLE_TEST_URL}>{HERO.seeExample}</a>
          <ConnectShopify className="as-link hero-connect" label={HERO.connect} />
        </div>

        <TestRunnerCard />
      </section>

      {/* Section 2 — the standard. The lead argument, not a feature. */}
      <section className="land-section">
        <h2>{STANDARD_SECTION.heading}</h2>
        <div className="standard-body card">
          {STANDARD_SECTION.body.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
        <blockquote className="pull">{STANDARD_SECTION.pull}</blockquote>
        <div className="standard-after">
          {STANDARD_SECTION.after.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      </section>

      {/* Section 3 — the category break. Below the fold, the contrast IS the pitch. */}
      <section className="land-section">
        <h2>{CATEGORY_BREAK.heading}</h2>
        <div className="cat-table-wrap">
          <table className="cat-table">
            <thead>
              <tr>
                {CATEGORY_BREAK.columns.map((c, i) => (
                  <th key={c} className={i === 2 ? "cat-us" : undefined}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CATEGORY_BREAK.rows.map((row) => (
                <tr key={row[0]}>
                  <td>{row[0]}</td>
                  <td>{row[1]}</td>
                  <td className="cat-us">{row[2]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <blockquote className="pull">{CATEGORY_BREAK.pull}</blockquote>
      </section>

      {/* Section 4 — how testing works (test-first; external signals demoted). */}
      <section className="land-section">
        <h2>{HOW_IT_WORKS.heading}</h2>
        <div className="steps steps-5">
          {HOW_IT_WORKS.steps.map(([n, t, d]) => (
            <div className="step" key={n}>
              <div className="step-n">{n}</div>
              <div className="step-t">{t}</div>
              <div className="step-d">{d}</div>
            </div>
          ))}
        </div>
        <div className="signals-note card">
          <b>{HOW_IT_WORKS.note.lead}</b> {HOW_IT_WORKS.note.body}
        </div>
      </section>

      {/* Section 5 — demonstration (controlled validation; a production case replaces it once one exists). */}
      <section className="land-section">
        <h2>{DEMONSTRATION.heading}</h2>
        <div className="demo-proof card">
          {DEMONSTRATION.lines.map(([lead, rest]) => (
            <p key={lead}><b>{lead}</b> {rest}</p>
          ))}
          <p className="demo-label">{DEMONSTRATION.label}</p>
        </div>
        <div style={{ textAlign: "center", marginTop: 20 }}>
          <a href={EXAMPLE_TEST_URL} className="btn">{DEMONSTRATION.cta}</a>
        </div>
      </section>

      {/* Section 6 — FAQ. */}
      <section className="land-section">
        <h2>FAQ</h2>
        <div className="faq">
          {FAQ.map(([q, a]) => (
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
