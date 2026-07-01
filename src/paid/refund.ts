import { ENV } from "../server/env.js";

// Auto-refund fallback (Phase 2). The owner is alerted immediately when generation fails and
// gets a window to hand-fix (re-run) before this fires. Critically, the owner alert is
// INDEPENDENT of the refund outcome: a refund that silently fails to fire is itself the
// unacceptable "silent failure after payment", so a failed refund alerts LOUDLY for manual action.

export interface RefundResult {
  ok: boolean;
  refundId?: string;
  error?: string;
  skipped?: boolean;
}

/** Issue a Stripe refund via REST (no SDK). Needs STRIPE_SECRET_KEY (on the WORKER). Returns
 *  ok:false (never throws) so the caller owns the alerting decision. */
export async function refundPayment(paymentIntent: string | null | undefined): Promise<RefundResult> {
  if (!ENV.stripeSecretKey) return { ok: false, skipped: true, error: "STRIPE_SECRET_KEY not set — refund cannot fire" };
  if (!paymentIntent) return { ok: false, error: "no payment_intent on the order to refund" };
  try {
    const res = await fetch("https://api.stripe.com/v1/refunds", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ENV.stripeSecretKey}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ payment_intent: paymentIntent, reason: "requested_by_customer" }).toString(),
    });
    if (!res.ok) return { ok: false, error: `Stripe refund HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
    const j = (await res.json()) as { id?: string };
    return { ok: true, refundId: j.id };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export interface RefundDeps {
  refund: (paymentIntent: string | null) => Promise<RefundResult>;
  alert: (subject: string, body: string) => Promise<void>;
  markRefunded: (sessionId: string) => Promise<void>;
}

/**
 * Auto-refund a held report. The alert path does NOT depend on the refund succeeding:
 *   • refund ok  → mark refunded + notify (informational).
 *   • refund FAIL → alert LOUDLY for manual action (the refund itself failing is the worst case).
 * Never throws.
 */
export async function processAutoRefund(
  row: { session_id: string; run_id: string; stripe_payment_intent: string | null; email?: string | null },
  deps: RefundDeps,
): Promise<{ refunded: boolean }> {
  let result: RefundResult;
  try {
    result = await deps.refund(row.stripe_payment_intent);
  } catch (err) {
    result = { ok: false, error: (err as Error).message };
  }

  if (result.ok) {
    await deps.markRefunded(row.session_id).catch(() => {});
    await deps.alert(
      `Paid report auto-refunded (${row.session_id})`,
      `A paid report failed to generate and was unresolved past the window, so it was auto-refunded (refund ${result.refundId ?? "?"}). run=${row.run_id}, buyer=${row.email ?? "?"}.`,
    );
    return { refunded: true };
  }

  // The refund did NOT fire — alert loudly, INDEPENDENTLY, for manual action.
  await deps.alert(
    `⚠️ REFUND FAILED — manual action needed (${row.session_id})`,
    `Auto-refund for a failed paid report could NOT be issued: ${result.error}. ` +
      `run=${row.run_id}, buyer=${row.email ?? "?"}, payment_intent=${row.stripe_payment_intent ?? "?"}. ` +
      `Refund this manually in the Stripe dashboard now.`,
  );
  return { refunded: false };
}
