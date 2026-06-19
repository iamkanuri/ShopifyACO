import type { Config } from "../types.js";
import type { ApiKeys } from "../engines/index.js";
import { expandPrompts } from "../prompts.js";
import { buildAdapters } from "../engines/index.js";
import { runScan } from "../runner.js";
import { writeReports } from "../report.js";
import { appendProgress, releaseLock, runDir, setStatus } from "./runStore.js";
import { recordSpend } from "./guards.js";
import { insertEvent, updateRun } from "../db/supabase.js";

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

    const results = await runScan(prompts, adapters, config, {
      concurrency: opts.concurrency ?? config.concurrency ?? 3,
      maxCostUsd: opts.maxCostUsd,
      maxDurationMs: 120_000, // hard wall-clock budget per scan
      // Don't persist raw provider payloads — the analysis only needs the answer
      // text (kept separately), and raw blobs are a privacy + disk liability.
      saveRaw: false,
      onProgress: (m) => void appendProgress(runId, m),
    });

    const finishedAt = new Date().toISOString();
    const meta = {
      startedAt,
      finishedAt,
      mode: "live" as const,
      engines: adapters.map((a) => a.name),
      promptCount: prompts.length,
      totalCalls: prompts.length * adapters.length,
    };
    const { analysis } = await writeReports(results, config, { outDir: runDir(runId), meta });

    // Surface per-engine failures (engine isolation already captured them).
    const engineErrors = [...new Set(results.filter((r) => r.error).map((r) => r.engine))];
    await setStatus(runId, {
      status: "complete",
      finishedAt,
      costUsd: analysis.totalCostUsd,
      engineErrors,
    });
    // Count this spend against the global daily cap + persist the run + event.
    recordSpend(analysis.totalCostUsd);
    await updateRun(runId, { status: "complete", cost_usd: analysis.totalCostUsd });
    await insertEvent("scan_completed", runId, {
      score: analysis.visibilityScore.score,
      costUsd: analysis.totalCostUsd,
      engineErrors,
    });
    await appendProgress(runId, `Done. Visibility score ${analysis.visibilityScore.score}/100, $${analysis.totalCostUsd.toFixed(4)}.`);
  } catch (err) {
    const message = (err as Error).message;
    await setStatus(runId, { status: "failed", error: message });
    await updateRun(runId, { status: "failed", error: message });
    await appendProgress(runId, `FAILED: ${message}`);
  } finally {
    releaseLock(runId);
  }
}
