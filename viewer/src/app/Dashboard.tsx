import { DEMO } from "./fixtures";
import { getAlerts, getDashboard } from "./appApi";
import { CiBar, DemoBadge, Pct, SeverityPill, useLoaded } from "./ui";
import { Onboarding } from "./Onboarding";
import { Link } from "../router";

// The /app home: where do I stand, and what's the next action across the loop. For a
// connected merchant this is THEIR own data (GET /app/api/dashboard); for a prospect /
// local preview with no shop session it falls back to the labeled Olipop sample.
export function Dashboard() {
  const dash = useLoaded(() => getDashboard(), []);
  const alerts = useLoaded(() => getAlerts("open"), []);

  if (dash.loading) return <div className="al-state">Loading your dashboard…</div>;

  const env = dash.data!;        // AppDashboard — live (connected) or demo fallback
  const demo = dash.demo;        // true → no shop session, showing the labeled sample
  const liveError = demo && Boolean(dash.error); // connected but the live call failed
  const connected = !demo;

  // Connected, but no completed benchmark yet → guide them to run the first one. Never
  // show sample numbers to a connected merchant.
  if (connected && !env.hasData) return <DashboardEmpty />;

  const d = env.data ?? DEMO.dashboard; // real metrics, or the sample when not connected
  const brand = connected ? env.brand : DEMO.brand;
  const category = connected ? env.category : DEMO.category;

  // Standing-aware CTA: "why you're losing" only when a competitor actually tops the share of voice.
  // A category leader (or an empty scan) gets a neutral "where you stand", never "why you're losing".
  const topSov = d.shareOfVoice[0];
  const losing = topSov != null && topSov.key.trim().toLowerCase() !== brand.trim().toLowerCase();

  return (
    <div>
      <div className="al-page-head">
        <div>
          <h2>Dashboard</h2>
          {liveError ? (
            <p className="al-sample-line">
              <span className="al-sample-tag al-sample-tag-err">Sample</span>
              Couldn't load your live dashboard — showing example data. This is an error, not your results; please retry. <span className="muted">({dash.error})</span>
            </p>
          ) : demo ? (
            <p className="al-sample-line">
              <span className="al-sample-tag">Sample</span>
              Example store <b>{brand}</b> · {category} — a preview of your dashboard.{" "}
              Connect your store to see your own numbers.
            </p>
          ) : (
            <p className="al-sample-line">
              Your store <b>{brand}</b>{category ? <> · {category}</> : null} — measured across ChatGPT, Gemini and Perplexity.
            </p>
          )}
        </div>
        <Link to="/app/evidence" className="btn btn-primary">{losing ? "See why you're losing →" : "See where you stand →"}</Link>
      </div>

      {demo && <Onboarding />}

      <div className="al-hero">
        <div className="card al-score">
          <div className="al-score-ring" style={{ ["--p" as string]: d.score ?? 0 }}>
            <div className="al-score-inner"><span className="al-score-num">{d.score ?? "—"}</span><span className="al-score-den">{d.score == null ? "" : "/100"}</span></div>
          </div>
          <div>
            <div className="al-score-label">AI Visibility Score</div>
            <div className="muted al-score-basis">A documented, deterministic blend of recommendation rate, mention rate, rank quality and competitive standing — never a black box.</div>
          </div>
        </div>

        <div className="al-kpis">
          <div className="card al-kpi">
            <div className="al-kpi-label">Recommendation rate</div>
            <div className="al-kpi-val"><Pct p={d.recommendationRate} /></div>
            {/* The leader's flagship metric shouldn't be red — tone follows standing. */}
            <CiBar p={d.recommendationRate} tone={losing ? "bad" : topSov != null ? "good" : "neutral"} />
          </div>
          <div className="card al-kpi">
            <div className="al-kpi-label">Mention rate</div>
            <div className="al-kpi-val"><Pct p={d.mentionRate} /></div>
            <CiBar p={d.mentionRate} tone="neutral" />
          </div>
          <div className="card al-kpi">
            <div className="al-kpi-label">Weakest engine</div>
            <div className="al-kpi-val"><b>{d.weakestEngine ?? "—"}</b></div>
            <div className="muted al-kpi-sub">{d.weakestEngine ? "recommends you least often" : "not enough data yet"}</div>
          </div>
          <div className="card al-kpi">
            {/* For a leader the top rival isn't "winning the queries you lose" — it's the one to watch. */}
            <div className="al-kpi-label">{losing ? "Top in-niche threat" : "Closest rival"}</div>
            <div className="al-kpi-val"><b>{d.topThreat ?? "—"}</b></div>
            <div className="muted al-kpi-sub">{d.topThreat ? (losing ? "winning the queries you lose" : "the rival AI recommends next") : "no competitor recommended yet"}</div>
          </div>
        </div>
      </div>

      <div className="al-loop">
        <LoopStep n={1} label="Measure" done={d.lastRunAt != null} sub={d.lastRunAt ? `Last run ${new Date(d.lastRunAt).toLocaleDateString()}` : "no run yet"} to="/app/measure" />
        <LoopStep n={2} label="Diagnose" sub={`${d.openFindings} finding${d.openFindings === 1 ? "" : "s"}`} to="/app/evidence" cta />
        <LoopStep n={3} label="Fix" sub={`${d.pendingFixes} proposed`} to="/app/fixes" />
        <LoopStep n={4} label="Verify" sub="prove it worked" to="/app/experiments" />
        <LoopStep n={5} label="Monitor" sub={`${d.openAlerts} open alert${d.openAlerts === 1 ? "" : "s"}`} to="/app/monitoring" />
      </div>

      <div className="section">
        <h2>Share of voice</h2>
        <div className="card al-sov">
          {d.shareOfVoice.length === 0 && <p className="muted">No brand was recommended in this scan yet.</p>}
          {d.shareOfVoice.map((s) => {
            const you = s.key.trim().toLowerCase() === brand.trim().toLowerCase();
            return (
              <div key={s.key} className={`al-sov-row ${you ? "is-you" : ""}`}>
                <span className="al-sov-name">{s.key}{you ? " (you)" : ""}</span>
                <span className="al-sov-track"><span className="al-sov-fill" style={{ width: `${Math.round(s.share * 100)}%` }} /></span>
                <span className="al-sov-val">{Math.round(s.share * 100)}%</span>
              </div>
            );
          })}
          <p className="muted al-fineprint">Recommendation-weighted across competitors in this scan. Small-sample, single-run — directional.</p>
        </div>
      </div>

      <div className="section">
        <h2>Open alerts <DemoBadge show={alerts.demo} error={alerts.error} /></h2>
        <StateList loading={alerts.loading} items={alerts.data?.alerts ?? []} empty="No open alerts. Add a Monitoring schedule to get alerted when your AI visibility changes.">
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

// Connected store with no completed benchmark yet. We have their session but no numbers —
// so we prompt the first measurement instead of ever showing the sample as if it were theirs.
function DashboardEmpty() {
  return (
    <div>
      <div className="al-page-head">
        <div>
          <h2>Dashboard</h2>
          <p className="al-sample-line">Store connected. Run your first benchmark to see your AI visibility.</p>
        </div>
        <Link to="/app/measure" className="btn btn-primary">Run a benchmark →</Link>
      </div>
      <div className="card al-onboard">
        <div className="al-onboard-head">
          <h3>You're connected — let's get your first numbers</h3>
          <p className="muted">A benchmark asks ChatGPT, Gemini and Perplexity buyer-intent questions and measures whether they recommend you. It makes real AI calls (cost-capped, metered by your plan) and shows the estimated cost before you run.</p>
        </div>
        <div className="al-onboard-steps">
          <div className="al-onboard-step">
            <span className="al-onboard-n">1</span>
            <div className="al-onboard-body">
              <div className="al-onboard-t">Sync your catalog</div>
              <div className="muted al-onboard-d">Pull your products so benchmarks and fixes can use them. Free.</div>
            </div>
            <Link to="/app/catalog" className="btn">Go to Catalog</Link>
          </div>
          <div className="al-onboard-step">
            <span className="al-onboard-n">2</span>
            <div className="al-onboard-body">
              <div className="al-onboard-t">Measure your visibility</div>
              <div className="muted al-onboard-d">Run a benchmark across the three assistants and populate this dashboard.</div>
            </div>
            <Link to="/app/measure" className="btn btn-primary">Run a benchmark</Link>
          </div>
        </div>
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
