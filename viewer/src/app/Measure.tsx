import { useState } from "react";
import { useConfig } from "../config";
import { diagnose, getBenchmarks, runBenchmark, type RunBenchmarkResult } from "./appApi";
import { ConfirmRun, DemoBadge, Pct, StatePane, useLoaded } from "./ui";
import { navigate } from "../router";

// Measure: start the loop. A merchant enters their brand + category + competitors and runs
// a benchmark across ChatGPT/Gemini/Perplexity. Every run is a REAL, cost-CONFIRMED run
// (metered by the plan + the daily spend cap) — there is no silent $0 mock preview tier.
const MAX_MEASURE_PROMPTS = 12; // mirrors buildShopBenchmarkConfig's default cap
const MEASURE_ENGINES = ["openai", "gemini", "perplexity"];

export function Measure() {
  const runs = useLoaded(() => getBenchmarks(), []);
  const { scanCostPerCall } = useConfig();
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("");
  const [competitors, setCompetitors] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<RunBenchmarkResult | null>(null);
  const [err, setErr] = useState("");

  // Worst-case estimate (server-sourced per-call costs from /api/config), shown before spend.
  const estimateUsd = MAX_MEASURE_PROMPTS * MEASURE_ENGINES.reduce((s, e) => s + (scanCostPerCall[e] ?? 0), 0);

  function requestRun() {
    setErr(""); setResult(null);
    if (!brand.trim() || !category.trim()) { setErr("Brand and category are required."); return; }
    setConfirmOpen(true);
  }

  async function run() {
    setBusy(true);
    const r = await runBenchmark({ brand: brand.trim(), category: category.trim(), competitors: competitors.split(",").map((s) => s.trim()).filter(Boolean), live: true });
    setBusy(false);
    setConfirmOpen(false);
    if (r.demo) { setErr("Open the app from the Shopify admin (Apps → AI Visibility) to run against your store."); return; }
    if (!r.ok) { setErr(r.error ?? "Run failed."); return; }
    setResult(r);
    runs.reload();
  }

  // Kick off the Phase-5 diagnosis for this run (mock crawl, $0), then jump to Evidence.
  async function diagnoseAndGo() {
    const id = result?.runId;
    if (id) { setBusy(true); await diagnose(id); setBusy(false); }
    navigate(`/app/evidence${id ? `?run=${id}` : ""}`);
  }

  return (
    <div>
      <div className="al-page-head">
        <div>
          <h2>Measure <DemoBadge show={runs.demo} /></h2>
          <p className="muted">Run a benchmark across ChatGPT, Gemini and Perplexity — real AI calls, cost-capped and metered by your plan.</p>
        </div>
      </div>

      <div className="card al-measure">
        <div className="al-measure-grid">
          <label className="al-field"><span className="al-set-k">Brand</span><input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Olipop" /></label>
          <label className="al-field"><span className="al-set-k">Category</span><input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="prebiotic soda" /></label>
          <label className="al-field al-measure-wide"><span className="al-set-k">Competitors (comma-separated)</span><input value={competitors} onChange={(e) => setCompetitors(e.target.value)} placeholder="Poppi, Culture Pop, Health-Ade" /></label>
        </div>
        <div className="al-measure-actions">
          <button className="btn btn-primary" disabled={busy} onClick={requestRun}>{busy ? "Running…" : "Run benchmark"}</button>
          <span className="muted al-fineprint" style={{ margin: 0 }}>Real AI calls across ChatGPT, Gemini and Perplexity. Cost-capped; metered by your plan.</span>
        </div>
        <ConfirmRun
          open={confirmOpen}
          title="Run a live benchmark?"
          detail={`Up to ${MAX_MEASURE_PROMPTS} buyer-intent prompts × 3 assistants (ChatGPT, Gemini, Perplexity).`}
          estimateUsd={estimateUsd}
          busy={busy}
          confirmLabel="Yes, run benchmark"
          onConfirm={run}
          onCancel={() => setConfirmOpen(false)}
        />
        {err && <div className="al-note err" style={{ marginTop: 12 }}>{err}</div>}
        {result?.ok && (
          <div className="al-measure-result">
            <div className="al-measure-stat"><span className="al-set-k">Recommendation rate</span>{result.recommendationRate ? <Pct p={result.recommendationRate} /> : "—"}</div>
            <div className="al-measure-stat"><span className="al-set-k">Mention rate</span>{result.mentionRate ? <Pct p={result.mentionRate} /> : "—"}</div>
            <div className="al-measure-stat"><span className="al-set-k">Observations</span><b>{result.observationCount}</b></div>
            <button className="btn" disabled={busy} onClick={diagnoseAndGo}>Diagnose why →</button>
          </div>
        )}
      </div>

      <div className="section">
        <h2>Recent runs</h2>
        <StatePane loading={runs.loading} empty={(runs.data?.runs ?? []).length === 0} emptyText="No runs yet. Run your first benchmark above.">
          <div className="card al-table-wrap">
            <table className="al-table">
              <thead><tr><th>Run</th><th>When</th><th>Mode</th><th>Prompts</th><th>Observations</th><th>Cost</th><th>Status</th></tr></thead>
              <tbody>
                {(runs.data?.runs ?? []).map((r) => (
                  <tr key={r.id}>
                    <td>#{r.id}</td>
                    <td className="muted">{new Date(r.started_at).toLocaleDateString()}</td>
                    <td>{r.mode === "mock"
                      ? <span className="al-status status-mock" title="Deterministic $0 preview — not a real AI measurement">Mock</span>
                      : <span className="al-status status-live" title="Real AI calls (metered)">Live</span>}</td>
                    <td>{r.prompt_count}</td>
                    <td>{r.observation_count}</td>
                    <td className="muted">${Number(r.cost_usd).toFixed(2)}</td>
                    <td><span className={`al-status status-${r.status === "completed" ? "applied" : "approved"}`}>{r.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </StatePane>
      </div>
    </div>
  );
}
