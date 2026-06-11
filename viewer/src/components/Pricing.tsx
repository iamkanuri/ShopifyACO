import { useState } from "react";
import { submitLead, trackEvent } from "../api";
import { useConfig, type Plan } from "../config";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CTA_EVENT: Record<string, string> = {
  full_report: "cta_full_report",
  monitoring: "cta_monitoring",
  founder_beta: "cta_founder_beta",
};

export function Pricing({ runId, currentPlanId }: { runId?: string; currentPlanId?: string }) {
  const { plans } = useConfig();
  const [modalPlan, setModalPlan] = useState<{ id: string; name: string } | null>(null);

  function onCta(p: Plan) {
    if (CTA_EVENT[p.id]) trackEvent(CTA_EVENT[p.id], runId, { plan: p.id });
    if (p.stripeUrl) {
      // Real payment signal: log the click, then open the Stripe Payment Link.
      trackEvent("payment_link_clicked", runId, { plan: p.id });
      window.open(p.stripeUrl, "_blank", "noopener");
      return;
    }
    setModalPlan({ id: p.id, name: p.name }); // fallback: email capture
  }

  return (
    <div className="no-print">
      <div className="pricing">
        {plans.map((p) => (
          <div className={`card plan ${p.cta ? "" : "plan-free"}`} key={p.id}>
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
              <button className="btn btn-primary" onClick={() => onCta(p)}>
                {p.cta}
              </button>
            ) : currentPlanId === p.id ? (
              <div className="plan-current">You're on this</div>
            ) : (
              <div className="plan-current">Free</div>
            )}
          </div>
        ))}
      </div>
      {modalPlan && <LeadModal plan={modalPlan} runId={runId} onClose={() => setModalPlan(null)} />}
    </div>
  );
}

function LeadModal({
  plan,
  runId,
  onClose,
}: {
  plan: { id: string; name: string };
  runId?: string;
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
              Payments aren't live yet. We'll email <b>{email}</b> your {plan.name.toLowerCase()} as
              soon as it's ready.
            </p>
            <button className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <>
            <h3>{plan.name}</h3>
            <p className="muted">
              <b>Payments aren't live yet.</b> Leave your email and we'll send it when it's ready —
              no charge today.
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
