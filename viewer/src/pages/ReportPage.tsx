import { useEffect, useState } from "react";
import type { RunResults } from "../types";
import { Report } from "./Report";

export function ReportPage({ runId }: { runId: string }) {
  const [run, setRun] = useState<RunResults | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/runs/${runId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Run not found or not finished yet."))))
      .then((d) => !cancelled && setRun(d))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (error) return <div className="card empty">{error}</div>;
  if (!run?.analysis) return <div className="card empty">Loading report…</div>;
  return <Report run={run} runId={runId} reportMdUrl={`/api/runs/${runId}/report.md`} />;
}
