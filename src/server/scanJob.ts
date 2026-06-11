import type { Config } from "../types.js";
import type { ApiKeys } from "../engines/index.js";
import { expandPrompts } from "../prompts.js";
import { buildAdapters } from "../engines/index.js";
import { runScan } from "../runner.js";
import { writeReports } from "../report.js";
import { appendProgress, releaseLock, runDir, setStatus } from "./runStore.js";

export interface ScanJobOpts {
  maxCostUsd: number;
  keys: ApiKeys;
  concurrency?: number;
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
      saveRaw: true,
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
    await appendProgress(runId, `Done. Visibility score ${analysis.visibilityScore.score}/100, $${analysis.totalCostUsd.toFixed(4)}.`);
  } catch (err) {
    await setStatus(runId, { status: "failed", error: (err as Error).message });
    await appendProgress(runId, `FAILED: ${(err as Error).message}`);
  } finally {
    releaseLock(runId);
  }
}
