import type { CitedSourcesReport, CitedSourceBucket } from "../types";

function Bucket({ b, blurb }: { b: CitedSourceBucket; blurb: string }) {
  return (
    <div className="cited-bucket">
      <div className="cited-blurb">{blurb} <b>(n={b.n} answers)</b></div>
      {b.sources.length === 0 ? (
        <div className="muted">—</div>
      ) : (
        <div className="cited-list">
          {b.sources.slice(0, 8).map((s) => (
            <div className="cited-row" key={s.domain} title={s.examplePrompts[0] ?? ""}>
              <span className="cited-count">{s.count}×</span>
              <span className="cited-domain">{s.domain}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The "AI trust graph": the source domains assistants CITED while answering — OBSERVED, not causal. */
export function CitedSources({ report, brand }: { report: CitedSourcesReport; brand: string }) {
  const { overall, onLostAnswers, byEngine } = report;
  if (overall.n === 0) {
    return (
      <p className="muted">
        No cited sources captured for this scan — either the answers weren't web-grounded, or this is an
        older run from before source capture.
      </p>
    );
  }
  return (
    <div className="cited-sources">
      <p className="muted">
        Where assistants <b>grounded</b> their answers — the sources they cited. This is <b>observed</b> (the
        assistant cited it while answering), not proof a citation caused a pick. The count is how many answers
        cited each source; <b>n=</b> is answers that carried any citation. These sets vary run-to-run.
      </p>
      {onLostAnswers.n > 0 && (
        <Bucket b={onLostAnswers} blurb={`In the answers ${brand} lost, assistants cited — get third-party proof here:`} />
      )}
      <Bucket b={overall} blurb="Across all answers, assistants cited:" />
      {Object.keys(byEngine).length > 1 && (
        <details className="report-collapse" style={{ marginTop: 10 }}>
          <summary>By assistant</summary>
          <div className="rc-body">
            {Object.entries(byEngine).map(([eng, b]) => (
              <div key={eng} style={{ marginBottom: 12 }}>
                <div className="cited-engine">{eng}</div>
                <Bucket b={b} blurb="cited:" />
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
