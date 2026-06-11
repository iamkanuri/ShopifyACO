import "dotenv/config";
import process from "node:process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import type { Config } from "../types.js";
import { validateConfig } from "../config.js";
import { buildAdapters } from "../engines/index.js";
import { estimateMaxCost } from "../cli.js";
import { generatePrompts, miniScanPrompts, type ScanForm } from "../prompts/library.js";
import { suggestPrompts } from "./suggest.js";
import { ENV, hasSupabase, reportConfig } from "./env.js";
import {
  clientIp,
  currentSpendUsd,
  freeScanAllowed,
  isValidEmail,
  rateLimit,
  spendAllows,
} from "./guards.js";
import { insertEvent, insertLead, insertRun } from "../db/supabase.js";
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
const MINI_MAX_COST_USD = 0.5;
const DEFAULT_ENGINES = ["openai", "gemini", "perplexity"];
const SUGGEST_COST_CAP_USD = 0.02;
const ALLOWED_EVENTS = new Set([
  "scan_started",
  "scan_completed",
  "report_viewed",
  "cta_full_report",
  "cta_monitoring",
  "lead_submitted",
]);

const keys = ENV.keys;
const app = express();
if (ENV.isProd) app.set("trust proxy", 1); // Railway proxy → real client IP
app.use(express.json({ limit: "256kb" }));

// Global per-IP rate limit on the API surface.
app.use("/api", (req: Request, res: Response, next: NextFunction) => {
  if (!rateLimit(`api:${clientIp(req)}`, 120, 60_000)) {
    return res.status(429).json({ error: "Too many requests — slow down a moment." });
  }
  next();
});

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
  fn(req, res).catch(next);

// --- health ----------------------------------------------------------------
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
    supabase: hasSupabase(),
    dailySpendCapUsd: ENV.dailySpendCapUsd,
    spendTodayUsd: Number(spendToday.toFixed(4)),
  });
});

// --- prompt generation (deterministic, no API cost) ------------------------
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

// --- start a scan (email-gated, rate-limited, spend-capped) -----------------
app.post(
  "/api/scan",
  wrap(async (req, res) => {
    const body = req.body as {
      form: ScanForm;
      prompts: string[];
      engines?: string[];
      email?: string;
      hp?: string; // honeypot
    };

    // Honeypot: real users never fill this hidden field.
    if (body.hp) return res.status(400).json({ error: "Request rejected." });

    const formErr = validateForm(body?.form);
    if (formErr) return res.status(400).json({ error: formErr });

    // Email gate — required before any scan; stored as a lead.
    if (!isValidEmail(body.email)) return res.status(400).json({ error: "A valid email is required to run a scan." });
    const email = body.email;
    const ip = clientIp(req);

    const prompts = (body.prompts ?? []).map((p) => String(p).trim()).filter(Boolean);
    if (prompts.length === 0) return res.status(400).json({ error: "No prompts selected." });

    // Per-IP scan rate limit (short window) + single-run lock.
    if (!rateLimit(`scan:${ip}`, 4, 60_000)) {
      return res.status(429).json({ error: "You're scanning too fast — give it a minute." });
    }
    if (isBusy()) {
      return res.status(409).json({ error: `A scan is already running (${activeRun()}). Try again shortly.` });
    }

    await insertLead({ email, plan: "free_mini", source: "scan_gate" });

    const engines = (body.engines ?? DEFAULT_ENGINES).filter((e) => DEFAULT_ENGINES.includes(e));
    const maxCostUsd = MINI_MAX_COST_USD;

    let config: Config;
    try {
      config = validateConfig(
        {
          brand: body.form.brand,
          category: body.form.category,
          competitors: body.form.competitors,
          buyerPersona: body.form.persona,
          location: body.form.location,
          priceRange: body.form.priceRange,
          promptTemplates: prompts,
          engines,
          concurrency: 3,
        },
        "scan form",
      );
    } catch (e) {
      return res.status(400).json({ error: (e as Error).message });
    }

    const { adapters } = buildAdapters(config, keys, false);
    if (adapters.length === 0) return res.status(400).json({ error: "No engines available — check server API keys." });
    const estimateMaxUsd = estimateMaxCost(prompts.length, adapters);

    // Per-scan cost cap.
    if (estimateMaxUsd > maxCostUsd) {
      return res.status(400).json({ error: `Estimated cost $${estimateMaxUsd.toFixed(4)} exceeds the $${maxCostUsd} cap.` });
    }

    // GLOBAL daily spend cap — enforced BEFORE any live API call.
    const spend = await spendAllows(estimateMaxUsd);
    if (!spend.ok) {
      await insertLead({ email, plan: "monitoring", source: "spend_cap" });
      await insertEvent("scan_blocked_spend_cap", undefined, { spentUsd: spend.spentUsd, capUsd: spend.capUsd });
      return res.status(429).json({
        capReached: true,
        error: `Daily scan capacity reached ($${spend.capUsd}). We saved your email — we'll notify you when it resets.`,
      });
    }

    // Free-scan daily limits (per email AND per IP).
    const free = await freeScanAllowed(email, ip);
    if (!free.ok) {
      return res.status(429).json({
        limitReached: true,
        error: `Free scan limit reached (${free.perEmail}/day per email, ${free.perIp}/day per IP). Try again tomorrow.`,
      });
    }

    const runId = newRunId();
    if (!acquireLock(runId)) return res.status(409).json({ error: "A scan is already running." });
    try {
      await createRun(runId, config, {
        runId,
        status: "pending",
        brand: config.brand.name,
        engines: adapters.map((a) => a.name),
        promptCount: prompts.length,
        estimateMaxUsd,
        createdAt: new Date().toISOString(),
      });
      await insertRun({ id: runId, brand: config.brand.name, category: config.category, status: "pending", email, ip });
      await insertEvent("scan_started", runId, { brand: config.brand.name, prompts: prompts.length });
    } catch (e) {
      releaseLock(runId);
      return res.status(500).json({ error: (e as Error).message });
    }

    void runScanJob(runId, config, { maxCostUsd, keys, concurrency: 3 });
    res.json({ runId, estimateMaxUsd, totalCalls: prompts.length * adapters.length });
  }),
);

// --- status ----------------------------------------------------------------
app.get(
  "/api/scan/:runId/status",
  wrap(async (req, res) => {
    const runId = String(req.params.runId);
    const status = await getStatus(runId);
    if (!status) return res.status(404).json({ error: "Unknown run." });
    res.json({ ...status, progress: (await readProgress(runId)).split("\n").filter(Boolean).slice(-40) });
  }),
);

// --- completed run results -------------------------------------------------
app.get(
  "/api/runs/:runId",
  wrap(async (req, res) => {
    const results = await getResults(String(req.params.runId));
    if (!results) return res.status(404).json({ error: "Results not ready." });
    res.json(results);
  }),
);

app.get("/api/runs/:runId/report.md", (req, res) => {
  const path = resolve(join(runDir(String(req.params.runId)), "report.md"));
  if (!existsSync(path)) return res.status(404).send("Report not ready.");
  res.type("text/markdown").sendFile(path);
});

// --- demo (served from the committed bundled fixture) ----------------------
app.get("/api/demo", (_req, res) => {
  for (const p of ["viewer/dist/sample-results.json", "viewer/public/sample-results.json"]) {
    const abs = resolve(p);
    if (existsSync(abs)) return res.sendFile(abs);
  }
  res.status(404).json({ error: "No demo fixture found." });
});

// --- pricing ---------------------------------------------------------------
app.get("/api/pricing", (_req, res) => res.json({ plans: PLANS }));

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

// --- CTA lead capture (fake-door) ------------------------------------------
app.post(
  "/api/leads",
  wrap(async (req, res) => {
    const { email, plan, runId } = (req.body ?? {}) as { email?: string; plan?: string; runId?: string };
    if (!isValidEmail(email)) return res.status(400).json({ error: "Please enter a valid email." });
    if (!plan) return res.status(400).json({ error: "Missing plan." });
    await insertLead({ email, plan, source: "cta", run_id: runId });
    await insertEvent("lead_submitted", runId, { plan });
    res.json({ ok: true });
  }),
);

// --- serve the built viewer (single service) -------------------------------
const dist = resolve("viewer/dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(join(dist, "index.html"));
  });
} else if (ENV.isProd) {
  console.warn("[server] viewer/dist not found — did `npm run build` run? Serving API only.");
}

// --- structured error handler ----------------------------------------------
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  console.error(JSON.stringify({ level: "error", at: req.method + " " + req.path, msg: err.message, ts: new Date().toISOString() }));
  if (!res.headersSent) res.status(500).json({ error: "Something went wrong." });
});

// --- listen ----------------------------------------------------------------
const host = ENV.isProd ? "0.0.0.0" : "127.0.0.1";
reportConfig();
app.listen(ENV.port, host, () => {
  if (ENV.isProd) {
    console.log(JSON.stringify({ level: "info", msg: "server up", port: ENV.port, host, supabase: hasSupabase(), spendCap: ENV.dailySpendCapUsd }));
  } else {
    console.log("\n" + "=".repeat(64));
    console.log("  ShopifyACO scan server (DEV)");
    console.log(`  → http://${host}:${ENV.port}  (LOCALHOST ONLY in dev)`);
    console.log("  ⚠️  Runs with your live API keys. In production this binds 0.0.0.0");
    console.log("      behind Railway with auth-gating, rate limits, and a daily spend cap.");
    console.log("=".repeat(64) + "\n");
  }
});

function validateForm(form: ScanForm | undefined): string | null {
  if (!form || typeof form !== "object") return "Missing form.";
  if (!form.brand?.name?.trim()) return "Brand name is required.";
  if (!form.category?.trim()) return "Category is required.";
  if (!Array.isArray(form.competitors) || form.competitors.length === 0) return "Add at least one competitor.";
  if (form.competitors.some((c) => !c?.name?.trim())) return "Every competitor needs a name.";
  return null;
}
