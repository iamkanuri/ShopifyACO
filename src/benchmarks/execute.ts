import type { Config } from "../types.js";
import { ENV } from "../server/env.js";
import { buildAdapters } from "../engines/index.js";
import { detectMentions } from "../detection/index.js";
import { estimateMaxCost } from "../cli.js";
import { reserveSpend, reconcileSpend, settleFailedReservation, recordUsage } from "../queue/spend.js";
import { aggregateRun, createRun, finishRun, getBenchmark, insertObservation } from "../db/benchmarks.js";
import type { BenchmarkMetrics } from "./metrics.js";
import { registerHandler } from "../queue/handlers.js";

// Benchmark executor (Phase 4). Expands product × prompt × engine × repetition, asks
// each engine, runs deterministic detection, and stores one observation per assessed
// brand. mock=true runs the deterministic mock engines at $0; a live run reserves its
// worst-case spend up front (Phase-1 atomic reservation) and reconciles to actuals.

export interface ExecuteResult {
  runId: number;
  observationCount: number;
  costUsd: number;
  estimateUsd: number;
  metrics: BenchmarkMetrics;
}

export async function executeBenchmark(benchmarkId: number, opts: { mock?: boolean; spendCapUsd?: number } = {}): Promise<ExecuteResult> {
  const bench = await getBenchmark(benchmarkId);
  if (!bench) throw new Error(`benchmark ${benchmarkId} not found`);
  const c = bench.config;
  const mock = opts.mock ?? false;
  const repetitions = Math.max(1, c.repetitions ?? 1);

  const cfg: Config = {
    brand: c.brand,
    category: c.category,
    competitors: c.competitors,
    promptTemplates: [],
    engines: c.engines,
  };
  const { adapters } = buildAdapters(cfg, ENV.keys, mock);
  if (adapters.length === 0) throw new Error("no engines configured for this benchmark");

  const prompts = c.prompts;
  const runId = await createRun(benchmarkId, bench.shop_domain, bench.tier, adapters.map((a) => a.name), prompts.length, repetitions, mock ? "mock" : "live");
  const estimateUsd = estimateMaxCost(prompts.length * repetitions, adapters);

  // Live runs reserve worst-case spend atomically BEFORE any paid call.
  let reservationId: number | undefined;
  if (!mock) {
    const cap = opts.spendCapUsd ?? ENV.dailySpendCapUsd;
    const r = await reserveSpend(String(runId), estimateUsd, cap);
    if (!r.ok) {
      await finishRun(runId, { status: "failed", error: `daily spend cap reached ($${r.spentUsd.toFixed(2)}/$${cap})` });
      throw new Error(`Daily spend cap reached — benchmark not run (would exceed $${cap}).`);
    }
    reservationId = r.reservationId;
  }

  let totalCost = 0;
  let obsCount = 0;
  let errorCount = 0;
  const modelVersions: Record<string, string> = {};
  const groundingModes: Record<string, string> = {};

  try {
    // Build the full work list, then run the (slow, web-grounded) engine calls with BOUNDED
    // CONCURRENCY instead of strictly sequentially — a mini live run drops from minutes to tens
    // of seconds. JS is single-threaded, so the shared accumulators below mutate safely between
    // awaits. Each call is hard-capped (covering the adapter's grounded→ungrounded fallback) so
    // one slow engine can't stall the whole run.
    const tasks: Array<{ pi: number; prompt: (typeof prompts)[number]; rep: number; adapter: (typeof adapters)[number] }> = [];
    for (let pi = 0; pi < prompts.length; pi++) {
      for (let rep = 0; rep < repetitions; rep++) {
        for (const adapter of adapters) tasks.push({ pi, prompt: prompts[pi]!, rep, adapter });
      }
    }

    await mapPool(tasks, ENV.benchmarkConcurrency, async ({ pi, prompt, rep, adapter }) => {
      const t0 = Date.now();
      let result;
      try {
        result = await adapter.generate(prompt.text, AbortSignal.timeout(PER_CALL_TIMEOUT_MS));
      } catch (err) {
        result = { engine: adapter.name, model: adapter.model, text: "", groundingMode: "unknown" as const, error: (err as Error).message };
      }
      const latencyMs = Date.now() - t0;
      modelVersions[adapter.name] = adapter.model;
      groundingModes[adapter.name] = result.groundingMode;
      const callCost = result.usage?.costUsd ?? 0;
      totalCost += callCost;
      if (!mock && callCost > 0) {
        await recordUsage({ runId: String(runId), shop: bench.shop_domain ?? undefined, engine: adapter.name, model: adapter.model, costUsd: callCost, promptTokens: result.usage?.inputTokens, completionTokens: result.usage?.outputTokens });
      }

      // A provider error (outage/timeout/quota/bad key) is OUR failure, not the merchant's.
      // Recording an own-brand not_mentioned would drag the merchant's recommendation/mention
      // rate down for an engine outage, so we EXCLUDE failed calls from the denominator —
      // matching the CLI/public pipeline. (Any cost is still recorded above; the error is
      // counted for transparency.)
      if (result.error) {
        errorCount++;
        return;
      }

      const responseId = `${runId}-${pi}-${rep}-${adapter.name}`;
      const detections = detectMentions(result.text, cfg);

      for (const det of detections) {
        await insertObservation({
          runId, benchmarkId, shopDomain: bench.shop_domain, responseId,
          promptText: prompt.text, intent: prompt.intent, engine: adapter.name, model: adapter.model,
          groundingMode: result.groundingMode, targetBrand: det.name, recommendationStatus: det.status,
          rank: det.listRank, evidenceSnippet: det.snippet ?? null,
          // Real citation URLs from the grounded answer → Phase-5 live crawl derives the
          // competitor pages to diagnose from these (was hardcoded []).
          latencyMs, costUsd: det.isOwn ? callCost : 0, citations: result.citations ?? [],
        });
        obsCount++;
      }
    });

    if (errorCount > 0) console.warn(`[benchmark] run ${runId}: ${errorCount}/${tasks.length} engine call(s) failed and were excluded from the rates`);
    await finishRun(runId, { status: "completed", observationCount: obsCount, costUsd: totalCost, modelVersions, groundingModes });
    if (reservationId) await reconcileSpend(reservationId, totalCost);
    const agg = await aggregateRun(runId, c.brand.name);
    return { runId, observationCount: obsCount, costUsd: totalCost, estimateUsd, metrics: agg.metrics };
  } catch (err) {
    await finishRun(runId, { status: "failed", error: (err as Error).message });
    // Reconcile any spend already incurred before the failure; only release if $0 spent.
    if (reservationId) await settleFailedReservation(reservationId, totalCost);
    throw err;
  }
}

/** Per-call hard cap covering the adapter's grounded→ungrounded fallback, so one slow engine
 *  can't stall the whole run. (The HTTP layer also times out each individual fetch at 45s.) */
const PER_CALL_TIMEOUT_MS = 40_000;

/** Run `fn` over `items` with at most `limit` calls in flight at once. */
async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (let i = next++; i < items.length; i = next++) await fn(items[i]!);
  });
  await Promise.all(workers);
}

/** Register the queue handler so benchmarks can run on the worker. */
export function registerBenchmarkJobs(): void {
  registerHandler("benchmark_run", async (payload) => {
    const id = Number(payload.benchmarkId);
    if (!Number.isInteger(id)) throw new Error("benchmark_run: missing benchmarkId");
    const r = await executeBenchmark(id, { mock: Boolean(payload.mock) });
    return { runId: r.runId, observationCount: r.observationCount, costUsd: r.costUsd };
  });
}
