import type { Config, PromptEngineResult } from "./types.js";
import type { ExpandedPrompt } from "./prompts.js";
import type { EngineAdapter } from "./engines/types.js";
import { HttpError } from "./engines/http.js";
import { detectMentions } from "./detection/index.js";

export interface RunOptions {
  concurrency: number;
  maxCostUsd?: number;
  saveRaw: boolean;
  retries?: number;
  onProgress?: (msg: string) => void;
}

interface Task {
  prompt: ExpandedPrompt;
  adapter: EngineAdapter;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry with exponential backoff + jitter; only retries retryable HTTP errors. */
async function withRetry<T>(fn: () => Promise<T>, attempts: number): Promise<T> {
  let delay = 500;
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const retryable = err instanceof HttpError && err.retryable;
      if (i >= attempts - 1 || !retryable) throw err;
      const jitter = Math.floor(Math.random() * 250);
      const wait = err instanceof HttpError && err.retryAfterMs ? err.retryAfterMs : delay + jitter;
      await sleep(wait);
      delay *= 2;
    }
  }
}

/**
 * Run every (prompt × engine) call under a concurrency cap, with retry/backoff,
 * per-engine graceful failure, and a hard cost stop. Detection runs inline so
 * results come back fully analyzed.
 */
export async function runScan(
  prompts: ExpandedPrompt[],
  adapters: EngineAdapter[],
  cfg: Config,
  opts: RunOptions,
): Promise<PromptEngineResult[]> {
  const tasks: Task[] = [];
  for (const prompt of prompts) {
    for (const adapter of adapters) tasks.push({ prompt, adapter });
  }

  const results: PromptEngineResult[] = [];
  const controller = new AbortController();
  let runningCost = 0;
  let costStopped = false;
  let next = 0;

  const attempts = opts.retries ?? 3;

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= tasks.length) return;
      const { prompt, adapter } = tasks[i]!;

      if (costStopped) {
        results.push(skipped(prompt, adapter, "skipped: cost cap reached"));
        continue;
      }

      try {
        const res = await withRetry(
          () => adapter.generate(prompt.prompt, controller.signal),
          attempts,
        );
        const detections = detectMentions(res.text, cfg);
        results.push({
          prompt: prompt.prompt,
          template: prompt.template,
          engine: res.engine,
          model: res.model,
          groundingMode: res.groundingMode,
          text: res.text,
          usage: res.usage,
          detections,
          ...(opts.saveRaw ? { raw: res.raw } : {}),
        });

        runningCost += res.usage?.costUsd ?? 0;
        opts.onProgress?.(
          `✓ ${adapter.name.padEnd(10)} [${res.groundingMode}] ` +
            `$${runningCost.toFixed(4)}  «${prompt.prompt.slice(0, 48)}»`,
        );

        if (opts.maxCostUsd !== undefined && runningCost >= opts.maxCostUsd && !costStopped) {
          costStopped = true;
          controller.abort();
          opts.onProgress?.(
            `! cost cap $${opts.maxCostUsd} reached at $${runningCost.toFixed(4)} — stopping remaining calls`,
          );
        }
      } catch (err) {
        const message = (err as Error).message;
        results.push({
          prompt: prompt.prompt,
          template: prompt.template,
          engine: adapter.name,
          model: adapter.model,
          groundingMode: "unknown",
          text: "",
          error: message,
          detections: [],
        });
        opts.onProgress?.(`✗ ${adapter.name.padEnd(10)} ERROR: ${message.slice(0, 70)}`);
      }
    }
  }

  const pool = Array.from({ length: Math.min(opts.concurrency, tasks.length) }, () => worker());
  await Promise.all(pool);
  return results;
}

function skipped(prompt: ExpandedPrompt, adapter: EngineAdapter, reason: string): PromptEngineResult {
  return {
    prompt: prompt.prompt,
    template: prompt.template,
    engine: adapter.name,
    model: adapter.model,
    groundingMode: "unknown",
    text: "",
    error: reason,
    detections: [],
  };
}
