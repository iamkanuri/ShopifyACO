import type { Config, PromptEngineResult } from "../types.js";
import type { ScoreComponent, VisibilityScore } from "./types.js";
import { avg, detOf, detScore, grounded, rate } from "./util.js";

// ---------------------------------------------------------------------------
// AI Visibility Score — a documented, deterministic 0..100 formula. NOT a black
// box: every component (weight, normalized value, points contributed) is exposed
// so a merchant can see exactly why they got the number.
//
//   score = 100 × Σ (weight_i × value_i)
//
//   Recommendation rate   weight 0.50   value = recommended / responses
//   Mention rate          weight 0.20   value = mentioned   / responses
//   Rank quality          weight 0.15   value = listed ? clamp(1 − (avgRank−1)/5) : 0.5
//   Competitive win rate  weight 0.15   value = 1 − (responses_a_competitor_beats_us / responses)
// ---------------------------------------------------------------------------

const WEIGHTS = {
  recommendation: 0.5,
  mention: 0.2,
  rank: 0.15,
  win: 0.15,
} as const;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function computeVisibilityScore(
  results: PromptEngineResult[],
  cfg: Config,
): VisibilityScore {
  const ok = grounded(results);
  const n = ok.length;

  let mentioned = 0;
  let recommended = 0;
  let beaten = 0;
  const ranks: number[] = [];

  for (const r of ok) {
    const own = detOf(r, cfg.brand.name);
    const ownScore = detScore(own);
    if (own?.mentioned) mentioned++;
    if (own?.status === "recommended") recommended++;
    if (own?.listRank != null) ranks.push(own.listRank);
    const beatenHere = cfg.competitors.some((c) => detScore(detOf(r, c.name)) > ownScore);
    if (beatenHere) beaten++;
  }

  const recRate = rate(recommended, n);
  const mentionRate = rate(mentioned, n);
  const avgRank = avg(ranks);
  const rankValue = avgRank == null ? 0.5 : clamp01(1 - (avgRank - 1) / 5);
  const winValue = n > 0 ? 1 - beaten / n : 0;

  const components: ScoreComponent[] = [
    {
      key: "recommendation",
      label: "Recommendation rate",
      weight: WEIGHTS.recommendation,
      value: recRate.rate,
      contribution: WEIGHTS.recommendation * recRate.rate * 100,
      detail: `Explicitly recommended in ${recommended}/${n} grounded answers.`,
    },
    {
      key: "mention",
      label: "Mention rate",
      weight: WEIGHTS.mention,
      value: mentionRate.rate,
      contribution: WEIGHTS.mention * mentionRate.rate * 100,
      detail: `Mentioned at all in ${mentioned}/${n} grounded answers.`,
    },
    {
      key: "rank",
      label: "Rank quality when listed",
      weight: WEIGHTS.rank,
      value: rankValue,
      contribution: WEIGHTS.rank * rankValue * 100,
      detail:
        avgRank == null
          ? "Never appeared in a ranked list (neutral 0.5 applied)."
          : `Average list position ${avgRank.toFixed(1)} when ranked (lower is better).`,
    },
    {
      key: "win",
      label: "Competitive win rate",
      weight: WEIGHTS.win,
      value: winValue,
      contribution: WEIGHTS.win * winValue * 100,
      detail: `A competitor out-ranked the brand in ${beaten}/${n} answers.`,
    },
  ];

  const score = Math.round(components.reduce((s, c) => s + c.contribution, 0));

  return {
    score,
    components,
    formula:
      "score = 100 × (0.50·recommendationRate + 0.20·mentionRate + " +
      "0.15·rankQuality + 0.15·competitiveWinRate)",
    basedOnResponses: n,
  };
}
