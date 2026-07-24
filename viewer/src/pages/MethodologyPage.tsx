// Methodology — the honesty machinery, published as public trust collateral.
// "No herd tool can publish this page. That's the point of publishing it." (§6)
export function MethodologyPage() {
  return (
    <div className="prose card">
      <h1>How AisleLens tests — and what it refuses to claim</h1>
      <p className="muted">
        AisleLens is AI Commerce QA: it runs executable shopping tests against your store and reports,
        with evidence, which buyer requirements a machine can and cannot verify. This page is the
        standard every result is held to.
      </p>

      <h3>The evidence-availability principle</h3>
      <p>
        We test what your store can <i>prove</i>, never what your product "is." Every finding is scoped
        to evidence a machine can retrieve from your store's own data. If a claim isn't stated in a form
        a buyer's AI can read, the test reports it as unproven — not as false.
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
        that can't meet the standard is not shown.
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
        store. We label these "requires store access" — never "missing."
      </p>

      <h3>Validation record</h3>
      <p>
        The standards above were enforced throughout a controlled, staged validation on a Shopify
        development store (labeled as such). A production merchant case will replace that demonstration
        as one becomes available.
      </p>
    </div>
  );
}
