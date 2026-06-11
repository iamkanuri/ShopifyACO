import { useEffect, useState } from "react";
import type { RunResults } from "../types";
import { Report } from "./Report";
import { useConfig } from "../config";

export function DemoPage() {
  const { demoNote } = useConfig();
  const [run, setRun] = useState<RunResults | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/sample-results.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Demo fixture missing"))))
      .then(setRun)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="card empty">{error}</div>;
  if (!run?.analysis) return <div className="card empty">Loading demo…</div>;
  return (
    <>
      <div className="demo-banner no-print">
        Demo report — a real scan vs competitors. Run your own from “Run free scan”. <i>{demoNote}</i>
      </div>
      <Report run={run} reportMdUrl="/sample-report.md" />
    </>
  );
}
