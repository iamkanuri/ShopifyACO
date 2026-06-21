import { useState } from "react";
import { getBenchmarks, runBenchmark, type RunBenchmarkResult } from "./appApi";
import { DemoBadge, Pct, StatePane, useLoaded } from "./ui";
import { Link } from "../router";

// Measure: start the loop. A merchant enters their brand + category + competitors and
// runs a benchmark across ChatGPT/Gemini/Perplexity. The preview is MOCK ($0); a live
// run (real engine spend) is an explicit opt-in. Below: their recent runs.
export function Measure() {
  const runs = useLoaded(() => getBenchmarks(), []);
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("");
  const [competitors, setCompetitors] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RunBenchmarkResult | null>(null);
  const [err, setErr] = useState("");

  async function run() {
    setErr(""); setResult(null);
    if (!brand.trim() || !category.trim()) { setErr("Brand and category are required."); return; }
    setBusy(true);
    const r = await runBenchmark({ brand: brand.trim(), category: category.trim(), competitors: competitors.split(",").map((s) => s.trim()).filter(Boolean) });
    setBusy(false);
    if (r.demo) { setErr("Connect your store to run a live benchmark. This is a preview."); return; }
    if (!r.ok) { setErr(r.error ?? "Run failed."); return; }
    setResult(r);
    runs.reload();
  }

  return (
    <div>
      <div className="al-page-head">
        <div>
          <h2>Measure <DemoBadge show={runs.demo} /></h2>
          <p className="muted">Run a benchmark across ChatGPT, Gemini and Perplexity. The preview is free; a live run uses real AI calls (cost-capped).</p>
        </div>
      </div>

      <div className="card al-measure">
        <div className="al-measure-grid">
          <label className="al-field"><span className="al-set-k">Brand</span><input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Caraway" /></label>
          <label className="al-field"><span className="al-set-k">Category</span><input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="non-toxic ceramic cookware" /></label>
          <label className="al-field al-measure-wide"><span className="al-set-k">Competitors (comma-separated)</span><input value={competitors} onChange={(e) => setCompetitors(e.target.value)} placeholder="GreenPan, Our Place, All-Clad" /></label>
        </div>
        <div className="al-measure-actions">
          <button className="btn btn-primary" disabled={busy} onClick={run}>{busy ? "Running…" : "Run benchmark (free preview)"}</button>
          <span className="muted al-fineprint" style={{ margin: 0 }}>Deterministic preview, $0. Live runs are gated + cost-capped.</span>
        </div>
        {err && <div className="al-note err" style={{ marginTop: 12 }}>{err}</div>}
        {result?.ok && (
          <div className="al-measure-result">
            <div className="al-measure-stat"><span className="al-set-k">Recommendation rate</span>{result.recommendationRate ? <Pct p={result.recommendationRate} /> : "—"}</div>
            <div className="al-measure-stat"><span className="al-set-k">Mention rate</span>{result.mentionRate ? <Pct p={result.mentionRate} /> : "—"}</div>
            <div className="al-measure-stat"><span className="al-set-k">Observations</span><b>{result.observationCount}</b></div>
            <Link to="/app/evidence" className="btn">Diagnose why →</Link>
          </div>
        )}
      </div>

      <div className="section">
        <h2>Recent runs</h2>
        <StatePane loading={runs.loading} empty={(runs.data?.runs ?? []).length === 0} emptyText="No runs yet. Run your first benchmark above.">
          <div className="card al-table-wrap">
            <table className="al-table">
              <thead><tr><th>Run</th><th>When</th><th>Prompts</th><th>Observations</th><th>Cost</th><th>Status</th></tr></thead>
              <tbody>
                {(runs.data?.runs ?? []).map((r) => (
                  <tr key={r.id}>
                    <td>#{r.id}</td>
                    <td className="muted">{new Date(r.started_at).toLocaleDateString()}</td>
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
