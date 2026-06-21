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
  attribute?: string; // e.g. "non-toxic", "induction-compatible"
  occasion?: string; // e.g. "wedding", "housewarming"
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
  const occasion = clean(input.occasion) ?? "a wedding";

  const out: IntentPrompt[] = [];
  const add = (intent: IntentType, text: string) => out.push({ intent, text });

  add("category_discovery", `What are the best ${cat} brands right now?`);
  add("best_for_use_case", `What is the best ${cat} for ${useCase}?`);
  if (comp[0]) add("comparison", `How does ${comp[0]} compare to other ${cat} for ${useCase}?`);
  else add("comparison", `Which ${cat} brands are most often compared, and how do they differ?`);
  add("constraint_attribute", attr ? `What is the best ${attr} ${cat}?` : `What ${cat} has the best build quality and materials?`);
  add("price_value", price ? `What is the best ${cat} ${price}?` : `What is the best value-for-money ${cat}?`);
  add("problem_solution", `What ${cat} should I buy if I'm replacing a worn-out or low-quality one?`);
  if (persona) add("persona", `What ${cat} would you recommend for ${persona}?`);
  else add("persona", `What ${cat} is best for a first-time buyer?`);
  add("compatibility", `What ${cat} works best with a typical modern kitchen setup?`);
  add("gift_occasion", `What ${cat} makes a good gift for ${occasion}?`);
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
