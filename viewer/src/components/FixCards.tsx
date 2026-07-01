import type { FixCard } from "../types";
import { trackEvent } from "../api";

export function FixCards({ cards, paid = true, runId }: { cards: FixCard[]; paid?: boolean; runId?: string }) {
  const evidence = cards.filter((c) => c.tier === "evidence_backed");
  const hygiene = cards.filter((c) => c.tier === "general_hygiene");

  return (
    <div className="grid" style={{ gap: 22 }}>
      {!paid && (
        <div className="fix-upsell">
          <div>
            <b>You're seeing what to fix.</b> The full report writes the fixes for you — a drafted
            comparison page, product schema, and llms.txt, generated from this scan's real prompts
            and competitor proof.
          </div>
          <a
            className="btn btn-primary"
            href="#full-report-cta"
            onClick={() => trackEvent("cta_full_report", runId, { from: "fix_cards" })}
          >
            Unlock the done-for-you fixes
          </a>
        </div>
      )}

      <div>
        <div className="tierhead">
          <span className="t">✅ Evidence-backed</span>
          <span className="note">each step cites the exact shopper prompts/snippets from this scan that triggered it</span>
        </div>
        <div className="fixgrid">
          {evidence.map((c) => (
            <Card key={c.id} c={c} paid={paid} />
          ))}
        </div>
      </div>

      <div>
        <div className="tierhead">
          <span className="t">🧹 General hygiene</span>
          <span className="note">general best practices — not yet checked against your live store</span>
        </div>
        <div className="fixgrid">
          {hygiene.map((c) => (
            <Card key={c.id} c={c} paid={paid} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Card({ c, paid }: { c: FixCard; paid: boolean }) {
  return (
    <div className="card fixcard">
      <div className="fhead">
        <span className={`badge ${c.impact}`}>{c.impact.toUpperCase()} IMPACT</span>
      </div>
      <div className="ftitle">{c.title}</div>
      <div className="meta">
        <b>Why:</b> {c.why}
      </div>

      {paid && c.suggestedFix ? (
        <div className="meta">
          <b>Suggested step:</b> {c.suggestedFix}
        </div>
      ) : (
        <div className="fix-locked">
          🔒 <span>The done-for-you fix for this — written from this scan — is in the full report.</span>
        </div>
      )}

      {(c.relatedPrompts.length > 0 || c.relatedSnippets.length > 0) && (
        <details>
          <summary>Evidence from this scan</summary>
          {c.relatedPrompts.length > 0 && (
            <div className="meta" style={{ marginTop: 6 }}>
              <b>Lost prompts:</b>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {c.relatedPrompts.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          {c.relatedSnippets.map((s, i) => (
            <div className="ev" key={i}>
              "{s}"
            </div>
          ))}
        </details>
      )}

      {paid && c.verifyNote && <div className="verify">⚠️ Verify before publishing: {c.verifyNote}</div>}
    </div>
  );
}
