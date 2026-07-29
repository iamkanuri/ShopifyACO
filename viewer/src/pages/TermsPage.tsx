import { useConfig } from "../config";

// Plain-English Terms of Service. Starting point for the Shopify App Store listing —
// the company name, jurisdiction, and any specifics should be reviewed before launch.
export function TermsPage() {
  const { brandName, contactEmail } = useConfig();
  return (
    <div className="prose card">
      <h1>Terms of Service</h1>
      <p className="muted">The agreement for using {brandName}. By using the service you agree to these terms.</p>

      <h3>What the service does</h3>
      <p>
        {brandName} publishes buying standards — the questions a competent buyer in a category needs
        settled — and runs them as executable tests against a public product page, reporting for each
        requirement whether your store's own public data proves it, with the evidence sentence and the
        surface it was read from. It also runs a general buyer task against stores outside a published
        category. For connected Shopify stores it can read your catalog and, only with your explicit
        approval, apply reviewable changes back to your store. Some plans additionally measure how AI
        assistants answer category questions; where that is used it is labelled as such.
      </p>

      <h3>Results are directional, not guarantees</h3>
      <ul>
        <li>AI answers vary by model, time, prompt, and location. Findings are small-sample market
          intelligence shown with sample sizes and confidence — never a guarantee of ranking,
          revenue, or a specific outcome.</li>
        <li>We never claim causation from a single change; verification compares before/after runs
          and reports "inconclusive" honestly when a change isn't statistically detectable.</li>
      </ul>

      <h3>Your responsibilities</h3>
      <ul>
        <li>Provide accurate information and use the service lawfully.</li>
        <li>You're responsible for reviewing and approving any change before it is applied to your
          store. We make changes reversible and conflict-checked, but final judgment is yours.</li>
        <li>Don't attempt to abuse, overload, reverse-engineer, or resell the service.</li>
      </ul>

      <h3>Billing</h3>
      <ul>
        <li>Plans for the Shopify App Store app are billed <b>through Shopify</b>. You review the
          price and what's included before approving, and you manage or cancel the subscription from
          your Shopify admin; access continues until the end of the paid period.</li>
        <li>Purchases made on our website (e.g. one-time reports) are billed <b>through Stripe</b>.
          Prices and what each purchase includes are shown before you pay. One-time reports are
          <b> generated automatically</b> after payment and appear on your report page.</li>
        <li>If a paid report can't be generated, it is <b>refunded automatically</b>; other refunds
          are handled case by case — contact us.</li>
      </ul>

      <h3>Availability &amp; changes</h3>
      <p>
        The service is provided on an "as is" and "as available" basis during active development.
        We may update features, plans, or these terms; material changes will be reflected here.
        To the extent permitted by law, {brandName} is not liable for indirect or consequential
        losses arising from use of the service or reliance on its directional findings.
      </p>

      <h3>Cancellation</h3>
      <p>
        You can stop using the service at any time. Uninstalling the Shopify app immediately revokes
        our access and deletes your stored access token. See our{" "}
        <a href="/privacy">Privacy</a> and <a href="/data-deletion">Data deletion</a> pages for what
        happens to your data.
      </p>

      <h3>Contact</h3>
      <p>
        {contactEmail ? (
          <>Questions about these terms? Email <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.</>
        ) : (
          "Questions about these terms? Reach out via the contact link in the footer."
        )}
      </p>
    </div>
  );
}
