import { useState } from "react";
import { acknowledgeAlert, getAlerts, getSchedules } from "./appApi";
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
        <StatePane loading={s.loading} empty={schedules.length === 0} emptyText="No schedules. Set one up to re-check weekly.">
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
