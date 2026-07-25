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

// CATEGORY-AGNOSTIC buyer-intent clusters. Triggers key off the UNIVERSAL shapes of shopper queries
// (the same intents the prompt library generates: core "what's best", brand comparison, budget,
// use-case/fit, alternatives, gift) — NOT vertical-specific vocabulary. The old taxonomy triggered on
// cookware terms (pfas/teflon/induction/first-apartment), so a fashion/supplement/furniture brand's
// prompts fell into ~zero clusters → thin transactional analysis AND a missing/wrong paid buying-guide
// topic (generate.ts picks it from a cluster_* card). Now every vertical's real prompts cluster.
export const CLUSTER_DEFS: ClusterDef[] = [
  {
    id: "high_intent",
    label: "Top recommendation ('what's best')",
    transactional: true,
    test: (p) => /(what(?:'s|s| is| are)?\s+the\s+best|which\b[^?]*\bbest\b|\brecommend\b|should i buy|top (pick|choice|recommendation))/.test(p),
  },
  {
    id: "comparison",
    label: "Brand comparison & quality",
    transactional: true,
    test: (p, cfg) => {
      if (/(best brand|brands?\s+right now|highest quality|best[- ]quality|top[- ]rated|most recommended|\bcompare\b|\bversus\b|difference between|which\b[^?]*\bbrand\b)/.test(p)) return true;
      return cfg.competitors.some((c) => new RegExp(`\\bvs\\.?\\b.{0,20}${escapeRe(c.name.toLowerCase())}|${escapeRe(c.name.toLowerCase())}.{0,20}\\bvs\\.?\\b`).test(p));
    },
  },
  {
    id: "budget",
    label: "Budget / price",
    transactional: true,
    test: (p) => /(under \$|\bunder \d|\bbudget\b|\bcheap\b|affordable|\bvalue\b|\$\d|best value|worth (the|it|every))/.test(p),
  },
  {
    id: "use_case",
    label: "Use case & fit",
    transactional: true,
    test: (p) => /(everyday|\bdaily\b|all[- ]?around|holds? up|built to last|lasts?\b|for (a|an|my|your|the|beginners?|first[- ]time|kids|pets|home|work|travel|daily|years)|best\b[^?]*\bfor\b)/.test(p),
  },
  {
    id: "alternatives",
    label: "Alternatives to a competitor",
    transactional: true,
    test: (p, cfg) => {
      if (/(alternative|instead of|switch (from|to)|replacement for|similar to|other options|comparable to)/.test(p)) return true;
      // "good alternatives to {Competitor}" / "{Competitor} vs" / "better than {Competitor}"
      return cfg.competitors.some((c) =>
        new RegExp(`(alternative|vs\\.?|versus|compare|better than).{0,20}${escapeRe(c.name.toLowerCase())}`).test(p),
      );
    },
  },
  {
    id: "gift",
    label: "Gift & occasion",
    transactional: false,
    test: (p) => /(\bgift\b|\bpresent\b|wedding|registry|\bholiday\b|birthday|christmas|anniversary|housewarming)/.test(p),
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

export type ClusterStanding = "leads" | "trails" | "contested" | "absent";

/**
 * Honest per-cluster win/loss: who has MORE recommendations in the cluster — the merchant or the top
 * rival. `topWinners` lists competitors ONLY (the merchant is excluded), so comparing the merchant's own
 * recommendation count against `topWinners[0]` is the real winner — NOT `topWinners[0]` itself, which is
 * merely the top competitor and must never be rendered as "who won" (that mislabels a cluster the
 * merchant dominates, e.g. Olipop recommended 18/21 while Poppi got 3, as "won by Poppi").
 * KEEP IN SYNC with viewer/src/components/GapAnalysis.tsx (separate bundle, can't import this).
 */
export function clusterStanding(
  c: Pick<QueryClusterResult, "absent" | "brandRecommendation" | "topWinners">,
): ClusterStanding {
  if (c.absent) return "absent";
  const rivalRecs = c.topWinners[0]?.recommendations ?? 0;
  if (c.brandRecommendation.count > rivalRecs) return "leads";
  if (c.brandRecommendation.count < rivalRecs) return "trails";
  return "contested";
}

// Re-export for callers that want the avg helper alongside cluster math.
export { avg, detScore };
