import { useEffect, useState } from "react";
import type { RunResults } from "../types";
import { Link } from "../router";
import { Report } from "./Report";

export function ReportPage({ runId }: { runId: string }) {
  const [run, setRun] = useState<RunResults | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/runs/${runId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("This report isn't available — it may still be running, or the link is wrong."))))
      .then((d) => !cancelled && setRun(d))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (error)
    return (
      <div className="card center-card">
        <h2>Report not available</h2>
        <p className="muted">{error}</p>
        <Link to="/scan" className="btn btn-primary">
          Run a free scan
        </Link>
      </div>
    );
  if (!run?.analysis)
    return (
      <div className="card center-card">
        <div className="spinner" />
        <h2 style={{ marginTop: 18 }}>Loading your report…</h2>
        <p className="muted">Fetching results and AI-visibility analysis.</p>
      </div>
    );
  return <Report run={run} runId={runId} reportMdUrl={`/api/runs/${runId}/report.md`} />;
}
