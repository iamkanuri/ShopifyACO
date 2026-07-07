import type { Config, PromptEngineResult } from "../types.js";
import type { MerchantAnalysis } from "./types.js";
import { nameableRivals } from "./nameableRivals.js";
import { selectSubstitutionFrame, type SubstitutionFrame, type FrameRival } from "./substitutionFrame.js";

// ===========================================================================
// Orchestration glue for the substitution frame. Kept OUT of the pure analyzeRun (same as
// discoveredBrands) because the frame is strongest with the LLM-discovered rivals, which are computed
// by the scan orchestration — not by the offline analyzer. This helper is itself pure (no I/O, no LLM):
// it re-verifies each rival's recommendation via the detector (nameableRivals) and picks the frame.
//
// The single builder for ALL surfaces (writeReports → public /report + report.md; paid/generate) so the
// frame can never diverge between them. Given the same run + discovered list, it returns the same frame.
// ===========================================================================

/** Compute the substitution frame for a completed run. `discoveredNames` are the unlisted brands the
 *  orchestration's LLM pass surfaced (may be empty — the offline analyze path passes none, and the
 *  frame still works from configured competitors). Uses the merchant's own recommendation count and
 *  visibility score straight off the analysis, so the frame's numbers match the rest of the report. */
export function buildSubstitutionFrame(
  analysis: Pick<MerchantAnalysis, "mentionGap" | "visibilityScore">,
  results: PromptEngineResult[],
  cfg: Config,
  discoveredNames: string[] = [],
): SubstitutionFrame {
  const nr = nameableRivals(results, cfg, discoveredNames);
  const rivals: FrameRival[] = nr.nameable.map((r) => ({ name: r.name, recCount: r.recCount, source: r.source }));
  const rec = analysis.mentionGap.recommendation;
  return selectSubstitutionFrame({
    brand: cfg.brand.name,
    category: cfg.category,
    merchantRec: { count: rec.count, total: rec.total },
    nameableRivals: rivals,
    score: analysis.visibilityScore.score,
  });
}
