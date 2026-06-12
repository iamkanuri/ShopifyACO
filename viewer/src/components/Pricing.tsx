import { useState } from "react";
import { submitLead, trackEvent } from "../api";
import { useConfig, type Plan } from "../config";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CTA_EVENT: Record<string, string> = {
  full_report: "cta_full_report",
  monitoring: "cta_monitoring",
  founder_beta: "cta_founder_beta",
};

// Monitoring isn't fulfillable yet — until a Stripe URL exists it's a waitlist.
const isWaitlist = (p: Plan) => p.id === "monitoring" && !p.stripeUrl;

export function Pricing({ runId, currentPlanId, email }: { runId?: string; currentPlanId?: string; email?: string }) {
  const { plans } = useConfig();
  const [modalPlan, setModalPlan] = useState<{ id: string; name: string; waitlist: boolean } | null>(null);

  function onCta(p: Plan) {
    if (CTA_EVENT[p.id]) trackEvent(CTA_EVENT[p.id], runId, { plan: p.id });
    if (p.stripeUrl) {
      // Real payment signal: log the click (with whatever we know), then open the
      // Stripe Payment Link — tagging it with the source run so the webhook can
      // tie the resulting paid order back to the report.
      trackEvent("payment_link_clicked", runId, { plan: p.id, email, ts: new Date().toISOString() });
      let url = p.stripeUrl;
      try {
        const u = new URL(p.stripeUrl);
        if (runId) u.searchParams.set("client_reference_id", runId);
        if (email) u.searchParams.set("prefilled_email", email);
        url = u.toString();
      } catch {
        /* non-URL string — open as-is */
      }
      window.open(url, "_blank", "noopener");
      return;
    }
    setModalPlan({ id: p.id, name: p.name, waitlist: isWaitlist(p) }); // fallback: email capture
  }

  return (
    <div className="no-print">
      <div className="pricing">
        {plans.map((p) => {
          const waitlist = isWaitlist(p);
          const ctaLabel = waitlist ? "Join the beta waitlist" : p.cta;
          return (
            <div className={`card plan ${p.cta ? "" : "plan-free"} ${waitlist ? "plan-soon" : ""}`} key={p.id}>
              {waitlist && <div className="plan-badge">Coming soon</div>}
              <div className="plan-name">{p.name}</div>
              <div className="plan-price">
                {p.price}
                <span className="plan-cadence">{p.cadence}</span>
              </div>
              <div className="plan-blurb">{p.blurb}</div>
              <ul className="plan-features">
                {p.features.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
              {p.cta ? (
                <button className={`btn ${waitlist ? "" : "btn-primary"}`} onClick={() => onCta(p)}>
                  {ctaLabel}
                </button>
              ) : currentPlanId === p.id ? (
                <div className="plan-current">You're on this</div>
              ) : (
                <div className="plan-current">Free</div>
              )}
            </div>
          );
        })}
      </div>
      {modalPlan && (
        <LeadModal plan={modalPlan} runId={runId} waitlist={modalPlan.waitlist} onClose={() => setModalPlan(null)} />
      )}
    </div>
  );
}

function LeadModal({
  plan,
  runId,
  waitlist,
  onClose,
}: {
  plan: { id: string; name: string };
  runId?: string;
  waitlist?: boolean;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [err, setErr] = useState("");
  const valid = EMAIL_RE.test(email);

  async function submit() {
    if (!valid) return setErr("Please enter a valid email.");
    setState("sending");
    try {
      await submitLead({ email, plan: plan.id, runId });
      setState("done");
    } catch (e) {
      setErr((e as Error).message);
      setState("error");
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}>
          ×
        </button>
        {state === "done" ? (
          <>
            <h3>You're on the list ✓</h3>
            <p className="muted">
              {waitlist ? (
                <>
                  We'll email <b>{email}</b> the moment weekly monitoring opens up.
                </>
              ) : (
                <>
                  Payments aren't live yet. We'll email <b>{email}</b> your {plan.name.toLowerCase()}{" "}
                  as soon as it's ready.
                </>
              )}
            </p>
            <button className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <>
            <h3>{plan.name}</h3>
            <p className="muted">
              {waitlist ? (
                <>
                  <b>Weekly monitoring is coming soon.</b> Join the waitlist and we'll let you know
                  the moment it's ready — no charge today.
                </>
              ) : (
                <>
                  <b>Payments aren't live yet.</b> Leave your email and we'll send it when it's ready
                  — no charge today.
                </>
              )}
            </p>
            <input
              className="modal-input"
              type="email"
              placeholder="you@store.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setErr("");
              }}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              autoFocus
            />
            {err && <div className="modal-err">{err}</div>}
            <button className="btn btn-primary" disabled={state === "sending"} onClick={submit}>
              {state === "sending" ? "Sending…" : "Notify me"}
            </button>
            <div className="modal-fine">We'll only use your email to send this report.</div>
          </>
        )}
      </div>
    </div>
  );
}
