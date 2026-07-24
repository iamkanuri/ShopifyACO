import { useState } from "react";
import { Link, navigate } from "../router";
import { ConnectShopify } from "../components/ConnectShopify";

// The public front door. Identity rule: the first screen and the first ACTION look
// like QA software, not brand monitoring — no model names, no competitors, no
// "we ask ChatGPT" above the fold. The interface (assertions, pass/fail, evidence,
// trace) IS the positioning. See the repositioning deck (AI Commerce QA for Shopify).

/** One assertion row in the test-runner visual. States mirror the real result
 *  vocabulary: proven (✓) · no blocking evidence (–) · not proven (✕). */
type HeroState = "proven" | "neutral" | "unproven";
const HERO_MARK: Record<HeroState, string> = { proven: "✓", neutral: "–", unproven: "✕" };
function Assertion({ state, label, i }: { state: HeroState; label: string; i: number }) {
  return (
    <div className={`asrt asrt-${state}`} style={{ animationDelay: `${0.15 + i * 0.16}s` }}>
      <span className="asrt-mark" aria-hidden>{HERO_MARK[state]}</span>
      <span className="asrt-label">{label}</span>
    </div>
  );
}

/** The hero test-runner card — live-looking, terminal-calm. No charts, no
 *  percentages, no logos, no competitor bars. A visibility tool shows rankings;
 *  a QA tool shows assertions. */
function TestRunnerCard() {
  return (
    <div className="testcard" role="img" aria-label="Example Buyer Test result: 1 of 5 requirements could not be proven">
      <div className="testcard-head">
        <span className="tc-dot" aria-hidden /> BUYER TEST · Sensitive-skin travel deodorant
      </div>
      <div className="testcard-task">
        Task: Find an unscented travel deodorant under $20, baking-soda-free, with no subscription.
      </div>
      <div className="testcard-asrts">
        <Assertion state="proven" label="Product found" i={0} />
        <Assertion state="proven" label="Travel variant available" i={1} />
        <Assertion state="proven" label="Price under $20" i={2} />
        <Assertion state="unproven" label="Baking-soda-free — no evidence found" i={3} />
        <Assertion state="neutral" label="One-time purchase — no blocking evidence" i={4} />
      </div>
      <div className="testcard-result">RESULT: 1 of 5 requirements could not be proven</div>
      <div className="testcard-evidence">
        Evidence checked: product copy · product details · variants · structured data
      </div>
      <div className="testcard-trace">[ Open failure trace ]</div>
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
      {/* First screen = the test. */}
      <section className="hero-land">
        <div className="eyebrow">AI COMMERCE QA FOR SHOPIFY</div>
        <h1>AI buyers treat your store like an API. We test it like one.</h1>
        <p className="hero-sub">
          AisleLens turns real buying requirements into executable tests against your products,
          variants, inventory, policies, and purchase options — then shows the exact requirement
          that failed, the evidence your store exposed, and proof that the identical test passes
          after the fix.
        </p>
        <form className="hero-form" onSubmit={run}>
          <input
            type="text"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste a Shopify product URL"
            aria-label="Shopify product URL"
          />
          <button type="submit" className="btn btn-primary lg">
            Run a free test
          </button>
        </form>
        <div className="hero-micro">One product. One buyer task. Pass or fail — with evidence.</div>
        <div className="hero-ctas">
          <Link className="hero-seeapp" to="/demo">See an example test →</Link>
          <ConnectShopify className="as-link hero-connect" label="Get it on the Shopify App Store →" />
        </div>

        <TestRunnerCard />
      </section>

      {/* Section 2 — the category break. Below the fold, the contrast IS the pitch. */}
      <section className="land-section">
        <h2>A score tells you that something moved. A test tells you what broke.</h2>
        <div className="cat-table-wrap">
          <table className="cat-table">
            <thead>
              <tr>
                <th>Visibility monitoring</th>
                <th>Readiness checklists</th>
                <th className="cat-us">AisleLens</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Counts mentions", "Inspects fields and schemas", "Executes an explicit shopping task"],
                ["Reports who appeared", "Flags generic omissions", "Checks every buyer requirement as an assertion"],
                ["Produces a score", "Cannot execute a buyer task", "Preserves the evidence trace"],
                ["Cannot say why a journey failed", "Cannot show model behavior", "Isolates the store-controlled failure — and refuses to invent a fix when the cause is external"],
                ["Cannot verify a correction", "Cannot rerun a specific failure", "Reruns the identical test after the fix, and keeps it as a regression check"],
              ].map((row, i) => (
                <tr key={i}>
                  <td>{row[0]}</td>
                  <td>{row[1]}</td>
                  <td className="cat-us">{row[2]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <blockquote className="pull">A machine can't act on a fact your store can't prove.</blockquote>
      </section>

      {/* Section 3 — how testing works (test-first; external signals demoted). */}
      <section className="land-section">
        <h2>How testing works</h2>
        <div className="steps steps-5">
          {[
            ["1", "Define the buying task", "Choose a product and state what an AI buyer must resolve: attributes, price, variant, inventory, subscription terms, delivery, returns, compatibility."],
            ["2", "Execute the test", "Each requirement becomes a testable assertion, run against the evidence your store actually exposes — using explicit retrieval tools and traceable evidence checks."],
            ["3", "Trace the failure", "Which requirement failed, which surfaces were checked, what evidence was found, and where the test stopped rather than guessed."],
            ["4", "Correct what your store controls", "Approve a targeted, reversible change linked to the failed assertion. When the cause is external, AisleLens says so and does not manufacture a store fix."],
            ["5", "Rerun and retain", "The identical test runs again — pass or fail, reported either way. Passing tests become permanent regression checks against future catalog, policy, variant, and model changes."],
          ].map(([n, t, d]) => (
            <div className="step" key={n}>
              <div className="step-n">{n}</div>
              <div className="step-t">{t}</div>
              <div className="step-d">{d}</div>
            </div>
          ))}
        </div>
        <div className="signals-note card">
          <b>Real-world signals can become tests.</b> AisleLens can convert shopping questions
          observed across external AI systems into executable store tests — including which
          requirements those systems emphasized and which stores they surfaced. Observed behavior
          seeds the tests; the tests do the proving.
        </div>
      </section>

      {/* Section 4 — demonstration (controlled validation; a production case will replace it). */}
      <section className="land-section">
        <h2>One failed test. One isolated cause. One verified rerun.</h2>
        <div className="demo-proof card">
          <p><b>Before the fix:</b> 0 of 4 test runs passed — the required claim could not be verified from any store surface.</p>
          <p><b>After one approved, reversible correction:</b> 4 of 4 passed. Same test, same models, versions pinned.</p>
          <p><b>Unsupported evidence credited:</b> zero — every claim in every run traces to retrieved evidence.</p>
          <p className="demo-label">Controlled technical validation on a Shopify development store. A production merchant case will replace this demonstration.</p>
        </div>
        <div style={{ textAlign: "center", marginTop: 20 }}>
          <Link to="/demo" className="btn">Read the full case →</Link>
        </div>
      </section>

      {/* Section 5 — FAQ. */}
      <section className="land-section">
        <h2>FAQ</h2>
        <div className="faq">
          {[
            ["What's a \"buyer task\"?", "A real shopping requirement, stated the way a customer would: \"unscented travel size under $20, baking-soda-free, no subscription, arrives by Friday.\" AisleLens turns each part into an assertion your store either proves or doesn't."],
            ["Is this SEO?", "No. SEO is about how pages rank. This is about whether a machine acting for a buyer can verify specific requirements — a price cap, an ingredient claim, a variant in stock, a delivery date — from what your store publishes. Different mechanism, different fix, testable outcome."],
            ["Is this an AI visibility tool?", "No. Visibility tools count mentions and produce scores; that category is crowded and Shopify ships a free version. AisleLens runs executable shopping tests and shows the exact requirement that failed, with evidence. External AI answers can seed our tests and appear in full diagnostics — as inputs, not as the product."],
            ["Does this guarantee an AI will recommend me?", "No, and anyone promising that is guessing. External AI systems update on their own schedule and weigh factors nobody controls. What we prove is narrower and real: a requirement a machine couldn't resolve from your store is now resolvable, and the identical test that failed now passes — reported honestly either way."],
            ["What if the problem isn't my store?", "Then we tell you, and we don't sell you a fix. Some failures come from how external systems retrieve answers, or from third-party pages saying something wrong about you. The tool shows what it found and refuses to propose a store edit it can't justify."],
            ["Will you change my store without asking?", "Never. Every change is proposed, previewed, approved by you, and reversible."],
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
