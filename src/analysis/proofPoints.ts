import type { Config, PromptEngineResult } from "../types.js";
import type { ProofPoint } from "./types.js";
import { detOf, detScore, grounded, uniq } from "./util.js";

// ---------------------------------------------------------------------------
// Deterministic proof-point taxonomy. We scan the responses where a competitor
// out-ranks the brand and tally WHY those competitors tend to win — the concrete,
// quotable reasons an AI cites. Purely keyword-driven (no LLM); an optional LLM
// pass can refine this later behind a flag.
// ---------------------------------------------------------------------------

interface ProofDef {
  id: string;
  label: string;
  re: RegExp;
}

export const PROOF_DEFS: ProofDef[] = [
  { id: "third_party_testing", label: "Third-party testing / lab results", re: /(test kitchen|america'?s test kitchen|consumer reports|wirecutter|good housekeeping|serious eats|lab[- ]tested|independent(ly)? test)/i },
  { id: "named_reviews", label: "Named editorial reviews", re: /(wirecutter|consumer reports|good housekeeping|america'?s test kitchen|serious eats|the spruce|editor'?s pick|named .* the best)/i },
  { id: "durability", label: "Durability / longevity", re: /(durab|long[- ]lasting|lasts (for )?years|scratch[- ]resistant|hard[- ]anodized|won'?t warp|built to last)/i },
  { id: "induction", label: "Induction compatibility", re: /induction/i },
  { id: "oven_safe", label: "Oven-safe temperature", re: /(oven[- ]safe|\d{3}\s?°?\s?f|\d{3}\s?degrees|broiler[- ]safe|high[- ]heat)/i },
  { id: "price_value", label: "Price / value", re: /(great value|best value|affordable|budget[- ]friendly|worth the (money|price)|cost[- ]effective)/i },
  { id: "warranty", label: "Warranty / guarantee", re: /(warranty|lifetime guarantee|guaranteed for life|money[- ]back)/i },
  { id: "non_toxic_claims", label: "Non-toxic material claims", re: /(pfas[- ]free|ptfe[- ]free|pfoa[- ]free|free of (lead|cadmium)|non[- ]toxic|free from .* chemicals)/i },
  { id: "materials", label: "Premium materials (steel/clad)", re: /(stainless steel|tri[- ]ply|5[- ]ply|fully clad|carbon steel|cast iron|aluminum core)/i },
  { id: "product_line", label: "Signature product line", re: /(valencia pro|always pan|d3|d5|d7|stainless clad|professional clad|original pan)/i },
  { id: "dishwasher_safe", label: "Dishwasher safe", re: /dishwasher[- ]safe/i },
];

/** Extract competitor proof points from the responses where a competitor beats us. */
export function extractProofPoints(results: PromptEngineResult[], cfg: Config): ProofPoint[] {
  const ok = grounded(results);
  const acc = new Map<string, { hits: number; competitors: Set<string>; prompt?: string; snippet?: string }>();

  for (const r of ok) {
    const ownScore = detScore(detOf(r, cfg.brand.name));
    // Winning competitors in this response (out-ranking the brand).
    const winners = cfg.competitors
      .map((c) => detOf(r, c.name))
      .filter((d): d is NonNullable<typeof d> => !!d && d.mentioned && detScore(d) > ownScore);
    if (winners.length === 0) continue;

    // Scan the full answer text (falling back to winner snippets for old fixtures
    // that predate the stored `text` field).
    const haystack = r.text && r.text.length > 0 ? r.text : winners.map((w) => w.snippet ?? "").join(" \n ");

    for (const def of PROOF_DEFS) {
      if (!def.re.test(haystack)) continue;
      const entry = acc.get(def.id) ?? { hits: 0, competitors: new Set<string>() };
      entry.hits += 1;
      winners.forEach((w) => entry.competitors.add(w.name));
      if (!entry.snippet) {
        const m = def.re.exec(haystack);
        if (m) {
          const start = Math.max(0, m.index - 70);
          entry.snippet = (start > 0 ? "…" : "") + haystack.slice(start, m.index + m[0].length + 70).replace(/\s+/g, " ").trim() + "…";
        }
        entry.prompt = r.prompt;
      }
      acc.set(def.id, entry);
    }
  }

  return PROOF_DEFS.filter((d) => acc.has(d.id))
    .map((d) => {
      const e = acc.get(d.id)!;
      return {
        id: d.id,
        label: d.label,
        hits: e.hits,
        competitors: uniq([...e.competitors]),
        examplePrompt: e.prompt,
        exampleSnippet: e.snippet,
      };
    })
    .sort((a, b) => b.hits - a.hits);
}
