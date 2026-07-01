import type { Config, PromptEngineResult } from "../types.js";
import type { ProofPoint } from "./types.js";
import { detOf, detScore, grounded, uniq } from "./util.js";

// ---------------------------------------------------------------------------
// Deterministic proof-point taxonomy. We scan the responses where a competitor
// out-ranks the brand and tally WHY those competitors tend to win — the concrete,
// quotable reasons an AI cites, captured with the real snippet as evidence.
//
// The taxonomy is CATEGORY-AGNOSTIC on purpose (this runs for fashion, supplements,
// furniture, cookware, anything). It NEVER assumes a vertical — the specificity comes
// from the real quoted snippet + the actual competitor + the actual lost prompt, not
// from a hardcoded spec list. (The old taxonomy was cookware-only and told a handbag
// brand to expose its "oven-safe temperature".) Purely keyword-driven, no LLM; an
// optional LLM pass can refine the categorization later behind a flag.
// ---------------------------------------------------------------------------

interface ProofDef {
  id: string;
  label: string;
  re: RegExp;
}

// Cross-vertical reasons an assistant cites for picking one brand over another. Labels
// stay neutral so they read correctly in any category; the regexes catch the concrete
// wording ("Saffiano leather", "third-party tested", "lasts for years") across verticals.
export const PROOF_DEFS: ProofDef[] = [
  { id: "editorial_press", label: "Editorial & press coverage", re: /(vogue|elle|harper'?s|gq|wirecutter|consumer reports|good housekeeping|the strategist|forbes|reviewed by|editor'?s? (pick|choice)|magazine|featured in|praised by|critics?|customer reviews|thousands of reviews)/i },
  { id: "awards_recognition", label: "Awards & recognition", re: /(award[- ]winning|\baward\b|best[- ]of|top[- ]?(pick|rated)|voted (the )?best|highly rated|acclaimed|iconic|renowned)/i },
  { id: "third_party_testing", label: "Third-party testing / certification", re: /(third[- ]party (test|lab)|independent(ly)? test|lab[- ]tested|clinically (tested|proven|dosed)|nsf certified|gmp|usda organic|\bcertified\b|dermatologist[- ]tested)/i },
  { id: "materials_craft", label: "Materials & craftsmanship", re: /(premium material|high[- ]quality material|full[- ]grain|top[- ]grain|leather|suede|silk|cashmere|merino|\bwool\b|organic cotton|solid (wood|oak|walnut|maple)|hardwood|stainless steel|craftsmanship|hand[- ](made|crafted|stitched|finished)|well[- ]made|quality construction)/i },
  { id: "ingredients_formulation", label: "Ingredients & formulation", re: /(ingredient|formula|active (ingredient|compound)|dosage|potency|clean label|no (artificial|added|fillers)|sugar[- ]free|bioavailab|clinically effective)/i },
  { id: "durability", label: "Durability & longevity", re: /(durab|long[- ]lasting|lasts (for )?years|built to last|sturdy|hard[- ]wearing|scratch[- ]resistant|holds up|won'?t (warp|sag|fade))/i },
  { id: "price_value", label: "Price & value", re: /(great value|best value|affordable|budget[- ]friendly|worth (the|every) (money|penny|price)|cost[- ]effective|reasonably priced|bang for)/i },
  { id: "heritage_reputation", label: "Heritage & reputation", re: /(heritage|since \d{4}|founded in \d{4}|established \d{4}|decades of|legacy|storied|trusted (brand|name)|reputation for|household name)/i },
  { id: "selection_range", label: "Selection & range", re: /(wide (range|selection|variety|array)|range of (styles|sizes|colou?rs|options|flavou?rs)|many (options|styles|choices)|extensive (line|collection)|customizable|made[- ]to[- ]order)/i },
  { id: "sustainability", label: "Sustainability & ethics", re: /(sustainab|ethical(ly)?|eco[- ]friendly|organic|responsibly (made|sourced)|carbon[- ]neutral|recycled|fair[- ]trade|cruelty[- ]free|\bvegan\b)/i },
  { id: "warranty_returns", label: "Warranty, guarantee & returns", re: /(warranty|guarantee|money[- ]back|free returns|lifetime (guarantee|warranty)|trial period|risk[- ]free)/i },
  { id: "design_style", label: "Design & style", re: /(timeless|elegant|stylish|sleek|refined aesthetic|signature (look|silhouette|design|style)|design[- ]forward|beautifully designed|versatile (style|look))/i },
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
