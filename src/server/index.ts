import "dotenv/config";
import process from "node:process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import type { Config } from "../types.js";
import { validateConfig } from "../config.js";
import { buildAdapters } from "../engines/index.js";
import { estimateMaxCost } from "../cli.js";
import { expandPrompts } from "../prompts.js";
import { generatePrompts, miniScanPrompts, type ScanForm } from "../prompts/library.js";
import { suggestPrompts } from "./suggest.js";
import { ENV, hasSupabase, reportConfig, SCAN_MODES, type ScanMode } from "./env.js";
import {
  clientIp,
  currentSpendUsd,
  freeScanAllowed,
  ipHash,
  isValidEmail,
  rateLimit,
  spendAllows,
} from "./guards.js";
import { insertEvent, insertLead, insertRun } from "../db/supabase.js";
import { ADMIN_COOKIE, buildAdminData, checkPassword, isAdmin, makeToken, requireAdmin } from "./admin.js";
import {
  acquireLock,
  activeRun,
  createRun,
  getResults,
  getStatus,
  isBusy,
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
  "See if AI shoppers recommend your store — or your competitors. Run a free mini scan across ChatGPT, Gemini, and Perplexity.";
const DEMO_NOTE = "Demo data shown for illustration; not affiliated with or endorsed by Caraway.";
const ALLOWED_EVENTS = new Set([
  "report_viewed",
  "cta_full_report",
  "cta_monitoring",
  "cta_founder_beta",
  "payment_link_clicked",
  "payment_completed",
  "lead_submitted",
]);
// Stripe Payment Link per plan id (URLs only).
const STRIPE_BY_PLAN: Record<string, string | undefined> = ENV.stripe;

const keys = ENV.keys;
const app = express();
if (ENV.isProd) app.set("trust proxy", 1);
app.use(express.json({ limit: "256kb" }));

app.use("/api", (req: Request, res: Response, next: NextFunction) => {
  if (!rateLimit(`api:${clientIp(req)}`, 120, 60_000)) {
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

// --- public runtime config (NO secrets; service-role key never sent) -------
app.get("/api/config", (req, res) => {
  const plans = PLANS.map((p) => ({ ...p, stripeUrl: STRIPE_BY_PLAN[p.id] ?? null }));
  res.json({
    brandName: ENV.publicBrandName,
    baseUrl: baseUrl(req),
    contactEmail: ENV.contactEmail,
    tagline: TAGLINE,
    demoNote: DEMO_NOTE,
    plans,
    miniPrompts: MINI_PROMPTS,
    fullReportPrompts: SCAN_MODES.deep.prompts,
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
    if (result.costUsd > SUGGEST_COST_CAP_USD) {
      return res.json({ prompts: [], costUsd: result.costUsd, error: "suggestion exceeded cost cap" });
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
    if (!isValidEmail(body.email)) return res.status(400).json({ error: "A valid email is required to run a scan." });
    const email = body.email;
    const ip = clientIp(req);
    const ipH = ipHash(ip);

    const prompts = (body.prompts ?? []).map((p) => String(p).trim()).filter(Boolean).slice(0, SCAN_MODES.mini.prompts);
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
    const runId = String(req.params.runId);
    const status = await getStatus(runId);
    if (!status) return res.status(404).json({ error: "Unknown run." });
    res.json({ ...status, progress: (await readProgress(runId)).split("\n").filter(Boolean).slice(-40) });
  }),
);

app.get(
  "/api/runs/:runId",
  wrap(async (req, res) => {
    const results = (await getResults(String(req.params.runId))) as Record<string, unknown> | null;
    if (!results) return res.status(404).json({ error: "Results not ready." });
    res.json(redactRun(results));
  }),
);

app.get("/api/runs/:runId/report.md", (req, res) => {
  const path = resolve(join(runDir(String(req.params.runId)), "report.md"));
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

// --- analytics events ------------------------------------------------------
app.post(
  "/api/events",
  wrap(async (req, res) => {
    const { name, run_id, metadata } = (req.body ?? {}) as { name?: string; run_id?: string; metadata?: unknown };
    if (!name || !ALLOWED_EVENTS.has(name)) return res.status(400).json({ error: "Unknown event." });
    await insertEvent(name, run_id, metadata);
    res.json({ ok: true });
  }),
);

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
  const html = indexTemplate
    .replaceAll("__BRAND_NAME__", escapeHtml(ENV.publicBrandName))
    .replaceAll("__DESC__", escapeHtml(TAGLINE))
    .replaceAll("__BASE_URL__", escapeHtml(baseUrl(req)));
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

function validateForm(form: ScanForm | undefined): string | null {
  if (!form || typeof form !== "object") return "Missing form.";
  if (!form.brand?.name?.trim()) return "Brand name is required.";
  if (!form.category?.trim()) return "Category is required.";
  if (!Array.isArray(form.competitors) || form.competitors.length === 0) return "Add at least one competitor.";
  if (form.competitors.some((c) => !c?.name?.trim())) return "Every competitor needs a name.";
  return null;
}
