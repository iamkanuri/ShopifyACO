import { useEffect, useState } from "react";
import type { RunResults, ArtifactBundle } from "../types";
import { Report } from "./Report";
import { useConfig } from "../config";

export function DemoPage() {
  const { demoNote } = useConfig();
  const [run, setRun] = useState<RunResults | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactBundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/sample-results.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Demo fixture missing"))))
      .then(setRun)
      .catch((e) => setError(e.message));
    // The done-for-you fix drafts (sample). Best-effort — the report still renders if it's absent.
    fetch("/sample-artifacts.json")
      .then((r) => (r.ok ? r.json() : null))
      .then(setArtifacts)
      .catch(() => setArtifacts(null));
  }, []);

  if (error) return <div className="card empty">{error}</div>;
  if (!run?.analysis) return <div className="card empty">Loading demo…</div>;
  return (
    <>
      <div className="demo-banner no-print">
        The full paid report, end to end — why AI recommends rivals over this store, and the done-for-you fix
        drafts you’d get to reverse it. Run your own from “Run free scan”. <i>{demoNote}</i>
      </div>
      {/* demo = the full paid product on screen: reveal the fix drafts, NO upsell button, NO plans. */}
      <Report run={run} reportMdUrl="/sample-report.md" demo artifacts={artifacts} />
    </>
  );
}
