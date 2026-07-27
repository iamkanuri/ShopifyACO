import type { VisibilityScore } from "../types";

// A number is never a failed requirement, so a number never gets the failure
// colour. Only a strong result is tinted (--pass); everything weaker is plain
// ink and lets the figure, the components and the `n=` do the talking. See the
// palette header in theme.css.
function scoreColor(score: number | null): string {
  if (score == null) return "var(--ink-3)";
  return score >= 70 ? "var(--pass)" : "var(--ink)";
}

export function ScorePanel({ score }: { score: VisibilityScore }) {
  const color = scoreColor(score.score);
  return (
    <div className="card scorecard">
      <div className="scoredial">
        <div
          className="ring"
          style={{ ["--p" as string]: score.score ?? 0, ["--ring-color" as string]: color }}
        >
          <div className="inner">
            <div className="num" style={{ color }}>
              {score.score ?? "—"}
            </div>
            <div className="den">{score.score == null ? "not enough data" : "/ 100"}</div>
          </div>
        </div>
        <div>
          <div className="label">AI buyer readiness</div>
          <div className="basis">
            Based on {score.basedOnResponses} grounded responses. Deterministic — every
            component is shown below, no black box.
          </div>
        </div>
      </div>

      <div className="components">
        {score.components.map((c) => (
          <div className="comp" key={c.key}>
            <div className="comp-top">
              <span>
                {c.label} <span className="muted">· {Math.round(c.weight * 100)}% weight</span>
              </span>
              <span className="pts">+{c.contribution.toFixed(1)} pts</span>
            </div>
            <div className="bar">
              <span style={{ width: `${Math.round(c.value * 100)}%` }} />
            </div>
            <div className="detail">{c.detail}</div>
          </div>
        ))}
        <div className="formula">{score.formula}</div>
      </div>
    </div>
  );
}
