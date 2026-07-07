import type { MerchantAnalysis, QueryClusterResult } from "../types";
import { fmtRateN } from "../types";

// Honest per-cluster win/loss — KEEP IN SYNC with src/analysis/queryClusters.ts#clusterStanding.
// topWinners lists COMPETITORS only, so the real winner is the merchant's own rec count vs topWinners[0]
// — never topWinners[0] itself (that would call a cluster the merchant dominates "won by <rival>").
type Standing = "leads" | "trails" | "contested" | "absent";
function standingOf(c: QueryClusterResult): Standing {
  if (c.absent) return "absent";
  const rival = c.topWinners[0]?.recommendations ?? 0;
  if (c.brandRecommendation.count > rival) return "leads";
  if (c.brandRecommendation.count < rival) return "trails";
  return "contested";
}

export function GapAnalysis({ a }: { a: MerchantAnalysis }) {
  const transactional = a.clusters.filter((c) => c.transactional);
  const losing = transactional.filter((c) => {
    const s = standingOf(c);
    return s === "trails" || s === "absent";
  });

  // Title honest to the actual standing — never "categories you're losing" on a category leader.
  const title =
    losing.length === 0 && a.ownLeadsCategory
      ? "Buyer-intent categories — you lead every one"
      : losing.length > 0 && a.ownLeadsCategory
        ? "You lead overall — but a rival is ahead in these categories"
        : losing.length > 0
          ? "Buyer-intent categories you're losing"
          : "Buyer-intent category performance";

  // Reasons AI cited: for a leader this is the minority of answers where a rival was picked instead —
  // reframe it, and suppress it entirely when the data is too thin to say anything (avoids a 1×/1×
  // "reasons you weren't recommended" contradicting a winning hero).
  const proofHits = a.proofPoints.reduce((s, p) => s + p.hits, 0);
  const showProof = a.proofPoints.length > 0 && !(a.ownLeadsCategory && proofHits < 3);
  const proofTitle = a.ownLeadsCategory
    ? "In the answers where a rival was picked instead, AI cited"
    : "Reasons AI cited in answers where you weren't recommended";

  const kStyle = { fontSize: 11.5, textTransform: "uppercase" as const, letterSpacing: "0.05em", color: "var(--ink-3)", fontWeight: 700, marginBottom: 12 };

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card" style={{ padding: 18 }}>
        <div className="k" style={kStyle}>{title}</div>
        <div className="clusterlist">
          {transactional.map((c) => {
            const s = standingOf(c);
            const rival = c.topWinners[0];
            // Badge reflects the STANDING (valence-correct): green only when the merchant actually leads.
            const badge =
              s === "leads" ? { cls: "rec", txt: "YOU LEAD" }
              : s === "trails" ? { cls: "abs", txt: "RIVAL AHEAD" }
              : s === "absent" ? { cls: "abs", txt: "ABSENT" }
              : { cls: "men", txt: "CONTESTED" };
            // Counts are always "N of M" (never a bare "N×", which reads as a multiplier — the ThreatCard
            // uses "N× more" for the actual recommendation MULTIPLIER, so the two must not collide).
            const note =
              s === "leads"
                ? `you win — recommended ${fmtRateN(c.brandRecommendation)}${rival ? `; nearest rival ${rival.brand}, recommended ${rival.recommendations} of ${c.responses}` : ""}`
                : s === "trails"
                  ? `${rival!.brand} ahead — recommended ${rival!.recommendations} of ${c.responses} vs your ${c.brandRecommendation.count}`
                  : s === "absent"
                    ? `you're not mentioned here${rival ? ` — ${rival.brand} recommended ${rival.recommendations} of ${c.responses}` : ""}`
                    : rival
                      ? `contested — you and ${rival.brand} tied at ${c.brandRecommendation.count} of ${c.responses}`
                      : "no brand is recommended here yet";
            return (
              <div className="clusterrow" key={c.cluster}>
                <span className={`badge ${badge.cls}`}>{badge.txt}</span>
                <span className="name">
                  {c.label}
                  <span className="sub"> · {c.responses} answers · {note}</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {showProof && (
        <div className="card" style={{ padding: 18 }}>
          <div className="k" style={kStyle}>{proofTitle}</div>
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
