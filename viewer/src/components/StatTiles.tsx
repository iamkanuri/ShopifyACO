import type { MerchantAnalysis } from "../types";
import { fmtRate, fmtRateN } from "../types";

export function StatTiles({ a }: { a: MerchantAnalysis }) {
  const g = a.mentionGap;
  const strongestComp = a.leaderboard.find((r) => !r.isOwn);

  const tiles = [
    {
      k: "Recommendation rate",
      v: fmtRate(g.recommendation),
      n: `${g.recommendation.count}/${g.recommendation.total} answers`,
      tone: g.recommendation.rate < 0.15 ? "danger" : "",
    },
    {
      k: "Mention rate",
      v: fmtRate(g.mention),
      n: `${g.mention.count}/${g.mention.total} answers`,
      tone: "",
    },
    {
      k: "Mentioned, not chosen",
      v: fmtRate(g.mentionedNotChosen),
      // For a category leader this is headroom, not an alarm — don't paint it red.
      n: a.ownLeadsCategory ? "mentioned, not yet chosen — headroom" : "known but passed over",
      tone: !a.ownLeadsCategory && g.mentionedNotChosen.rate > 0.2 ? "danger" : "",
    },
    {
      k: "Strongest competitor",
      v: strongestComp?.brand ?? "—",
      n: strongestComp ? `${fmtRateN(strongestComp.recommendation)} recommended` : "",
      tone: "",
    },
    {
      // "Weakest" is relative — only red when the weakest engine's recommendation rate is
      // absolutely low. A leader whose weakest engine still recommends 50% shows neutral, not red.
      k: "Weakest engine",
      v: a.weakestEngine ?? "—",
      n: "recommends you least",
      tone: (a.engineWeakness.find((e) => e.isWeakest)?.recommendation.rate ?? 0) < 0.15 ? "danger" : "",
    },
    {
      // Honest "no threat" state — never a bare red dash. A winning brand has no direct threat.
      k: "Direct threat",
      v: a.threat ? a.threat.competitor : "None",
      n: a.threat
        ? a.threat.recommendationMultiplier
          ? `${a.threat.recommendationMultiplier.toFixed(1)}× your rec rate in niche`
          : "out-recommends you in your niche"
        : a.ownLeadsCategory
          ? "you lead — no rival out-recommends you"
          : "no rival out-recommends you in this scan",
      tone: a.threat ? "danger" : "",
    },
  ];

  return (
    <div className="tiles">
      {tiles.map((t) => (
        <div className={`card tile ${t.tone}`} key={t.k}>
          <div className="k">{t.k}</div>
          <div className="v">{t.v}</div>
          <div className="n">{t.n}</div>
        </div>
      ))}
    </div>
  );
}
