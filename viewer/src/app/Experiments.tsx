import { useState } from "react";
import { getExperiments, startVerification, verifyExperiment } from "./appApi";
import { DEMO, type AppExperimentRow, type Proportion } from "./fixtures";
import { CiBar, DemoBadge, Pct, StatePane, VerdictPill, useLoaded } from "./ui";

// Experiments: the differentiator — did the change actually work? Matched
// baseline/verification runs compared with CIs. "Inconclusive" is shown honestly,
// and every result carries its causation caveats. Merchants START one here (capture
// a baseline), apply their change, then run the verification.
export function Experiments() {
  const e = useLoaded(() => getExperiments(), []);
  // Surface the demo pending experiment so the verify action is visible in preview.
  const experiments = e.demo ? [DEMO.pendingExperiment, ...(e.data?.experiments ?? [])] : (e.data?.experiments ?? []);

  return (
    <div>
      <div className="al-page-head">
        <div>
          <h2>Experiments <DemoBadge show={e.demo} /></h2>
          <p className="muted">Proof, not vibes: a benchmark before and after each change, compared with confidence intervals. We never claim causation.</p>
        </div>
      </div>

      <StartPanel onStarted={() => e.reload()} />

      <StatePane loading={e.loading} empty={experiments.length === 0} emptyText="No experiments yet. Start one below, apply your change, then verify it.">
        <div className="grid">
          {experiments.map((x) => <ExperimentCard key={x.id} x={x} onVerified={() => e.reload()} />)}
        </div>
      </StatePane>
    </div>
  );
}

function StartPanel({ onStarted }: { onStarted: () => void }) {
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("");
  const [competitors, setCompetitors] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function start() {
    if (!brand.trim() || !category.trim() || !description.trim()) { setMsg("Brand, category and what-you-changed are required."); return; }
    setBusy(true); setMsg("");
    const r = await startVerification({ brand: brand.trim(), category: category.trim(), competitors: competitors.split(",").map((s) => s.trim()).filter(Boolean), description: description.trim() });
    setBusy(false);
    setMsg(r.ok ? "Baseline captured. Apply your change, then run the verification below." : r.demo ? "Connect your store to start a verification." : r.error ?? "Could not start.");
    if (r.ok) onStarted();
  }

  return (
    <div className="card al-generate" style={{ marginBottom: 18 }}>
      <div className="al-measure-grid">
        <label className="al-field"><span className="al-set-k">Brand</span><input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Caraway" /></label>
        <label className="al-field"><span className="al-set-k">Category</span><input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="ceramic cookware" /></label>
        <label className="al-field"><span className="al-set-k">Competitors</span><input value={competitors} onChange={(e) => setCompetitors(e.target.value)} placeholder="GreenPan, Our Place" /></label>
        <label className="al-field"><span className="al-set-k">What did you change?</span><input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Added review schema" /></label>
      </div>
      <div className="al-measure-actions">
        <button className="btn btn-primary" disabled={busy} onClick={start}>{busy ? "Capturing baseline…" : "Start a verification (capture baseline)"}</button>
        <span className="muted al-fineprint" style={{ margin: 0 }}>Captures the BEFORE benchmark. Preview is $0.</span>
      </div>
      {msg && <div className="al-note ok" style={{ marginTop: 12 }}>{msg}</div>}
    </div>
  );
}

function ExperimentCard({ x, onVerified }: { x: AppExperimentRow; onVerified: () => void }) {
  const r = x.result;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function verify() {
    setBusy(true); setMsg("");
    const res = await verifyExperiment(x.id);
    setBusy(false);
    setMsg(res.ok ? "Verification complete." : res.demo ? "Connect your store to run the verification." : res.error ?? "Verification failed.");
    if (res.ok) onVerified();
  }

  if (x.verdict === "pending") {
    return (
      <div className="card al-exp">
        <div className="al-exp-top">
          <VerdictPill verdict="pending" />
          <span className="al-exp-metric">Baseline captured</span>
          <button className="btn btn-primary al-exp-verify" disabled={busy} onClick={verify}>{busy ? "Verifying…" : "Run verification"}</button>
        </div>
        <div className="al-exp-mrow"><span className="al-exp-mlabel">Baseline</span><Pct p={r.primary.baseline} /><CiBar p={r.primary.baseline} tone="neutral" /></div>
        <p className="muted al-fineprint">Apply your change, then run the verification to measure whether it moved {labelOf(r.primary.metric)} — with CIs and honest caveats.</p>
        {msg && <div className="al-note ok" style={{ marginTop: 10 }}>{msg}</div>}
      </div>
    );
  }

  return (
    <div className="card al-exp">
      <div className="al-exp-top">
        <VerdictPill verdict={x.verdict} />
        <span className="al-exp-metric">{labelOf(r.primary.metric)}</span>
      </div>

      <div className="al-exp-compare">
        <MetricRow label="Baseline" p={r.primary.baseline} tone="neutral" />
        <MetricRow label="Verification" p={r.primary.current} tone={x.verdict === "improved" ? "good" : x.verdict === "regressed" ? "bad" : "neutral"} />
      </div>
      <div className="al-exp-diff">
        Change: <b>{fmtDiff(r.primary.diff)}</b> <span className="muted">(95% CI {fmtSigned(r.primary.diffCiLow)} to {fmtSigned(r.primary.diffCiHigh)})</span>
      </div>

      {r.secondary.length > 0 && (
        <details className="al-exp-secondary">
          <summary>Secondary metrics</summary>
          {r.secondary.map((s) => (
            <div key={s.metric} className="al-exp-srow">
              <span>{labelOf(s.metric)}</span>
              <Pct p={s.baseline} ci={false} /> → <Pct p={s.current} ci={false} />
              <VerdictPill verdict={s.verdict} />
            </div>
          ))}
        </details>
      )}

      {r.comparability.length > 0 && (
        <div className="al-warns">
          {r.comparability.map((c, i) => <div key={i} className="al-warn">⚠ {c.message}</div>)}
        </div>
      )}

      <ul className="al-caveats">
        {r.caveats.map((c, i) => <li key={i} className="muted">{c}</li>)}
      </ul>
    </div>
  );
}

function MetricRow({ label, p, tone }: { label: string; p: Proportion; tone: "neutral" | "good" | "bad" }) {
  return (
    <div className="al-exp-mrow">
      <span className="al-exp-mlabel">{label}</span>
      <Pct p={p} />
      <CiBar p={p} tone={tone} />
    </div>
  );
}

const labelOf = (m: string) => ({ recommendationRate: "Recommendation rate", mentionRate: "Mention rate", topChoiceRate: "Top-choice rate", promptCoverage: "Prompt coverage", citationBackedRate: "Citation-backed rate" } as Record<string, string>)[m] ?? m;
const fmtDiff = (d: number | null) => (d == null ? "—" : `${d >= 0 ? "+" : ""}${Math.round(d * 100)} pts`);
const fmtSigned = (d: number) => `${d >= 0 ? "+" : ""}${Math.round(d * 100)}`;
