import { useEffect } from "react";
import { Link, navigate } from "../router";
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

  // For a report purchase we know the run for, send the buyer STRAIGHT to their report — which
  // reflects the REAL state (generating → complete, or the honest failed/refunded banner) instead
  // of this page's old static "we're generating it" claim that stayed cheerful even on failure.
  // ?paid=1 tells the report page to hold a "confirming payment" state until the webhook lands.
  const willRedirect = Boolean(runId) && plan !== "monitoring";

  useEffect(() => {
    trackEvent("payment_completed", runId, { plan });
    if (willRedirect) navigate(`/report/${runId}?paid=1`);
  }, [plan, runId, willRedirect]);

  if (willRedirect) {
    return (
      <div className="card center-card">
        <div className="big-check">✓</div>
        <h1>Payment received — thank you.</h1>
        <p className="muted">Taking you to your report…</p>
      </div>
    );
  }

  const isMonitoring = plan === "monitoring";
  return (
    <div className="card center-card">
      <div className="big-check">✓</div>
      <h1>Thank you — you're in.</h1>
      <p className="muted">
        {isMonitoring
          ? "Your weekly monitoring is being set up. Your first report and each weekly scan appear in the app."
          : "Your full report is generated automatically — a deeper scan plus your done-for-you fixes. Open it from the report link you already have; it updates on-screen as it finishes, no email needed."}
      </p>
      {contactEmail && (
        <p className="muted" style={{ fontSize: 13 }}>
          Questions? <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
        </p>
      )}
      <Link to="/demo" className="btn btn-primary">
        See a sample report meanwhile
      </Link>
    </div>
  );
}
