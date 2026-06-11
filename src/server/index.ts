import "dotenv/config";
import process from "node:process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import express, { type Request, type Response } from "express";
import type { Config } from "../types.js";
import { validateConfig } from "../config.js";
import { buildAdapters, type ApiKeys } from "../engines/index.js";
import { estimateMaxCost } from "../cli.js";
import { generatePrompts, miniScanPrompts, type ScanForm } from "../prompts/library.js";
import { suggestPrompts } from "./suggest.js";
import { captureLead, isValidEmail } from "./leads.js";
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

// === Local-only config =====================================================
const HOST = "127.0.0.1"; // localhost ONLY — never bind 0.0.0.0 as-is (no auth).
const PORT = Number(process.env.PORT ?? 8787);
const MINI_PROMPTS = 5;
const MINI_MAX_COST_USD = 0.5; // hard cap for a mini scan
const DEFAULT_ENGINES = ["openai", "gemini", "perplexity"];
const SUGGEST_COST_CAP_USD = 0.02;

// ⚠️ DEPLOYMENT TODOs (Railway, public funnel) — DO NOT skip before exposing:
//   TODO(auth): require a session/login before POST /api/scan and /api/leads.
//   TODO(rate-limit): per-IP rate limiting on /api/scan + /api/prompts/suggest.
//   TODO(spend-cap): per-IP and global per-DAY USD ceiling; reject when exceeded.
//   TODO(abuse): input size limits, captcha/turnstile on scan submit, allowlist origins.
//   TODO(queue): replace the single in-process lock with a real job queue + per-user concurrency.
// Until ALL of the above exist, this server must stay bound to localhost.

const keys: ApiKeys = {
  openai: process.env.OPENAI_API_KEY,
  google: process.env.GOOGLE_AI_API_KEY,
  perplexity: process.env.PERPLEXITY_API_KEY,
  anthropic: process.env.ANTHROPIC_API_KEY,
};

const app = express();
app.use(express.json({ limit: "256kb" })); // TODO(abuse): keep payloads bounded

// --- prompt generation (deterministic, no API cost) ------------------------
app.post("/api/prompts/generate", (req: Request, res: Response) => {
  const form = req.body as ScanForm;
  const err = validateForm(form);
  if (err) return res.status(400).json({ error: err });
  res.json({ prompts: generatePrompts(form), miniDefault: miniScanPrompts(form, MINI_PROMPTS).map((p) => p.text) });
});

// --- optional AI suggest (ONE capped call) ---------------------------------
app.post("/api/prompts/suggest", async (req: Request, res: Response) => {
  const form = req.body as ScanForm;
  const err = validateForm(form);
  if (err) return res.status(400).json({ error: err });
  // TODO(rate-limit): this spends money — gate per-IP before deploy.
  const result = await suggestPrompts(form, keys.openai);
  if (result.costUsd > SUGGEST_COST_CAP_USD) {
    // Defensive: max_tokens already bounds this; never loop or retry.
    return res.json({ prompts: [], costUsd: result.costUsd, error: "suggestion exceeded cost cap" });
  }
  res.json(result);
});

// --- start a scan ----------------------------------------------------------
app.post("/api/scan", async (req: Request, res: Response) => {
  const body = req.body as { form: ScanForm; prompts: string[]; engines?: string[]; maxCostUsd?: number };
  const formErr = validateForm(body?.form);
  if (formErr) return res.status(400).json({ error: formErr });
  const prompts = (body.prompts ?? []).map((p) => String(p).trim()).filter(Boolean);
  if (prompts.length === 0) return res.status(400).json({ error: "No prompts selected." });

  // One scan at a time.
  if (isBusy()) {
    return res.status(409).json({ error: `A scan is already running (${activeRun()}). Try again when it finishes.` });
  }

  const engines = (body.engines ?? DEFAULT_ENGINES).filter((e) => DEFAULT_ENGINES.includes(e));
  const maxCostUsd = Math.min(body.maxCostUsd ?? MINI_MAX_COST_USD, MINI_MAX_COST_USD);

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

  // Cost-cap guard BEFORE any live call.
  const { adapters, skipped } = buildAdapters(config, keys, false);
  if (adapters.length === 0) {
    return res.status(400).json({ error: "No engines available — check API keys.", skipped });
  }
  const estimateMaxUsd = estimateMaxCost(prompts.length, adapters);
  if (estimateMaxUsd > maxCostUsd) {
    return res.status(400).json({
      error: `Estimated max cost $${estimateMaxUsd.toFixed(4)} exceeds the cap $${maxCostUsd}. Reduce prompts or engines.`,
      estimateMaxUsd,
      cap: maxCostUsd,
    });
  }

  const runId = newRunId();
  if (!acquireLock(runId)) {
    return res.status(409).json({ error: "A scan is already running." });
  }
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
  } catch (e) {
    releaseLock(runId);
    return res.status(500).json({ error: (e as Error).message });
  }

  // Fire-and-forget; the job releases the lock + writes status when done.
  void runScanJob(runId, config, { maxCostUsd, keys, concurrency: 3 });
  res.json({ runId, estimateMaxUsd, totalCalls: prompts.length * adapters.length });
});

// --- status (UI polls this) ------------------------------------------------
app.get("/api/scan/:runId/status", async (req: Request, res: Response) => {
  const runId = String(req.params.runId);
  const status = await getStatus(runId);
  if (!status) return res.status(404).json({ error: "Unknown run." });
  res.json({ ...status, progress: (await readProgress(runId)).split("\n").filter(Boolean).slice(-40) });
});

// --- completed run results -------------------------------------------------
app.get("/api/runs/:runId", async (req: Request, res: Response) => {
  const results = await getResults(String(req.params.runId));
  if (!results) return res.status(404).json({ error: "Results not ready." });
  res.json(results);
});

// --- downloadable report.md for a run --------------------------------------
app.get("/api/runs/:runId/report.md", (req: Request, res: Response) => {
  const path = resolve(join(runDir(String(req.params.runId)), "report.md"));
  if (!existsSync(path)) return res.status(404).send("Report not ready.");
  res.type("text/markdown").sendFile(path);
});

// --- bundled demo (Caraway) ------------------------------------------------
app.get("/api/demo", async (_req: Request, res: Response) => {
  const path = resolve("results/results.json");
  if (!existsSync(path)) return res.status(404).json({ error: "No demo run found. Run a scan first." });
  res.sendFile(path);
});

// --- pricing (fake-door test) ----------------------------------------------
app.get("/api/pricing", (_req: Request, res: Response) => res.json({ plans: PLANS }));

// --- lead capture (fake-door; emails -> runs/leads.jsonl, gitignored) -------
app.post("/api/leads", async (req: Request, res: Response) => {
  const { email, plan, runId } = (req.body ?? {}) as { email?: string; plan?: string; runId?: string };
  if (!isValidEmail(email)) return res.status(400).json({ error: "Please enter a valid email." });
  if (!plan) return res.status(400).json({ error: "Missing plan." });
  // TODO(abuse): rate-limit + dedupe before deploy.
  await captureLead({ email, plan, runId, timestamp: new Date().toISOString() });
  res.json({ ok: true });
});

// --- optionally serve the built viewer (single-command demo) ---------------
const dist = resolve("viewer/dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(join(dist, "index.html"))); // SPA fallback
}

app.listen(PORT, HOST, () => {
  console.log("\n" + "=".repeat(64));
  console.log("  ShopifyACO scan server");
  console.log(`  → http://${HOST}:${PORT}  (LOCALHOST ONLY)`);
  console.log("  ⚠️  Runs with YOUR live API keys. No auth, no rate limits,");
  console.log("      no spend caps beyond the per-scan cost cap. NEVER expose this");
  console.log("      publicly as-is — see DEPLOYMENT TODOs in src/server/index.ts.");
  console.log("=".repeat(64) + "\n");
});

function validateForm(form: ScanForm | undefined): string | null {
  if (!form || typeof form !== "object") return "Missing form.";
  if (!form.brand?.name?.trim()) return "Brand name is required.";
  if (!form.category?.trim()) return "Category is required.";
  if (!Array.isArray(form.competitors) || form.competitors.length === 0) return "Add at least one competitor.";
  if (form.competitors.some((c) => !c?.name?.trim())) return "Every competitor needs a name.";
  return null;
}
