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
      n: `known but passed over`,
      tone: g.mentionedNotChosen.rate > 0.2 ? "danger" : "",
    },
    {
      k: "Strongest competitor",
      v: strongestComp?.brand ?? "—",
      n: strongestComp ? `${fmtRateN(strongestComp.recommendation)} recommended` : "",
      tone: "",
    },
    {
      k: "Weakest engine",
      v: a.weakestEngine ?? "—",
      n: "recommends you least",
      tone: "danger",
    },
    {
      k: "Direct threat",
      v: a.threat?.competitor ?? "—",
      n: a.threat?.recommendationMultiplier
        ? `${a.threat.recommendationMultiplier.toFixed(1)}× your rec rate in niche`
        : "in your niche",
      tone: "danger",
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
