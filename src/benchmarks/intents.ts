// Shopper-intent prompt cohort generation (Phase 4). Deterministic templates across
// the full intent taxonomy, auto-filled from benchmark inputs. Merchants can later
// edit/approve/lock these; an optional AI pass can add more (gated, costs money).

export type IntentType =
  | "category_discovery"
  | "best_for_use_case"
  | "comparison"
  | "constraint_attribute"
  | "price_value"
  | "problem_solution"
  | "persona"
  | "compatibility"
  | "gift_occasion"
  | "alternatives";

export interface IntentPrompt {
  intent: IntentType;
  text: string;
}

export interface IntentInput {
  category: string;
  competitors?: string[];
  persona?: string;
  priceRange?: string;
  useCase?: string;
  attribute?: string; // a category-relevant qualifier, e.g. "waterproof", "organic", "handmade"
  occasion?: string; // when set, drives a gift-occasion prompt, e.g. "a wedding", "the holidays"
}

const clean = (s?: string) => (s && s.trim() ? s.trim() : undefined);

/** Generate a deterministic, deduped intent cohort from the inputs. */
export function generateIntentCohort(input: IntentInput): IntentPrompt[] {
  const cat = input.category.trim();
  const comp = (input.competitors ?? []).map((c) => c.trim()).filter(Boolean);
  const persona = clean(input.persona);
  const price = clean(input.priceRange);
  const useCase = clean(input.useCase) ?? "everyday use";
  const attr = clean(input.attribute);
  const occasion = clean(input.occasion); // no hardcoded default — a specific gift occasion is category-dependent

  const out: IntentPrompt[] = [];
  const add = (intent: IntentType, text: string) => out.push({ intent, text });

  add("category_discovery", `What are the best ${cat} brands right now?`);
  add("best_for_use_case", `What is the best ${cat} for ${useCase}?`);
  if (comp[0]) add("comparison", `How does ${comp[0]} compare to other ${cat} for ${useCase}?`);
  else add("comparison", `Which ${cat} brands are most often compared, and how do they differ?`);
  // Authority (default): "who do experts recommend" measures a DISTINCT facet (editorial/expert
  // endorsement — the very thing that made GreenPan out-recommend Caraway) instead of collapsing
  // into category_discovery's "best brands". With a merchant attribute it stays a qualified query.
  add("constraint_attribute", attr ? `What is the best ${attr} ${cat}?` : `What ${cat} do experts recommend?`);
  add("price_value", price ? `What is the best ${cat} ${price}?` : `What is the best value-for-money ${cat}?`);
  // Switching intent: "disappointed by cheaper options" works for anything — the old "replacing a
  // worn-out one" assumed a durable that wears out (wrong for consumables, which are used up).
  add("problem_solution", `What ${cat} should I buy if I've been disappointed by cheaper options?`);
  if (persona) add("persona", `What ${cat} would you recommend for ${persona}?`);
  else add("persona", `What ${cat} is best for a first-time buyer?`);
  // Contextual fit — "complements what you already have" keeps the distinct COMPATIBILITY signal
  // (fit with the shopper's existing things) while reading naturally for any vertical. NOT a
  // hardcoded "kitchen setup", and NOT collapsed to a generic "best for me" (which would duplicate
  // category_discovery). "have" is universal — a wardrobe, a room, a routine, a supplement regimen.
  add("compatibility", `What ${cat} best complements what you already have?`);
  add("gift_occasion", occasion ? `What ${cat} makes a good gift for ${occasion}?` : `What ${cat} makes a good gift?`);
  if (comp[0]) add("alternatives", `What are good alternatives to ${comp[0]} for ${cat}?`);
  else add("alternatives", `What are good alternatives to the most popular ${cat} brand?`);

  // Dedupe by text (case-insensitive), preserve order.
  const seen = new Set<string>();
  return out.filter((p) => {
    const k = p.text.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const ALL_INTENT_TYPES: IntentType[] = [
  "category_discovery", "best_for_use_case", "comparison", "constraint_attribute",
  "price_value", "problem_solution", "persona", "compatibility", "gift_occasion", "alternatives",
];
