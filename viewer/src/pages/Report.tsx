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
import { CitedSources } from "../components/CitedSources";
import { useConfig } from "../config";

export function Report({
  run,
  runId,
  reportMdUrl,
  isShopify,
  storeUrlHint,
  paid = true,
  purchased = false,
  failed = false,
}: {
  run: RunResults;
  runId?: string;
  reportMdUrl?: string;
  isShopify?: boolean;
  /** Prefill for the paid-step store-URL capture (confirm vs re-type). */
  storeUrlHint?: string | null;
  /** Paid-report Phase 1: false hides the executed "how" (done-for-you fixes) behind the
   *  $29 upgrade. Defaults to true so the demo/showcase renders the full experience. */
  paid?: boolean;
  /** The viewer already BOUGHT this report (real purchase, not the demo showcase). Hides the
   *  $29 upsell (keeps the Shopify-install bridge). Distinct from `paid`: the demo sets
   *  paid=true to unlock the full experience but leaves purchased=false so it still upsells. */
  purchased?: boolean;
  /** Genuine paid-generation failure (refunded). The banner + retry live in ReportPage; here we
   *  just suppress the $29 same-run re-buy (which would recur on the same failed config) — the
   *  retry is a fresh scan — while keeping the Shopify-install bridge. */
  failed?: boolean;
}) {
  const a = run.analysis as MerchantAnalysis;
  const { plans } = useConfig(); // gate the "See all plans" accordion — never render it empty

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

      {/* Lead: the substitution frame — where you stand in AI's recommendation decision, naming who
          AI recommends instead. Severity-selected copy (brutal → stark number-led; mild → reframe-led).
          Falls back to the legacy score-led headline for pre-frame results (frame absent). */}
      {a.substitutionFrame ? (
        <section className="frame-lead" data-severity={a.substitutionFrame.severity ?? "neutral"}>
          <h1 className="frame-headline">{a.substitutionFrame.headline}</h1>
          <p className="frame-subline">{a.substitutionFrame.subline}</p>
        </section>
      ) : (
        <h1 className="report-headline">{a.headline}</h1>
      )}

      <ExportBar run={run} reportMdUrl={reportMdUrl} />

      {/* The score, DEMOTED below the verdict — the summary of it, not the lead. */}
      {a.substitutionFrame && <p className="frame-scoreproof">{a.substitutionFrame.scoreProof}</p>}

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
      <Collapse title={a.ownLeadsCategory ? "Your category standing + nearest challenger" : "Category leader vs your direct niche threat"} open>
        <ThreatCard a={a} />
      </Collapse>

      <Collapse title="Competitor leaderboard">
        <Leaderboard rows={a.leaderboard} />
      </Collapse>

      <Collapse title="Engine breakdown">
        <EngineCards engines={a.engineWeakness} brand={a.brand} />
      </Collapse>

      <Collapse title={a.ownLeadsCategory ? "Category performance — where you lead and who's closest" : "Gap analysis — why AI picks your competitor"}>
        <GapAnalysis a={a} />
      </Collapse>

      <Collapse title={a.ownLeadsCategory ? `The few prompts where a rival edged ahead (${a.lostPrompts.length} of ${a.basedOnResponses})` : "Lost prompts"}>
        <LostPrompts lost={a.lostPrompts} brand={a.brand} ownLeads={a.ownLeadsCategory} />
      </Collapse>

      {a.citedSources && a.citedSources.overall.n > 0 && (
        <Collapse title="Where AI grounds its answers — cited sources">
          <CitedSources report={a.citedSources} brand={a.brand} />
        </Collapse>
      )}

      <Collapse title="Recommended next steps">
        <FixCards cards={a.fixCards} paid={paid} runId={runId} />
      </Collapse>

      <section className="section no-print" id="full-report-cta">
        <h2>{failed ? "Prefer to run this on your store?" : purchased || isShopify ? "Fix this on your store" : "Get your done-for-you fixes"}</h2>
        <p className="muted">
          {failed
            ? "Install AisleLens to run your AI-visibility report right inside Shopify — and apply the fixes automatically."
            : purchased
            ? "You've got the full report. Install AisleLens on your Shopify store to apply these fixes and keep watching your AI visibility automatically."
            : isShopify
            ? "AisleLens installs on your Shopify store to diagnose why AI picks competitors — and helps you fix it."
            : "Everything above is your free diagnosis. The paid report adds the done-for-you fix drafts — a “you vs your rival” comparison page, llms.txt, and Product schema, written from your real store data and ready to paste. On Shopify? Install AisleLens free instead."}
        </p>
        {/* On a genuine failure, suppress the $29 same-run re-buy (retry is a fresh scan, in the
            banner above) — show only the Shopify-install bridge. `purchased || failed` = install-only. */}
        <FunnelCta isShopify={isShopify} runId={runId} purchased={purchased || failed} storeUrlHint={storeUrlHint} />
        {/* Only offer the plans accordion when plans actually loaded — never an expander that opens to nothing. */}
        {!purchased && !failed && plans.length > 0 && (
          <details className="report-collapse" style={{ marginTop: 18 }}>
            <summary>See all plans</summary>
            <div className="rc-body"><Pricing runId={runId} /></div>
          </details>
        )}
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
