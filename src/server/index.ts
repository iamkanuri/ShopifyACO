import "dotenv/config";
import process from "node:process";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
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
import { installHandler, callbackHandler, tokenExchangeHandler, webhookHandler, shopifyStatus, requireShop } from "./shopify.js";
import { normalizeShopDomain } from "../shopify/domain.js";
import { triggerSyncHandler, syncStatusHandler, listProductsHandler } from "./catalog.js";
import { diagnoseHandler, findingsHandler, pagesHandler } from "./evidence.js";
import { applyHandler, approveHandler, dismissHandler, listFixesHandler, proposeHandler, rollbackHandler } from "./fixes.js";
import { baselineHandler, getExperimentHandler, listExperimentsHandler, listInterventionsHandler, planHandler, startVerificationHandler, verifyHandler } from "./experiments.js";
import { acknowledgeAlertHandler, createScheduleHandler, deleteScheduleHandler, listAlertsHandler, listSchedulesHandler, runScheduleHandler, updateScheduleHandler } from "./monitoring.js";
import { createFeedHandler, deliveryStatusHandler, exportVersionHandler, feedSpecHandler, generateFeedHandler, getVersionHandler, listFeedsHandler, listItemsHandler, listVersionsHandler } from "./feeds.js";
import { registerFeedJobs } from "../feeds/generate.js";
import { activateHandler, attributionHandler, ingestHandler, ingestPreflightHandler } from "./pixel.js";
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
  ipHash,
  isValidEmail,
  rateLimit,
  recordSpend,
  spendAllows,
} from "./guards.js";
import {
  getCategoryIndex,
  getOrder,
  insertEvent,
  insertLead,
  insertRun,
  listCategoryIndexes,
  updateOrder,
  upsertCategoryIndex,
  type IndexEntry,
} from "../db/supabase.js";
import { handleStripeWebhook } from "./stripe.js";
import { ADMIN_COOKIE, buildAdminData, checkPassword, isAdmin, makeToken, requireAdmin } from "./admin.js";
import {
  acquireLock,
  activeRun,
  createRun,
  getResults,
  getStatus,
  isBusy,
  isValidRunId,
  newRunId,
  readProgress,
  releaseLock,
  runDir,
} from "./runStore.js";
import { runScanJob } from "./scanJob.js";
import { PLANS } from "../pricing.js";

const MINI_PROMPTS = 5;
const DEFAULT_ENGINES = ["openai", "gemini", "perplexity"];
const SUGGEST_COST_CAP_USD = 0.02;
const TAGLINE =
  "Test whether ChatGPT, Gemini, and Perplexity recommend your store, see which competitors appear instead, and find the shopper prompts where your brand is missing.";
const DEMO_NOTE = "Demo data shown for illustration; not affiliated with or endorsed by Olipop.";
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
    .send(`User-agent: *\nDisallow: /admin\nDisallow: /api/\nAllow: /\n\nSitemap: ${baseUrl(req)}/sitemap.xml\n`);
});
app.get("/sitemap.xml", async (req, res) => {
  const base = baseUrl(req);
  const paths = ["/", "/demo", "/scan", "/privacy", "/terms", "/support", "/index"];
  try {
    for (const idx of await listCategoryIndexes()) paths.push(`/index/${idx.slug}`);
  } catch {
    /* DB down — ship the static paths */
  }
  const urls = paths.map((p) => `  <url><loc>${base}${p}</loc></url>`).join("\n");
  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.w3.org/2000/sitemaps/0.9">\n${urls}\n</urlset>\n`);
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
    tagline: TAGLINE,
    demoNote: DEMO_NOTE,
    plans,
    miniPrompts: MINI_PROMPTS,
    fullReportPrompts: SCAN_MODES.deep.prompts,
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
    const result = await inferStore(store, keys.openai);
    recordSpend(result.costUsd); // count toward the global daily cap
    if (result.costUsd > SUGGEST_COST_CAP_USD) {
      return res.json({ costUsd: result.costUsd, competitors: [], prompts: [], error: "lookup exceeded cost cap" });
    }
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
    if (!isValidEmail(body.email)) return res.status(400).json({ error: "A valid email is required to run a scan." });
    const email = body.email;
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

    await insertLead({ email, plan: "free_mini", source: "scan_gate", source_page: body.sourcePage, ip_hash: ipH });

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
      await insertLead({ email, plan: "monitoring", source: "spend_cap", source_page: body.sourcePage, ip_hash: ipH });
      await insertEvent("spend_cap_block", undefined, { spentUsd: spend.spentUsd, capUsd: spend.capUsd });
      return res.status(429).json({
        capReached: true,
        error: `Daily scan capacity reached ($${spend.capUsd}). We saved your email — we'll notify you when it resets.`,
      });
    }

    // Free-scan daily limits (per email AND per IP).
    const free = await freeScanAllowed(email, ipH);
    if (!free.ok) {
      await insertEvent("daily_limit_block", undefined, { ipHash: ipH });
      return res.status(429).json({
        limitReached: true,
        error: `Free scan limit reached (${free.perEmail}/day per email, ${free.perIp}/day per IP). Try again tomorrow.`,
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
    if (!isValidRunId(req.params.runId)) return res.status(404).json({ error: "Results not ready." });
    const results = (await getResults(req.params.runId)) as Record<string, unknown> | null;
    if (!results) return res.status(404).json({ error: "Results not ready." });
    res.json(redactRun(results));
  }),
);

app.get("/api/runs/:runId/report.md", (req, res) => {
  if (!isValidRunId(req.params.runId)) return res.status(404).send("Report not ready.");
  const path = resolve(join(runDir(req.params.runId), "report.md"));
  if (!existsSync(path)) return res.status(404).send("Report not ready.");
  res.type("text/markdown").sendFile(path);
});

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
function serveIndex(req: Request, res: Response) {
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
  if (req.path.startsWith("/admin")) res.setHeader("Cache-Control", "no-store");
  res.type("html").send(html);
}

if (existsSync(dist)) {
  app.use(express.static(dist, { index: false }));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    serveIndex(req, res);
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
        | { analysis?: { leaderboard?: Array<{ brand: string; mention: { rate: number }; recommendation: { rate: number } }> } }
        | null;
      const lb = results?.analysis?.leaderboard;
      if (lb?.length) {
        const entries: IndexEntry[] = lb.map((r, i) => ({
          brand: r.brand,
          rank: i + 1,
          mention: r.mention.rate,
          recommendation: r.recommendation.rate,
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
