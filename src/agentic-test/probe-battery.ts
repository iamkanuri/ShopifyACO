import "dotenv/config";
import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ENV } from "../server/env.js";
import { createOpenAIAdapter } from "../engines/openai.js";
import { createGeminiAdapter } from "../engines/gemini.js";
import { createPerplexityAdapter } from "../engines/perplexity.js";
import type { EngineAdapter } from "../engines/types.js";
import { HttpError } from "../engines/http.js";
import { DEV_SHOP_ID } from "./contract.js";
import { assertRunnable } from "./preflight.js";
import { assertPreregistered } from "./preregistration.js";
import { addSpend, readCumulativeSpend } from "./trace-recorder.js";
import { useStage3ResultsDir } from "./run-experiment3.js";

// ===========================================================================
// STAGE 3 PROBE BATTERY (spec 4.6) — LIVE AI-visibility probes through the
// app's EXISTING engine adapters (raw fetch, existing env keys, read-only
// against external AI services). Full raw responses + citations persisted,
// batch-tagged `stage3`. Spend counts against the shared $25 breaker.
// The pre-registration guard runs BEFORE anything else (Rule 5).
// ===========================================================================

export const PROBE_FILE = join(process.cwd(), "experiments", "agentic-stage3", "probes", "probe-battery.jsonl");

/** 6 category prompts: real buyer questions with hard constraints (price caps,
 *  no-subscription, delivery timing) over the two seeded categories. */
export const PROBE_PROMPTS: Array<{ id: string; category: "deodorant" | "shave_soap"; text: string }> = [
  { id: "p1", category: "deodorant", text: "What's the best aluminum-free natural deodorant under $20? I don't want a subscription — just a one-time purchase." },
  { id: "p2", category: "deodorant", text: "I need a natural deodorant without baking soda for sensitive skin that ships fast — arrives in 2 to 4 business days in the US. Any recommendations?" },
  { id: "p3", category: "deodorant", text: "Best travel-size natural deodorant I can buy online for under $15?" },
  { id: "p4", category: "shave_soap", text: "Which artisan shave soap is 100% vegan and tallow-free for under $30?" },
  { id: "p5", category: "deodorant", text: "Recommend an unscented aluminum-free deodorant that arrives within a week — nothing with auto-renew." },
  { id: "p6", category: "shave_soap", text: "Where can I buy a handmade tallow-free shave soap online with free returns?" },
];

export const PROBE_REPEATS = 3;

export interface ProbeRecord {
  batchTag: "stage3";
  channel: string;
  model: string;
  promptId: string;
  category: string;
  repeat: number;
  promptText: string;
  responseText: string;
  citations: string[];
  groundingMode: string;
  usage: { inputTokens?: number; outputTokens?: number };
  costUsd: number;
  timestamp: string;
}

function channels(): EngineAdapter[] {
  return [
    createOpenAIAdapter(ENV.keys.openai),
    createGeminiAdapter(ENV.keys.google),
    createPerplexityAdapter(ENV.keys.perplexity),
  ].filter((a) => a.isConfigured());
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runProbeBattery(): Promise<void> {
  assertRunnable(process.env, DEV_SHOP_ID);
  assertPreregistered(); // Rule 5: manual arm committed first, mechanically enforced
  useStage3ResultsDir(); // spend ledger shares the stage-3 breaker file

  const adapters = channels();
  if (adapters.length < 2) throw new Error(`fewer than two probe channels configured (${adapters.length})`);
  mkdirSync(join(PROBE_FILE, ".."), { recursive: true });

  // Idempotent: skip (channel, promptId, repeat) combos already persisted.
  const done = new Set<string>();
  if (existsSync(PROBE_FILE)) {
    for (const line of readFileSync(PROBE_FILE, "utf8").trim().split("\n")) {
      if (!line) continue;
      const r = JSON.parse(line) as ProbeRecord;
      done.add(`${r.channel}|${r.promptId}|${r.repeat}`);
    }
  }

  let ran = 0;
  for (const prompt of PROBE_PROMPTS) {
    for (const adapter of adapters) {
      for (let repeat = 1; repeat <= PROBE_REPEATS; repeat++) {
        const key = `${adapter.name}|${prompt.id}|${repeat}`;
        if (done.has(key)) continue;
        let attempt = 0;
        for (;;) {
          attempt++;
          try {
            const res = await adapter.generate(prompt.text);
            const record: ProbeRecord = {
              batchTag: "stage3",
              channel: adapter.name,
              model: res.model,
              promptId: prompt.id,
              category: prompt.category,
              repeat,
              promptText: prompt.text,
              responseText: res.text,
              citations: res.citations ?? [],
              groundingMode: res.groundingMode,
              usage: { inputTokens: res.usage?.inputTokens, outputTokens: res.usage?.outputTokens },
              costUsd: res.usage?.costUsd ?? 0,
              timestamp: new Date().toISOString(),
            };
            appendFileSync(PROBE_FILE, `${JSON.stringify(record)}\n`, "utf8");
            addSpend(record.costUsd);
            ran++;
            console.log(
              `[battery] ${adapter.name} ${prompt.id} r${repeat} → ${res.text.length} chars, ` +
                `${(res.citations ?? []).length} citations, ${res.groundingMode}, $${record.costUsd.toFixed(4)}`,
            );
            break;
          } catch (err) {
            const retryable = err instanceof HttpError ? err.retryable : true;
            if (!retryable || attempt >= 3) {
              console.warn(`[battery] ${key} FAILED after ${attempt} attempt(s): ${(err as Error).message.slice(0, 120)}`);
              break; // a missing probe is a gap in the battery, reported, never faked
            }
            await sleep(2000 * attempt);
          }
        }
      }
    }
  }
  console.log(`[battery] complete: ${ran} new probes persisted · cumulative spend $${readCumulativeSpend().toFixed(4)}`);
}

export function loadProbeRecords(): ProbeRecord[] {
  assertPreregistered(); // every read path is guarded
  if (!existsSync(PROBE_FILE)) return [];
  return readFileSync(PROBE_FILE, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as ProbeRecord);
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("agentic-test/probe-battery.ts");
if (isMain) {
  runProbeBattery().catch((err) => {
    console.error(`[battery] FAILED: ${(err as Error).message}`);
    process.exit(1);
  });
}
