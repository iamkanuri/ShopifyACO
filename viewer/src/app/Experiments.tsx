import { getExperiments } from "./appApi";
import type { AppExperimentRow, Proportion } from "./fixtures";
import { CiBar, DemoBadge, Pct, StatePane, VerdictPill, useLoaded } from "./ui";

// Experiments: the differentiator — did the change actually work? Matched
// baseline/verification runs compared with CIs. "Inconclusive" is shown honestly,
// and every result carries its causation caveats.
export function Experiments() {
  const e = useLoaded(() => getExperiments(), []);
  const experiments = e.data?.experiments ?? [];

  return (
    <div>
      <div className="al-page-head">
        <div>
          <h2>Experiments <DemoBadge show={e.demo} /></h2>
          <p className="muted">Proof, not vibes: a benchmark before and after each change, compared with confidence intervals. We never claim causation.</p>
        </div>
      </div>

      <StatePane loading={e.loading} empty={experiments.length === 0} emptyText="No experiments yet. Apply a fix, then verify it.">
        <div className="grid">
          {experiments.map((x) => <ExperimentCard key={x.id} x={x} />)}
        </div>
      </StatePane>
    </div>
  );
}

function ExperimentCard({ x }: { x: AppExperimentRow }) {
  const r = x.result;
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
