import { useConfig } from "../config";

export function PrivacyPage() {
  const { brandName, contactEmail } = useConfig();
  return (
    <div className="prose card">
      <h1>Privacy</h1>
      <p className="muted">Plain-English summary of what {brandName} collects and why.</p>

      <h3>What we collect</h3>
      <ul>
        <li>
          <b>Your email</b> — required to run a scan and to send your report.
        </li>
        <li>
          <b>Scan inputs</b> — the brand, category, competitors, and prompts you enter.
        </li>
        <li>
          <b>Analytics events</b> — anonymous funnel events (scan started, report viewed, CTA
          clicked) and a one-way hash of your IP address for abuse prevention. We do not store your
          raw IP.
        </li>
      </ul>

      <h3>How we use it</h3>
      <ul>
        <li>To run your scan, generate your report, and email you results.</li>
        <li>To prevent abuse and stay within our cost limits.</li>
        <li>To understand how the product is used so we can improve it.</li>
      </ul>

      <h3>What we don't do</h3>
      <ul>
        <li>We don't sell your data.</li>
        <li>We don't require a store login for the free scan.</li>
        <li>We don't share your email with third parties beyond what's needed to deliver the service.</li>
      </ul>

      <h3>Contact</h3>
      <p>
        {contactEmail ? (
          <>
            Email <a href={`mailto:${contactEmail}`}>{contactEmail}</a> for any request, including
            deletion of your data.
          </>
        ) : (
          "Reach out via the contact link in the footer for any data request, including deletion."
        )}
      </p>
      <p className="muted" style={{ fontSize: 12 }}>
        Results are directional market intelligence. AI answers vary by model, time, prompt, and
        location.
      </p>
    </div>
  );
}
