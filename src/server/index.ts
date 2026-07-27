import "dotenv/config";
import process from "node:process";
import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import type { Config } from "../types.js";
import { validateConfig } from "../config.js";
import { buildAdapters } from "../engines/index.js";
import { estimateMaxCost } from "../cli.js";
import { expandPrompts } from "../prompts.js";
import { generatePrompts, miniScanPrompts, type ScanForm } from "../prompts/library.js";
import { suggestPrompts } from "./suggest.js";
import { inferStore } from "./infer.js";
import { checkEngineKeys } from "./healthcheck.js";
import { installHandler, callbackHandler, tokenExchangeHandler, webhookHandler, shopifyStatus, shopInfoHandler, requireShop } from "./shopify.js";
import { normalizeShopDomain } from "../shopify/domain.js";
import { triggerSyncHandler, syncStatusHandler, listProductsHandler } from "./catalog.js";
import { diagnoseHandler, findingsHandler, pagesHandler } from "./evidence.js";
import { applyHandler, approveHandler, dismissHandler, listFixesHandler, proposeHandler, rollbackHandler } from "./fixes.js";
import { baselineHandler, getExperimentHandler, listExperimentsHandler, listInterventionsHandler, planHandler, startVerificationHandler, verifyHandler } from "./experiments.js";
import { acknowledgeAlertHandler, createScheduleHandler, deleteScheduleHandler, listAlertsHandler, listSchedulesHandler, runScheduleHandler, updateScheduleHandler } from "./monitoring.js";
import { createFeedHandler, deliveryStatusHandler, exportVersionHandler, feedSpecHandler, generateFeedHandler, getVersionHandler, listFeedsHandler, listItemsHandler, listVersionsHandler } from "./feeds.js";
import { registerFeedJobs } from "../feeds/generate.js";
import { activateHandler, attributionHandler, ingestHandler, ingestPreflightHandler, pixelHealthHandler } from "./pixel.js";
import { billingPortalHandler, billingStatusHandler } from "./billing.js";
import { listBenchmarksHandler, runBenchmarkHandler } from "./benchmarks.js";
import { dashboardHandler } from "./dashboard.js";
import { registerCatalogJobs } from "../catalog/sync.js";
import { registerDiagnosisJobs } from "../diagnosis/execute.js";
import { registerExperimentJobs } from "../experiments/execute.js";
import { registerMonitoringJobs } from "../monitoring/execute.js";
import { hasPg, pgQuery } from "../db/pg.js";
import { stats as queueStats, recentHeartbeats, retryDeadLetter, cancel as cancelJob } from "../queue/jobs.js";
import { currentSpendDbUsd } from "../queue/spend.js";
import { ENV, hasSupabase, reportConfig, SCAN_MODES, type ScanMode } from "./env.js";
import {
  clientIp,
  currentSpendUsd,
  freeScanAllowed,
  ungatedScanAllowed,
  claimAllowed,
  ipHash,
  isValidEmail,
  rateLimit,
  recordSpend,
  spendAllows,
} from "./guards.js";
import {
  getCategoryIndex,
  getOrder,
  getPaidOrderForRun,
  insertEvent,
  insertLead,
  insertRun,
  listCategoryIndexes,
  updateOrder,
  updateRun,
  upsertCategoryIndex,
  type IndexEntry,
} from "../db/supabase.js";
import { handleStripeWebhook } from "./stripe.js";
import { ADMIN_COOKIE, buildAdminData, checkPassword, isAdmin, makeToken, requireAdmin } from "./admin.js";
import {
  acquireLock,
  activeRun,
  createRun,
  getClaim,
  getResults,
  getStatus,
  isBusy,
  isValidRunId,
  newRunId,
  ogPngPath,
  readProgress,
  releaseLock,
  runDir,
  setClaimed,
  setRunStoreUrl,
} from "./runStore.js";
import { safeFetch } from "../crawler/fetch.js";
import { validateUrl } from "../crawler/ssrf.js";
import { runScanJob } from "./scanJob.js";
import { runProductTest } from "./productTest.js";
import { discoverProduct } from "./discover.js";
import { newTestToken, storePublicTest } from "../db/buyerTests.js";
import { recordFunnelEvent, classifyReferrer } from "../db/funnel.js";
import { funnelHandler } from "./funnelAdmin.js";
import { hostedCaseHandler } from "./hostedCase.js";
import {
  claimTestHandler, listTestsHandler, createTestHandler, getTestHandler,
  runTestHandler, confirmQuestionsHandler, confirmHandler,
  proposeFromTestHandler, testProposalsHandler,
} from "./buyerTests.js";
import { indexSsrFor, loadIndexOgModel } from "./indexSsr.js";
import { standardsPageFor, standardJsonFor, standardsSitemapPaths, llmsTxt, renderStandaloneDocument } from "./standardsSite.js";
import { reportPreview } from "./reportPreview.js";
import { stripPaidDelta, paidReportTier } from "./reportProjection.js";
import { getPaidReportByRun } from "../db/paidReports.js";
import { buildDefaultCardSvg, buildDemoCardSvg, buildIndexListCardSvg, buildIndexSlugCardSvg, buildReportCardSvg, renderCardPng, renderOgPng } from "./ogCard.js";
import { PLANS } from "../pricing.js";
import { MODELS, perCallMaxCostUsd } from "../engines/models.js";

const MINI_PROMPTS = 5;
const DEFAULT_ENGINES = ["openai", "gemini", "perplexity"];
const SUGGEST_COST_CAP_USD = 0.02;
// ⚠️ Kept byte-identical to TAGLINE in viewer/src/copy.ts (test/siteCopy.test.ts
// asserts the pair, and lints this string with the real claim linter).
const TAGLINE =
  "AisleLens publishes versioned buying standards — the questions a competent buyer asks in a category, written as executable tests — and runs them against your real product pages, reporting every requirement as proven, not proven, or requires store access, with the evidence.";
// MERGE NOTE (v2.1): the DESCRIPTION is v2's (the QA repositioning). The DEMO_NOTE is main's,
// deliberately: v2's shorter note dropped the third-party trademark attribution that main added
// for the Sennen demo. The demo still renders those real brands, so the attribution is a legal
// requirement, not stale copy — it must survive the reposition.
const DEMO_NOTE =
  "Sample data, shown for illustration. “Sennen” is a fictional brand; The Ordinary, CeraVe, La Roche-Posay and Paula's Choice are trademarks of their respective owners, referenced for illustration only and not affiliated with AisleLens.";
const ALLOWED_EVENTS = new Set([
  "report_viewed",
  "cta_full_report",
  "cta_monitoring",
  "cta_founder_beta",
  "payment_link_clicked",
  "payment_completed",
  "lead_submitted",
  "index_viewed",
  "index_claim_click",
]);
// Stripe Payment Link per plan id (URLs only).
const STRIPE_BY_PLAN: Record<string, string | undefined> = ENV.stripe;

// Harden the PUBLIC analytics beacon: accept only a shallow object of short primitive
// values (no nesting/arrays) so a valid event name can't be used to inject large/deep
// junk JSON into the events table. Legit client events carry small primitive fields.
function sanitizeEventMeta(meta: unknown): Record<string, unknown> | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
    if (n++ >= 20 || typeof k !== "string" || k.length > 64) continue; // cap key count + length
    if (v == null || typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (typeof v === "string") out[k] = v.slice(0, 256); // primitives only — drop nested objects/arrays
  }
  return out;
}

const keys = ENV.keys;
const app = express();
if (ENV.isProd) app.set("trust proxy", 1);
app.disable("x-powered-by");

// --- security headers (every response) -------------------------------------
// Strict CSP. Everything stays 'self' except: Google Fonts (style/font), and
// app-bridge.js in script-src so Shopify App Bridge can load inside the embedded iframe.
// `frame-ancestors` is the ONLY per-request directive: when Shopify loads the app embedded
// it passes ?shop=<store>.myshopify.com, and we allow EXACTLY that store + admin.shopify.com
// to frame us. The shop value is strictly validated (normalizeShopDomain → only canonical
// <name>.myshopify.com), so it can't inject into the header; no wildcards (Shopify rejects
// them). With no valid shop we deny all framing. X-Frame-Options can't express an allowlist
// (DENY/SAMEORIGIN only) and would block the embed regardless of CSP — so it's set ONLY on
// the non-embedded (deny) path, where it's pure defense-in-depth and never conflicts.
const CSP_BASE = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "script-src 'self' https://cdn.shopify.com/shopifycloud/app-bridge.js",
  "connect-src 'self'",
  "form-action 'self'",
];
app.use((req: Request, res: Response, next: NextFunction) => {
  const shop = normalizeShopDomain(typeof req.query.shop === "string" ? req.query.shop : undefined);
  const frameAncestors = shop
    ? `frame-ancestors https://${shop} https://admin.shopify.com`
    : "frame-ancestors 'none'";
  res.setHeader("Content-Security-Policy", [...CSP_BASE, frameAncestors].join("; "));
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!shop) res.setHeader("X-Frame-Options", "DENY"); // allowlist not expressible in X-FO; deny path only
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  // COOP is processed only for TOP-LEVEL documents; it is ignored when the page is framed,
  // so it does not interfere with the Shopify embed while still hardening standalone pages.
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  if (ENV.isProd) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});

// --- crawl hygiene: index public pages, keep admin/api out of search --------
app.get("/robots.txt", (req, res) => {
  res
    .type("text/plain")
    // /c/ = the unlisted outreach cases. They already send X-Robots-Tag: noindex,
    // but a Disallow keeps a compliant crawler from fetching them at all — and a
    // case page names a real third-party store, so it should never be indexed.
    .send(`User-agent: *\nDisallow: /admin\nDisallow: /api/\nDisallow: /c/\nAllow: /\n\nSitemap: ${baseUrl(req)}/sitemap.xml\n`);
});
// ---- the published standard (v3.2 CP7) -------------------------------------
//
// Registered BEFORE `express.static` and the SPA catch-all so these paths resolve to
// the artifact rather than to index.html. The point of a stable entry id is an agency
// writing "your product pages fail ALS-COFFEE-1.0-CERT-002" and having it resolve, so
// these URLs are a contract: they must keep working, and the JSON must keep being JSON.
app.get(/^\/standards\/[a-z0-9-]+\/[0-9.]+\/standard\.json$/, (req, res) => {
  const found = standardJsonFor(req.path);
  if (!found) return res.status(404).type("application/json").send(`{"error":"no such standard"}`);
  // The content hash is served as a header too, so a machine can check the artifact it
  // just fetched against a citation without parsing the body first.
  res.set("X-Standard-Hash", found.hash);
  res.set("Cache-Control", "public, max-age=3600");
  res.type("application/json").send(found.json);
});

// A plain-text map for a machine reader that arrives without a crawler.
app.get("/llms.txt", (req, res) => {
  res.type("text/plain").send(llmsTxt(baseUrl(req)));
});

// The standard's HTML pages, served as STANDALONE DOCUMENTS — see the block above
// `renderStandaloneDocument`. They deliberately do not load the SPA bundle: these
// paths are not React routes, so injecting them into the app shell made a crawler
// see the standard and a human see "Page not found".
/** The hashed stylesheet Vite emitted, read once from the built index.html. The
 *  standalone standard pages link it so they inherit the site's tokens without
 *  loading the app bundle. Null in a tree with no build — the pages still render,
 *  unstyled, which is the right failure: the CONTENT is the point. */
let cssHrefCache: string | null | undefined;
function builtCssHref(): string | null {
  if (cssHrefCache !== undefined) return cssHrefCache;
  try {
    const html = readFileSync(resolve("viewer/dist/index.html"), "utf8");
    cssHrefCache = (/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/.exec(html)?.[1]) ?? null;
  } catch { cssHrefCache = null; }
  return cssHrefCache;
}

app.get(/^\/standards(\/.*)?$/, (req, res, next) => {
  const page = standardsPageFor(req.path, baseUrl(req));
  if (!page) return next();          // unknown standard/entry ⇒ the SPA's 404
  res.type("html").set("Cache-Control", "public, max-age=300").send(
    renderStandaloneDocument(page, { cssHref: builtCssHref(), brand: ENV.publicBrandName, base: baseUrl(req) }),
  );
});

app.get("/sitemap.xml", async (req, res) => {
  const base = baseUrl(req);
  // Repositioning: Index is retired from the public identity (nav/footer) but its
  // routes stay crawlable for now (existing shared links + prior distribution work).
  const urls = ["/", "/demo", "/methodology", "/scan", "/privacy", "/terms", "/support", "/index"]
    // Every published standard and every ENTRY. A citation that resolves is the whole
    // reason the ids are stable, so each one is a first-class indexable page.
    .concat(standardsSitemapPaths())
    .map((p) => `  <url><loc>${base}${p}</loc></url>`);
  try {
    for (const idx of await listCategoryIndexes()) {
      const lastmod = idx.updated_at ? `<lastmod>${new Date(idx.updated_at).toISOString().slice(0, 10)}</lastmod>` : "";
      urls.push(`  <url><loc>${base}/index/${idx.slug}</loc>${lastmod}</url>`);
    }
  } catch {
    /* DB down — ship the static paths */
  }
  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`);
});

// Stripe webhook needs the RAW body for signature verification, so it must be
// registered BEFORE express.json() (and before the /api rate limiter — Stripe
// can burst retries). The handler sends its own response and never calls next().
app.post("/api/stripe/webhook", express.raw({ type: () => true, limit: "1mb" }), (req, res) => {
  handleStripeWebhook(req, res).catch((err) => {
    console.error(`[stripe] unhandled webhook error: ${(err as Error).message}`);
    if (!res.headersSent) res.status(500).send("Webhook handler error.");
  });
});

// Shopify webhooks also need the RAW body for HMAC verification (before express.json).
app.post("/api/shopify/webhooks", express.raw({ type: () => true, limit: "1mb" }), (req, res) => {
  webhookHandler(req, res).catch((err) => {
    console.error(`[shopify] unhandled webhook error: ${(err as Error).message}`);
    if (!res.headersSent) res.status(500).end();
  });
});

app.use(express.json({ limit: "256kb" }));

app.use("/api", (req: Request, res: Response, next: NextFunction) => {
  if (!rateLimit(`api:${clientIp(req)}`, 120, 60_000)) {
    return res.status(429).json({ error: "Too many requests — slow down a moment." });
  }
  next();
});

// The embedded-app API is authenticated (requireShop) but still per-IP rate-limited as
// defense-in-depth: a stolen or abused shop session must not be able to hammer the
// expensive shop-scoped endpoints (live benchmarks, crawls, feed generation). Generous
// limit — a normal dashboard makes several calls per screen.
app.use("/app/api", (req: Request, res: Response, next: NextFunction) => {
  if (!rateLimit(`appapi:${clientIp(req)}`, 240, 60_000)) {
    return res.status(429).json({ error: "Too many requests — slow down a moment." });
  }
  next();
});

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
  fn(req, res).catch(next);

function baseUrl(req: Request): string {
  return ENV.publicBaseUrl ?? `${req.protocol}://${req.get("host")}`;
}

// --- health (with deployed commit for prod==main verification) -------------
app.get("/healthz", async (_req, res) => {
  let spendToday = 0;
  try {
    spendToday = await currentSpendUsd();
  } catch {
    /* ignore */
  }
  res.json({
    ok: true,
    env: ENV.nodeEnv,
    commit: ENV.commit,
    brand: ENV.publicBrandName,
    supabase: hasSupabase(),
    dailySpendCapUsd: ENV.dailySpendCapUsd,
    spendTodayUsd: Number(spendToday.toFixed(4)),
  });
});

// --- deep health: db, queue, worker/scheduler heartbeats, engine creds ------
// No secrets. Used to verify the Phase-1 job system + process modes are live.
app.get("/healthz/deep", async (_req, res) => {
  const out: Record<string, unknown> = { ok: true, commit: ENV.commit, jobQueueEnabled: ENV.jobQueueEnabled };
  // DB connectivity
  let db = false;
  if (hasPg()) {
    try {
      await pgQuery("select 1");
      db = true;
    } catch (err) {
      // Log the detail server-side; the PUBLIC payload exposes only the status (no raw
      // error string — it can leak schema/connection internals).
      console.error("[healthz] db check failed:", (err as Error).message);
    }
  }
  out.database = db ? "ok" : hasPg() ? "error" : "not_configured";
  // Queue depth + heartbeats (only if DB reachable + tables migrated)
  if (db) {
    try {
      const s = await queueStats();
      out.queue = { byStatus: s.byStatus, oldestQueuedAgeSec: s.oldestQueuedAgeSec, deadLetter: s.deadLetter, running: s.running };
      out.heartbeats = await recentHeartbeats(120);
      out.spendTodayDbUsd = Number((await currentSpendDbUsd()).toFixed(4));
    } catch (err) {
      out.queue = "unavailable"; // detail logged server-side, not exposed publicly
      console.error("[healthz] queue check failed:", (err as Error).message);
    }
  }
  // Engine credentials (configured-or-not only; full validity check is admin-gated)
  out.engines = {
    openai: Boolean(keys.openai),
    google: Boolean(keys.google),
    perplexity: Boolean(keys.perplexity),
    anthropic: Boolean(keys.anthropic),
  };
  out.shopify = shopifyStatus();
  out.ok = db || !hasPg(); // healthy if DB works, or if DB intentionally unconfigured
  res.status(out.ok ? 200 : 503).json(out);
});

// --- Shopify OAuth: install + callback (Phase 2) ---------------------------
app.get("/api/shopify/install", wrap(installHandler));
app.get("/api/shopify/callback", wrap(callbackHandler));
// Embedded install via token exchange (no redirect): the App Bridge session token is
// swapped for an offline token. Authenticated by the token itself (not requireShop).
app.post("/api/shopify/token", wrap(tokenExchangeHandler));

// --- Catalog API (Phase 3, shop-scoped). Shopify reads are free. -----------
const shopMw = (req: Request, res: Response, next: NextFunction) => requireShop(req, res, next).catch(next);
app.post("/app/api/catalog/sync", shopMw, wrap(triggerSyncHandler));
app.get("/app/api/catalog/sync/status", shopMw, wrap(syncStatusHandler));
app.get("/app/api/catalog/products", shopMw, wrap(listProductsHandler));
registerCatalogJobs();

// --- Evidence & diagnosis API (Phase 5, shop-scoped). Crawl defaults to mock;
//     a live crawl is explicit opt-in and hits the network (no API spend). ------
app.post("/app/api/evidence/diagnose", shopMw, wrap(diagnoseHandler));
app.get("/app/api/evidence/findings", shopMw, wrap(findingsHandler));
app.get("/app/api/evidence/pages", shopMw, wrap(pagesHandler));
registerDiagnosisJobs();

// --- Fix Studio API (Phase 6, shop-scoped). APPLY is the only store-writing route
//     and is gated: merchant approval + write_products scope + re-read conflict
//     check + rollback snapshot, all inside applyProposal. ------------------------
app.post("/app/api/fixes/propose", shopMw, wrap(proposeHandler));
app.get("/app/api/fixes", shopMw, wrap(listFixesHandler));
app.post("/app/api/fixes/:id/approve", shopMw, wrap(approveHandler));
app.post("/app/api/fixes/:id/apply", shopMw, wrap(applyHandler));
app.post("/app/api/fixes/:id/rollback", shopMw, wrap(rollbackHandler));
app.post("/app/api/fixes/:id/dismiss", shopMw, wrap(dismissHandler));

// --- Buyer Tests API (V2, shop-scoped). The authenticated continuation of the
//     public Buyer Test: claim a public result through install, re-run the PINNED
//     contract with full store access, confirm claims the merchant alone can
//     answer, and keep the whole thing as a re-runnable regression test. --------
app.post("/app/api/buyer-tests/claim", shopMw, wrap(claimTestHandler));
app.get("/app/api/buyer-tests", shopMw, wrap(listTestsHandler));
app.post("/app/api/buyer-tests", shopMw, wrap(createTestHandler));
app.get("/app/api/buyer-tests/:id", shopMw, wrap(getTestHandler));
app.post("/app/api/buyer-tests/:id/run", shopMw, wrap(runTestHandler));
app.get("/app/api/buyer-tests/:id/confirm", shopMw, wrap(confirmQuestionsHandler));
app.post("/app/api/buyer-tests/:id/confirm", shopMw, wrap(confirmHandler));
app.post("/app/api/buyer-tests/:id/propose", shopMw, wrap(proposeFromTestHandler));
app.get("/app/api/buyer-tests/:id/proposals", shopMw, wrap(testProposalsHandler));

// --- Experiments API (Phase 7, shop-scoped). "Prove whether it worked": matched
//     baseline/verification benchmark runs compared with CIs. Runs default to mock
//     ($0); a live run (engine spend) requires explicit { live: true }. -----------
app.post("/app/api/experiments/plan", shopMw, wrap(planHandler));
app.post("/app/api/experiments/start", shopMw, wrap(startVerificationHandler));
app.get("/app/api/experiments", shopMw, wrap(listExperimentsHandler));
app.get("/app/api/experiments/:id", shopMw, wrap(getExperimentHandler));
app.post("/app/api/experiments/:id/baseline", shopMw, wrap(baselineHandler));
app.post("/app/api/experiments/:id/verify", shopMw, wrap(verifyHandler));
app.get("/app/api/interventions", shopMw, wrap(listInterventionsHandler));
registerExperimentJobs();

// --- Self-serve benchmarks (Phase 12, shop-scoped). Lets a merchant start the loop.
//     Runs default to mock ($0); a live run (engine spend) needs explicit { live: true }.
app.post("/app/api/benchmarks/run", shopMw, wrap(runBenchmarkHandler));
app.get("/app/api/benchmarks", shopMw, wrap(listBenchmarksHandler));

// --- Dashboard API (shop-scoped). The connected merchant's OWN home metrics computed
//     from their latest completed run + findings/proposals/alerts. hasData=false until
//     they've run a benchmark; the client falls back to the labeled sample only on 401.
app.get("/app/api/dashboard", shopMw, wrap(dashboardHandler));

// --- Connected-shop info (scopes/plan/status) for the Settings screen.
app.get("/app/api/shop", shopMw, wrap(shopInfoHandler));

// --- Monitoring & alerts API (Phase 8, shop-scoped). Recurring schedules + alerts.
//     Runs default to mock ($0); the scheduler enqueues live only if MONITORING_LIVE=1.
app.post("/app/api/schedules", shopMw, wrap(createScheduleHandler));
app.get("/app/api/schedules", shopMw, wrap(listSchedulesHandler));
app.post("/app/api/schedules/:id", shopMw, wrap(updateScheduleHandler));
app.post("/app/api/schedules/:id/delete", shopMw, wrap(deleteScheduleHandler));
app.post("/app/api/schedules/:id/run", shopMw, wrap(runScheduleHandler));
app.get("/app/api/alerts", shopMw, wrap(listAlertsHandler));
app.post("/app/api/alerts/:id/acknowledge", shopMw, wrap(acknowledgeAlertHandler));
registerMonitoringJobs();

// --- Product feeds API (Phase 9, shop-scoped). Generate a versioned, validated feed
//     over the synced catalog + an auditable readiness score. Generation is $0 + no
//     network; DELIVERY to OpenAI is an external, config-gated step (never faked).
app.post("/app/api/feeds", shopMw, wrap(createFeedHandler));
app.get("/app/api/feeds", shopMw, wrap(listFeedsHandler));
app.get("/app/api/feeds/spec", shopMw, wrap(feedSpecHandler));
app.get("/app/api/feeds/delivery/status", shopMw, wrap(deliveryStatusHandler));
app.post("/app/api/feeds/:id/generate", shopMw, wrap(generateFeedHandler));
app.get("/app/api/feeds/:id/versions", shopMw, wrap(listVersionsHandler));
app.get("/app/api/feeds/versions/:vid", shopMw, wrap(getVersionHandler));
app.get("/app/api/feeds/versions/:vid/items", shopMw, wrap(listItemsHandler));
app.get("/app/api/feeds/versions/:vid/export", shopMw, wrap(exportVersionHandler));
registerFeedJobs();

// --- AI-referral attribution API (Phase 10, shop-scoped). Directional funnel of
//     AI-referred storefront sessions. Read-only; the storefront pixel writes via the
//     public /api/pixel/ingest beacon above. -------------------------------------
app.get("/app/api/pixel/attribution", shopMw, wrap(attributionHandler));
app.get("/app/api/pixel/health", shopMw, wrap(pixelHealthHandler));
app.post("/app/api/pixel/activate", shopMw, wrap(activateHandler));

// --- Billing & entitlements API (Phase 11, shop-scoped). Effective plan + usage vs
//     limits + the Stripe billing portal. Paid-feature ENFORCEMENT is dormant until
//     BILLING_ENFORCED=1 (additive deploy); this read surface is always live. Stripe
//     stays in TEST mode — going live is a credentials-only swap (KYC-gated).
app.get("/app/api/billing", shopMw, wrap(billingStatusHandler));
app.post("/app/api/billing/portal", shopMw, wrap(billingPortalHandler));

// --- public runtime config (NO secrets; service-role key never sent) -------
app.get("/api/config", (req, res) => {
  const plans = PLANS.map((p) => ({ ...p, stripeUrl: STRIPE_BY_PLAN[p.id] ?? null }));
  const base = baseUrl(req);
  res.json({
    brandName: ENV.publicBrandName,
    baseUrl: base,
    contactEmail: ENV.contactEmail,
    // Public Shopify App Store listing (Shopify-owned install surface; req 2.3.1). Null until
    // the listing is live → the connect CTA falls back to an App Store search for the brand.
    appStoreUrl: ENV.shopify.appStoreUrl ?? null,
    tagline: TAGLINE,
    demoNote: DEMO_NOTE,
    plans,
    miniPrompts: MINI_PROMPTS,
    fullReportPrompts: SCAN_MODES.deep.prompts,
    // Accurate worst-case cost PER CALL per public engine (token cost + the fixed
    // search/request fee), so the scan UI's estimate matches the backend reservation
    // instead of the old token-only client constant (~4.6× under). Codex #9.
    scanCostPerCall: {
      openai: perCallMaxCostUsd(MODELS.openai),
      gemini: perCallMaxCostUsd(MODELS.gemini),
      perplexity: perCallMaxCostUsd(MODELS.perplexity),
    } as Record<string, number>,
    scanCostCapUsd: SCAN_MODES.mini.maxCostUsd,
    // Ready-to-paste legal/support URLs for the Shopify App Store listing (in-app pages).
    legal: {
      privacyUrl: `${base}/privacy`,
      termsUrl: `${base}/terms`,
      supportUrl: `${base}/support`,
      dataDeletionUrl: `${base}/data-deletion`,
      supportEmail: ENV.contactEmail || null,
    },
  });
});

// --- prompt generation (deterministic, free) -------------------------------
app.post(
  "/api/prompts/generate",
  wrap(async (req, res) => {
    const form = req.body as ScanForm;
    const err = validateForm(form);
    if (err) return res.status(400).json({ error: err });
    res.json({ prompts: generatePrompts(form), miniDefault: miniScanPrompts(form, MINI_PROMPTS).map((p) => p.text) });
  }),
);

// --- optional AI suggest (ONE capped call) ---------------------------------
app.post(
  "/api/prompts/suggest",
  wrap(async (req, res) => {
    const form = req.body as ScanForm;
    const err = validateForm(form);
    if (err) return res.status(400).json({ error: err });
    if (!rateLimit(`suggest:${clientIp(req)}`, 5, 60_000)) {
      return res.status(429).json({ error: "Too many suggestions — try again shortly." });
    }
    // Reserve against the global daily cap BEFORE the paid OpenAI call (worst case = the
    // per-call cap), so a burst can't spend past the cap before we record it.
    const budget = await spendAllows(SUGGEST_COST_CAP_USD);
    if (!budget.ok) return res.status(429).json({ error: `Daily AI budget reached ($${budget.capUsd}). Try again later.`, capReached: true });
    const result = await suggestPrompts(form, keys.openai);
    recordSpend(result.costUsd); // count toward the global daily cap
    if (result.costUsd > SUGGEST_COST_CAP_USD) {
      return res.json({ prompts: [], costUsd: result.costUsd, error: "suggestion exceeded cost cap" });
    }
    res.json(result);
  }),
);

// --- auto-detect a store from a name/URL (ONE capped call) -----------------
app.post(
  "/api/store/infer",
  wrap(async (req, res) => {
    const store = typeof (req.body as { store?: unknown })?.store === "string" ? (req.body as { store: string }).store.trim() : "";
    if (store.length < 2) return res.status(400).json({ error: "Enter a store name or URL." });
    if (store.length > 200) return res.status(400).json({ error: "Store name is too long." });
    if (!rateLimit(`infer:${clientIp(req)}`, 8, 60_000)) {
      return res.status(429).json({ error: "Too many lookups — try again shortly." });
    }
    // Reserve against the global daily cap BEFORE the paid OpenAI call.
    const budget = await spendAllows(SUGGEST_COST_CAP_USD);
    if (!budget.ok) return res.status(429).json({ error: `Daily AI budget reached ($${budget.capUsd}). Try again later.`, capReached: true });
    const result = await inferStore(store, keys.openai);
    recordSpend(result.costUsd); // count toward the global daily cap
    if (result.costUsd > SUGGEST_COST_CAP_USD) {
      return res.json({ costUsd: result.costUsd, competitors: [], prompts: [], error: "lookup exceeded cost cap" });
    }
    res.json(result);
  }),
);

// --- AI-buyer PRODUCT TEST (Phase B). Paste a Shopify product URL → a buyer task
//     of 4–6 requirements run as honest, evidence-availability assertions against
//     PUBLIC data. Deterministic apart from ONE batched model call: `applySemanticTier`
//     (productTest.ts) resolves claim rows the lexical pass couldn't, and is enabled
//     unless `PRODUCT_TEST_SEMANTIC=0`. Measured cost ≈ $0.0013–$0.003 per test — small,
//     but NOT zero; this comment used to say "$0, no model calls" and that was wrong
//     (v2.1 CP2 correction, experiments/v2-1/CP2_METHOD.md). SSRF-safe + robots-respecting
//     fetch inside runProductTest. Per-IP rate-limited.
app.post(
  "/api/product-test",
  wrap(async (req, res) => {
    const body = (req.body ?? {}) as { url?: unknown; force?: unknown };
    const url = typeof body.url === "string" ? body.url.trim() : "";
    const host = (() => { try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).host; } catch { return "invalid"; } })();
    // Funnel telemetry (v2.2 CP2). Emitted for EVERY arrival, before any gate, so the
    // denominator is real: counting only tests that got past the rate limiter would
    // hide exactly the demand we most need to see. `host` is reduced to a registrable
    // domain inside recordFunnelEvent; the Referer is classified and then discarded.
    const referrerClass = classifyReferrer(req.get("referer"), req.get("host"));
    void recordFunnelEvent({ name: "test_requested", host, referrerClass });

    if (!url || url.length > 400) {
      void recordFunnelEvent({ name: "test_failed", host, referrerClass, errorKind: "http_400" });
      return res.status(400).json({ error: "Paste a Shopify product URL." });
    }
    // Per-IP budget: 5 tests / 10 minutes. Cached repeats still count (cheap), so a
    // burst can't be used to walk many stores from one client.
    if (!rateLimit(`producttest:${clientIp(req)}`, 5, 10 * 60_000)) {
      // OUR limiter, recorded as such. A throttle rate that quietly folded this in
      // would report our own back-pressure as stores refusing us.
      void recordFunnelEvent({
        name: "test_failed", host, referrerClass,
        errorKind: "http_429", throttleSource: "our_rate_limit",
      });
      return res.status(429).json({ error: "You've run several tests just now — give it a few minutes and try again." });
    }
    const startedAt = Date.now();
    let result: Awaited<ReturnType<typeof runProductTest>>;
    try {
      result = await runProductTest(url, { force: body.force === true });
    } catch (err) {
      // The one path that produces a 500. Previously invisible to telemetry, so a
      // systematic crash would have looked like an absence of traffic.
      void recordFunnelEvent({
        name: "test_failed", host, referrerClass,
        errorKind: "exception", durationMs: Date.now() - startedAt,
      });
      throw err;
    }

    // V2 CP2 — mint a short token for a successful result so the merchant can carry
    // THIS test through install and land on it, continued, instead of a cold app.
    // Best-effort: a DB hiccup must never cost a visitor their result.
    if (result.ok) {
      try {
        const token = newTestToken();
        await storePublicTest(token, url, host, result);
        result.testToken = token;
      } catch (e) {
        console.warn(`[product-test] could not persist for install continuity: ${(e as Error).message}`);
      }
    }
    // `tier` and `throttled` are the V2 §2.5 escalation signal: if the throttle
    // rate over a rolling 24h stays high, the next step is an egress proxy pool,
    // an async queued flow, or Storefront API access for installed merchants.
    console.log(JSON.stringify({
      at: "product_test", host, ok: result.ok, errorKind: result.errorKind ?? null,
      cached: Boolean(result.cached), tier: result.fetchTier ?? null,
      throttled: result.throttledTiers ?? [], degraded: Boolean(result.degraded),
      ms: Date.now() - startedAt,
    }));
    // Outcome logging for diagnosis (no PII — host + state counts only).
    await insertEvent("product_test", undefined, {
      ok: result.ok, errorKind: result.errorKind ?? null, cached: Boolean(result.cached),
      evidenced: result.evidencedCount, notProven: result.notProvenCount, requiresAccess: result.requiresAccessCount,
      tier: result.fetchTier ?? null, throttled: (result.throttledTiers ?? []).join(",") || null,
      degraded: Boolean(result.degraded),
    }).catch(() => {});

    // Funnel outcome (v2.2 CP2). `runProductTest` answers HTTP 200 even when it failed,
    // so the discriminator is `result.ok`, never the status code.
    void recordFunnelEvent({
      name: result.ok ? "test_completed" : "test_failed",
      host, referrerClass,
      testToken: result.testToken ?? null,
      cached: Boolean(result.cached),
      durationMs: Date.now() - startedAt,
      fetchTier: result.fetchTier ?? null,
      evidenced: result.ok ? result.evidencedCount : null,
      noBlocking: result.ok ? result.noBlockingCount : null,
      notProven: result.ok ? result.notProvenCount : null,
      requiresAccess: result.ok ? result.requiresAccessCount : null,
      requirements: result.ok ? result.total : null,
      // "Invoked" means the tier actually ran and reported stats — a cached result
      // carries the ORIGINAL run's stats, and its cost was already counted then, so
      // it must not be summed again.
      semanticInvoked: result.cached ? false : Boolean(result.semantic),
      semanticCostUsd: result.cached ? null : (result.semantic?.costUsd ?? null),
      errorKind: result.errorKind ?? null,
      throttleSource: result.throttleSource ?? null,
      robotsStatus: result.robotsStatus ?? null,
      policyStatus: result.policyStatus ?? null,
    });
    res.json(result);
  }),
);

// --- start a (public, mini) scan -------------------------------------------
app.post(
  "/api/scan",
  wrap(async (req, res) => {
    const body = req.body as {
      form: ScanForm;
      prompts: string[];
      engines?: string[];
      email?: string;
      hp?: string;
      sourcePage?: string;
    };

    if (body.hp) return res.status(400).json({ error: "Request rejected." });
    const formErr = validateForm(body?.form);
    if (formErr) return res.status(400).json({ error: formErr });
    if (body.form.competitors.length > 8) return res.status(400).json({ error: "Free scans allow up to 8 competitors." });
    // VALUE-FIRST: the scan runs WITHOUT an email. Email is collected later to CLAIM the
    // report (POST /api/runs/:id/claim). A legacy client may still send one; we ignore it
    // for the run and never gate the run on it.
    const email = isValidEmail(body.email) ? body.email : undefined;
    const ip = clientIp(req);
    const ipH = ipHash(ip);

    const prompts = (body.prompts ?? []).map((p) => String(p).trim().slice(0, 300)).filter(Boolean).slice(0, SCAN_MODES.mini.prompts);
    if (prompts.length === 0) return res.status(400).json({ error: "No prompts selected." });

    if (!rateLimit(`scan:${ip}`, 4, 60_000)) {
      await insertEvent("rate_limit_block", undefined, { ipHash: ipH });
      return res.status(429).json({ error: "You're scanning too fast — give it a minute." });
    }
    if (isBusy()) {
      return res.status(409).json({ error: `A scan is already running (${activeRun()}). Try again shortly.` });
    }

    const engines = (body.engines ?? DEFAULT_ENGINES).filter((e) => DEFAULT_ENGINES.includes(e));
    let config: Config;
    try {
      config = buildConfig(body.form, prompts, engines);
    } catch (e) {
      return res.status(400).json({ error: (e as Error).message });
    }

    const { adapters } = buildAdapters(config, keys, false);
    if (adapters.length === 0) return res.status(400).json({ error: "No engines available — check server API keys." });
    const estimateMaxUsd = estimateMaxCost(prompts.length, adapters);
    if (estimateMaxUsd > SCAN_MODES.mini.maxCostUsd) {
      return res.status(400).json({ error: `Estimated cost $${estimateMaxUsd.toFixed(4)} exceeds the mini cap.` });
    }

    // GLOBAL daily spend cap — before any live API call.
    const spend = await spendAllows(estimateMaxUsd);
    if (!spend.ok) {
      if (email) await insertLead({ email, plan: "monitoring", source: "spend_cap", source_page: body.sourcePage, ip_hash: ipH });
      await insertEvent("spend_cap_block", undefined, { spentUsd: spend.spentUsd, capUsd: spend.capUsd });
      return res.status(429).json({
        capReached: true,
        error: `Daily scan capacity reached ($${spend.capUsd}). Please try again after it resets.`,
      });
    }

    // Ungated runs are bounded per-IP/day (the global spend cap above is the real backstop).
    const free = await ungatedScanAllowed(ipH);
    if (!free.ok) {
      await insertEvent("daily_limit_block", undefined, { ipHash: ipH });
      return res.status(429).json({
        limitReached: true,
        error: `Free scan limit reached (${free.perIp}/day from this network). Try again tomorrow.`,
      });
    }

    try {
      const runId = await createAndStart(config, "mini", SCAN_MODES.mini.maxCostUsd, adapters, estimateMaxUsd, email, ipH);
      res.json({ runId, estimateMaxUsd, totalCalls: prompts.length * adapters.length });
    } catch (e) {
      return res.status(409).json({ error: (e as Error).message });
    }
  }),
);

// --- scan status / results -------------------------------------------------
app.get(
  "/api/scan/:runId/status",
  wrap(async (req, res) => {
    const runId = req.params.runId;
    if (!isValidRunId(runId)) return res.status(404).json({ error: "Unknown run." });
    const status = await getStatus(runId);
    if (!status) return res.status(404).json({ error: "Unknown run." });
    res.json({ ...status, progress: (await readProgress(runId)).split("\n").filter(Boolean).slice(-40) });
  }),
);

app.get(
  "/api/runs/:runId",
  wrap(async (req, res) => {
    const runId = req.params.runId;
    if (!isValidRunId(runId)) return res.status(404).json({ error: "Results not ready." });
    const results = (await getResults(runId)) as Record<string, unknown> | null;
    if (!results) return res.status(404).json({ error: "Results not ready." });
    const claim = await getClaim(runId);
    // Paid-report tiers:
    //  • PAID + deep report COMPLETE → the worker-generated DEEP report + done-for-you artifacts (from DB).
    //  • PAID + still generating/held → the full free report + a `generating` flag (buyer polls).
    //  • CLAIMED (email) → the FREE diagnosis + proof + fix TITLES, minus the paid delta.
    //  • else → the ungated preview (score + gap + weakest engine).
    const paidReport = await getPaidReportByRun(runId);
    const paidOrder = Boolean(await getPaidOrderForRun(runId));
    const tier = paidReportTier(paidReport?.status, Boolean(paidReport?.report), paidOrder);
    if (tier === "complete") {
      return res.json({
        claimed: true, paid: true, generating: false,
        ...redactRun(paidReport!.report as Record<string, unknown>),
        artifacts: paidReport!.artifacts ?? null,
      });
    }
    if (tier === "failed") {
      // Genuine failure (retries exhausted / stuck → held/refunded). Be HONEST AND don't devalue the
      // paid tier: serve the clean FREE scorecard (paid delta withheld via stripPaidDelta — the same
      // projection the free claimed tier uses), NOT the paid diagnosis. The client shows an honest
      // refund banner + a retry (a fresh scan) and STOPS polling — never an infinite spinner, never a
      // silent free page, never the $29 "how" given away on a refund.
      return res.json({
        claimed: true, paid: false, generating: false,
        failed: true, failedRefunded: paidReport?.status === "refunded",
        ...stripPaidDelta(redactRun(results)),
      });
    }
    if (tier === "generating") {
      // Paid; the deep report + artifacts are being generated on the worker. Show the full report
      // meanwhile with a generating flag so the buyer sees progress, never a blank wait.
      return res.json({ claimed: true, paid: true, generating: true, ...redactRun(results) });
    }
    if (claim.claimed) {
      // CLAIMED → fully PUBLIC (no email wall for viewers): the whole alarm, no PII — this
      // is what lets a shared scorecard spread. The paid delta (the executed fixes) is held.
      // storeUrlHint prefills the paid-step store-URL capture (confirm vs re-type).
      const storeUrlHint = (results.config as { brand?: { storeUrl?: string } } | undefined)?.brand?.storeUrl ?? null;
      return res.json({ claimed: true, paid: false, storeUrlHint, ...stripPaidDelta(redactRun(results)) });
    }
    // Ungated preview: score + gap + weakest engine only. Email claims the full breakdown.
    const preview = reportPreview(results);
    if (!preview) return res.status(404).json({ error: "Results not ready." });
    res.json({ claimed: false, paid: false, preview });
  }),
);

// Claim a report with an email → it becomes publicly viewable + saves the lead. UNLOCK-ONLY:
// it never re-runs the scan (the 15 calls already ran once); it just reveals what's computed.
app.post(
  "/api/runs/:runId/claim",
  wrap(async (req, res) => {
    const runId = req.params.runId;
    if (!isValidRunId(runId)) return res.status(404).json({ error: "Unknown report." });
    const body = req.body as { email?: string; hp?: string; sourcePage?: string };
    if (body.hp) return res.status(400).json({ error: "Request rejected." });
    if (!isValidEmail(body.email)) return res.status(400).json({ error: "Enter a valid email to save your report." });
    const email = body.email;
    const ipH = ipHash(clientIp(req));
    if (!rateLimit(`claim:${clientIp(req)}`, 8, 60_000)) return res.status(429).json({ error: "Too many requests — give it a minute." });

    const results = await getResults(runId);
    if (!results) return res.status(404).json({ error: "Report not found." });
    const status = await getStatus(runId);
    if (status?.status !== "complete") return res.status(409).json({ error: "The scan isn't finished yet." });

    const claim = await getClaim(runId);
    if (!claim.claimed) {
      const allowed = await claimAllowed(email); // per-email/day limit on report creation
      if (!allowed.ok) return res.status(429).json({ error: `Daily limit reached (${allowed.perEmail}/day per email). Try again tomorrow.` });
      await setClaimed(runId);
      await updateRun(runId, { email });
      await insertLead({ email, plan: "free_mini", source: "report_claim", run_id: runId, source_page: body.sourcePage, ip_hash: ipH });
      await insertEvent("report_claimed", runId, {});
    }
    res.json({ ok: true, claimed: true });
  }),
);

// Paid-step store-URL capture. The $29 checkout promises done-for-you DRAFTS, and the crawler is what
// fills them — so we confirm the merchant's store URL at the point of purchase (the free scan keeps it
// OPTIONAL to stay frictionless). Persists onto the run config (overwriting any stale free-scan value)
// so the Stripe webhook's paid generation crawls the confirmed URL. Light + fail-friendly: a quick
// SSRF-safe liveness check catches typos BEFORE payment, but never hard-blocks (some valid stores
// refuse bots; the crawler has fallback discovery). Never requires Shopify detection.
function normalizeStoreUrl(raw: string): string | null {
  const s = (raw ?? "").trim();
  if (!s || /\s/.test(s) || !/\./.test(s)) return null; // must look like a domain
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  return validateUrl(withScheme).ok ? withScheme : null;
}

app.post(
  "/api/runs/:runId/store-url",
  wrap(async (req, res) => {
    const runId = req.params.runId;
    if (!isValidRunId(runId)) return res.status(404).json({ error: "Unknown report." });
    const body = req.body as { storeUrl?: string; hp?: string };
    if (body.hp) return res.status(400).json({ error: "Request rejected." });
    if (!rateLimit(`storeurl:${clientIp(req)}`, 12, 60_000)) return res.status(429).json({ error: "Too many requests — give it a minute." });

    const url = normalizeStoreUrl(body.storeUrl ?? "");
    if (!url) return res.status(400).json({ error: "That doesn't look like a store URL — try yourstore.com" });

    // Don't let a late edit change a report that's already been generated. Best-effort — a DB hiccup
    // must not block capture (fail-friendly), it just skips this guard.
    const existing = await getPaidReportByRun(runId).catch(() => null);
    if (existing?.status === "complete") return res.status(409).json({ error: "Your report is already generated." });

    const saved = await setRunStoreUrl(runId, url);
    if (!saved) return res.status(404).json({ error: "Report not found." });

    // SSRF-safe liveness probe (tight budget). reachable=false is a SOFT signal, not a block.
    let reachable = false;
    try {
      const r = await safeFetch(url, { maxBytes: 200_000, timeoutMs: 4_000, maxRedirects: 4 });
      reachable = r.status >= 200 && r.status < 400;
    } catch { reachable = false; }

    res.json({ ok: true, storeUrl: url, reachable });
  }),
);

// Dynamic OG/social share card (1200×630 PNG, no PII). Cached to the volume per report —
// rasterize once; social scrapers re-fetch. Public route (it IS the share image).
app.get("/report/:runId/og.png", wrap(async (req, res) => {
  const runId = req.params.runId;
  if (!isValidRunId(runId)) return res.status(404).end();
  const cached = ogPngPath(runId);
  if (existsSync(cached)) {
    res.type("png").setHeader("Cache-Control", "public, max-age=86400, immutable");
    return res.sendFile(cached);
  }
  const results = await getResults(runId);
  const preview = reportPreview(results);
  if (!preview) return res.status(404).end();
  const png = renderOgPng(preview, ENV.publicBrandName);
  await writeFile(cached, png).catch(() => {}); // best-effort cache; serve regardless
  res.type("png").setHeader("Cache-Control", "public, max-age=86400, immutable").send(png);
}));

// --- OG share cards for the rest of the shareable pages ----------------------
// PNG only: LinkedIn/Facebook/Slack refuse SVG og:images (that's how every preview
// rendered naked). Rendered server-side via resvg — no headless browser. Small
// in-memory cache keyed by a content discriminator: index cards change only when
// the category index is rebuilt; demo/default change only per deploy.
const ogMemCache = new Map<string, { key: string; png: Buffer }>();
function ogFromCache(name: string, key: string, build: () => string): Buffer {
  const hit = ogMemCache.get(name);
  if (hit && hit.key === key) return hit.png;
  const png = renderCardPng(build());
  ogMemCache.set(name, { key, png });
  return png;
}
const sendOg = (res: Response, png: Buffer, maxAge: number) =>
  res.type("png").setHeader("Cache-Control", `public, max-age=${maxAge}`).send(png);

/** The demo sample (fictional brand) — read once per process from the built fixture.
 *  `card` carries the SAME substitution frame the demo page leads with (headline + named
 *  rivals + counts), so the share card and the page tell one story — never the retired
 *  mention-gap line. */
interface DemoShare { preview: NonNullable<ReturnType<typeof reportPreview>>; card: import("./ogCard.js").DemoCardModel | null; frameHeadline: string | null }
let demoShareCache: DemoShare | null | undefined;
function demoShare(): DemoShare | null {
  if (demoShareCache !== undefined) return demoShareCache;
  demoShareCache = null;
  for (const p of ["viewer/dist/sample-results.json", "viewer/public/sample-results.json"]) {
    const abs = resolve(p);
    if (!existsSync(abs)) continue;
    try {
      const raw = JSON.parse(readFileSync(abs, "utf8")) as {
        analysis?: {
          substitutionFrame?: { headline?: string; namedRivals?: Array<{ name?: string; recCount?: number }> };
          mentionGap?: { recommendation?: { count?: number; total?: number } };
        };
      };
      const preview = reportPreview(raw);
      if (!preview) break;
      const frame = raw.analysis?.substitutionFrame;
      const rec = raw.analysis?.mentionGap?.recommendation;
      const card: import("./ogCard.js").DemoCardModel | null = frame?.headline
        ? {
            brand: preview.brand,
            category: preview.category,
            headline: frame.headline,
            rivals: (frame.namedRivals ?? [])
              .filter((r): r is { name: string; recCount: number } => typeof r.name === "string" && typeof r.recCount === "number")
              .map((r) => ({ name: r.name, recCount: r.recCount })),
            merchantCount: typeof rec?.count === "number" ? rec.count : null,
            total: typeof rec?.total === "number" ? rec.total : preview.basedOnResponses || null,
          }
        : null;
      demoShareCache = { preview, card, frameHeadline: frame?.headline ?? null };
    } catch {
      demoShareCache = null;
    }
    break;
  }
  return demoShareCache;
}

app.get("/og/default.png", (_req, res) => {
  sendOg(res, ogFromCache("default", "v1", () => buildDefaultCardSvg(ENV.publicBrandName, TAGLINE)), 86_400);
});

app.get("/og/demo.png", (_req, res) => {
  const share = demoShare();
  // The rich card needs the substitution frame; without it, fall back to the restrained
  // report card rather than resurrect retired framing.
  if (!share) return res.status(404).end();
  sendOg(res, ogFromCache("demo", "v2", () =>
    share.card ? buildDemoCardSvg(share.card, ENV.publicBrandName) : buildReportCardSvg(share.preview, ENV.publicBrandName)), 86_400);
});

app.get("/og/index.png", wrap(async (_req, res) => {
  const rows = await listCategoryIndexes();
  if (!rows.length) return res.status(404).end();
  const cats = rows.map((r) => ({ label: r.label, brands: r.entries?.length ?? 0 }));
  const key = JSON.stringify(cats);
  sendOg(res, ogFromCache("index", key, () => buildIndexListCardSvg(cats, ENV.publicBrandName)), 3_600);
}));

// The per-category card — the distribution artifact itself. Content passes through the
// SAME dominance gate as the page (indexOgModel → rankView), so the image can never
// crown a brand the page calls contested.
app.get("/og/index/:slug([a-z0-9-]+).png", wrap(async (req, res) => {
  const model = await loadIndexOgModel(String(req.params.slug));
  if (!model) return res.status(404).end();
  const key = `${model.updatedAt ?? ""}|${model.brandsRanked}|${model.headline}`;
  sendOg(res, ogFromCache(`index:${model.slug}`, key, () => buildIndexSlugCardSvg(model, ENV.publicBrandName)), 3_600);
}));

app.get("/api/runs/:runId/report.md", wrap(async (req, res) => {
  if (!isValidRunId(req.params.runId)) return res.status(404).send("Report not ready.");
  // The downloadable report.md carries the full write-up incl. the executed fixes — it's part
  // of the PAID bundle. Free viewers read the diagnosis on-screen; the md is gated to a paid order.
  if (!(await getPaidOrderForRun(req.params.runId))) {
    return res.status(402).send("The downloadable report is part of the full report.");
  }
  const path = resolve(join(runDir(req.params.runId), "report.md"));
  if (!existsSync(path)) return res.status(404).send("Report not ready.");
  res.type("text/markdown").sendFile(path);
}));

// --- demo (committed fixture) ----------------------------------------------
app.get("/api/demo", (_req, res) => {
  for (const p of ["viewer/dist/sample-results.json", "viewer/public/sample-results.json"]) {
    const abs = resolve(p);
    if (existsSync(abs)) return res.sendFile(abs);
  }
  res.status(404).json({ error: "No demo fixture found." });
});

// --- AI Visibility Index (public category leaderboards) --------------------
app.get(
  "/api/index",
  wrap(async (_req, res) => {
    res.json(await listCategoryIndexes());
  }),
);
app.get(
  "/api/index/:slug",
  wrap(async (req, res) => {
    const idx = await getCategoryIndex(String(req.params.slug));
    if (!idx) return res.status(404).json({ error: "Index not found." });
    res.json(idx);
  }),
);

// --- analytics events ------------------------------------------------------
app.post(
  "/api/events",
  wrap(async (req, res) => {
    const { name, run_id, metadata } = (req.body ?? {}) as { name?: string; run_id?: string; metadata?: unknown };
    if (!name || !ALLOWED_EVENTS.has(name)) return res.status(400).json({ error: "Unknown event." });
    const runId = typeof run_id === "string" ? run_id.slice(0, 128) : undefined;
    await insertEvent(name, runId, sanitizeEventMeta(metadata));
    res.json({ ok: true });
  }),
);

// --- AI-referral pixel ingest (Phase 10, PUBLIC storefront beacon) ----------
//     Cross-origin (storefront → our domain): CORS preflight + a forgiving 202 so a
//     beacon never breaks a merchant's storefront. Consent-gated, install-scoped,
//     server-classified; data is directional, not authenticated. See server/pixel.ts.
app.options("/api/pixel/ingest", ingestPreflightHandler);
app.post("/api/pixel/ingest", wrap(ingestHandler));

// --- CTA lead capture (fake-door fallback) ---------------------------------
app.post(
  "/api/leads",
  wrap(async (req, res) => {
    const { email, plan, runId, sourcePage } = (req.body ?? {}) as {
      email?: string;
      plan?: string;
      runId?: string;
      sourcePage?: string;
    };
    if (!isValidEmail(email)) return res.status(400).json({ error: "Please enter a valid email." });
    if (!plan) return res.status(400).json({ error: "Missing plan." });
    await insertLead({ email, plan, source: "cta", run_id: runId, source_page: sourcePage, ip_hash: ipHash(clientIp(req)) });
    await insertEvent("lead_submitted", runId, { plan });
    res.json({ ok: true });
  }),
);

// --- funnel: the install CLICK (v2.2 CP2) ----------------------------------
//     "Connect Shopify" is a plain link to the Shopify App Store — App Store rule
//     2.3.1 forbids a domain prompt, so installation begins on a Shopify-owned
//     surface and NO server route of ours is hit by the click itself. Without this
//     beacon the funnel would show tests and installs with nothing in between, and
//     we could never tell "nobody clicked" from "clicking doesn't convert".
//     Fire-and-forget: it always 204s so a failed beacon never blocks navigation.
app.post(
  "/api/funnel/install-click",
  wrap(async (req, res) => {
    const b = (req.body ?? {}) as { testToken?: unknown; host?: unknown };
    const testToken = typeof b.testToken === "string" && /^t_[a-f0-9]{20}$/.test(b.testToken) ? b.testToken : null;
    void recordFunnelEvent({
      name: "install_clicked",
      testToken,
      // Only ever a host; recordFunnelEvent reduces it to a registrable domain.
      host: typeof b.host === "string" ? b.host.slice(0, 253) : null,
      referrerClass: classifyReferrer(req.get("referer"), req.get("host")),
    });
    res.status(204).end();
  }),
);

// ============ ADMIN ========================================================
app.post(
  "/api/admin/login",
  wrap(async (req, res) => {
    if (!rateLimit(`adminlogin:${clientIp(req)}`, 10, 60_000)) {
      return res.status(429).json({ error: "Too many attempts — wait a minute." });
    }
    const { password } = (req.body ?? {}) as { password?: string };
    if (!ENV.adminPassword) return res.status(503).json({ error: "Admin not configured (set ADMIN_PASSWORD)." });
    if (!checkPassword(password)) return res.status(401).json({ error: "Wrong password." });
    res.cookie(ADMIN_COOKIE, makeToken(), {
      httpOnly: true,
      sameSite: "lax",
      secure: ENV.isProd,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/",
    });
    res.json({ ok: true });
  }),
);

app.post("/api/admin/logout", (_req, res) => {
  res.clearCookie(ADMIN_COOKIE, { path: "/" });
  res.json({ ok: true });
});

app.get("/api/admin/me", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ authed: isAdmin(req), configured: Boolean(ENV.adminPassword) });
});

app.get(
  "/api/admin/data",
  requireAdmin,
  wrap(async (_req, res) => {
    res.json(await buildAdminData());
  }),
);

// Funnel read surface (v2.2 CP2) — admin session AND `FUNNEL_ADMIN_ENABLED`.
// text/plain by default so it is readable over curl; `?format=json` for the raw
// windows. 404s (not 403s) when the flag is off — an unlit surface shouldn't
// announce itself. robots.txt already Disallows /api/.
app.get("/api/admin/funnel", requireAdmin, wrap(funnelHandler));

// On-demand engine-key health check (pings each provider — see healthcheck.ts).
app.post(
  "/api/admin/engine-keys",
  requireAdmin,
  wrap(async (_req, res) => {
    res.json({ engines: await checkEngineKeys(keys) });
  }),
);

// --- admin job-queue visibility + controls (Phase 1) -----------------------
app.get(
  "/api/admin/queue",
  requireAdmin,
  wrap(async (_req, res) => {
    if (!hasPg()) return res.json({ enabled: false, configured: false });
    try {
      const [s, hb] = await Promise.all([queueStats(), recentHeartbeats(120)]);
      res.json({ enabled: ENV.jobQueueEnabled, configured: true, heartbeats: hb, ...s });
    } catch (err) {
      res.json({ enabled: ENV.jobQueueEnabled, configured: false, error: (err as Error).message });
    }
  }),
);
app.post(
  "/api/admin/queue/:id/retry",
  requireAdmin,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Bad job id." });
    res.json({ ok: await retryDeadLetter(id) });
  }),
);
app.post(
  "/api/admin/queue/:id/cancel",
  requireAdmin,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Bad job id." });
    res.json({ ok: await cancelJob(id) });
  }),
);

// Admin can run standard/deep scans for paid beta customers.
app.post(
  "/api/admin/scan",
  requireAdmin,
  wrap(async (req, res) => {
    const body = req.body as { form: ScanForm; mode?: ScanMode; prompts?: string[]; email?: string };
    const formErr = validateForm(body?.form);
    if (formErr) return res.status(400).json({ error: formErr });
    const mode: ScanMode = body.mode && SCAN_MODES[body.mode] ? body.mode : "standard";
    const cap = SCAN_MODES[mode].maxCostUsd;

    let prompts = (body.prompts ?? []).map((p) => String(p).trim()).filter(Boolean);
    if (prompts.length === 0) prompts = generatePrompts(body.form).slice(0, SCAN_MODES[mode].prompts).map((p) => p.text);
    prompts = prompts.slice(0, SCAN_MODES[mode].prompts);

    if (isBusy()) return res.status(409).json({ error: `A scan is already running (${activeRun()}).` });

    let config: Config;
    try {
      config = buildConfig(body.form, prompts, DEFAULT_ENGINES);
    } catch (e) {
      return res.status(400).json({ error: (e as Error).message });
    }
    const { adapters } = buildAdapters(config, keys, false);
    if (!adapters.length) return res.status(400).json({ error: "No engines available." });
    const estimateMaxUsd = estimateMaxCost(prompts.length, adapters);
    const spend = await spendAllows(estimateMaxUsd);
    if (!spend.ok) return res.status(429).json({ error: `Daily spend cap reached ($${spend.capUsd}).` });

    try {
      const runId = await createAndStart(config, mode, cap, adapters, estimateMaxUsd, body.email, undefined);
      res.json({ runId, mode, estimateMaxUsd, prompts: prompts.length });
    } catch (e) {
      return res.status(409).json({ error: (e as Error).message });
    }
  }),
);

// Mark a paid order fulfilled (manual beta fulfillment).
app.post(
  "/api/admin/orders/:id/fulfill",
  requireAdmin,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Bad order id." });
    const ok = await updateOrder(id, { status: "fulfilled", fulfilled_at: new Date().toISOString() });
    if (!ok) return res.status(502).json({ error: "Could not update order (DB unavailable?)." });
    res.json({ ok: true });
  }),
);

// Admin-triggered deep scan for a paid order (we never auto-run on payment).
// Reuses the source run's config (brand/category/competitors) and runs a fresh
// deep prompt set.
app.post(
  "/api/admin/orders/:id/scan",
  requireAdmin,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Bad order id." });
    const order = await getOrder(id);
    if (!order) return res.status(404).json({ error: "Order not found." });
    const sourceRunId = order.source_run_id as string | null;
    if (!sourceRunId) {
      return res.status(400).json({ error: "Order has no source run — use the manual scan form instead." });
    }
    const cfgPath = join(runDir(sourceRunId), "config.json");
    if (!existsSync(cfgPath)) {
      return res.status(400).json({ error: "Source run config not found — use the manual scan form instead." });
    }
    if (isBusy()) return res.status(409).json({ error: `A scan is already running (${activeRun()}).` });

    const sourceConfig = JSON.parse(await readFile(cfgPath, "utf8")) as Config;
    const form: ScanForm = {
      brand: sourceConfig.brand,
      category: sourceConfig.category,
      competitors: sourceConfig.competitors,
      persona: sourceConfig.buyerPersona,
      location: sourceConfig.location,
      priceRange: sourceConfig.priceRange,
    };
    const prompts = generatePrompts(form).slice(0, SCAN_MODES.deep.prompts).map((p) => p.text);
    let config: Config;
    try {
      config = buildConfig(form, prompts, DEFAULT_ENGINES);
    } catch (e) {
      return res.status(400).json({ error: (e as Error).message });
    }
    const { adapters } = buildAdapters(config, keys, false);
    if (!adapters.length) return res.status(400).json({ error: "No engines available." });
    const estimateMaxUsd = estimateMaxCost(prompts.length, adapters);
    const spend = await spendAllows(estimateMaxUsd);
    if (!spend.ok) return res.status(429).json({ error: `Daily spend cap reached ($${spend.capUsd}).` });

    try {
      const runId = await createAndStart(config, "deep", SCAN_MODES.deep.maxCostUsd, adapters, estimateMaxUsd, (order.email as string) ?? undefined, undefined);
      await updateOrder(id, { status: "scanning", scan_run_id: runId });
      res.json({ runId, mode: "deep", estimateMaxUsd, prompts: prompts.length });
    } catch (e) {
      return res.status(409).json({ error: (e as Error).message });
    }
  }),
);

// INTERNAL storefront discovery (v2.8 CP3). Reads ONE public endpoint —
// `/products.json` — and returns ONE product handle, so a measurement sample can be
// assembled through production's egress. It exists because the dev machine cannot do
// this: robots.txt itself returns 429 there for most Shopify hosts, so a fail-closed
// sample assembly is impossible from a laptop. NOT a crawler and NOT a feature: it
// stores nothing, follows no links, and is double-gated on `requireAdmin` plus
// `DISCOVERY_ENABLED`. Robots-respecting, SSRF-hardened, and bound by the same
// per-host and egress budgets as the buyer test, so it can never outrun it.
app.post(
  "/api/admin/discover",
  requireAdmin,
  wrap(async (req, res) => {
    const origin = typeof (req.body as { origin?: unknown })?.origin === "string"
      ? String((req.body as { origin: string }).origin).trim() : "";
    if (!origin || origin.length > 300) return res.status(400).json({ error: "Pass a storefront origin." });
    const result = await discoverProduct(origin);
    // 503 for the flag being off — that is a configuration state, not a bad request.
    if (!result.ok && result.errorKind === "disabled") return res.status(503).json(result);
    res.json(result);
  }),
);

// Build a public AI Visibility Index for a category from one multi-brand scan.
app.post(
  "/api/admin/index",
  requireAdmin,
  wrap(async (req, res) => {
    const { label, brands, mode } = req.body as { label?: string; brands?: string[]; mode?: ScanMode };
    if (!label?.trim()) return res.status(400).json({ error: "Category label required." });
    const brandList = (brands ?? []).map((s) => String(s).trim()).filter(Boolean);
    if (brandList.length < 3) return res.status(400).json({ error: "Add at least 3 brands." });
    if (brandList.length > 25) return res.status(400).json({ error: "Max 25 brands per index." });
    const m: ScanMode = mode && SCAN_MODES[mode] ? mode : "deep";
    try {
      res.json(await startCategoryIndexBuild(label.trim(), brandList, m));
    } catch (e) {
      res.status(409).json({ error: (e as Error).message });
    }
  }),
);

// --- serve the built viewer (single service) -------------------------------
const dist = resolve("viewer/dist");
let indexTemplate: string | null = null;
async function serveIndex(req: Request, res: Response) {
  if (indexTemplate === null) {
    try {
      indexTemplate = readFileSync(join(dist, "index.html"), "utf8");
    } catch {
      return res.status(503).send("App not built. Run `npm run build`.");
    }
  }
  // App Bridge is injected ONLY when Shopify itself is loading the embedded app — i.e. an
  // /app route WITH Shopify's embed params (host/shop) AND a configured API key. App Bridge
  // can redirect the top window into admin if it loads outside the iframe, so a DIRECT visit
  // to /app (no params) deliberately gets none — preserving the public demo-fallback there.
  const fromShopify = Boolean(req.query.host || req.query.shop);
  const appBridge =
    req.path.startsWith("/app") && fromShopify && ENV.shopify.apiKey
      ? `<meta name="shopify-api-key" content="${escapeHtml(ENV.shopify.apiKey)}" />\n    <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>`
      : "";
  let html = indexTemplate
    .replaceAll("__BRAND_NAME__", escapeHtml(ENV.publicBrandName))
    .replaceAll("__DESC__", escapeHtml(TAGLINE))
    .replaceAll("__BASE_URL__", escapeHtml(baseUrl(req)))
    .replaceAll("__APP_BRIDGE__", appBridge);

  // Category index pages get a shareable, category-specific title + OG title.
  const m = req.path.match(/^\/index\/([a-z0-9-]+)/);
  if (m) {
    const pretty = m[1]!.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const t = escapeHtml(`AI Visibility Index: ${pretty} — ${ENV.publicBrandName}`);
    html = html
      .replace(/<title>[^<]*<\/title>/, `<title>${t}</title>`)
      .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${t}$2`)
      .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${t}$2`);
  }

  // Server-render the Index leaderboards into the raw HTML: AI crawlers (GPTBot,
  // OAI-SearchBot, PerplexityBot) and search first-pass indexers don't execute JS,
  // so the CSR-only pages were invisible to them — and these pages are the
  // distribution engine. The static snapshot sits inside #root (React clears it on
  // mount and takes over); category-specific meta + canonical + ItemList JSON-LD go
  // into <head>. Any failure (DB down, unpublished slug) ⇒ the plain SPA above.
  if (m || req.path === "/index" || req.path === "/index/") {
    try {
      const ssr = await indexSsrFor(req.path, baseUrl(req));
      if (ssr) {
        const t = escapeHtml(ssr.title);
        const d = escapeHtml(ssr.description);
        const u = escapeHtml(ssr.canonical);
        // The dynamic leaderboard card — the preview IS the artifact traveling. Same
        // dominance gate as the page (see /og/index/:slug.png), so it can't out-claim it.
        const img = escapeHtml(`${baseUrl(req)}/og/index${m ? `/${m[1]}` : ""}.png`);
        html = html
          .replace(/<title>[^<]*<\/title>/, `<title>${t}</title>`)
          .replace(/(<meta name="description" content=")[^"]*(")/, `$1${d}$2`)
          .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${t}$2`)
          .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${d}$2`)
          .replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${img}$2`)
          .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${u}$2`)
          .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${t}$2`)
          .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${d}$2`)
          .replace(/(<meta name="twitter:image" content=")[^"]*(")/, `$1${img}$2`)
          .replace("</head>", `<link rel="canonical" href="${u}" />\n    ${ssr.jsonLd}\n  </head>`)
          .replace(/<div id="root">\s*<\/div>/, `<div id="root">${ssr.bodyHtml}</div>`);
      }
    } catch {
      /* CSR fallback */
    }
  }

  // Utility pages: correct the per-page og:url (the template default says "/", which
  // mis-canonicalizes every share of these paths). Image/title stay the brand defaults.
  if (["/demo", "/scan", "/privacy", "/terms", "/support", "/data-deletion", "/thanks", "/pricing"].includes(req.path)) {
    const u = escapeHtml(baseUrl(req) + req.path);
    html = html.replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${u}$2`);
  }

  // The demo (fictional sample brand) gets the full rich treatment — it exists to sell —
  // labeled a sample in both the text and the card. The description carries the SAME
  // substitution frame the page leads with (never the retired mention-gap line).
  if (req.path === "/demo" || req.path === "/demo/") {
    const share = demoShare();
    const p = share?.preview;
    if (share && p && p.brand) {
      const base = baseUrl(req);
      const t = escapeHtml(`Sample AI Visibility Report: ${p.brand}${p.category ? ` (${p.category})` : ""} — ${ENV.publicBrandName}`);
      const lead = share.frameHeadline ?? `Which brands AI assistants recommend in ${p.category || "this category"}.`;
      const d = escapeHtml(`${lead} A complete sample report on a fictional brand — see exactly what a scan finds.`);
      const img = escapeHtml(`${base}/og/demo.png`);
      html = html
        .replace(/<title>[^<]*<\/title>/, `<title>${t}</title>`)
        .replace(/(<meta name="description" content=")[^"]*(")/, `$1${d}$2`)
        .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${t}$2`)
        .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${d}$2`)
        .replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${img}$2`)
        .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${t}$2`)
        .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${d}$2`)
        .replace(/(<meta name="twitter:image" content=")[^"]*(")/, `$1${img}$2`);
    }
  }

  // Per-report share card: a /report/:id link unfurls into a rich preview. DOCTRINE:
  // public artifacts are winner- or field-headlined, never loser-headlined — the merchant
  // chose to share this link, so the poster names the brand + frames the CATEGORY question;
  // their score/losing rate lives on the page, not in the preview that travels feeds.
  // Wrapped in try/catch so a missing/failed report falls back to the default meta.
  const rm = req.path.match(/^\/report\/(\d{8}-\d{6}-[0-9a-f]{20})\/?$/);
  if (rm) {
    try {
      const runId = rm[1]!;
      const preview = reportPreview(await getResults(runId));
      if (preview && (preview.brand || preview.category)) {
        const base = baseUrl(req);
        // MERGE NOTE (v2.1): kept main's category-framed meta because it is the matched PAIR for
        // main's rewritten share card (buildReportCardSvg renders "AI VISIBILITY REPORT · {cat}"
        // and deliberately shows no score and no gap line). v2's version titled this "AI buyer
        // readiness" and described it with preview.gapLine — both of which main's card retired, so
        // applying v2's text here would make the OG title and the OG image tell different stories.
        // Renaming this surface means redesigning main's 3-card family; that is a follow-up, not a
        // merge resolution. This is the one place v2's vocabulary is NOT applied.
        const cat = preview.category || "their category";
        const t = escapeHtml(`${preview.brand || "This store"} — AI Visibility Report, ${cat} — ${ENV.publicBrandName}`);
        const d = escapeHtml(
          `Which brands AI assistants recommend in ${cat}` +
          `${preview.basedOnResponses > 0 ? ` — ${preview.basedOnResponses} answers` : ""} across ChatGPT, Gemini & Perplexity. See the full breakdown.`,
        );
        const img = escapeHtml(`${base}/report/${runId}/og.png`);
        const url = escapeHtml(`${base}/report/${runId}`);
        html = html
          .replace(/<title>[^<]*<\/title>/, `<title>${t}</title>`)
          .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${t}$2`)
          .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${d}$2`)
          .replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${img}$2`)
          .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`)
          .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${t}$2`)
          .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${d}$2`)
          .replace(/(<meta name="twitter:image" content=")[^"]*(")/, `$1${img}$2`);
      }
    } catch { /* fall back to default meta */ }
  }

  if (req.path.startsWith("/admin")) res.setHeader("Cache-Control", "no-store");
  res.type("html").send(html);
}

// --- hosted outreach cases (v2.2 CP4) --------------------------------------
//     MUST be registered BEFORE the SPA catch-all below: that handler only defers
//     paths starting with /api, so a /c/:token route registered after it would be
//     dead code that silently served index.html with a 200. Inert until
//     HOSTED_CASES_DIR points at a bundle on the volume (see DEPLOY.md).
//     The `/api` rate limiter does not match `/c/*`, so this carries its own.
app.get("/c/:token", (req, res) => {
  if (!rateLimit(`case:${clientIp(req)}`, 60, 60_000)) {
    return res.status(429).type("text/plain").send("Too many requests");
  }
  hostedCaseHandler(req, res);
});
// Everything else under /c — `/c`, `/c/`, `/c/a/b`, a mistyped token — is a hard
// 404, never the SPA. Verified against a running server: without this the catch-all
// below served the marketing homepage with HTTP 200, so a broken outreach link
// would have looked like it worked and quietly reported a visit that never happened.
// There is deliberately no index page: the case set must not be browsable.
app.use("/c", (_req, res) => {
  res.status(404).type("text/plain").send("Not found");
});

if (existsSync(dist)) {
  app.use(express.static(dist, { index: false }));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    serveIndex(req, res).catch(next);
  });
} else if (ENV.isProd) {
  console.warn("[server] viewer/dist not found — did `npm run build` run? Serving API only.");
}

// --- structured error handler ----------------------------------------------
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  console.error(JSON.stringify({ level: "error", at: req.method + " " + req.path, msg: err.message, ts: new Date().toISOString() }));
  if (!res.headersSent) res.status(500).json({ error: "Something went wrong." });
});

const host = ENV.isProd ? "0.0.0.0" : "127.0.0.1";
reportConfig();
if (!ENV.adminPassword) console.warn("[config] ADMIN_PASSWORD not set — /admin is disabled.");

// Optional: run the job worker inside the web process (single-service/dev). Production
// should run a dedicated `worker` service instead (see LAUNCH_CHECKLIST.md).
if (ENV.workerInProcess && hasPg()) {
  import("../queue/runner.js")
    .then(({ startWorker }) => {
      startWorker("web");
      console.log("[server] in-process worker started (WORKER_IN_PROCESS=1)");
    })
    .catch((err) => console.error("[server] failed to start in-process worker:", (err as Error).message));
}

app.listen(ENV.port, host, () => {
  if (ENV.isProd) {
    console.log(JSON.stringify({ level: "info", msg: "server up", port: ENV.port, host, commit: ENV.commit, supabase: hasSupabase(), spendCap: ENV.dailySpendCapUsd }));
  } else {
    console.log("\n" + "=".repeat(64));
    console.log(`  ${ENV.publicBrandName} scan server (DEV)`);
    console.log(`  → http://${host}:${ENV.port}  (LOCALHOST ONLY in dev)`);
    console.log("  ⚠️  Live API keys. Prod binds 0.0.0.0 behind Railway with rate");
    console.log("      limits, daily spend cap, and admin password gating.");
    console.log("=".repeat(64) + "\n");
  }
});

// ---- helpers --------------------------------------------------------------

function buildConfig(form: ScanForm, prompts: string[], engines: string[]): Config {
  return validateConfig(
    {
      brand: form.brand,
      category: form.category,
      competitors: form.competitors,
      buyerPersona: form.persona,
      location: form.location,
      priceRange: form.priceRange,
      promptTemplates: prompts,
      engines,
      concurrency: 3,
    },
    "scan form",
  );
}

async function createAndStart(
  config: Config,
  mode: ScanMode,
  maxCostUsd: number,
  adapters: { name: string }[],
  estimateMaxUsd: number,
  email: string | undefined,
  ipHashValue: string | undefined,
): Promise<string> {
  const runId = newRunId();
  if (!acquireLock(runId)) throw new Error("A scan is already running.");
  try {
    const promptCount = expandPrompts(config).prompts.length;
    await createRun(runId, config, {
      runId,
      status: "pending",
      brand: config.brand.name,
      engines: adapters.map((a) => a.name),
      promptCount,
      estimateMaxUsd,
      createdAt: new Date().toISOString(),
    });
    await insertRun({ id: runId, brand: config.brand.name, category: config.category, status: "pending", email, ip_hash: ipHashValue, mode });
    await insertEvent("scan_started", runId, { brand: config.brand.name, mode });
  } catch (e) {
    releaseLock(runId);
    throw e;
  }
  void runScanJob(runId, config, { maxCostUsd, keys, concurrency: 3, mode });
  return runId;
}

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

/**
 * Build a category index from ONE multi-brand scan: brand[0] is "the brand",
 * the rest are competitors, so the analysis leaderboard ranks ALL of them on the
 * same prompts. The scan runs in the background; the index row is written when it
 * completes. Returns immediately with the slug + runId so the admin can poll.
 */
async function startCategoryIndexBuild(
  label: string,
  brands: string[],
  mode: ScanMode,
): Promise<{ slug: string; runId: string; estimateMaxUsd: number; brands: number }> {
  const slug = slugify(label);
  const form: ScanForm = {
    brand: { name: brands[0]! },
    category: label,
    competitors: brands.slice(1).map((name) => ({ name })),
  };
  const prompts = generatePrompts(form).slice(0, SCAN_MODES[mode].prompts).map((p) => p.text);
  const config = buildConfig(form, prompts, DEFAULT_ENGINES);
  const { adapters } = buildAdapters(config, keys, false);
  if (!adapters.length) throw new Error("No engines available.");
  const estimateMaxUsd = estimateMaxCost(prompts.length, adapters);
  const spend = await spendAllows(estimateMaxUsd);
  if (!spend.ok) throw new Error(`Daily spend cap reached ($${spend.capUsd}).`);
  if (isBusy()) throw new Error(`A scan is already running (${activeRun()}).`);

  const runId = newRunId();
  if (!acquireLock(runId)) throw new Error("A scan is already running.");
  try {
    await createRun(runId, config, {
      runId, status: "pending", brand: config.brand.name, engines: adapters.map((a) => a.name),
      promptCount: prompts.length, estimateMaxUsd, createdAt: new Date().toISOString(),
    });
    await insertRun({ id: runId, brand: config.brand.name, category: label, status: "pending", mode });
    await insertEvent("index_build_started", runId, { slug, brands: brands.length });
  } catch (e) {
    releaseLock(runId);
    throw e;
  }
  // Background: run scan to completion (runScanJob releases the lock), then write the index.
  void (async () => {
    try {
      await runScanJob(runId, config, { maxCostUsd: SCAN_MODES[mode].maxCostUsd, keys, mode });
      const results = (await getResults(runId)) as
        | { analysis?: { leaderboard?: Array<{ brand: string; mention: { rate: number; total?: number }; recommendation: { rate: number } }> } }
        | null;
      const lb = results?.analysis?.leaderboard;
      if (lb?.length) {
        const entries: IndexEntry[] = lb.map((r, i) => ({
          brand: r.brand,
          rank: i + 1,
          mention: r.mention.rate,
          recommendation: r.recommendation.rate,
          // Rate denominator (answers in the scan) — the SSR page cites it as n=.
          ...(r.mention.total ? { n: r.mention.total } : {}),
        }));
        await upsertCategoryIndex({ slug, label, run_id: runId, entries });
        await insertEvent("index_build_completed", runId, { slug, brands: entries.length });
      }
    } catch (err) {
      console.error(`[index] build failed for ${slug}: ${(err as Error).message}`);
    }
  })();
  return { slug, runId, estimateMaxUsd, brands: brands.length };
}

/** Strip raw API payloads + any stray email from a run before public exposure. */
function redactRun(run: Record<string, unknown>): Record<string, unknown> {
  const results = (run.results as Array<Record<string, unknown>>) ?? [];
  for (const r of results) {
    delete r.raw;
    if (typeof r.text === "string") r.text = redactEmails(r.text);
  }
  return run;
}
const EMAIL_IN_TEXT = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const redactEmails = (s: string) => s.replace(EMAIL_IN_TEXT, "[email]");
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CONTROL_CHARS = /[\x00-\x1F\x7F]/;
function badText(s: string | undefined, max: number): boolean {
  return s != null && (s.length > max || CONTROL_CHARS.test(s));
}
function badUrl(s: string | undefined): boolean {
  return s != null && s.trim() !== "" && (s.length > 200 || /\s/.test(s) || CONTROL_CHARS.test(s));
}

function validateForm(form: ScanForm | undefined): string | null {
  if (!form || typeof form !== "object") return "Missing form.";
  if (!form.brand?.name?.trim()) return "Brand name is required.";
  if (!form.category?.trim()) return "Category is required.";
  if (!Array.isArray(form.competitors) || form.competitors.length === 0) return "Add at least one competitor.";
  if (form.competitors.length > 25) return "Too many competitors (max 25).";
  if (form.competitors.some((c) => !c?.name?.trim())) return "Every competitor needs a name.";
  if (badText(form.brand.name, 80)) return "Brand name is too long.";
  if (badText(form.category, 120)) return "Category is too long.";
  if (form.competitors.some((c) => badText(c.name, 80))) return "A competitor name is too long.";
  if (badText(form.persona, 200)) return "Buyer persona is too long.";
  if (badText(form.location, 80) || badText(form.priceRange, 60)) return "A field is too long.";
  if (badUrl(form.brand.storeUrl) || form.competitors.some((c) => badUrl(c.storeUrl))) return "A store URL looks invalid.";
  return null;
}
