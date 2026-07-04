// ---------------------------------------------------------------------------
// Done-for-you fix ARTIFACTS (paid-report Phase 2). The $29 delta over the free
// diagnosis: not "here's what to write" but the WRITTEN THING — a drafted comparison
// page, a buying guide, an llms.txt, and Product JSON-LD — each grounded in THIS scan's
// real category, lost prompts, and competitor evidence.
//
// NON-NEGOTIABLE (mirrors the report's "verify before publishing" ethos): we NEVER
// fabricate facts about the merchant's own products. Anything store-specific the model
// can't know is a clearly-marked [PLACEHOLDER] the merchant fills in. Competitor claims
// reflect only the captured AI-answer evidence.
// ---------------------------------------------------------------------------

export type ArtifactKind = "comparison_page" | "buying_guide" | "llms_txt" | "product_schema";
export type ArtifactFormat = "markdown" | "text" | "json";

export interface Artifact {
  id: string;
  kind: ArtifactKind;
  title: string;
  format: ArtifactFormat;
  filename: string;
  body: string;
  /** [PLACEHOLDER] tokens the merchant must fill (we never invent store-specific facts). */
  placeholders: string[];
  /** Whether this was LLM-drafted (live) or a deterministic structural draft (mock/offline). */
  drafted: "llm" | "template";
  /** Provenance tags present in the body — "(fact Fn — crawled …)", "(AI answer, this scan)",
   *  "(you provide)". Parallel to `placeholders` so the viewer can render source counts (tier 2a). */
  provenance: string[];
  groundedIn?: { prompts?: string[]; competitor?: string };
}

export interface ArtifactBundle {
  artifacts: Artifact[];
  /** The recurring-product bridge that must close the paid bundle (one-time report = on-ramp,
   *  the AisleLens app = the recurring product that applies + monitors these fixes). */
  bridge: string;
  costUsd: number;
  /** How many sourced facts the store crawl produced (tier 2a). 0 → the merchant side is all
   *  templates (no store URL, or nothing crawlable) → the viewer shows the honest "fill-in" note.
   *  >0 → real prices/ratings/claims were read from the live store. */
  sourcedFacts: number;
}
