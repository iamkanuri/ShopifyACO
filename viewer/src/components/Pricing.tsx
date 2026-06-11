import { useState } from "react";
import { PLANS } from "../pricing";
import { submitLead } from "../api";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function Pricing({ runId }: { runId?: string }) {
  const [modalPlan, setModalPlan] = useState<{ id: string; name: string } | null>(null);

  return (
    <div className="no-print">
      <div className="pricing">
        {PLANS.map((p) => (
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
              <button className="btn btn-primary" onClick={() => setModalPlan({ id: p.id, name: p.name })}>
                {p.cta}
              </button>
            ) : (
              <div className="plan-current">You're on this</div>
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
    if (!valid) {
      setErr("Please enter a valid email.");
      return;
    }
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
              Payments aren't live yet. I'll email <b>{email}</b> your {plan.name.toLowerCase()} as
              soon as it's ready. Thanks for the interest — it genuinely helps me prioritize.
            </p>
            <button className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <>
            <h3>{plan.name}</h3>
            <p className="muted">
              <b>Payments aren't live yet.</b> Leave your email and I'll send your full report when
              it's ready — no charge today.
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
