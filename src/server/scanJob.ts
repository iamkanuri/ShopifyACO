import type { Config } from "../types.js";
import type { ApiKeys } from "../engines/index.js";
import { expandPrompts } from "../prompts.js";
import { buildAdapters } from "../engines/index.js";
import { runScan } from "../runner.js";
import { writeReports } from "../report.js";
import { extractDiscoveredBrands } from "../analysis/discoveredBrands.js";
import { appendProgress, releaseLock, runDir, setStatus } from "./runStore.js";
import { recordSpend } from "./guards.js";
import { insertEvent, updateRun } from "../db/supabase.js";
import { detectShopify } from "./shopifyDetect.js";

export interface ScanJobOpts {
  maxCostUsd: number;
  keys: ApiKeys;
  concurrency?: number;
  mode?: string;
}

/**
 * Execute a self-service scan into runs/{runId}/. Reuses the exact same engine,
 * detection, analysis, and report pipeline as the CLI — engine isolation and the
 * cost cap already live there. Always releases the single-run lock when done.
 */
export async function runScanJob(runId: string, config: Config, opts: ScanJobOpts): Promise<void> {
  const startedAt = new Date().toISOString();
  try {
    const { prompts } = expandPrompts(config);
    const { adapters, skipped } = buildAdapters(config, opts.keys, false);
    for (const s of skipped) await appendProgress(runId, `! skipped ${s.name}: ${s.reason}`);

    if (adapters.length === 0) {
      await setStatus(runId, { status: "failed", error: "No configured engines (check API keys)." });
      return;
    }

    await setStatus(runId, {
      status: "running",
      startedAt,
      promptCount: prompts.length,
      engines: adapters.map((a) => a.name),
    });
    await appendProgress(runId, `Running ${prompts.length} prompts × ${adapters.length} engines…`);

    // Shopify detection runs IN PARALLEL with the AI calls (never on the critical path) and
    // defaults to false on any failure. We start it before awaiting runScan so they overlap.
    const detectP = detectShopify(config.brand.storeUrl).catch(() => ({ isShopify: false, signal: null }));

    const results = await runScan(prompts, adapters, config, {
      concurrency: opts.concurrency ?? config.concurrency ?? 3,
      maxCostUsd: opts.maxCostUsd,
      maxDurationMs: 120_000, // hard wall-clock budget per scan
      // Don't persist raw provider payloads — the analysis only needs the answer
      // text (kept separately), and raw blobs are a privacy + disk liability.
      saveRaw: false,
      onProgress: (m) => void appendProgress(runId, m),
    });

    const detection = await detectP;
    const finishedAt = new Date().toISOString();
    const meta = {
      startedAt,
      finishedAt,
      mode: "live" as const,
      engines: adapters.map((a) => a.name),
      promptCount: prompts.length,
      totalCalls: prompts.length * adapters.length,
      isShopify: detection.isShopify,
      shopifySignal: detection.signal,
    };
    // Fix 1: surface brands the AI recommended that weren't configured. Best-effort + cheap
    // (a per-answer gpt-5.4-mini pass over the already-captured text); a failure just yields none.
    const discovered = await extractDiscoveredBrands(results, config, {
      apiKey: opts.keys.openai,
      concurrency: 4,
    }).catch(() => ({ brands: [], answersConsidered: 0, costUsd: 0 }));
    if (discovered.brands.length) {
      await appendProgress(runId, `Discovered ${discovered.brands.length} unlisted brand(s) AI recommended.`);
    }

    const { analysis } = await writeReports(results, config, {
      outDir: runDir(runId),
      meta,
      discoveredBrands: discovered.brands,
    });

    // Surface per-engine failures (engine isolation already captured them).
    const engineErrors = [...new Set(results.filter((r) => r.error).map((r) => r.engine))];
    const totalCostUsd = analysis.totalCostUsd + discovered.costUsd;
    await setStatus(runId, {
      status: "complete",
      finishedAt,
      costUsd: totalCostUsd,
      engineErrors,
    });
    // Count this spend (scan + discovery) against the global daily cap + persist the run + event.
    recordSpend(totalCostUsd);
    await updateRun(runId, { status: "complete", cost_usd: totalCostUsd });
    await insertEvent("scan_completed", runId, {
      score: analysis.visibilityScore.score,
      costUsd: totalCostUsd,
      engineErrors,
    });
    // Cost is recorded internally (recordSpend + updateRun.cost_usd + the scan_completed event) but NOT
    // shown to the user — anchoring a shopper on the few-cents scan cost sabotages the $29 value framing.
    await appendProgress(runId, `Done. Visibility score ${analysis.visibilityScore.score}/100.`);
  } catch (err) {
    const message = (err as Error).message;
    await setStatus(runId, { status: "failed", error: message });
    await updateRun(runId, { status: "failed", error: message });
    await appendProgress(runId, `FAILED: ${message}`);
  } finally {
    releaseLock(runId);
  }
}
