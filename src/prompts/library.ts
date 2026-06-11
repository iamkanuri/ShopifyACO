// ---------------------------------------------------------------------------
// Deterministic buyer-intent prompt library. Given a scan form, produce concrete
// search-style prompts across the buyer journey — zero API cost. This is the
// DEFAULT prompt source; the optional AI-suggest endpoint only adds to it.
// ---------------------------------------------------------------------------

export interface ScanBrand {
  name: string;
  storeUrl?: string;
  aliases?: string[];
  products?: string[];
}

export interface ScanForm {
  brand: ScanBrand;
  category: string;
  competitors: ScanBrand[];
  persona?: string;
  location?: string;
  priceRange?: string;
}

export interface GeneratedPrompt {
  category: string; // tag, e.g. "buyer_intent"
  text: string;
}

const dedupe = (ps: GeneratedPrompt[]): GeneratedPrompt[] => {
  const seen = new Set<string>();
  return ps.filter((p) => {
    const k = p.text.toLowerCase().trim();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/**
 * Build the default prompt set. Prompts are interleaved by journey stage so the
 * first N (mini scan) still cover diverse intents.
 */
export function generatePrompts(form: ScanForm): GeneratedPrompt[] {
  const cat = form.category.trim();
  const price = form.priceRange?.trim();
  const persona = form.persona?.trim();
  const location = form.location?.trim();

  const buckets: GeneratedPrompt[][] = [];

  // 1. Core buyer intent
  buckets.push([
    { category: "buyer_intent", text: `what is the best ${cat}?` },
    { category: "buyer_intent", text: `recommend a good ${cat}` },
    { category: "buyer_intent", text: `what ${cat} should I buy?` },
  ]);

  // 2. Brand discovery / comparison
  buckets.push([
    { category: "comparison", text: `best ${cat} brands right now` },
    { category: "comparison", text: `which ${cat} brand is the highest quality?` },
    { category: "comparison", text: `most recommended ${cat} brand` },
  ]);

  // 3. Budget
  const budget: GeneratedPrompt[] = [
    { category: "budget", text: `best ${cat} on a budget` },
    { category: "budget", text: `best affordable ${cat}` },
  ];
  if (price) budget.unshift({ category: "budget", text: `best ${cat} ${price}` });
  buckets.push(budget);

  // 4. Use case (persona / location)
  const useCase: GeneratedPrompt[] = [];
  if (persona) useCase.push({ category: "use_case", text: `best ${cat} for ${persona}` });
  if (location) useCase.push({ category: "use_case", text: `best ${cat} to buy in ${location}` });
  useCase.push({ category: "use_case", text: `best ${cat} for everyday use` });
  buckets.push(useCase);

  // 5. Alternatives to each competitor
  buckets.push(
    form.competitors.map((c) => ({
      category: "alternatives",
      text: `good alternatives to ${c.name}`,
    })),
  );

  // Interleave buckets round-robin for diversity in the first few prompts.
  const out: GeneratedPrompt[] = [];
  const max = Math.max(...buckets.map((b) => b.length));
  for (let i = 0; i < max; i++) {
    for (const b of buckets) if (b[i]) out.push(b[i]!);
  }
  return dedupe(out);
}

/** Mini-scan default: first N diverse prompts. */
export function miniScanPrompts(form: ScanForm, n = 5): GeneratedPrompt[] {
  return generatePrompts(form).slice(0, n);
}
