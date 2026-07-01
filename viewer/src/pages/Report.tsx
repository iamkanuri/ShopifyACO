import { useEffect } from "react";
import type { MerchantAnalysis, RunResults } from "../types";
import { trackEvent } from "../api";
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
import { FunnelCta } from "../components/FunnelCta";

export function Report({
  run,
  runId,
  reportMdUrl,
  isShopify,
  paid = true,
}: {
  run: RunResults;
  runId?: string;
  reportMdUrl?: string;
  isShopify?: boolean;
  /** Paid-report Phase 1: false hides the executed "how" (done-for-you fixes) behind the
   *  $29 upgrade. Defaults to true so the demo/showcase renders the full experience. */
  paid?: boolean;
}) {
  const a = run.analysis as MerchantAnalysis;

  // Friendly engine names for the status chips (data uses provider ids).
  const ENG: Record<string, string> = { openai: "ChatGPT", gemini: "Gemini", perplexity: "Perplexity" };
  const eng = (e: string) => ENG[e] ?? e;

  // Honest partial-failure surface: count real engine errors (not deliberate
  // cost/time skips) so a flaky engine is visible, not silently dropped.
  const engineFailures = (run.results ?? []).reduce<Record<string, number>>((m, r) => {
    if (r.error && !r.error.startsWith("skipped:")) m[r.engine] = (m[r.engine] ?? 0) + 1;
    return m;
  }, {});
  const failedEntries = Object.entries(engineFailures);

  useEffect(() => {
    trackEvent("report_viewed", runId, { brand: a.brand, score: a.visibilityScore.score });
  }, [runId, a.brand]);

  return (
    <>
      <div className="runmeta">
        <span className="chip" style={{ fontWeight: 700 }}>
          {a.brand} · {a.category}
        </span>
        <RunSizeBadge runSize={a.runSize} />
        <ConfidenceBadge c={a.confidence} />
        {a.groundedEngines.map((e) => (
          <span className="chip" key={e} title="This assistant searched the live web before answering.">
            <span className="dot" /> {eng(e)} · live web
          </span>
        ))}
        {a.ungroundedEngines.map((e) => (
          <span className="chip warn" key={e} title="This assistant answered from its training data only — no live web search.">
            <span className="dot" /> {eng(e)} · no web search
          </span>
        ))}
        <span className="chip">{a.basedOnResponses} answers analyzed</span>
        {failedEntries.map(([e, n]) => (
          <span className="chip warn" key={`fail-${e}`} title="These calls errored and are excluded from the rates below">
            <span className="dot" /> {eng(e)} · {n} failed
          </span>
        ))}
      </div>
      <p className="runmeta-legend muted">
        These are status labels (not buttons). <b>“Live web”</b> means the assistant searched the
        web before answering — what matters for shopping questions.
        {a.ungroundedEngines.length > 0 && " “No web search” means it answered from training data only."}
        {failedEntries.length > 0 && " Failed calls are excluded — rates reflect only answers that succeeded."}
      </p>

      {/* Lead: one verdict headline + the key sub-metrics. */}
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

      {a.discoveredBrands && a.discoveredBrands.length > 0 && (
        <section className="section">
          <div className="card discovered">
            <div className="disc-head">AI is recommending brands you didn't list</div>
            <p className="muted" style={{ marginTop: 4 }}>
              Discovered in your scan — <b>directional</b>, ranked by how many of your {a.basedOnResponses} answers
              each appeared in. Not measured as competitors, just surfaced so you know who's actually in the room.
            </p>
            <div className="disc-tags">
              {a.discoveredBrands.map((b) => (
                <span className="disc-tag" key={b.name}>
                  <b>{b.name}</b> <span className="muted">· seen in {b.answers}</span>
                </span>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Detail: collapsed by default, expand on demand. */}
      <Collapse title="Category leader vs your direct niche threat" open>
        <ThreatCard a={a} />
      </Collapse>

      <Collapse title="Competitor leaderboard">
        <Leaderboard rows={a.leaderboard} />
      </Collapse>

      <Collapse title="Engine breakdown">
        <EngineCards engines={a.engineWeakness} brand={a.brand} />
      </Collapse>

      <Collapse title="Gap analysis — why AI picks your competitor">
        <GapAnalysis a={a} />
      </Collapse>

      <Collapse title="Lost prompts">
        <LostPrompts lost={a.lostPrompts} brand={a.brand} />
      </Collapse>

      <Collapse title="Recommended next steps">
        <FixCards cards={a.fixCards} paid={paid} runId={runId} />
      </Collapse>

      <section className="section no-print" id="full-report-cta">
        <h2>{isShopify ? "Fix this on your store" : "Get the full report"}</h2>
        <p className="muted">
          {isShopify
            ? "AisleLens installs on your Shopify store to diagnose why AI picks competitors — and helps you fix it."
            : "A hand-reviewed deep report, or install AisleLens free if you're on Shopify."}
        </p>
        <FunnelCta isShopify={isShopify} runId={runId} />
        <details className="report-collapse" style={{ marginTop: 18 }}>
          <summary>See all plans</summary>
          <div className="rc-body"><Pricing runId={runId} /></div>
        </details>
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

/** Collapsible report section — header reads like the old <h2>, body hidden until
 *  expanded. Keeps the result dense but scannable (progressive disclosure). */
function Collapse({ title, children, open }: { title: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details className="section report-collapse" open={open}>
      <summary>{title}</summary>
      <div className="rc-body">{children}</div>
    </details>
  );
}
