import { generateIntentCohort } from "./intents.js";
import { createBenchmark, type BenchmarkConfig } from "../db/benchmarks.js";
import { executeBenchmark, type ExecuteResult } from "./execute.js";

// Self-serve benchmark for a connected shop (Phase 12). Builds a deterministic
// shopper-intent cohort from the merchant's brand/category/competitors, creates a
// versioned benchmark, and runs it. MOCK by default ($0); a live run spends money
// (reserved up front + capped) and must be explicitly opted into + cost-confirmed.

export interface ShopBenchmarkInput {
  brand: string;
  category: string;
  competitors: string[];
  priceRange?: string;
  persona?: string;
  attribute?: string;
  mock?: boolean;
  /** Cap prompt count to bound cost (1–30). */
  maxPrompts?: number;
}

export interface ShopBenchmarkResult extends ExecuteResult {
  benchmarkId: number;
  promptCount: number;
}

export async function runShopBenchmark(shop: string, input: ShopBenchmarkInput): Promise<ShopBenchmarkResult> {
  const brand = input.brand.trim();
  const category = input.category.trim();
  if (!brand || !category) throw new Error("brand and category are required");
  const competitors = [...new Set(input.competitors.map((c) => c.trim()).filter(Boolean))].slice(0, 10);

  const cap = Math.max(1, Math.min(input.maxPrompts ?? 12, 30));
  const cohort = generateIntentCohort({ category, competitors, persona: input.persona, priceRange: input.priceRange, attribute: input.attribute });
  const prompts = cohort.slice(0, cap).map((c) => ({ intent: c.intent, text: c.text }));

  const config: BenchmarkConfig = {
    brand: { name: brand },
    category,
    competitors: competitors.map((name) => ({ name })),
    prompts,
    engines: ["openai", "gemini", "perplexity"],
    repetitions: 1,
  };
  const benchmarkId = await createBenchmark(shop, `${brand} — AI visibility`, "monitoring", config);
  const result = await executeBenchmark(benchmarkId, { mock: input.mock ?? true });
  return { benchmarkId, promptCount: prompts.length, ...result };
}
