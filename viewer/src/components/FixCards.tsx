import type { FixCard } from "../types";

export function FixCards({ cards }: { cards: FixCard[] }) {
  const evidence = cards.filter((c) => c.tier === "evidence_backed");
  const hygiene = cards.filter((c) => c.tier === "general_hygiene");

  return (
    <div className="grid" style={{ gap: 22 }}>
      <div>
        <div className="tierhead">
          <span className="t">✅ Evidence-backed</span>
          <span className="note">each step cites the exact shopper prompts/snippets from this scan that triggered it</span>
        </div>
        <div className="fixgrid">
          {evidence.map((c) => (
            <Card key={c.id} c={c} />
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
            <Card key={c.id} c={c} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Card({ c }: { c: FixCard }) {
  return (
    <div className="card fixcard">
      <div className="fhead">
        <span className={`badge ${c.impact}`}>{c.impact.toUpperCase()} IMPACT</span>
      </div>
      <div className="ftitle">{c.title}</div>
      <div className="meta">
        <b>Why:</b> {c.why}
      </div>
      <div className="meta">
        <b>Suggested step:</b> {c.suggestedFix}
      </div>

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

      {c.verifyNote && <div className="verify">⚠️ Verify before publishing: {c.verifyNote}</div>}
    </div>
  );
}
