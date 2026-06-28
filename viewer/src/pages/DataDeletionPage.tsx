import { useConfig } from "../config";

// Data-deletion request page. Shopify app review requires a clear path for merchants and
// shoppers to request deletion of their data. Describes the automatic + on-request flows.
export function DataDeletionPage() {
  const { brandName, contactEmail } = useConfig();
  const mail = contactEmail || "the contact link in the footer";
  return (
    <div className="prose card">
      <h1>Data deletion</h1>
      <p className="muted">How to remove your data from {brandName}, and what happens automatically.</p>

      <h3>If you installed the Shopify app</h3>
      <ul>
        <li><b>Uninstalling immediately revokes our access</b> and deletes the encrypted access
          token we held for your store — we can no longer read your catalog.</li>
        <li><b>Your store's data is then erased automatically.</b> About 48 hours after uninstall,
          Shopify sends us <code>shop/redact</code> and we delete <b>everything</b> tied to your
          store — catalog, benchmarks and answers, findings, fix proposals, experiments, monitoring,
          AI-referral attribution, and your billing grant. You don't need to email us for this.</li>
        <li>We don't store your customers' personal details (names, emails, addresses, orders). The
          AI-referral Web Pixel does record <b>pseudonymous</b> shopper session data — the assistant a
          visit came from, the landing path, the referrer host, and a salted IP hash — only with the
          shopper's analytics consent. That's auto-deleted after 90 days and erased with the rest on
          <code> shop/redact</code>.</li>
        <li>Want erasure sooner, or have a specific request? Email{" "}
          {contactEmail ? <a href={`mailto:${contactEmail}`}>{contactEmail}</a> : "us"}.</li>
      </ul>

      <h3>If you used the free scan (no store connected)</h3>
      <ul>
        <li>We store your email, the scan inputs you entered, and your report. We never store your
          raw IP address — only a one-way hash used for abuse prevention.</li>
        <li>To delete your email, scans, and reports, email {mail} from the address you used and ask
          us to remove your data. We'll confirm when it's done.</li>
      </ul>

      <h3>What we keep, briefly</h3>
      <p>
        We may retain minimal, non-identifying records required for security, accounting, or legal
        obligations (for example, that a payment occurred) — never your store's customer data, which
        we don't collect. See <a href="/privacy">Privacy</a> for the full picture.
      </p>

      <h3>Request deletion</h3>
      <p>
        {contactEmail ? (
          <>Email <a href={`mailto:${contactEmail}?subject=Data%20deletion%20request`}>{contactEmail}</a>{" "}
            with the subject "Data deletion request". Include your store domain or the email you used
            so we can find your data.</>
        ) : (
          "Use the contact link in the footer with the subject \"Data deletion request\", and include your store domain or the email you used."
        )}
      </p>
    </div>
  );
}
