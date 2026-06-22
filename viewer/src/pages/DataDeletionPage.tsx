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
        <li>Shopify also sends us standard data-erasure requests on your behalf
          (<code>shop/redact</code>, <code>customers/redact</code>). We honor these. Note that we do
          not store your customers' personal information in the first place — the app reads product
          data, not customer data.</li>
        <li>To also delete the analysis history and benchmark results tied to your store, email{" "}
          {contactEmail ? <a href={`mailto:${contactEmail}`}>{contactEmail}</a> : "us"} and we'll
          remove them.</li>
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
