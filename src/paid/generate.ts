import type { Config, RunResults, RunMeta } from "../types.js";
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
import { reserveSpend, reconcileSpend, settleFailedReservation } from "../queue/spend.js";
import { ENV } from "../server/env.js";

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

export async function generatePaidReport(input: GeneratePaidInput): Promise<PaidReportOutput> {
  const deep = deepenConfig(input.config);
  const { adapters } = buildAdapters(deep, input.keys, input.mock ?? false);
  if (adapters.length === 0) throw new Error("paid deep scan: no engines configured (check API keys).");
  const { prompts } = expandPrompts(deep);

  const cap = ENV.paidSpendCapUsd;
  const estimate = prompts.length * adapters.length * perCallMaxCostUsd(MODELS.openai) + 0.2; // + discovery/artifacts
  let reservationId: number | undefined;
  if (!input.mock) {
    const res = await reserveSpend(`paid:${input.runId}`, estimate, cap);
    if (!res.ok) throw new Error(`paid spend cap reached (would exceed $${cap}); not run.`);
    reservationId = res.reservationId;
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
    const artifacts = await generateArtifacts(analysis, results, deep, { live: !input.mock, apiKey: input.keys.openai });

    const costUsd = agg.totalCost.costUsd + disc.costUsd + artifacts.costUsd;
    if (reservationId != null) await reconcileSpend(reservationId, costUsd).catch(() => {});
    return { report: run, artifacts, costUsd };
  } catch (err) {
    if (reservationId != null) await settleFailedReservation(reservationId, 0).catch(() => {});
    throw err;
  }
}
