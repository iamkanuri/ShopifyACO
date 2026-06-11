import type { MerchantAnalysis, RunResults } from "../types";
import { fmtUsd } from "../types";
import { ScorePanel } from "../components/ScorePanel";
import { StatTiles } from "../components/StatTiles";
import { Insight } from "../components/Insight";
import { Leaderboard } from "../components/Leaderboard";
import { EngineCards } from "../components/EngineCards";
import { GapAnalysis } from "../components/GapAnalysis";
import { LostPrompts } from "../components/LostPrompts";
import { FixCards } from "../components/FixCards";
import { ThreatCard } from "../components/ThreatCard";
import { WhatThisMeans } from "../components/WhatThisMeans";
import { ConfidenceBadge, RunSizeBadge } from "../components/Badges";
import { ExportBar } from "../components/ExportBar";
import { Pricing } from "../components/Pricing";

export function Report({
  run,
  runId,
  reportMdUrl,
}: {
  run: RunResults;
  runId?: string;
  reportMdUrl?: string;
}) {
  const a = run.analysis as MerchantAnalysis;

  return (
    <>
      <div className="runmeta">
        <span className="chip" style={{ fontWeight: 700 }}>
          {a.brand} · {a.category}
        </span>
        <RunSizeBadge runSize={a.runSize} />
        <ConfidenceBadge c={a.confidence} />
        {a.groundedEngines.map((e) => (
          <span className="chip" key={e}>
            <span className="dot" /> {e} · grounded
          </span>
        ))}
        {a.ungroundedEngines.map((e) => (
          <span className="chip warn" key={e}>
            <span className="dot" /> {e} · ungrounded
          </span>
        ))}
        <span className="chip">{a.basedOnResponses} grounded answers</span>
        <span className="chip">{fmtUsd(a.totalCostUsd)} spend</span>
      </div>

      <h1 className="report-headline">{a.headline}</h1>

      <ExportBar run={run} reportMdUrl={reportMdUrl} />

      <section className="hero section">
        <ScorePanel score={a.visibilityScore} />
        <StatTiles a={a} />
      </section>

      <section className="section">
        <Insight a={a} />
      </section>

      <section className="section">
        <WhatThisMeans a={a} />
      </section>

      <section className="section">
        <h2>Category leader vs your direct niche threat</h2>
        <ThreatCard a={a} />
      </section>

      <section className="section">
        <h2>Competitor leaderboard</h2>
        <Leaderboard rows={a.leaderboard} />
      </section>

      <section className="section">
        <h2>Engine breakdown</h2>
        <EngineCards engines={a.engineWeakness} brand={a.brand} />
      </section>

      <section className="section">
        <h2>Gap analysis — why AI picks your competitor</h2>
        <GapAnalysis a={a} />
      </section>

      <section className="section">
        <h2>Lost prompts</h2>
        <LostPrompts lost={a.lostPrompts} brand={a.brand} />
      </section>

      <section className="section">
        <h2>Recommended fixes</h2>
        <FixCards cards={a.fixCards} />
      </section>

      <section className="section no-print">
        <h2>Get the full report</h2>
        <Pricing runId={runId} />
      </section>

      <footer className="disclaimer">
        <p>
          AI answers vary by model, time, prompt, and location. Treat this as directional market
          intelligence, not a guarantee of ranking.
        </p>
        <p className="muted">{a.caveat}</p>
      </footer>
    </>
  );
}
