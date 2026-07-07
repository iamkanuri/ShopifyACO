import type { Config, PromptEngineResult } from "../types.js";
import { detectBrandInAnswer } from "../detection/index.js";
import { grounded } from "./util.js";

// ===========================================================================
// Nameable-rivals gate for the substitution frame. The frame's power is NAMING a specific rival
// ("AI recommends X over you"), so a rival may only be NAMED if AI genuinely RECOMMENDED it — not
// merely mentioned, contrasted ("unlike X"), or named as the reference in an "alternatives to X"
// query. That is exactly the recommendation-vs-mention distinction the score already makes at the
// MERCHANT level; here it is applied at the COMPETITOR level, using the SAME detection classifier
// (so the reference-framing fix that stopped mis-attributing "alternatives to X" applies equally to
// configured competitors AND LLM-discovered brands — a discovered brand is re-checked by the
// detector, so nothing is named unless BOTH the extractor and the classifier agree it was recommended).
//
// Pure + deterministic (no I/O, no LLM). Unit-testable.
// ===========================================================================

export interface RivalRecommendation {
  name: string;
  source: "configured" | "discovered";
  recCount: number;      // grounded answers where AI genuinely RECOMMENDED it
  mentionCount: number;  // grounded answers where it was only mentioned (not recommended)
  total: number;         // grounded answers considered
  engines: string[];     // engines that RECOMMENDED it — the cross-engine corroboration signal
  /** Raw proof of each recommendation. `reason` is the detector's basis ("explicit recommendation
   *  language" vs "top of list (rank 1)") — a rank-1 basis may be a hedged list, so it's surfaced. */
  recSnippets: Array<{ prompt: string; engine: string; snippet: string; reason: string }>;
  /** Raw context of the MENTIONS (for demoted brands — lets a human confirm it wasn't over-filtered). */
  mentionSnippets: Array<{ prompt: string; engine: string; snippet: string }>;
}

export interface NameableRivals {
  /** Genuinely RECOMMENDED rivals — the ONLY ones eligible to headline "AI recommends X over you",
   *  sorted by how often AI recommended them. `engines.length >= 2` = cross-engine corroborated. */
  nameable: RivalRecommendation[];
  /** Mentioned but NOT recommended — may surface as "also mentioned", NEVER the substitution headline. */
  mentionedOnly: RivalRecommendation[];
}

/**
 * Split a scan's rival candidates (configured competitors + LLM-discovered brands) into those AI
 * genuinely RECOMMENDED (nameable) vs merely mentioned (demoted). The nameable set is what the
 * substitution frame may name; each carries the raw answer snippets that prove the recommendation.
 */
export function nameableRivals(results: PromptEngineResult[], cfg: Config, discovered: string[] = []): NameableRivals {
  const answers = grounded(results).filter((r) => typeof r.text === "string" && r.text!.length > 0);
  const seen = new Set(cfg.competitors.map((c) => c.name.toLowerCase()));
  const candidates: Array<{ name: string; source: "configured" | "discovered" }> = [
    ...cfg.competitors.map((c) => ({ name: c.name, source: "configured" as const })),
    ...discovered.filter((d) => !seen.has(d.toLowerCase())).map((d) => ({ name: d, source: "discovered" as const })),
  ];

  const rows: RivalRecommendation[] = candidates.map(({ name, source }) => {
    let recCount = 0, mentionCount = 0;
    const engines = new Set<string>();
    const recSnippets: RivalRecommendation["recSnippets"] = [];
    const mentionSnippets: RivalRecommendation["mentionSnippets"] = [];
    for (const r of answers) {
      const d = detectBrandInAnswer(r.text!, { name });
      if (d.status === "recommended") {
        recCount += 1;
        engines.add(r.engine);
        if (recSnippets.length < 3) recSnippets.push({ prompt: r.prompt, engine: r.engine, snippet: d.snippet ?? "", reason: d.reason ?? "" });
      } else if (d.mentioned) {
        mentionCount += 1;
        if (mentionSnippets.length < 3) mentionSnippets.push({ prompt: r.prompt, engine: r.engine, snippet: d.snippet ?? "" });
      }
    }
    return { name, source, recCount, mentionCount, total: answers.length, engines: [...engines], recSnippets, mentionSnippets };
  });

  return {
    nameable: rows.filter((r) => r.recCount >= 1).sort((a, b) => b.recCount - a.recCount || b.engines.length - a.engines.length),
    mentionedOnly: rows.filter((r) => r.recCount === 0 && r.mentionCount >= 1).sort((a, b) => b.mentionCount - a.mentionCount),
  };
}
