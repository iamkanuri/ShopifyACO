import type { Config, PromptEngineResult } from "../types.js";
import type {
  CategoryLeader,
  CompetitorThreat,
  EngineWeakness,
  LeaderboardRow,
  LostPrompt,
  MentionGap,
  QueryClusterResult,
} from "./types.js";
import { avg, detOf, detScore, fmtRate, grounded, rate, uniq } from "./util.js";
import { confidenceFor } from "./confidence.js";

// ---------------------------------------------------------------------------
// Brand-vs-competitor gap analysis. All scan-scoped + relative-framed: numbers
// are always paired with n= and described as "in this scan", never as settled fact.
// ---------------------------------------------------------------------------

export function computeMentionGap(results: PromptEngineResult[], cfg: Config): MentionGap {
  const ok = grounded(results);
  let mentioned = 0;
  let recommended = 0;
  for (const r of ok) {
    const d = detOf(r, cfg.brand.name);
    if (d?.mentioned) mentioned++;
    if (d?.status === "recommended") recommended++;
  }
  const mention = rate(mentioned, ok.length);
  const recommendation = rate(recommended, ok.length);
  const mentionedNotChosen = rate(mentioned - recommended, ok.length);
  return {
    brand: cfg.brand.name,
    mention,
    recommendation,
    mentionedNotChosen,
    summary:
      `${cfg.brand.name} is known but rarely chosen in this scan: mentioned ` +
      `${fmtRate(mention)} of answers but recommended only ${fmtRate(recommendation)}. ` +
      `That leaves ${fmtRate(mentionedNotChosen)} "mentioned but not chosen".`,
  };
}

/** Brand's "home niche": non-transactional clusters where it actually shows up. */
function homeNicheClusters(clusters: QueryClusterResult[]): QueryClusterResult[] {
  return clusters.filter((c) => !c.transactional && c.brandMention.rate > 0);
}

/** The category-wide recommendation leader (whole run), regardless of niche. */
export function computeCategoryLeader(
  results: PromptEngineResult[],
  cfg: Config,
): CategoryLeader | null {
  const ok = grounded(results);
  if (ok.length === 0) return null;
  let best: { name: string; rec: number; men: number } | null = null;
  for (const c of cfg.competitors) {
    const rec = countStatus(ok, c.name, "recommended");
    const men = countMentioned(ok, c.name);
    if (men === 0) continue;
    if (!best || rec > best.rec || (rec === best.rec && men > best.men)) best = { name: c.name, rec, men };
  }
  if (!best) return null;
  return { competitor: best.name, recommendation: rate(best.rec, ok.length), mention: rate(best.men, ok.length) };
}

export function computeThreat(
  results: PromptEngineResult[],
  cfg: Config,
  clusters: QueryClusterResult[],
): CompetitorThreat | null {
  const ok = grounded(results);
  if (ok.length === 0) return null;

  // The niche threat is the rival inside the brand's OWN territory — distinct from
  // the category-wide leader (computed separately). We anchor to the niche the brand
  // most OCCUPIES (most brand mentions = its identity territory, and the least-thin
  // slice), then name whoever out-recommends it there. We walk niches in that order
  // so a tiny high-gap slice can't crown a threat the brand's main niche disagrees
  // with. Falls back to the whole run only if no niche shows a real threat.
  const niches = homeNicheClusters(clusters).sort(
    (a, b) => b.brandMention.count - a.brandMention.count || b.brandMention.rate - a.brandMention.rate,
  );

  let best: ThreatCand | null = null;
  for (const c of niches) {
    best = pickThreat([{ label: c.label, rows: ok.filter((r) => c.prompts.includes(r.prompt)) }], cfg);
    if (best) break;
  }
  if (!best) best = pickThreat([{ label: "all queries", rows: ok }], cfg);
  if (!best) return null;

  const ownRecRate = rate(best.ownRec, best.n);
  const compRecRate = rate(best.rec, best.n);
  const multiplier = ownRecRate.rate > 0 ? compRecRate.rate / ownRecRate.rate : null;
  const basisLabel = `${best.n} ${best.label === "all queries" ? "" : best.label.toLowerCase() + " "}prompts`.replace(/\s+/g, " ");
  const confidence = confidenceFor(best.n);
  const where = best.label === "all queries" ? "across this scan" : `in ${best.label.toLowerCase()} queries`;
  const multiText =
    multiplier != null
      ? `recommended ${multiplier.toFixed(1)}× more often than ${cfg.brand.name}`
      : `recommended ${best.rec} time(s) vs ${cfg.brand.name}'s ${best.ownRec}`;

  return {
    competitor: best.name,
    ownRecommendation: ownRecRate,
    competitorRecommendation: compRecRate,
    ownMention: rate(best.ownMen, best.n),
    competitorMention: rate(best.men, best.n),
    recommendationMultiplier: multiplier,
    sharedNiche: best.label === "all queries" ? [] : [best.label],
    basisLabel,
    basisResponses: best.n,
    confidence,
    summary:
      `${best.name} is ${cfg.brand.name}'s most direct competitor ${where}: ` +
      `${multiText} (${fmtRate(compRecRate)} vs ${fmtRate(ownRecRate)}, based on ${basisLabel} in this scan). ` +
      `${confidence.label}`,
  };
}

export function computeEngineWeakness(
  results: PromptEngineResult[],
  cfg: Config,
): { engines: EngineWeakness[]; weakest: string | null } {
  const engines = uniq(results.map((r) => r.engine));
  const rows: EngineWeakness[] = [];

  for (const engine of engines) {
    const ok = grounded(results.filter((r) => r.engine === engine));
    let mentioned = 0;
    let recommended = 0;
    const ranks: number[] = [];
    for (const r of ok) {
      const d = detOf(r, cfg.brand.name);
      if (d?.mentioned) mentioned++;
      if (d?.status === "recommended") recommended++;
      if (d?.listRank != null) ranks.push(d.listRank);
    }
    rows.push({
      engine,
      mention: rate(mentioned, ok.length),
      recommendation: rate(recommended, ok.length),
      avgRankWhenMentioned: avg(ranks),
      isWeakest: false,
      summary: "",
    });
  }

  // Weakest = lowest rec rate, then lowest mention rate, then worst avg rank.
  // Only engines that actually produced grounded responses are eligible.
  const eligible = rows.filter((r) => r.mention.total > 0);
  let weakest: string | null = null;
  if (eligible.length) {
    const sorted = [...eligible].sort((a, b) => {
      if (a.recommendation.rate !== b.recommendation.rate) return a.recommendation.rate - b.recommendation.rate;
      if (a.mention.rate !== b.mention.rate) return a.mention.rate - b.mention.rate;
      return (b.avgRankWhenMentioned ?? 99) - (a.avgRankWhenMentioned ?? 99);
    });
    weakest = sorted[0]!.engine;
  }

  for (const r of rows) {
    r.isWeakest = r.engine === weakest;
    r.summary =
      r.mention.total === 0
        ? `${r.engine} produced no grounded answers in this scan.`
        : `${r.engine}: recommends ${cfg.brand.name} ${fmtRate(r.recommendation)}, ` +
          `mentions ${fmtRate(r.mention)}` +
          (r.avgRankWhenMentioned != null ? `, avg rank ${r.avgRankWhenMentioned.toFixed(1)}` : "") +
          (r.isWeakest ? " — weakest engine." : ".");
  }

  return { engines: rows, weakest };
}

export function computeLeaderboard(results: PromptEngineResult[], cfg: Config): LeaderboardRow[] {
  const ok = grounded(results);
  const engines = uniq(results.map((r) => r.engine));
  const brands = [{ name: cfg.brand.name, isOwn: true }, ...cfg.competitors.map((c) => ({ name: c.name, isOwn: false }))];

  return brands
    .map((b) => {
      let mentioned = 0;
      let recommended = 0;
      const ranks: number[] = [];
      const winningPrompts: string[] = [];
      for (const r of ok) {
        const d = detOf(r, b.name);
        if (d?.mentioned) mentioned++;
        if (d?.status === "recommended") {
          recommended++;
          winningPrompts.push(r.prompt);
        }
        if (d?.listRank != null) ranks.push(d.listRank);
      }
      // Engines where this brand's recommendation rate is highest.
      const perEngineRec = engines.map((e) => {
        const eok = grounded(results.filter((r) => r.engine === e));
        const rec = eok.filter((r) => detOf(r, b.name)?.status === "recommended").length;
        return { engine: e, rate: eok.length ? rec / eok.length : 0 };
      });
      const maxRate = Math.max(0, ...perEngineRec.map((x) => x.rate));
      const strongestEngines = maxRate > 0 ? perEngineRec.filter((x) => x.rate === maxRate).map((x) => x.engine) : [];

      return {
        brand: b.name,
        isOwn: b.isOwn,
        mention: rate(mentioned, ok.length),
        recommendation: rate(recommended, ok.length),
        avgRankWhenMentioned: avg(ranks),
        strongestEngines,
        topWinningPrompts: uniq(winningPrompts).slice(0, 3),
      };
    })
    .sort((a, b) => b.recommendation.rate - a.recommendation.rate || b.mention.rate - a.mention.rate);
}

export function computeLostPrompts(results: PromptEngineResult[], cfg: Config): LostPrompt[] {
  const ok = grounded(results);
  const lost: LostPrompt[] = [];
  for (const r of ok) {
    const own = detOf(r, cfg.brand.name);
    const ownScore = detScore(own);
    const compDets = cfg.competitors.map((c) => detOf(r, c.name)).filter((d): d is NonNullable<typeof d> => !!d?.mentioned);
    const beats = compDets.filter((d) => detScore(d) > ownScore);
    if (beats.length === 0) continue; // not a loss

    const recommendedComps = beats.filter((d) => d.status === "recommended").map((d) => d.name);
    const winners = recommendedComps.length ? recommendedComps : beats.map((d) => d.name);
    const topWinner = beats.sort((a, b) => detScore(b) - detScore(a))[0];

    lost.push({
      prompt: r.prompt,
      template: r.template,
      engine: r.engine,
      brandMentioned: !!own?.mentioned,
      brandRecommended: own?.status === "recommended",
      brandRank: own?.listRank ?? null,
      winners: uniq(winners),
      snippet: topWinner?.snippet,
    });
  }
  // Worst losses first: brand absent before merely out-ranked.
  return lost.sort((a, b) => Number(a.brandMentioned) - Number(b.brandMentioned));
}

// ---- helpers ---------------------------------------------------------------

function countMentioned(results: PromptEngineResult[], brand: string): number {
  return results.filter((r) => detOf(r, brand)?.mentioned).length;
}
function countStatus(results: PromptEngineResult[], brand: string, status: string): number {
  return results.filter((r) => detOf(r, brand)?.status === status).length;
}

interface ThreatCand {
  name: string; rec: number; men: number; ownRec: number; ownMen: number;
  n: number; label: string; score: number;
}

/** Pick the sample-weighted strongest competitor-out-recommends-brand signal across scopes. */
function pickThreat(
  scopes: { label: string; rows: PromptEngineResult[] }[],
  cfg: Config,
): ThreatCand | null {
  let best: ThreatCand | null = null;
  for (const scope of scopes) {
    const n = scope.rows.length;
    if (n === 0) continue;
    const ownRec = countStatus(scope.rows, cfg.brand.name, "recommended");
    const ownMen = countMentioned(scope.rows, cfg.brand.name);
    for (const c of cfg.competitors) {
      const rec = countStatus(scope.rows, c.name, "recommended");
      const men = countMentioned(scope.rows, c.name);
      if (men === 0) continue;
      const gap = rec / n - ownRec / n;
      if (gap <= 0) continue;
      // effect size × sqrt(n): rewards both a real gap and enough data to trust it.
      const score = gap * Math.sqrt(n);
      if (!best || score > best.score) best = { name: c.name, rec, men, ownRec, ownMen, n, label: scope.label, score };
    }
  }
  return best;
}
