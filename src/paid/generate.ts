import type { BrandConfig, Config, RunResults, RunMeta } from "../types.js";
import type { ApiKeys } from "../engines/index.js";
import type { ArtifactBundle } from "../artifacts/types.js";
import { buildAdapters } from "../engines/index.js";
import { expandPrompts } from "../prompts.js";
import { runScan } from "../runner.js";
import { aggregate } from "../aggregate.js";
import { analyzeRun } from "../analysis/index.js";
import { extractDiscoveredBrands } from "../analysis/discoveredBrands.js";
import { generateArtifacts } from "../artifacts/generate.js";
import { generatePrompts } from "../prompts/library.js";
import { MODELS, perCallMaxCostUsd } from "../engines/models.js";
import { reservePaidSpend, settlePaidSpend, releasePaidSpend } from "../queue/paidSpend.js";
import { ENV } from "../server/env.js";
import { crawlSeeds } from "../crawler/crawl.js";
import { discoverSeeds } from "../crawler/seeds.js";
import { buildMerchantFacts, type MerchantFacts } from "../artifacts/merchantFacts.js";

// The automated $29 deep-report generator (Phase 2). Deep scan (≈30 prompts) → analysis →
// discovered brands → done-for-you artifacts. Runs in the WORKER; mock-capable ($0) for tests.
// Spend is reserved against a SEPARATE paid cap so a busy free-scan day can't starve a payer.

const DEEP_PROMPTS = 30;

export interface GeneratePaidInput {
  runId: string;
  config: Config; // the original mini-scan config
  keys: ApiKeys;
  mock?: boolean;
}

export interface PaidReportOutput {
  report: RunResults; // deep analysis embedded
  artifacts: ArtifactBundle;
  costUsd: number;
}

/** Build a deeper config: ≈30 varied buyer-intent prompts (vs the mini's ~5) for higher confidence. */
export function deepenConfig(config: Config, n = DEEP_PROMPTS): Config {
  const generated = generatePrompts({
    brand: config.brand,
    category: config.category,
    competitors: config.competitors,
    persona: config.buyerPersona,
    location: config.location,
    priceRange: config.priceRange,
  }).map((p) => p.text);
  const merged = [...new Set([...(config.promptTemplates ?? []), ...generated])].slice(0, n);
  return { ...config, promptTemplates: merged };
}

/**
 * Tier 2a: crawl the merchant's OWN store into typed, sourced facts so the paid artifacts fill with
 * real data (prices, ratings, stated claims) instead of [YOUR DIFFERENTIATORS] placeholders. Gated
 * on `brand.storeUrl` (absent → null → the artifacts degrade to placeholders, unchanged). Best-effort
 * and NEVER throws: any discovery/crawl/build failure yields null. Mock by default (CRAWLER_MODE),
 * live only when CRAWLER_MODE=live is set on the worker. Bounded to ENV.crawler.maxPages (1 homepage
 * + ≤7 PDPs, depth 0). Runs CONCURRENT with the deep scan — never on the critical path.
 */
export async function crawlMerchantFacts(brand: BrandConfig): Promise<MerchantFacts | null> {
  const storeUrl = brand.storeUrl?.trim();
  if (!storeUrl) return null;
  try {
    const discovery = await discoverSeeds(storeUrl, Math.max(1, ENV.crawler.maxPages - 1));
    if (!discovery || discovery.seeds.length === 0) return null;
    const pages = await crawlSeeds(discovery.seeds, { maxPages: ENV.crawler.maxPages, maxDepth: 0 });
    if (!pages.some((p) => p.ok)) return null; // couldn't read the store at all → placeholders
    const facts = buildMerchantFacts(pages, brand.name, storeUrl, discovery.products);
    // Fold in non-products dropped at DISCOVERY (never crawled) so the exclusion is fully auditable.
    if (discovery.excludedNonProducts.length) {
      facts.excluded.nonProducts = [...new Set([...discovery.excludedNonProducts, ...facts.excluded.nonProducts])];
    }
    return facts;
  } catch {
    return null;
  }
}

export async function generatePaidReport(input: GeneratePaidInput): Promise<PaidReportOutput> {
  const deep = deepenConfig(input.config);
  const { adapters } = buildAdapters(deep, input.keys, input.mock ?? false);
  if (adapters.length === 0) throw new Error("paid deep scan: no engines configured (check API keys).");
  const { prompts } = expandPrompts(deep);

  // Tier 2a store crawl runs IN PARALLEL with the AI calls (detectShopify pattern): kick it off
  // before awaiting the scan so they overlap, and swallow any failure to a null (→ placeholders).
  const factsP = crawlMerchantFacts(input.config.brand).catch(() => null);

  const cap = ENV.paidSpendCapUsd;
  const estimate = prompts.length * adapters.length * perCallMaxCostUsd(MODELS.openai) + 0.2; // + discovery/artifacts
  // Reserve against the PAID-ONLY budget (paid_spend_days) — isolated from the shared queue counter
  // and the free funnel, so nothing else can starve a paying customer's generation.
  let reserved = false;
  if (!input.mock) {
    const res = await reservePaidSpend(estimate, cap);
    if (!res.ok) throw new Error(`paid spend cap reached (would exceed $${cap}); not run.`);
    reserved = true;
  }

  try {
    const results = await runScan(prompts, adapters, deep, {
      concurrency: deep.concurrency ?? 3,
      maxCostUsd: cap,
      maxDurationMs: 180_000,
      saveRaw: false,
    });
    const agg = aggregate(results, deep);
    const meta: RunMeta = {
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      mode: input.mock ? "mock" : "live",
      engines: adapters.map((a) => a.name),
      promptCount: prompts.length,
      totalCalls: prompts.length * adapters.length,
    };
    const run: RunResults = { meta, config: deep, results, aggregate: agg };
    const analysis = analyzeRun(run);

    // Discovered brands (the hidden competition) + the done-for-you artifacts. Mock → $0 templates.
    const disc = await extractDiscoveredBrands(results, deep, { apiKey: input.mock ? undefined : input.keys.openai });
    analysis.discoveredBrands = disc.brands;
    run.analysis = analysis;
    const merchantFacts = (await factsP) ?? undefined; // tier 2a: real sourced facts (or placeholders)
    const artifacts = await generateArtifacts(analysis, results, deep, { live: !input.mock, apiKey: input.keys.openai, merchantFacts });

    const costUsd = agg.totalCost.costUsd + disc.costUsd + artifacts.costUsd;
    if (reserved) await settlePaidSpend(estimate, costUsd).catch(() => {});
    return { report: run, artifacts, costUsd };
  } catch (err) {
    if (reserved) await releasePaidSpend(estimate).catch(() => {});
    throw err;
  }
}
