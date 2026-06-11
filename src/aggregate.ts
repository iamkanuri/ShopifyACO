import type {
  Aggregate,
  BrandStats,
  Config,
  CostSummary,
  EngineGrounding,
  GroundingMode,
  PromptEngineResult,
} from "./types.js";

interface BrandRef {
  name: string;
  isOwn: boolean;
}

function brandList(cfg: Config): BrandRef[] {
  return [
    { name: cfg.brand.name, isOwn: true },
    ...cfg.competitors.map((c) => ({ name: c.name, isOwn: false })),
  ];
}

/** A successful response is one without an error (detections were computed). */
function successful(results: PromptEngineResult[]): PromptEngineResult[] {
  return results.filter((r) => !r.error);
}

function computeBrandStats(results: PromptEngineResult[], brands: BrandRef[]): BrandStats[] {
  const ok = successful(results);
  const responses = ok.length;

  return brands.map((b) => {
    let mentions = 0;
    let recommendations = 0;
    const ranks: number[] = [];
    for (const r of ok) {
      const d = r.detections.find((x) => x.name === b.name);
      if (!d || !d.mentioned) continue;
      mentions += 1;
      if (d.status === "recommended") recommendations += 1;
      if (d.listRank !== null) ranks.push(d.listRank);
    }
    return {
      name: b.name,
      isOwn: b.isOwn,
      mentions,
      recommendations,
      responses,
      mentionRate: responses ? mentions / responses : 0,
      recommendationRate: responses ? recommendations / responses : 0,
      avgListRank: ranks.length ? ranks.reduce((a, c) => a + c, 0) / ranks.length : null,
    };
  });
}

function dominantGrounding(modes: GroundingMode[]): GroundingMode {
  if (modes.length === 0) return "unknown";
  if (modes.includes("api_model_only")) return "api_model_only";
  if (modes.every((m) => m === "web_grounded")) return "web_grounded";
  return "unknown";
}

export function aggregate(results: PromptEngineResult[], cfg: Config): Aggregate {
  const brands = brandList(cfg);
  const engines = [...new Set(results.map((r) => r.engine))];

  const overall = computeBrandStats(results, brands);

  const byEngine: Record<string, BrandStats[]> = {};
  const grounding: EngineGrounding[] = [];
  const cost: Record<string, CostSummary> = {};
  const totalCost: CostSummary = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

  for (const engine of engines) {
    const forEngine = results.filter((r) => r.engine === engine);
    byEngine[engine] = computeBrandStats(forEngine, brands);

    const ok = successful(forEngine);
    grounding.push({
      engine,
      model: forEngine[0]?.model ?? "",
      groundingMode: dominantGrounding(ok.map((r) => r.groundingMode)),
      errors: forEngine.filter((r) => r.error).length,
      calls: forEngine.length,
    });

    const c: CostSummary = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
    for (const r of ok) {
      c.inputTokens += r.usage?.inputTokens ?? 0;
      c.outputTokens += r.usage?.outputTokens ?? 0;
      c.costUsd += r.usage?.costUsd ?? 0;
    }
    cost[engine] = c;
    totalCost.inputTokens += c.inputTokens;
    totalCost.outputTokens += c.outputTokens;
    totalCost.costUsd += c.costUsd;
  }

  const hasUngroundedEngine = grounding.some(
    (g) => g.groundingMode !== "web_grounded" && g.calls - g.errors > 0,
  );

  return { overall, byEngine, grounding, hasUngroundedEngine, cost, totalCost };
}
