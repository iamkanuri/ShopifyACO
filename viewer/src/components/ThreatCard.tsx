import type { MerchantAnalysis } from "../types";
import { fmtRateN } from "../types";
import { ConfidenceBadge } from "./Badges";

/**
 * Distinguishes the overall category leader from the in-niche direct threat.
 * When the same competitor is both, that's the stronger story — say so.
 */
export function ThreatCard({ a }: { a: MerchantAnalysis }) {
  const leader = a.categoryLeader;
  const threat = a.threat;
  const same = leader && threat && leader.competitor === threat.competitor;

  return (
    <div className="card threatcard">
      <div className="threat-grid">
        <div className="threat-col">
          <div className="threat-k">Category leader (overall)</div>
          <div className="threat-name">{leader?.competitor ?? "—"}</div>
          {leader && (
            <div className="threat-sub">
              recommended {fmtRateN(leader.recommendation)} across the whole scan
            </div>
          )}
        </div>
        <div className="threat-divider" />
        <div className="threat-col">
          <div className="threat-k">
            Direct niche threat <ConfidenceBadge c={threat?.confidence ?? a.confidence} compact />
          </div>
          <div className="threat-name danger">{threat?.competitor ?? "—"}</div>
          {threat && (
            <div className="threat-sub">
              {threat.recommendationMultiplier != null
                ? `recommended ${threat.recommendationMultiplier.toFixed(1)}× more than ${a.brand}`
                : `out-recommends ${a.brand}`}{" "}
              · based on {threat.basisLabel}
            </div>
          )}
        </div>
      </div>
      <div className="threat-note">
        {same
          ? `${leader!.competitor} isn't just the category leader — it out-recommends ${a.brand} even inside ${a.brand}'s own ${threat!.sharedNiche[0]?.toLowerCase() ?? "niche"} territory. That's where the gap is most urgent.`
          : threat
            ? `${leader?.competitor ?? "The leader"} wins the category overall, but ${threat.competitor} is the rival beating ${a.brand} specifically in ${threat.sharedNiche[0]?.toLowerCase() ?? "its niche"}.`
            : `No competitor is clearly out-recommending ${a.brand} yet.`}
      </div>
    </div>
  );
}
