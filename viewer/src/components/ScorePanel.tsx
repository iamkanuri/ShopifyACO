import type { VisibilityScore } from "../types";

function scoreColor(score: number): string {
  if (score >= 70) return "var(--good)";
  if (score >= 40) return "var(--warn)";
  return "var(--bad)";
}

export function ScorePanel({ score }: { score: VisibilityScore }) {
  const color = scoreColor(score.score);
  return (
    <div className="card scorecard">
      <div className="scoredial">
        <div
          className="ring"
          style={{ ["--p" as string]: score.score, ["--ring-color" as string]: color }}
        >
          <div className="inner">
            <div className="num" style={{ color }}>
              {score.score}
            </div>
            <div className="den">/ 100</div>
          </div>
        </div>
        <div>
          <div className="label">AI Visibility Score</div>
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
