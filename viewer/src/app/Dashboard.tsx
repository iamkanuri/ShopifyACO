import { DEMO } from "./fixtures";
import { getAlerts } from "./appApi";
import { CiBar, DemoBadge, Pct, SeverityPill, useLoaded } from "./ui";
import { Onboarding } from "./Onboarding";
import { Link } from "../router";

// The /app home: where do I stand, and what's the next action across the loop.
export function Dashboard({ demo }: { demo: boolean }) {
  const d = DEMO.dashboard;
  const alerts = useLoaded(() => getAlerts("open"), []);

  return (
    <div>
      <div className="al-page-head">
        <div>
          <h2>Dashboard <DemoBadge show={demo} /></h2>
          <p className="muted">AI shopping visibility for <b>{DEMO.brand}</b> · {DEMO.category}</p>
        </div>
        <Link to="/app/evidence" className="btn btn-primary">See why you're losing →</Link>
      </div>

      {demo && <Onboarding />}

      <div className="al-hero">
        <div className="card al-score">
          <div className="al-score-ring" style={{ ["--p" as string]: d.score }}>
            <div className="al-score-inner"><span className="al-score-num">{d.score}</span><span className="al-score-den">/100</span></div>
          </div>
          <div>
            <div className="al-score-label">AI Visibility Score</div>
            <div className="muted al-score-basis">A documented, deterministic blend of recommendation rate, mention rate, average position and engine coverage — never a black box.</div>
          </div>
        </div>

        <div className="al-kpis">
          <div className="card al-kpi">
            <div className="al-kpi-label">Recommendation rate</div>
            <div className="al-kpi-val"><Pct p={d.recommendationRate} /></div>
            <CiBar p={d.recommendationRate} tone="bad" />
          </div>
          <div className="card al-kpi">
            <div className="al-kpi-label">Mention rate</div>
            <div className="al-kpi-val"><Pct p={d.mentionRate} /></div>
            <CiBar p={d.mentionRate} tone="neutral" />
          </div>
          <div className="card al-kpi">
            <div className="al-kpi-label">Weakest engine</div>
            <div className="al-kpi-val"><b>{d.weakestEngine}</b></div>
            <div className="muted al-kpi-sub">recommends you least often</div>
          </div>
          <div className="card al-kpi">
            <div className="al-kpi-label">Top in-niche threat</div>
            <div className="al-kpi-val"><b>{d.topThreat}</b></div>
            <div className="muted al-kpi-sub">winning the queries you lose</div>
          </div>
        </div>
      </div>

      <div className="al-loop">
        <LoopStep n={1} label="Measure" done sub={`Last run ${new Date(d.lastRunAt).toLocaleDateString()}`} to="/app/monitoring" />
        <LoopStep n={2} label="Diagnose" sub={`${d.openFindings} findings`} to="/app/evidence" cta />
        <LoopStep n={3} label="Fix" sub={`${d.pendingFixes} proposed`} to="/app/fixes" />
        <LoopStep n={4} label="Verify" sub="prove it worked" to="/app/experiments" />
        <LoopStep n={5} label="Monitor" sub={`${d.openAlerts} open alert`} to="/app/monitoring" />
      </div>

      <div className="section">
        <h2>Share of voice</h2>
        <div className="card al-sov">
          {d.shareOfVoice.map((s) => (
            <div key={s.key} className={`al-sov-row ${s.key === DEMO.brand ? "is-you" : ""}`}>
              <span className="al-sov-name">{s.key}{s.key === DEMO.brand ? " (you)" : ""}</span>
              <span className="al-sov-track"><span className="al-sov-fill" style={{ width: `${Math.round(s.share * 100)}%` }} /></span>
              <span className="al-sov-val">{Math.round(s.share * 100)}%</span>
            </div>
          ))}
          <p className="muted al-fineprint">Recommendation-weighted across competitors in this scan. Small-sample, single-run — directional.</p>
        </div>
      </div>

      <div className="section">
        <h2>Open alerts <DemoBadge show={alerts.demo} /></h2>
        <StateList loading={alerts.loading} items={alerts.data?.alerts ?? []} empty="No open alerts — your visibility is steady.">
          {(alerts.data?.alerts ?? []).map((a) => (
            <div key={a.id} className="card al-alert">
              <div className="al-alert-top"><SeverityPill severity={a.severity} /><span className="al-alert-title">{a.title}</span></div>
              <p className="muted">{a.detail}</p>
            </div>
          ))}
        </StateList>
      </div>
    </div>
  );
}

function LoopStep({ n, label, sub, to, done, cta }: { n: number; label: string; sub: string; to: string; done?: boolean; cta?: boolean }) {
  return (
    <Link to={to} className={`al-loopstep ${done ? "done" : ""} ${cta ? "cta" : ""}`}>
      <span className="al-loopstep-n">{n}</span>
      <span className="al-loopstep-label">{label}</span>
      <span className="al-loopstep-sub">{sub}</span>
    </Link>
  );
}

function StateList({ loading, items, empty, children }: { loading: boolean; items: unknown[]; empty: string; children: React.ReactNode }) {
  if (loading) return <div className="al-state">Loading…</div>;
  if (items.length === 0) return <div className="al-state al-empty">{empty}</div>;
  return <div className="grid">{children}</div>;
}
