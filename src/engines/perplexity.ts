import type { EngineResult } from "../types.js";
import type { EngineAdapter } from "./types.js";
import { MAX_OUTPUT_TOKENS, MODELS, estimateCostUsd } from "./models.js";
import { SHOPPING_SYSTEM_PROMPT, postJson } from "./http.js";

const URL = "https://api.perplexity.ai/chat/completions";

/**
 * Perplexity adapter (sonar). OpenAI-compatible chat completions API; sonar is
 * web-grounded by default — its live search is exactly what matters for shopping
 * queries, so we always report web_grounded.
 */
export function createPerplexityAdapter(apiKey: string | undefined): EngineAdapter {
  const model = MODELS.perplexity;

  return {
    name: "perplexity",
    model,
    preferredGrounding: "web_grounded",
    isConfigured: () => Boolean(apiKey),

    async generate(prompt, signal): Promise<EngineResult> {
      const json = await postJson<PerplexityPayload>({
        url: URL,
        headers: { authorization: `Bearer ${apiKey}` },
        signal,
        body: {
          model,
          messages: [
            { role: "system", content: SHOPPING_SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
          max_tokens: MAX_OUTPUT_TOKENS,
        },
      });

      const text = json.choices?.[0]?.message?.content ?? "";
      const inputTokens = json.usage?.prompt_tokens;
      const outputTokens = json.usage?.completion_tokens;
      return {
        engine: "perplexity",
        model,
        text,
        groundingMode: "web_grounded",
        usage: {
          inputTokens,
          outputTokens,
          costUsd: estimateCostUsd(model, inputTokens ?? 0, outputTokens ?? 0),
        },
        raw: json,
      };
    },
  };
}

interface PerplexityPayload {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}
