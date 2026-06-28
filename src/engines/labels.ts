// Display labels for engine ADAPTER names (internal provider IDs → the consumer product
// names a merchant recognizes). Single source of truth so the dashboard, the offline
// analysis, and reports never show a raw slug like "openai" in customer-facing copy.
export const ENGINE_LABELS: Record<string, string> = {
  openai: "ChatGPT",
  gemini: "Gemini",
  perplexity: "Perplexity",
  anthropic: "Claude",
};

export const engineLabel = (e: string): string => ENGINE_LABELS[e] ?? e;
