import { useState } from "react";
import { diagnose, getFindings } from "./appApi";
import { ConfidenceBadge, DemoBadge, KindTag, StatePane, useLoaded } from "./ui";
import { Link } from "../router";

// Evidence: WHY you're losing. Each finding pairs the lost shopper moment (the AI
// answer + its citations) with the structural gap, and an intervention + the expected
// MECHANISM — always hedged, never a guaranteed outcome. When arrived at with ?run=,
// it can trigger the Phase-5 diagnosis for that run.
export function Evidence() {
  const runId = Number(new URLSearchParams(window.location.search).get("run")) || undefined;
  const f = useLoaded(() => getFindings(runId), [runId]);
  const findings = f.data?.findings ?? [];
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function runDiagnosis() {
    if (!runId) return;
    setBusy(true); setNote("");
    const r = await diagnose(runId);
    setBusy(false);
    setNote(r.ok ? "Diagnosis complete." : r.demo ? "Connect your store to diagnose a live run." : r.error ?? "Diagnosis failed.");
    if (r.ok) f.reload();
  }

  return (
    <div>
      <div className="al-page-head">
        <div>
          <h2>Evidence &amp; diagnosis <DemoBadge show={f.demo} /></h2>
          <p className="muted">Why AI assistants pick competitors over you — tied to the exact queries you lost.{runId ? ` Run #${runId}.` : ""}</p>
        </div>
        <div className="al-head-actions">
          {runId && <button className="btn" disabled={busy} onClick={runDiagnosis}>{busy ? "Diagnosing…" : "Run diagnosis"}</button>}
          <Link to={`/app/fixes${runId ? `?run=${runId}` : ""}`} className="btn">Turn into fixes →</Link>
        </div>
      </div>
      {note && <div className="al-note ok" style={{ marginBottom: 16 }}>{note}</div>}

      <StatePane loading={f.loading} empty={findings.length === 0} emptyText={runId ? "No findings for this run yet — click Run diagnosis to crawl competitors and diagnose the gap." : "No findings yet. Run a benchmark, then diagnose it."}>
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
