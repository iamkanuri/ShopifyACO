import type { Confidence, ConfidenceTier, RunSize } from "./types.js";

// ---------------------------------------------------------------------------
// Statistical confidence guardrails. AI answers vary run-to-run, so every major
// insight is LABELED (never removed) with a tier derived from the sample size it
// rests on. We never present a thin-sample number as settled fact.
// ---------------------------------------------------------------------------

const LABELS: Record<ConfidenceTier, string> = {
  high: "Strong signal",
  medium: "Moderate signal",
  directional: "Directional signal — run a larger scan to confirm.",
};

/** Confidence tier from the number of grounded answers an insight is based on. */
export function confidenceFor(n: number): Confidence {
  const tier: ConfidenceTier = n >= 30 ? "high" : n >= 12 ? "medium" : "directional";
  return { tier, label: LABELS[tier], basedOnResponses: n };
}

/** Overall run size badge from total grounded answers. */
export function runSizeFor(n: number): RunSize {
  if (n >= 75) return "deep";
  if (n >= 30) return "standard";
  return "mini";
}

export const RUN_SIZE_LABEL: Record<RunSize, string> = {
  mini: "Mini scan",
  standard: "Standard scan",
  deep: "Deep scan",
};
