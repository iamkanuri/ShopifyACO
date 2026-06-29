import process from "node:process";

// ===========================================================================
// Single source of truth for configuration. EVERY secret comes from an
// environment variable here and nowhere else — identical for local `.env`
// (loaded via dotenv) and Railway env vars. No file-based secret source.
//
// SECURITY: SUPABASE_SERVICE_ROLE_KEY, the API keys, and DATABASE_URL are
// SERVER-ONLY. They are never imported by the viewer bundle (the viewer is a
// separate Vite app that imports nothing from src/).
// ===========================================================================

const str = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

// A CA cert for strict Postgres TLS — accept a raw PEM or a base64-encoded PEM (Railway
// env vars handle multi-line PEM, but base64 is easier to paste). undefined when unset.
function decodePem(v: string | undefined): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  if (s.includes("BEGIN CERTIFICATE")) return s;
  try { return Buffer.from(s, "base64").toString("utf8"); } catch { return undefined; }
}

// Supabase client wants the bare project URL. Tolerate a pasted REST path or
// trailing slash (e.g. "https://x.supabase.co/rest/v1/").
function normalizeSupabaseUrl(v: string | undefined): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  return s.replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
}

export const ENV = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  // Production when NODE_ENV says so OR when running on Railway (safety net so we
  // never accidentally bind to localhost — and stay unreachable — in the cloud).
  get isProd() {
    return (
      (process.env.NODE_ENV ?? "development") === "production" ||
      Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID)
    );
  },
  port: Number(process.env.PORT ?? 8787),

  // Engine API keys (server-only).
  keys: {
    openai: str(process.env.OPENAI_API_KEY),
    google: str(process.env.GOOGLE_AI_API_KEY),
    perplexity: str(process.env.PERPLEXITY_API_KEY),
    anthropic: str(process.env.ANTHROPIC_API_KEY),
  },

  // Supabase (runtime data) + direct Postgres (migrations).
  supabaseUrl: normalizeSupabaseUrl(process.env.SUPABASE_URL),
  supabaseServiceRoleKey: str(process.env.SUPABASE_SERVICE_ROLE_KEY),
  databaseUrl: str(process.env.DATABASE_URL),
  // Optional CA (PEM or base64-PEM) for STRICT Postgres TLS (verify-full). When set, DB
  // connections verify the server cert against it (rejectUnauthorized:true); unset keeps the
  // encrypted-but-unverified default so a deploy never breaks if the CA isn't configured.
  // Enable by downloading Supabase's CA (Dashboard → Database → SSL) into DB_CA_CERT.
  dbCaCert: decodePem(process.env.DB_CA_CERT),

  // How many engine calls a benchmark issues at once. Web-grounded calls are slow, so a
  // strictly sequential mini run took minutes; bounded concurrency cuts it to tens of seconds.
  benchmarkConcurrency: Math.max(1, Number(process.env.BENCHMARK_CONCURRENCY ?? 6)),

  // Spend / storage.
  dailySpendCapUsd: Number(process.env.DAILY_SPEND_CAP_USD ?? 10),
  // Where result files live. On Railway this is the volume mount path (e.g. /data).
  dataDir: str(process.env.DATA_DIR) ?? "runs",

  // Free-scan abuse limits.
  freeScansPerEmailPerDay: Number(process.env.FREE_SCANS_PER_EMAIL ?? 2),
  freeScansPerIpPerDay: Number(process.env.FREE_SCANS_PER_IP ?? 2),

  // Admin cockpit.
  adminPassword: str(process.env.ADMIN_PASSWORD),
  // Salt for hashing IPs before storage (privacy). Stable default so hashes match
  // across restarts; override in prod for unlinkability.
  ipHashSalt: str(process.env.IP_HASH_SALT) ?? "shopifyaco-ip-salt-v1",

  // Public branding (NEVER ship "Shopify" in the public-facing name — trademark).
  // Set the real name + domain before launch; repo/internal names stay as-is.
  publicBrandName: str(process.env.PUBLIC_BRAND_NAME) ?? "AI Visibility",
  // Absolute base URL for OG tags / share links. Empty => derive from the request,
  // so it works behind any custom domain with no hardcoded railway.app URLs.
  publicBaseUrl: str(process.env.PUBLIC_BASE_URL),
  contactEmail: str(process.env.CONTACT_EMAIL) ?? "",

  // Stripe Payment Links (URLs only — no Stripe SDK this build). Missing => the
  // CTA falls back to the email-capture modal.
  stripe: {
    full_report: str(process.env.STRIPE_FULL_REPORT_URL),
    monitoring: str(process.env.STRIPE_WEEKLY_MONITORING_URL),
    founder_beta: str(process.env.STRIPE_FOUNDER_BETA_URL),
  } as Record<string, string | undefined>,

  // Stripe webhook (proof of payment). Signature is verified manually with the
  // webhook secret (no SDK). The secret API key is optional defense-in-depth: when
  // set, the webhook re-confirms the session is paid via the Stripe REST API. It is
  // ALSO required to open the billing portal (Phase 11).
  stripeWebhookSecret: str(process.env.STRIPE_WEBHOOK_SECRET),
  stripeSecretKey: str(process.env.STRIPE_SECRET_KEY),
  // Per-plan Stripe Price ids (Phase 11). Used to map a paid line item back to a plan
  // entitlement (the webhook also accepts metadata.plan / amount as fallbacks). NO
  // prices are hardcoded — only the opaque price id, set in the dashboard.
  stripePrices: {
    full_report: str(process.env.STRIPE_PRICE_FULL_REPORT),
    monitoring: str(process.env.STRIPE_PRICE_MONITORING),
    founder_beta: str(process.env.STRIPE_PRICE_FOUNDER_BETA),
  } as Record<string, string | undefined>,
  // Where Stripe returns the merchant after they manage billing in the portal.
  stripePortalReturnUrl: str(process.env.STRIPE_PORTAL_RETURN_URL),

  // ---- Entitlement enforcement (Phase 11) ---------------------------------
  // Additive & DORMANT by default (mirrors the Phase-1 D2 "ship dormant" rule): the
  // entitlements model, provisioning, portal, and usage are always live, but gating
  // paid features/limits is OFF until BILLING_ENFORCED=1 so existing behavior (and the
  // owner's own dev store) is never broken on deploy. When off, the resolved plan is
  // still surfaced in /app for transparency; only the BLOCK is suppressed.
  billing: {
    enforced: process.env.BILLING_ENFORCED === "1" || process.env.BILLING_ENFORCED === "true",
  },

  // ---- Shopify public app (Phase 2) ---------------------------------------
  // All server-only. When key/secret are unset the integration reports
  // "not configured" and the OAuth/webhook routes return 503 instead of running.
  shopify: {
    apiKey: str(process.env.SHOPIFY_API_KEY),
    apiSecret: str(process.env.SHOPIFY_API_SECRET),
    // Optional SECOND secret accepted during a client-secret rotation. Shopify keeps
    // both the old and new secret valid for a grace period and may sign callbacks/
    // webhooks with either; we VERIFY against both so rotation never breaks OAuth.
    apiSecretFallback: str(process.env.SHOPIFY_API_SECRET_FALLBACK),
    // Comma/space separated; least-privilege default. write_products added later.
    scopes: (str(process.env.SHOPIFY_SCOPES) ?? "read_products").split(/[,\s]+/).filter(Boolean),
    apiVersion: str(process.env.SHOPIFY_API_VERSION) ?? "2026-01",
    appUrl: str(process.env.SHOPIFY_APP_URL) ?? str(process.env.PUBLIC_BASE_URL),
    // The app's URL handle (slug), for the Shopify Managed Pricing page link
    // (admin.shopify.com/store/{shop}/charges/{appHandle}/pricing_plans). Find it in the
    // Partner Dashboard. Unset → the in-app "Manage plan" button degrades to a note.
    appHandle: str(process.env.SHOPIFY_APP_HANDLE),
    // Public Shopify App Store LISTING url (apps.shopify.com/<handle>). Set once the listing is
    // live; until then the connect CTA falls back to an App Store search. We must NOT collect a
    // myshopify.com domain in the install flow (App Store req 2.3.1) — installation always starts
    // from this Shopify-owned surface (managed install + token exchange take over inside admin).
    appStoreUrl: str(process.env.SHOPIFY_APP_STORE_URL),
    // 'mock' lets us build + test the full flow with no real Shopify credentials.
    mode: (str(process.env.SHOPIFY_MODE) ?? "live") as "live" | "mock",
  },
  // Base64 32-byte key for AES-256-GCM token encryption at rest. Generate with:
  //   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  appEncryptionKey: str(process.env.APP_ENCRYPTION_KEY),

  // Deployed commit (Railway injects this) for /healthz version checks.
  commit: str(process.env.RAILWAY_GIT_COMMIT_SHA) ?? "dev",

  // ---- Durable job queue (Phase 1) ----------------------------------------
  // Process role: 'web' (default) serves HTTP; 'worker' runs the job loop;
  // 'scheduler' runs periodic maintenance. One image, three Railway services.
  processMode: (str(process.env.PROCESS_MODE) ?? "web") as "web" | "worker" | "scheduler",
  // Opt-in: route scans through the durable queue instead of the in-process lock.
  // Stays OFF until a worker service is deployed + verified (LAUNCH_CHECKLIST.md).
  jobQueueEnabled: process.env.JOB_QUEUE_ENABLED === "1" || process.env.JOB_QUEUE_ENABLED === "true",
  // Let the web process also run the worker loop in-process (handy for local/dev or
  // a single-service deploy). Production should run a dedicated worker instead.
  workerInProcess: process.env.WORKER_IN_PROCESS === "1",
  queue: {
    globalConcurrency: Number(process.env.QUEUE_GLOBAL_CONCURRENCY ?? 4),
    shopConcurrency: Number(process.env.QUEUE_SHOP_CONCURRENCY ?? 1),
    emailConcurrency: Number(process.env.QUEUE_EMAIL_CONCURRENCY ?? 1),
    leaseSec: Number(process.env.QUEUE_LEASE_SEC ?? 120),
    pollMs: Number(process.env.QUEUE_POLL_MS ?? 2000),
    recoverGraceSec: Number(process.env.QUEUE_RECOVER_GRACE_SEC ?? 30),
  },

  // ---- Notifications (Phase 8) --------------------------------------------
  // Until a provider + key are set, alerts fall back to the dev logger adapter
  // (recorded as channel='log', no real send). Email is opt-in.
  email: {
    provider: str(process.env.EMAIL_PROVIDER), // e.g. resend | postmark | ses (unset => logger)
    apiKey: str(process.env.EMAIL_API_KEY),
    from: str(process.env.EMAIL_FROM),
    replyTo: str(process.env.EMAIL_REPLY_TO),
  },
  // Recurring monitoring runs are MOCK ($0) by default; flip to 1 to let the
  // scheduler enqueue LIVE benchmark runs (real engine spend, still under the daily
  // cap). Off by default so monitoring never auto-spends without an explicit opt-in.
  monitoringLive: process.env.MONITORING_LIVE === "1",

  // ---- Evidence & diagnosis crawler (Phase 5) -----------------------------
  // Live crawling hits the network (it spends NO API money — Shopify/web reads are
  // free — but it makes outbound HTTP requests, so it is gated). Default 'mock'
  // exercises the entire pipeline against built-in fixtures at $0 with no network.
  crawler: {
    mode: (str(process.env.CRAWLER_MODE) ?? "mock") as "live" | "mock",
    maxPages: Number(process.env.CRAWLER_MAX_PAGES ?? 8),
    maxDepth: Number(process.env.CRAWLER_MAX_DEPTH ?? 1),
    maxBytes: Number(process.env.CRAWLER_MAX_BYTES ?? 2_500_000),
    timeoutMs: Number(process.env.CRAWLER_TIMEOUT_MS ?? 10_000),
    maxRedirects: Number(process.env.CRAWLER_MAX_REDIRECTS ?? 4),
    respectRobots: process.env.CRAWLER_RESPECT_ROBOTS !== "0",
  },

  // ---- Product feeds (Phase 9) --------------------------------------------
  // Generating + validating + scoring a feed is local computation over the synced
  // catalog: $0 and NO network. SUBMITTING/DELIVERING a feed to OpenAI is a separate
  // external onboarding step (merchant eligibility + delivery endpoint), kept behind
  // this flag so the app never implies it delivered a feed it hasn't. Off until OpenAI
  // approves the merchant and delivery is wired (LAUNCH_CHECKLIST item 8).
  feeds: {
    deliveryEnabled: process.env.FEED_DELIVERY_ENABLED === "1",
    // Fallback currency for the feed price column — the catalog doesn't yet capture
    // the shop's currency, so a feed's config currency (or this) is used.
    defaultCurrency: str(process.env.FEED_DEFAULT_CURRENCY) ?? "USD",
  },

  // ---- AI-referral pixel (Phase 10) ---------------------------------------
  // The public /api/pixel/ingest beacon accepts storefront events. On by default
  // (harmless until the Web Pixel extension is deployed + activated — a separate
  // external step). The shared secret is a WEAK anti-noise gate only (it ships to the
  // browser inside the pixel), never authentication — real scoping is install + consent.
  pixel: {
    ingestEnabled: process.env.PIXEL_INGEST_ENABLED !== "0",
    sharedSecret: str(process.env.PIXEL_SHARED_SECRET),
    // Per-shop ingest token enforcement. SOFT by default: a present-but-wrong token is
    // rejected, a MISSING token is accepted (so pixels activated before the token rollout keep
    // working). Flip PIXEL_REQUIRE_TOKEN=1 to STRICT (reject a missing token) once every shop's
    // pixel has been re-activated with a token.
    requireToken: process.env.PIXEL_REQUIRE_TOKEN === "1" || process.env.PIXEL_REQUIRE_TOKEN === "true",
  },
};

/** Scan modes. Only `mini` is self-serve for the public; admin can run the rest. */
export const SCAN_MODES = {
  mini: { label: "Mini", prompts: 5, maxCostUsd: 0.5, public: true },
  standard: { label: "Standard", prompts: 15, maxCostUsd: 2, public: false },
  deep: { label: "Deep", prompts: 30, maxCostUsd: 5, public: false },
} as const;
export type ScanMode = keyof typeof SCAN_MODES;

/** True when Supabase persistence is configured. */
export const hasSupabase = () => Boolean(ENV.supabaseUrl && ENV.supabaseServiceRoleKey);

/** True when the Shopify app can run OAuth/webhooks (mock mode needs only the key). */
export const hasShopify = () =>
  ENV.shopify.mode === "mock"
    ? Boolean(ENV.appEncryptionKey)
    : Boolean(ENV.shopify.apiKey && ENV.shopify.apiSecret && ENV.appEncryptionKey);

/** Warn (don't crash) about anything important that's missing for the current mode. */
export function reportConfig(): void {
  const miss: string[] = [];
  if (!ENV.keys.openai && !ENV.keys.google && !ENV.keys.perplexity) miss.push("all engine API keys");
  if (!hasSupabase()) miss.push("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY (persistence disabled)");
  if (ENV.isProd && !ENV.databaseUrl) miss.push("DATABASE_URL (migrations)");
  if (miss.length) console.warn(`[config] missing: ${miss.join("; ")}`);

  // Louder warnings for a weak PRODUCTION posture (don't crash — degrade visibly).
  if (ENV.isProd) {
    const warn: string[] = [];
    if (ENV.ipHashSalt === "shopifyaco-ip-salt-v1") warn.push("IP_HASH_SALT is the default — set a unique random value");
    if (!ENV.publicBaseUrl) warn.push("PUBLIC_BASE_URL unset — OG/share links derive from the request host");
    if (!ENV.contactEmail) warn.push("CONTACT_EMAIL unset — privacy page/footer have no contact");
    if (ENV.adminPassword && ENV.adminPassword.length < 12) warn.push("ADMIN_PASSWORD is short (<12 chars)");
    const stripeUrls = Object.values(ENV.stripe).some(Boolean);
    if (stripeUrls && !process.env.STRIPE_WEBHOOK_SECRET) warn.push("Stripe links set but STRIPE_WEBHOOK_SECRET missing — payments won't be recorded");
    if (warn.length) console.warn(`[config] ⚠️ prod: ${warn.join("; ")}`);
  }
}
