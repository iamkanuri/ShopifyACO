import { useEffect } from "react";
import { Link } from "../router";
import { trackEvent } from "../api";
import { useConfig } from "../config";

export function ThanksPage() {
  const { contactEmail } = useConfig();
  const params = new URLSearchParams(window.location.search);
  const plan = params.get("plan") ?? "full_report";
  // Prefer the runId on the URL; otherwise the one we stored when the buyer
  // clicked the paid CTA — so we can send them back to THEIR report (not the demo).
  const runId =
    params.get("runId") ??
    (() => {
      try {
        return localStorage.getItem("al_last_run") ?? undefined;
      } catch {
        return undefined;
      }
    })();

  useEffect(() => {
    trackEvent("payment_completed", runId, { plan });
  }, [plan, runId]);

  const isMonitoring = plan === "monitoring";
  return (
    <div className="card center-card">
      <div className="big-check">✓</div>
      <h1>Thank you — you're in.</h1>
      <p className="muted">
        {isMonitoring
          ? "Your weekly monitoring is being set up. We'll email you your first full report and then a fresh scan every week."
          : "We're generating your full report now — a deeper scan plus your done-for-you fixes. It appears on your report page in a few minutes, no email needed."}
      </p>
      {contactEmail && (
        <p className="muted" style={{ fontSize: 13 }}>
          Questions? <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
        </p>
      )}
      {runId ? (
        <>
          <Link to={`/report/${runId}`} className="btn btn-primary">
            View your scan report
          </Link>
          <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            Your full report builds on this scan — the deep version appears here automatically in a few minutes.
          </div>
        </>
      ) : (
        <Link to="/demo" className="btn btn-primary">
          See a sample report meanwhile
        </Link>
      )}
    </div>
  );
}
