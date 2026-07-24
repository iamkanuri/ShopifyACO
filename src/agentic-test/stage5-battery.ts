import "dotenv/config";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ENV } from "../server/env.js";
import { createOpenAIAdapter } from "../engines/openai.js";
import { createGeminiAdapter } from "../engines/gemini.js";
import { createPerplexityAdapter } from "../engines/perplexity.js";
import { HttpError } from "../engines/http.js";
import type { EngineAdapter } from "../engines/types.js";
import { addSpend, readCumulativeSpend } from "./trace-recorder.js";

// ===========================================================================
// STAGE 5 category battery (spec 4.1). Reuses the existing engine adapters
// (raw fetch, existing keys) with a 10-prompt buyer-intent set for ONE
// category. Output is GITIGNORED — responses name real stores. No
// pre-registration guard (Stage 5 has no A/B contamination-control arm); the
// $25 breaker still applies via addSpend.
// ===========================================================================

export const STAGE5_BATTERY_FILE = join(process.cwd(), "experiments", "stage5", "out", "battery.jsonl");
export const STAGE5_BATTERY_REPEATS = 3;
export const STAGE5_CATEGORY = "deodorant";
/** Deterministic product-selection keywords for this category (public-catalog scoring). */
export const STAGE5_CATEGORY_KEYWORDS = ["deodorant", "natural deodorant", "aluminum-free", "aluminum free", "antiperspirant"];

/** 10 buyer-intent prompts with hard, verifiable constraints. */
export const STAGE5_PROMPTS: Array<{ id: string; text: string }> = [
  { id: "d1", text: "What's the best aluminum-free natural deodorant under $20? I want a one-time purchase, no subscription." },
  { id: "d2", text: "Recommend a natural deodorant without baking soda for sensitive skin, from a store that ships in the US within a week." },
  { id: "d3", text: "Best unscented aluminum-free deodorant I can buy online for under $18?" },
  { id: "d4", text: "I want a vegan, cruelty-free natural deodorant that actually lasts 24 hours. Which brands should I look at?" },
  { id: "d5", text: "Which natural deodorant brands offer a travel size under $12 with no auto-renew subscription?" },
  { id: "d6", text: "Aluminum-free deodorant for men that doesn't stain shirts — where should I buy it?" },
  { id: "d7", text: "Best baking-soda-free deodorant for people who get irritation, available as a one-time purchase?" },
  { id: "d8", text: "I need a plastic-free / low-waste natural deodorant under $15. Recommendations with a link to buy?" },
  { id: "d9", text: "What natural deodorant do dermatologists or reviewers recommend that's aluminum-free and paraben-free?" },
  { id: "d10", text: "Recommend a small-batch or indie natural deodorant brand that ships fast and offers free returns." },
];

export interface Stage5ProbeRecord {
  batchTag: "stage5";
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

export async function runStage5Battery(): Promise<void> {
  const adapters = channels();
  if (adapters.length < 2) throw new Error(`fewer than two probe channels configured (${adapters.length})`);
  mkdirSync(join(STAGE5_BATTERY_FILE, ".."), { recursive: true });

  const done = new Set<string>();
  if (existsSync(STAGE5_BATTERY_FILE)) {
    for (const line of readFileSync(STAGE5_BATTERY_FILE, "utf8").trim().split("\n")) {
      if (!line) continue;
      const r = JSON.parse(line) as Stage5ProbeRecord;
      done.add(`${r.channel}|${r.promptId}|${r.repeat}`);
    }
  }

  let ran = 0;
  for (const prompt of STAGE5_PROMPTS) {
    for (const adapter of adapters) {
      for (let repeat = 1; repeat <= STAGE5_BATTERY_REPEATS; repeat++) {
        if (done.has(`${adapter.name}|${prompt.id}|${repeat}`)) continue;
        let attempt = 0;
        for (;;) {
          attempt++;
          try {
            const res = await adapter.generate(prompt.text);
            const record: Stage5ProbeRecord = {
              batchTag: "stage5",
              channel: adapter.name,
              model: res.model,
              promptId: prompt.id,
              category: STAGE5_CATEGORY,
              repeat,
              promptText: prompt.text,
              responseText: res.text,
              citations: res.citations ?? [],
              groundingMode: res.groundingMode,
              usage: { inputTokens: res.usage?.inputTokens, outputTokens: res.usage?.outputTokens },
              costUsd: res.usage?.costUsd ?? 0,
              timestamp: new Date().toISOString(),
            };
            appendFileSync(STAGE5_BATTERY_FILE, `${JSON.stringify(record)}\n`, "utf8");
            addSpend(record.costUsd);
            ran++;
            console.log(`[s5-battery] ${adapter.name} ${prompt.id} r${repeat} → ${res.text.length} chars, ${(res.citations ?? []).length} citations, $${record.costUsd.toFixed(4)}`);
            break;
          } catch (err) {
            const retryable = err instanceof HttpError ? err.retryable : true;
            if (!retryable || attempt >= 3) {
              console.warn(`[s5-battery] ${adapter.name} ${prompt.id} r${repeat} FAILED: ${(err as Error).message.slice(0, 100)}`);
              break;
            }
            await sleep(2000 * attempt);
          }
        }
      }
    }
  }
  console.log(`[s5-battery] complete: ${ran} new probes · cumulative spend $${readCumulativeSpend().toFixed(4)}`);
}

export function loadStage5Battery(): Stage5ProbeRecord[] {
  if (!existsSync(STAGE5_BATTERY_FILE)) return [];
  return readFileSync(STAGE5_BATTERY_FILE, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Stage5ProbeRecord);
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("agentic-test/stage5-battery.ts");
if (isMain) {
  runStage5Battery().catch((err) => {
    console.error(`[s5-battery] FAILED: ${(err as Error).message}`);
    process.exit(1);
  });
}
