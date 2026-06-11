import type { BrandConfig, EngineResult, GroundingMode } from "../types.js";
import type { EngineAdapter } from "./types.js";
import { estimateCostUsd } from "./models.js";

/**
 * Deterministic fake engine for --mock. Zero API spend. Crafts answers that
 * exercise EVERY downstream code path:
 *   - brand recommended at #1 in a list
 *   - competitors beating the brand in a list
 *   - brand entirely absent
 *   - brand referenced only via its store URL/domain
 *   - explicit "I recommend" prose
 * Plus per-engine quirks: one engine (gemini) deterministically throws to prove
 * graceful per-engine failure, and openai reports api_model_only to exercise the
 * "ungrounded engine" warning.
 */
export function createMockAdapter(
  name: string,
  brand: BrandConfig,
  competitors: BrandConfig[],
): EngineAdapter {
  const model = `mock-${name}`;
  // Per-engine scenario offset so share-of-voice differs across engines.
  const offset = name === "perplexity" ? 2 : name === "openai" ? 0 : 1;
  const grounding: GroundingMode = name === "openai" ? "api_model_only" : "web_grounded";

  return {
    name,
    model,
    preferredGrounding: grounding,
    isConfigured: () => true,
    async generate(prompt): Promise<EngineResult> {
      // gemini always fails -> exercises per-engine graceful failure.
      if (name === "gemini") {
        throw new Error("mock gemini outage (deterministic failure path)");
      }
      const scenario = (hash(prompt) + offset) % SCENARIOS.length;
      const text = SCENARIOS[scenario]!(brand, competitors);
      const inputTokens = 40 + (prompt.length % 30);
      const outputTokens = 120 + (text.length % 80);
      return {
        engine: name,
        model,
        text,
        groundingMode: grounding,
        usage: {
          inputTokens,
          outputTokens,
          costUsd: estimateCostUsd("mock", inputTokens, outputTokens),
        },
        raw: { mock: true, scenario },
      };
    },
  };
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function domain(url?: string): string {
  if (!url) return "their website";
  return url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

type Scenario = (brand: BrandConfig, comp: BrandConfig[]) => string;

const SCENARIOS: Scenario[] = [
  // 0 — brand recommended at #1
  (b, c) =>
    `Great question! Here are the best options I'd recommend:\n` +
    `1. ${b.name} — my top pick, excellent quality and value.\n` +
    `2. ${c[0]?.name ?? "Acme"} — a solid runner-up.\n` +
    `3. ${c[1]?.name ?? "Globex"} — worth considering too.`,
  // 1 — competitors beat the brand (brand last)
  (b, c) =>
    `Based on current reviews, the leading choices are:\n` +
    `1. ${c[0]?.name ?? "Acme"} is the best choice overall.\n` +
    `2. ${c[1]?.name ?? "Globex"} is a close second.\n` +
    `3. ${b.name} is also worth a look if you find a deal.`,
  // 2 — brand absent entirely
  (b, c) =>
    `I'd recommend ${c[0]?.name ?? "Acme"}, ${c[1]?.name ?? "Globex"}, or ` +
    `${c[2]?.name ?? "Initech"}. These are the most popular and well-reviewed brands ` +
    `right now.`,
  // 3 — brand referenced only via its store URL/domain (neutral)
  (b, c) =>
    `You can find good picks at ${domain(b.storeUrl)} for a range of budgets. ` +
    `${c[0]?.name ?? "Acme"} is another popular store people mention.`,
  // 4 — explicit recommend language in prose
  (b, c) =>
    `Honestly, I'd recommend ${b.name} — it's the best choice for most shoppers. ` +
    `${c[0]?.name ?? "Acme"} is a decent alternative if you want something cheaper.`,
];
