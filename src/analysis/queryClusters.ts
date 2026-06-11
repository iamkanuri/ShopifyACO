import type { Config, PromptEngineResult } from "../types.js";
import type { QueryClusterResult } from "./types.js";
import { avg, detOf, detScore, grounded, rate, uniq } from "./util.js";

// ---------------------------------------------------------------------------
// Deterministic buyer-intent clustering. Each prompt is classified by keyword
// match into zero-or-more clusters; "transactional" clusters are the high-intent
// buying queries where being absent hurts most.
// ---------------------------------------------------------------------------

interface ClusterDef {
  id: string;
  label: string;
  transactional: boolean;
  test: (promptLower: string, cfg: Config) => boolean;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const CLUSTER_DEFS: ClusterDef[] = [
  {
    id: "non_toxic_ceramic",
    label: "Non-toxic / ceramic",
    transactional: false,
    test: (p) => /(non[- ]?toxic|ceramic|pfas|ptfe|pfoa|teflon|toxic|non[- ]?stick)/.test(p),
  },
  {
    id: "budget",
    label: "Budget / under-price",
    transactional: true,
    test: (p) => /(under \$|\bunder \d|budget|cheap|affordable|value|\$\d)/.test(p),
  },
  {
    id: "induction",
    label: "Induction stove",
    transactional: true,
    test: (p) => /induction/.test(p),
  },
  {
    id: "wedding_gift",
    label: "Wedding / gift",
    transactional: true,
    test: (p) => /(wedding|gift|registry)/.test(p),
  },
  {
    id: "first_apartment",
    label: "First apartment / starter",
    transactional: true,
    test: (p) => /(first apartment|apartment|starter|first place|moving out|new home)/.test(p),
  },
  {
    id: "alternatives",
    label: "Alternatives to a competitor",
    transactional: true,
    test: (p, cfg) => {
      if (/(alternative|instead of|switch from|replacement for)/.test(p)) return true;
      // "good alternatives to {Competitor}" / "vs {Competitor}"
      return cfg.competitors.some((c) =>
        new RegExp(`(alternative|vs\\.?|compare).{0,20}${escapeRe(c.name.toLowerCase())}`).test(p),
      );
    },
  },
  {
    id: "teflon_replacement",
    label: "Replacing Teflon / safety switch",
    transactional: true,
    test: (p) => /(replac\w*|switch).{0,30}(teflon|non[- ]?stick|pans)/.test(p),
  },
  {
    id: "everyday",
    label: "Everyday cooking",
    transactional: false,
    test: (p) => /(everyday|daily|home cooking|all[- ]?around)/.test(p),
  },
  {
    id: "dtc_quality",
    label: "Best-quality / DTC brand",
    transactional: false,
    test: (p) => /(direct[- ]to[- ]consumer|\bdtc\b|highest quality|best quality|best brand)/.test(p),
  },
];

/** Cluster ids that a single prompt belongs to. */
export function clustersForPrompt(prompt: string, cfg: Config): string[] {
  const p = prompt.toLowerCase();
  return CLUSTER_DEFS.filter((d) => d.test(p, cfg)).map((d) => d.id);
}

/** Per-cluster brand performance across the run. */
export function analyzeClusters(results: PromptEngineResult[], cfg: Config): QueryClusterResult[] {
  const ok = grounded(results);
  const out: QueryClusterResult[] = [];

  for (const def of CLUSTER_DEFS) {
    const inCluster = ok.filter((r) => def.test(r.prompt.toLowerCase(), cfg));
    if (inCluster.length === 0) continue;

    let mentions = 0;
    let recs = 0;
    const winnerRecs = new Map<string, number>();
    for (const r of inCluster) {
      const own = detOf(r, cfg.brand.name);
      if (own?.mentioned) mentions++;
      if (own?.status === "recommended") recs++;
      for (const c of cfg.competitors) {
        const d = detOf(r, c.name);
        if (d?.status === "recommended") {
          winnerRecs.set(c.name, (winnerRecs.get(c.name) ?? 0) + 1);
        }
      }
    }

    out.push({
      cluster: def.id,
      label: def.label,
      transactional: def.transactional,
      prompts: uniq(inCluster.map((r) => r.prompt)),
      responses: inCluster.length,
      brandMention: rate(mentions, inCluster.length),
      brandRecommendation: rate(recs, inCluster.length),
      absent: mentions === 0,
      topWinners: [...winnerRecs.entries()]
        .map(([brand, recommendations]) => ({ brand, recommendations }))
        .sort((a, b) => b.recommendations - a.recommendations)
        .slice(0, 3),
    });
  }

  // Sort: transactional first, then by how badly the brand is losing (absent, then
  // lowest mention rate).
  return out.sort((a, b) => {
    if (a.transactional !== b.transactional) return a.transactional ? -1 : 1;
    if (a.absent !== b.absent) return a.absent ? -1 : 1;
    return a.brandMention.rate - b.brandMention.rate;
  });
}

// Re-export for callers that want the avg helper alongside cluster math.
export { avg, detScore };
