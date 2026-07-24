import { join } from "node:path";
import type { ShoppingTaskContract } from "../types.js";
import {
  STAGE5_PROMPTS, STAGE5_CATEGORY_KEYWORDS, STAGE5_BATTERY_FILE, STAGE5_BATTERY_REPEATS, STAGE5_CATEGORY,
} from "../stage5-battery.js";
import { deodorantAluminumFreeContract } from "./deodorant/contracts.js";
import { coffeeFreshSingleOriginContract, COFFEE_PROMPTS, COFFEE_CATEGORY_KEYWORDS, COFFEE_BRAND_STOPWORDS } from "./coffee/contracts.js";

// ===========================================================================
// STAGE 6.2 — Category descriptor registry. Everything that varies BY CATEGORY
// in the Stage 5 pipeline (prompts, product-selection keywords, the flagship
// contract, brand-extraction stopwords, and the output/cache/battery paths)
// lives here so ONE parameterized pipeline serves deodorant AND coffee. The
// deodorant descriptor points at the exact Stage 5 constants + paths, so the
// deodorant run is byte-identical to before this refactor.
// ===========================================================================

export interface CategoryDescriptor {
  /** Stable key (also the battery record `category`). */
  key: string;
  label: string;
  prompts: Array<{ id: string; text: string }>;
  batteryRepeats: number;
  categoryKeywords: string[];
  /** The flagship contract this category diagnoses against. */
  contract: ShoppingTaskContract;
  /** Category-generic words dropped from brand extraction (empty for deodorant —
   *  its terms already live in the compiler's base stopword set). */
  extraBrandStopwords: string[];
  /** Gitignored output roots (real store names live here). */
  outDir: string;
  cacheDir: string;
  batteryFile: string;
}

const STAGE6_OUT = join(process.cwd(), "experiments", "stage6", "out");

export const DEODORANT_CATEGORY: CategoryDescriptor = {
  key: STAGE5_CATEGORY, // "deodorant"
  label: "natural deodorant",
  prompts: STAGE5_PROMPTS,
  batteryRepeats: STAGE5_BATTERY_REPEATS,
  categoryKeywords: STAGE5_CATEGORY_KEYWORDS,
  contract: deodorantAluminumFreeContract,
  extraBrandStopwords: [],
  outDir: join(process.cwd(), "experiments", "stage5", "out"),
  cacheDir: join(process.cwd(), "experiments", "stage5", "cache"),
  batteryFile: STAGE5_BATTERY_FILE,
};

export const COFFEE_CATEGORY: CategoryDescriptor = {
  key: "coffee",
  label: "coffee",
  prompts: COFFEE_PROMPTS,
  batteryRepeats: STAGE5_BATTERY_REPEATS,
  categoryKeywords: COFFEE_CATEGORY_KEYWORDS,
  contract: coffeeFreshSingleOriginContract,
  extraBrandStopwords: COFFEE_BRAND_STOPWORDS,
  outDir: join(STAGE6_OUT, "coffee"),
  cacheDir: join(process.cwd(), "experiments", "stage6", "cache"),
  batteryFile: join(STAGE6_OUT, "coffee", "battery.jsonl"),
};

export const CATEGORIES: Record<string, CategoryDescriptor> = {
  deodorant: DEODORANT_CATEGORY,
  coffee: COFFEE_CATEGORY,
};

export function categoryByKey(key: string): CategoryDescriptor {
  const c = CATEGORIES[key];
  if (!c) throw new Error(`unknown category '${key}' (have: ${Object.keys(CATEGORIES).join(", ")})`);
  return c;
}
