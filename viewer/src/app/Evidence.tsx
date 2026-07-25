import { useState } from "react";
import { diagnose, getBenchmarks, getFindings } from "./appApi";
import type { AppFindingRow } from "./fixtures";
import { ConfidenceBadge, DemoBadge, KindTag, StatePane, useLoaded } from "./ui";
import { Link } from "../router";

// Evidence: WHY you're losing. Each finding pairs the lost shopper moment (the AI
// answer + its citations) with the structural gap, and an intervention + the expected
// MECHANISM — always hedged, never a guaranteed outcome. When arrived at with ?run=,
// it can trigger the Phase-5 diagnosis for that run.
export function Evidence() {
  // Reached with ?run= (from Measure / Fix Studio) pins that run; from the sidebar we default
  // to the latest completed run + offer a selector. The findings endpoint REQUIRES a runId, so
  // calling it without one 400s → the UI would otherwise fall back to the demo sample.
  const urlRun = Number(new URLSearchParams(window.location.search).get("run")) || undefined;
  const runsL = useLoaded(() => getBenchmarks(), []);
  const completed = (runsL.data?.runs ?? []).filter((r) => r.status === "completed");
  const [sel, setSel] = useState("");
  const runId = urlRun ?? (sel ? Number(sel) : completed[0]?.id);
  const f = useLoaded<{ findings: AppFindingRow[] }>(
    () => (runId ? getFindings(runId) : Promise.resolve({ data: { findings: [] }, demo: false })),
    [runId],
  );
  const findings = f.data?.findings ?? [];
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; tone: "ok" | "err" | "info" } | null>(null);

  async function runDiagnosis() {
    if (!runId) return;
    setBusy(true);
    setNote({ text: "Diagnosing — crawling the competitors your answers cited. This runs in the background and can take 30–60s…", tone: "info" });
    const r = await diagnose(runId);
    if (!r.ok) {
      setBusy(false);
      setNote(r.demo
        ? { text: "Connect your store from the Shopify admin to diagnose a live run.", tone: "info" }
        : { text: r.error ?? "Diagnosis failed.", tone: "err" });
      return;
    }
    // When the durable queue is on, diagnosis runs ASYNC on the worker — the response is just
    // "queued", findings aren't ready yet. Poll until they land (ignoring any transient demo
    // fallback) instead of falsely reporting "complete" against an empty screen.
    if (!(r.data as { queued?: boolean } | undefined)?.queued) {
      setBusy(false); setNote({ text: "Diagnosis complete.", tone: "ok" }); f.reload();
      return;
    }
    const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
    for (let i = 0; i < 18; i++) { // ~90s
      await sleep(5000);
      const fr = await getFindings(runId);
      const count = fr.demo ? 0 : (fr.data?.findings?.length ?? 0);
      if (count > 0) {
        setBusy(false);
        setNote({ text: `Diagnosis complete — ${count} finding${count === 1 ? "" : "s"}.`, tone: "ok" });
        f.reload();
        return;
      }
    }
    setBusy(false);
    setNote({ text: "Diagnosis finished. If no findings appear, this run had no clear evidence-backed gap — re-run the live benchmark for more cited answers, or your brand may already be well-covered for these prompts.", tone: "info" });
    f.reload();
  }

  return (
    <div>
      <div className="al-page-head">
        <div>
          <h2>Evidence &amp; diagnosis <DemoBadge show={f.demo} /></h2>
          <p className="muted">Why AI assistants pick competitors over you — tied to the exact queries you lost.{runId ? ` Run #${runId}.` : ""}</p>
        </div>
        <div className="al-head-actions">
          {!urlRun && completed.length > 0 && (
            <select className="al-generate-select" value={sel} disabled={busy} onChange={(e) => setSel(e.target.value)}>
              <option value="">{`Latest run (#${completed[0]?.id})`}</option>
              {completed.map((r) => <option key={r.id} value={r.id}>Run #{r.id} · {new Date(r.started_at).toLocaleDateString()}</option>)}
            </select>
          )}
          {runId && <button className="btn" disabled={busy} onClick={runDiagnosis}>{busy ? "Diagnosing…" : "Run diagnosis"}</button>}
          <Link to={`/app/fixes${runId ? `?run=${runId}` : ""}`} className="btn">Turn into fixes →</Link>
        </div>
      </div>
      {note && <div className={`al-note ${note.tone}`} style={{ marginBottom: 16 }}>{note.text}</div>}

      <StatePane loading={f.loading} empty={findings.length === 0} emptyText={runId ? "No findings for this run yet — click Run diagnosis to crawl competitors and diagnose the gap." : "Run a benchmark first (Measure), then diagnose it here."}>
        <div className="grid">
          {findings.map((finding) => (
            <div key={finding.id} className="card al-finding">
              <div className="al-finding-top">
                <KindTag kind={finding.kind} />
                <ConfidenceBadge level={finding.confidence_level} />
                {finding.crawl_mode === "mock" && (
                  <span className="al-demo al-demo-err" title="This finding came from a mock (fixture) crawl — the pages behind it were NOT your live store. Re-run diagnosis on a live-crawl deployment for real observations.">
                    Fixture crawl — not your live store
                  </span>
                )}
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
                        <a key={i} className="al-cite" href={c} target="_blank" rel="noopener noreferrer">{hostOf(c)}</a>
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
