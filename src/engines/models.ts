// ---------------------------------------------------------------------------
// Model names and pricing live here so they're trivial to change in one place.
// Prices are USD per 1,000,000 tokens. Update as providers change pricing —
// these are estimates used only for the cost summary, not billing.
// ---------------------------------------------------------------------------

export const MODELS = {
  // gpt-5.4-mini: a CURRENT, web_search-capable model (gpt-4o is now deprecated/off OpenAI's
  // pricing page). ~half the per-call cost of gpt-4o and fresher for the "ChatGPT" claim.
  openai: "gpt-5.4-mini",
  gemini: "gemini-2.5-flash",
  perplexity: "sonar",
  // Reserved for later adapters:
  anthropic: "claude-opus-4-8",
} as const;

export interface ModelPrice {
  inputPerM: number;
  outputPerM: number;
  /** Approximate FIXED per-call fee (web-search / grounding request charge) that token
   *  pricing doesn't capture. Conservative, approximate estimates — used only to keep
   *  worst-case spend ESTIMATES/RESERVATIONS from running too low (grounded shopping
   *  queries are exactly where search fees bite). Refine when exact metadata is known. */
  fixedPerCallUsd?: number;
}

/** Approximate public pricing (USD / 1M tokens). Keep in sync with MODELS. */
export const PRICING: Record<string, ModelPrice> = {
  // OpenAI web_search bills a ~$0.01/call tool fee PLUS the retrieved search content as ~8k
  // input tokens at the model's input rate — so fixedPerCallUsd ≈ 0.01 + 8000·inputPerM/1e6.
  // gpt-5.4-mini: 0.01 + 8000·0.75/1e6 ≈ 0.016.
  "gpt-5.4-mini": { inputPerM: 0.75, outputPerM: 4.5, fixedPerCallUsd: 0.016 },
  "gpt-4o": { inputPerM: 2.5, outputPerM: 10, fixedPerCallUsd: 0.03 }, // legacy (deprecated by OpenAI)
  "gemini-2.5-flash": { inputPerM: 0.3, outputPerM: 2.5, fixedPerCallUsd: 0.01 },
  // Perplexity sonar also bills per-request for web search; tokens are the bulk.
  sonar: { inputPerM: 1, outputPerM: 1, fixedPerCallUsd: 0.005 },
  "claude-opus-4-8": { inputPerM: 5, outputPerM: 25 },
  mock: { inputPerM: 0, outputPerM: 0 },
};

/** Approximate fixed per-call fee (grounded-search/request charge), 0 if none/mock. */
export function fixedCostPerCall(model: string): number {
  return PRICING[model]?.fixedPerCallUsd ?? 0;
}

/** Max output tokens we request per call — also drives worst-case cost estimate. */
export const MAX_OUTPUT_TOKENS = 700;

/** Rough input-token estimate for a prompt when we must guess before sending. */
export const ASSUMED_INPUT_TOKENS = 60;

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const price = PRICING[model] ?? { inputPerM: 0, outputPerM: 0 };
  return (
    (inputTokens / 1_000_000) * price.inputPerM +
    (outputTokens / 1_000_000) * price.outputPerM
  );
}

/** Worst-case cost of ONE call: max-output token cost PLUS the fixed search/request fee.
 *  THE single source of truth for per-call cost — estimateMaxCost and the public /api/config
 *  scan quote both use it, so the client's displayed estimate can't drift from the backend's
 *  reservation (the old token-only client constant under-counted ~4.6× by omitting the fee). */
export function perCallMaxCostUsd(model: string): number {
  return estimateCostUsd(model, ASSUMED_INPUT_TOKENS, MAX_OUTPUT_TOKENS) + fixedCostPerCall(model);
}
