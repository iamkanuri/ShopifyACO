import { getFindings } from "./appApi";
import { ConfidenceBadge, DemoBadge, KindTag, StatePane, useLoaded } from "./ui";
import { Link } from "../router";

// Evidence: WHY you're losing. Each finding pairs the lost shopper moment (the AI
// answer + its citations) with the structural gap, and an intervention + the expected
// MECHANISM — always hedged, never a guaranteed outcome.
export function Evidence() {
  const f = useLoaded(() => getFindings(), []);
  const findings = f.data?.findings ?? [];

  return (
    <div>
      <div className="al-page-head">
        <div>
          <h2>Evidence &amp; diagnosis <DemoBadge show={f.demo} /></h2>
          <p className="muted">Why AI assistants pick competitors over you — tied to the exact queries you lost.</p>
        </div>
        <Link to="/app/fixes" className="btn">Turn into fixes →</Link>
      </div>

      <StatePane loading={f.loading} empty={findings.length === 0} emptyText="No findings yet. Run a benchmark to diagnose your gaps.">
        <div className="grid">
          {findings.map((finding) => (
            <div key={finding.id} className="card al-finding">
              <div className="al-finding-top">
                <KindTag kind={finding.kind} />
                <ConfidenceBadge level={finding.confidence_level} />
                {finding.basis_n > 0 && <span className="muted al-basis">{finding.basis_n} lost responses</span>}
              </div>

              <div className="al-finding-gap">{finding.merchant_gap.join("; ")}</div>

              {finding.ai_answer_snippet && (
                <blockquote className="al-quote">
                  <span className="al-quote-label">{finding.engine} answered “{finding.prompt_text}”</span>
                  “{finding.ai_answer_snippet}”
                  {finding.citations.length > 0 && (
                    <div className="al-cites">
                      cited: {finding.citations.map((c, i) => (
                        <span key={i} className="al-cite">{hostOf(c)}</span>
                      ))}
                    </div>
                  )}
                </blockquote>
              )}

              {finding.competitor_advantage.length > 0 && (
                <div className="al-adv"><b>{finding.winning_competitor}</b> {finding.competitor_advantage.join("; ")}</div>
              )}

              <div className="al-rec">
                <div className="al-rec-do"><span className="al-rec-k">Do</span>{finding.recommended_intervention}</div>
                <div className="al-rec-why"><span className="al-rec-k">Why it may help</span>{finding.expected_mechanism}</div>
              </div>

              <p className="muted al-fineprint">{finding.limits}</p>
            </div>
          ))}
        </div>
      </StatePane>
    </div>
  );
}

function hostOf(u: string): string {
  try { return new URL(u).host.replace(/^www\./, ""); } catch { return u; }
}
