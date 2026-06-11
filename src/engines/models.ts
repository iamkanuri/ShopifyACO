// ---------------------------------------------------------------------------
// Model names and pricing live here so they're trivial to change in one place.
// Prices are USD per 1,000,000 tokens. Update as providers change pricing —
// these are estimates used only for the cost summary, not billing.
// ---------------------------------------------------------------------------

export const MODELS = {
  openai: "gpt-4o",
  gemini: "gemini-2.5-flash",
  perplexity: "sonar",
  // Reserved for later adapters:
  anthropic: "claude-opus-4-8",
} as const;

export interface ModelPrice {
  inputPerM: number;
  outputPerM: number;
}

/** Approximate public pricing (USD / 1M tokens). Keep in sync with MODELS. */
export const PRICING: Record<string, ModelPrice> = {
  "gpt-4o": { inputPerM: 2.5, outputPerM: 10 },
  "gemini-2.5-flash": { inputPerM: 0.3, outputPerM: 2.5 },
  // Perplexity sonar also bills per-request for web search; tokens are the bulk.
  sonar: { inputPerM: 1, outputPerM: 1 },
  "claude-opus-4-8": { inputPerM: 5, outputPerM: 25 },
  mock: { inputPerM: 0, outputPerM: 0 },
};

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
