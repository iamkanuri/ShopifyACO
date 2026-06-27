import { useState } from "react";
import { acknowledgeAlert, createSchedule, getAlerts, getBenchmarks, getSchedules } from "./appApi";
import { CADENCE_OPTIONS } from "./constants";
import { DemoBadge, SeverityPill, StatePane, useLoaded } from "./ui";

// Monitoring: recurring runs + alerts. Alerts only fire on statistically credible
// change (the CI of the difference excludes 0) — no cry-wolf on run-to-run noise.
export function Monitoring() {
  const s = useLoaded(() => getSchedules(), []);
  const a = useLoaded(() => getAlerts("open"), []);
  const [busy, setBusy] = useState<number | null>(null);
  const schedules = s.data?.schedules ?? [];
  const alerts = a.data?.alerts ?? [];

  async function ack(id: number) {
    setBusy(id);
    await acknowledgeAlert(id);
    setBusy(null);
    a.reload();
  }

  return (
    <div>
      <div className="al-page-head">
        <div>
          <h2>Monitoring <DemoBadge show={s.demo || a.demo} /></h2>
          <p className="muted">Keep watch on a cadence; get alerted only when a change is real, not noise.</p>
        </div>
      </div>

      <div className="section">
        <h2>Schedules</h2>
        <CreateSchedule onCreated={() => s.reload()} />
        <StatePane loading={s.loading} empty={schedules.length === 0} emptyText="No schedules yet — create one above to re-check on a cadence.">
          <div className="grid">
            {schedules.map((sc) => (
              <div key={sc.id} className="card al-sched">
                <div className="al-sched-main">
                  <span className={`al-dot ${sc.enabled ? "on" : "off"}`} />
                  <b>{sc.kind === "verification" ? "Re-verify fix" : "Re-run benchmark"}</b>
                  <span className="al-cadence">{sc.cadence}</span>
                </div>
                <div className="muted al-sched-meta">
                  next {new Date(sc.next_run_at).toLocaleDateString()}
                  {sc.last_run_at ? ` · last ${new Date(sc.last_run_at).toLocaleDateString()}` : " · not run yet"}
                </div>
              </div>
            ))}
          </div>
        </StatePane>
      </div>

      <div className="section">
        <h2>Alerts</h2>
        <StatePane loading={a.loading} empty={alerts.length === 0} emptyText="No open alerts — visibility is steady.">
          <div className="grid">
            {alerts.map((al) => (
              <div key={al.id} className="card al-alert">
                <div className="al-alert-top">
                  <SeverityPill severity={al.severity} />
                  <span className="al-alert-title">{al.title}</span>
                  <button className="btn al-ghost al-alert-ack" disabled={busy === al.id} onClick={() => ack(al.id)}>Acknowledge</button>
                </div>
                <p className="muted">{al.detail}</p>
              </div>
            ))}
          </div>
        </StatePane>
      </div>
    </div>
  );
}

// Create a recurring monitoring schedule for one of the shop's benchmarks. The backend
// re-runs it on the cadence and raises an alert only on a statistically credible change.
function CreateSchedule({ onCreated }: { onCreated: () => void }) {
  const runsL = useLoaded(() => getBenchmarks(), []);
  // One option per benchmark (its latest completed run), since multiple runs share a benchmark.
  const benches: Array<{ benchmarkId: number; runId: number; started_at: string }> = [];
  const seen = new Set<number>();
  for (const r of runsL.data?.runs ?? []) {
    if (r.status !== "completed" || r.benchmark_id == null || seen.has(r.benchmark_id)) continue;
    seen.add(r.benchmark_id);
    benches.push({ benchmarkId: r.benchmark_id, runId: r.id, started_at: r.started_at });
  }
  const [bid, setBid] = useState("");
  const [cadence, setCadence] = useState("weekly");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "err" | "info" } | null>(null);
  const chosen = bid || (benches[0] ? String(benches[0].benchmarkId) : "");

  async function create() {
    if (!chosen) return;
    setBusy(true); setMsg(null);
    const r = await createSchedule({ kind: "benchmark", benchmarkId: Number(chosen), cadence });
    setBusy(false);
    if (r.ok) { setMsg({ text: "Schedule created — we'll re-run on this cadence and alert only on a credible change.", tone: "ok" }); onCreated(); }
    else if (r.demo) setMsg({ text: "Open the app from the Shopify admin to schedule monitoring.", tone: "info" });
    else setMsg({ text: r.error ?? "Could not create schedule.", tone: "err" });
  }

  return (
    <div className="card al-generate" style={{ marginBottom: 16 }}>
      <div className="al-generate-main">
        <div>
          <div className="al-set-k">Schedule monitoring</div>
          <p className="muted" style={{ margin: "3px 0 0", fontSize: 12.5 }}>Re-run a benchmark on a cadence; get alerted only when a change is statistically credible — never on run-to-run noise.</p>
        </div>
        <select className="al-generate-select" value={chosen} disabled={busy || benches.length === 0} onChange={(e) => setBid(e.target.value)}>
          {benches.length === 0 && <option value="">No benchmarks yet</option>}
          {benches.map((b) => <option key={b.benchmarkId} value={b.benchmarkId}>Benchmark from run #{b.runId} · {new Date(b.started_at).toLocaleDateString()}</option>)}
        </select>
        <select className="al-generate-select" value={cadence} disabled={busy} onChange={(e) => setCadence(e.target.value)}>
          {CADENCE_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button className="btn btn-primary" disabled={busy || !chosen} onClick={create}>{busy ? "Scheduling…" : "Create schedule"}</button>
      </div>
      {benches.length === 0 && <div className="al-note info" style={{ marginTop: 12 }}>Run a benchmark first (Measure), then schedule it here.</div>}
      {msg && <div className={`al-note ${msg.tone}`} style={{ marginTop: 12 }}>{msg.text}</div>}
    </div>
  );
}
