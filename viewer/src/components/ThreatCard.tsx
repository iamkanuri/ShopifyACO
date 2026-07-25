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
  const ownLeads = a.ownLeadsCategory; // merchant out-recommends the field → "you lead", never crown a rival

  return (
    <div className="card threatcard">
      <div className="threat-grid">
        <div className="threat-col">
          <div className="threat-k">{ownLeads ? "Category standing" : "Category leader (overall)"}</div>
          <div className="threat-name">{ownLeads ? `${a.brand} (you)` : (leader?.competitor ?? "—")}</div>
          <div className="threat-sub">
            {ownLeads
              ? `you lead — recommended ${fmtRateN(a.mentionGap.recommendation)}, ahead of every competitor`
              : leader
                ? `recommended ${fmtRateN(leader.recommendation)} across the whole scan`
                : "no competitor was recommended in this scan"}
          </div>
        </div>
        <div className="threat-divider" />
        <div className="threat-col">
          {threat ? (
            <>
              <div className="threat-k">
                Direct niche threat <ConfidenceBadge c={threat.confidence} compact />
              </div>
              <div className="threat-name danger">{threat.competitor}</div>
              <div className="threat-sub">
                {threat.recommendationMultiplier != null
                  ? `recommended ${threat.recommendationMultiplier.toFixed(1)}× more than ${a.brand}`
                  : `out-recommends ${a.brand}`}{" "}
                · based on {threat.basisLabel}
              </div>
            </>
          ) : ownLeads && leader ? (
            <>
              <div className="threat-k">Nearest challenger</div>
              <div className="threat-name">{leader.competitor}</div>
              <div className="threat-sub">
                recommended {fmtRateN(leader.recommendation)} · worth watching, but doesn't out-recommend you
              </div>
            </>
          ) : (
            <>
              <div className="threat-k">Direct niche threat</div>
              <div className="threat-name">None</div>
              <div className="threat-sub">no competitor out-recommends {a.brand} in this scan</div>
            </>
          )}
        </div>
      </div>
      <div className="threat-note">
        {same
          ? `${leader!.competitor} isn't just the category leader — it out-recommends ${a.brand} even inside ${a.brand}'s own ${threat!.sharedNiche[0]?.toLowerCase() ?? "niche"} territory. That's where the gap is most urgent.`
          : threat
            ? `${ownLeads ? `${a.brand} leads overall, but` : `${leader?.competitor ?? "The leader"} wins the category overall, but`} ${threat.competitor} is the rival beating ${a.brand} specifically in ${threat.sharedNiche[0]?.toLowerCase() ?? "its niche"}.`
            : ownLeads
              ? `${a.brand} is the most-recommended brand in ${a.category}; ${leader?.competitor ?? "its nearest rival"} is the one to watch, but doesn't out-recommend ${a.brand} in this scan.`
              : `No competitor is clearly out-recommending ${a.brand} yet.`}
      </div>
    </div>
  );
}
