import type { FixCard, MerchantAnalysis } from "../types";

/** Plain-English "what this means" + the single top evidence-backed next action. */
export function WhatThisMeans({ a }: { a: MerchantAnalysis }) {
  const next: FixCard | undefined = a.fixCards.find((c) => c.tier === "evidence_backed");
  return (
    <div className="grid wtm-grid">
      <div className="card wtm">
        <h3>What this means</h3>
        <ul>
          {a.whatThisMeans.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </div>
      {next && (
        <div className="card nba">
          <div className="nba-tag">Next best action</div>
          <div className="nba-title">{next.title}</div>
          <div className="nba-why">{next.why}</div>
          {next.verifyNote && <div className="verify">⚠️ Verify before publishing: {next.verifyNote}</div>}
        </div>
      )}
    </div>
  );
}
