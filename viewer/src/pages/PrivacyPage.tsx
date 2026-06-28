import { useConfig } from "../config";

export function PrivacyPage() {
  const { brandName, contactEmail } = useConfig();
  return (
    <div className="prose card">
      <h1>Privacy</h1>
      <p className="muted">
        A plain-English inventory of what {brandName} collects, who it's shared with, how long it's
        kept, and your choices. This is a summary, not legal advice.
      </p>

      <h3>What we collect — free website scan</h3>
      <ul>
        <li><b>Your email</b> — to run the free scan, prevent abuse, and contact you about your
          results or the service. Your report is shown on screen; we don't email it to you.</li>
        <li><b>Scan inputs</b> — the brand, category, competitors and prompts you enter.</li>
        <li><b>Results</b> — the AI assistants' answers to those prompts and the visibility metrics
          we compute from them.</li>
        <li><b>Analytics events</b> — funnel events (scan started, report viewed, CTA clicked) and a
          one-way hash of your IP address for abuse prevention. We never store your raw IP.</li>
      </ul>

      <h3>What we collect — connected Shopify store</h3>
      <ul>
        <li><b>Store identity</b> — your <code>.myshopify.com</code> domain and install record.</li>
        <li><b>Access tokens &amp; scopes</b> — the offline access/refresh tokens Shopify issues and
          the permissions you granted, stored <b>encrypted</b> (AES-256-GCM).</li>
        <li><b>Product catalog</b> — product titles, descriptions, variants, identifiers and
          metafields, read with the <code>read_products</code> scope (we don't read customer or order
          data).</li>
        <li><b>Measurements</b> — the benchmark prompts, the AI assistants' answers, and the derived
          findings, fix proposals, experiments and monitoring history.</li>
        <li><b>Billing</b> — your plan, subscription status and period (via Shopify App Pricing).</li>
        <li><b>AI-referral attribution</b> — if the Web Pixel is active and the shopper grants
          analytics consent: the assistant a session arrived from, the landing path, the referrer
          host, a pseudonymous session id, and a salted hash of the IP. No names, emails, addresses
          or order details — but pseudonymous data can still be personal data, so we treat it as such.</li>
      </ul>

      <h3>Who we share it with</h3>
      <ul>
        <li><b>AI providers (to generate answers):</b> your prompts — including the brand, category
          and competitor names — are sent to <b>OpenAI (ChatGPT)</b>, <b>Google (Gemini)</b> and
          <b> Perplexity</b> to produce the answers we analyze.</li>
        <li><b>Infrastructure:</b> Supabase (database), Railway (hosting), Stripe (website payments)
          and Shopify (app billing + the data you've connected). They process data on our behalf.</li>
        <li>We <b>don't sell</b> your data and don't share it for advertising.</li>
      </ul>

      <h3>How long we keep it</h3>
      <ul>
        <li><b>AI-referral pixel events</b> — 90 days, then automatically deleted.</li>
        <li><b>Access tokens</b> — deleted the moment you uninstall the app.</li>
        <li><b>Your store's data</b> (catalog, measurements, findings, fixes, experiments, monitoring,
          attribution) — erased automatically after you uninstall, via Shopify's <code>shop/redact</code>
          (about 48 hours later). See <a href="/data-deletion">Data deletion</a>.</li>
        <li><b>Free-scan data</b> (email, inputs, results) — kept until you ask us to delete it.</li>
        <li><b>Billing records</b> — retained as needed for accounting/legal obligations.</li>
      </ul>

      <h3>How we use it</h3>
      <ul>
        <li>To run your scans/benchmarks, diagnose gaps, and (only with your explicit approval) apply
          reviewable SEO changes back to your store.</li>
        <li>To prevent abuse and stay within our cost limits.</li>
        <li>To understand how the product is used so we can improve it.</li>
      </ul>

      <h3>Your choices &amp; security</h3>
      <ul>
        <li>Uninstall anytime to revoke access and trigger erasure; or email us to access or delete
          your data (see below).</li>
        <li>Data is encrypted in transit (TLS) and at rest; Shopify tokens use AES-256-GCM.</li>
        <li>We don't require a store login for the free scan.</li>
      </ul>

      <h3>Contact</h3>
      <p>
        {contactEmail ? (
          <>Email <a href={`mailto:${contactEmail}`}>{contactEmail}</a> for any request, including
            access or deletion of your data.</>
        ) : (
          "Reach out via the contact link in the footer for any data request, including access or deletion."
        )}
      </p>
      <p className="muted" style={{ fontSize: 12 }}>
        Results are directional market intelligence. AI answers vary by model, time, prompt, and
        location.
      </p>
    </div>
  );
}
