import type { MerchantAnalysis } from "../types";
import { fmtRateN } from "../types";

export function GapAnalysis({ a }: { a: MerchantAnalysis }) {
  const transactional = a.clusters.filter((c) => c.transactional);
  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card" style={{ padding: 18 }}>
        <div className="k" style={{ fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-3)", fontWeight: 700, marginBottom: 12 }}>
          Buyer-intent categories you're losing
        </div>
        <div className="clusterlist">
          {transactional.map((c) => (
            <div className="clusterrow" key={c.cluster}>
              <span className={`badge ${c.absent ? "abs" : c.brandRecommendation.count > 0 ? "rec" : "men"}`}>
                {c.absent ? "ABSENT" : c.brandRecommendation.count > 0 ? "PARTIAL" : "MENTION-ONLY"}
              </span>
              <span className="name">
                {c.label}
                <span className="sub"> · {fmtRateN(c.brandMention)} mentioned across {c.responses} answers</span>
              </span>
              {c.topWinners[0] && (
                <span className="muted" style={{ fontSize: 12 }}>
                  won by {c.topWinners[0].brand}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {a.proofPoints.length > 0 && (
        <div className="card" style={{ padding: 18 }}>
          <div className="k" style={{ fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-3)", fontWeight: 700, marginBottom: 12 }}>
            Reasons AI cited in answers where you weren't recommended
          </div>
          <div className="prooflist">
            {a.proofPoints.slice(0, 9).map((p) => (
              <div className="prooftag" key={p.id} title={p.exampleSnippet ?? ""}>
                <b>{p.label}</b> · {p.hits}×
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
