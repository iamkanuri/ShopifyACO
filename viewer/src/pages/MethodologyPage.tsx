import { Link } from "../router";
import { COFFEE_STANDARD_URL, COFFEE_STANDARD_VERSION, STANDARDS_INDEX_URL } from "../copy";

// Methodology — the honesty machinery, published as public trust collateral.
// "No herd tool can publish this page. That's the point of publishing it." (§6)
//
// ⚠️ TWO THINGS WERE WRONG HERE UNTIL v4.1, and this is the page a sceptical reader opens
// FIRST — it is the destination of "How testing works →" on every single result.
//
//  1. It opened "AisleLens is AI Commerce QA", the retired-era framing, and never once
//     mentioned a published buying standard, a version, a content hash or an error rate.
//     The no-JS twin a crawler receives (publicSsr.ts) named all four. The page a human
//     read was strictly less informative than the page a robot read.
//  2. It used the word "standard" in a SECOND sense — "this page is the standard every
//     result is held to" — which collides head-on with the only sense the rest of the site
//     uses. A reader who has just been told results cite a published standard, and who then
//     reads that the standard is a page of principles, has been given two incompatible
//     definitions inside one click.
//
// ⚠️ NO MEASURED FIGURE APPEARS ON THIS PAGE. The viewer bundle imports nothing from
// `src/`, so it cannot reach the fitness sidecar; a rate typed here is a literal that goes
// false the next time the audit improves. Two such paragraphs were live on the landing page
// until v4.1. Every number lives on the standard's own page, which derives it.
export function MethodologyPage() {
  return (
    <div className="prose card">
      <h1>How AisleLens tests — and what it refuses to claim</h1>
      <p className="muted">
        AisleLens publishes <b>buying standards</b> — the questions a competent buyer in a category
        actually needs settled — and runs them as executable tests against a real product page. Every
        row comes back proven, not proven, or requiring store access, with the sentence it was proven
        from and the surface that sentence came from.
      </p>

      <h3>The evidence-availability principle</h3>
      <p>
        We test what your store can <i>prove</i>, never what your product "is." Every finding is scoped
        to evidence a machine can retrieve from your store's own data. If a claim isn't stated in a form
        a buyer's AI can read, the test reports it as unproven — not as false. A page can be completely
        honest and still fail, and that is the finding: the buyer's machine could not confirm it.
      </p>

      <h3>The standard is public before the test runs</h3>
      <p>
        A result is only checkable if you can read the contract it ran under. Every published standard
        sits at a fixed version and content hash, with each entry at its own URL — what counts as
        evidence, what does not, and which surface wins when two disagree. You can read the questions
        before anyone runs anything, and a citation still resolves after the standard is reissued.
      </p>
      <p>
        <a href={STANDARDS_INDEX_URL}>Every published standard</a> ·{" "}
        <a href={COFFEE_STANDARD_URL}>Coffee Standard {COFFEE_STANDARD_VERSION}</a> ·{" "}
        <a href={`${COFFEE_STANDARD_URL}/standard.json`}>the artifact as JSON</a>
      </p>

      <h3>We publish our own error rate, and it has moved</h3>
      <p>
        A test that never states how often it is wrong is asking to be trusted rather than checked. Each
        standard carries a measured upper bound on its false-pass rate, on its own page, with the method,
        the sample size and the individual defects behind it. Every passing row in those samples was read
        back individually against the store's full page text — not sampled.
      </p>
      <p>
        That bound has moved more than once, always because the audit got better rather than because the
        engine did, and each move is on the record with the reason. The known limitations are published
        beside it, including the ones we tried to fix and could not.
      </p>

      <h3>Two evidence tiers</h3>
      <ul>
        <li><b>Explicit statements</b> — a deterministic match against the exact text or structured data
          your store exposes.</li>
        <li><b>Verified semantic evidence</b> — exact quotes only, machine-checked against the source.
          Nothing is ever credited without a retrievable citation.</li>
      </ul>

      <h3>What we refuse to say</h3>
      <p>
        No revenue claims. No ranking promises. No causal claims about external AI behavior. No
        product-truth assertions. A deterministic linter blocks any output that violates this — a result
        that can't meet the bar is not shown at all.
      </p>

      <h3>The refusal rule</h3>
      <p>
        When a failure isn't store-controlled, the correct output is "not fixable from your store data,"
        and that is what you get. We do not manufacture a store edit to explain a cause that lives
        outside your store.
      </p>

      <h3>What requires store access</h3>
      <p>
        Public data proves a lot; some things it can't reach. Product metafields, full policy data,
        merchant confirmation, applied fixes, reruns, and regression history all require a connected
        store. We label these "requires store access" — never "missing," and they are never counted
        against the store.
      </p>

      <h3>Validation record</h3>
      <p>
        The rules above were enforced throughout a controlled, staged validation on a Shopify development
        store (labeled as such). A production merchant case will replace that demonstration as one becomes
        available. <Link to="/demo">See a real result on a real store →</Link>
      </p>
    </div>
  );
}
