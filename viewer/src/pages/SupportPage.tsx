import { useConfig } from "../config";

// Support / help page. Required as a public contact point for the Shopify App Store
// listing. Honest about beta response times.
export function SupportPage() {
  const { brandName, contactEmail } = useConfig();
  return (
    <div className="prose card">
      <h1>Support</h1>
      <p className="muted">Help with {brandName} — getting set up, reading your results, or billing.</p>

      <h3>Get in touch</h3>
      <p>
        {contactEmail ? (
          <>Email <a href={`mailto:${contactEmail}`}>{contactEmail}</a> and we'll get back to you.
            During beta we typically reply within one business day.</>
        ) : (
          "Use the contact link in the footer to reach us. During beta we typically reply within one business day."
        )}
      </p>

      <h3>Common questions</h3>
      <ul>
        <li><b>How do I run a scan?</b> Enter your store URL on the home page — no login needed for
          the free scan. Connected Shopify stores get the full measure → diagnose → fix → verify loop
          in the app.</li>
        <li><b>Why did my results change between runs?</b> AI answers vary by model, time, prompt,
          and location. That's why we show sample sizes and confidence, and compare before/after runs
          with statistics rather than claiming a single change "worked".</li>
        <li><b>Will you change my store automatically?</b> No. Any write-back is shown as a reviewable
          proposal, applied only after you approve it, conflict-checked, and reversible.</li>
        <li><b>Billing &amp; cancellation.</b> Manage your plan or cancel anytime from the billing
          portal in the app; access continues until the end of your paid period.</li>
      </ul>

      <h3>Data &amp; privacy</h3>
      <p>
        See <a href="/privacy">Privacy</a> for what we collect, <a href="/terms">Terms</a> for the
        agreement, and <a href="/data-deletion">Data deletion</a> to request removal of your data.
      </p>
    </div>
  );
}
