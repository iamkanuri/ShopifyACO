import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { ENV } from "./env.js";
import { insertEvent, upsertOrder } from "../db/supabase.js";
import { PLANS } from "../pricing.js";

// ---------------------------------------------------------------------------
// Minimal Stripe webhook — NO Stripe SDK. We verify the signature ourselves
// (HMAC-SHA256 over `${t}.${rawBody}`, constant-time) and read the event JSON.
// A verified `checkout.session.completed` is the ONLY proof of payment; it
// creates a paid order. /thanks is just a funnel event, never proof.
// ---------------------------------------------------------------------------

const SIG_TOLERANCE_SEC = 300; // reject replays older than 5 minutes (Stripe default)

interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, any> };
}

type VerifyResult = { ok: true; event: StripeEvent } | { ok: false; reason: string };

/** Verify a Stripe webhook signature and parse the event. Pure + unit-testable. */
export function constructEvent(rawBody: Buffer, sigHeader: string | undefined, secret: string): VerifyResult {
  if (!sigHeader) return { ok: false, reason: "missing Stripe-Signature header" };

  const parts = sigHeader.split(",").map((p) => p.trim());
  const t = parts.find((p) => p.startsWith("t="))?.slice(2);
  // Multiple v1 signatures can appear during secret rotation — accept any match.
  const v1s = parts.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || v1s.length === 0) return { ok: false, reason: "malformed signature header" };

  const ageSec = Math.floor(Date.now() / 1000) - Number(t);
  if (!Number.isFinite(ageSec) || Math.abs(ageSec) > SIG_TOLERANCE_SEC) {
    return { ok: false, reason: "timestamp outside tolerance" };
  }

  const expected = createHmac("sha256", secret).update(`${t}.${rawBody.toString("utf8")}`).digest("hex");
  const exp = Buffer.from(expected);
  const matches = v1s.some((v1) => {
    const got = Buffer.from(v1);
    return got.length === exp.length && timingSafeEqual(got, exp);
  });
  if (!matches) return { ok: false, reason: "signature mismatch" };

  try {
    return { ok: true, event: JSON.parse(rawBody.toString("utf8")) as StripeEvent };
  } catch {
    return { ok: false, reason: "invalid JSON body" };
  }
}

/** Map an amount in cents to one of our plan ids, as a fallback when no metadata.plan. */
function planFromAmount(cents: number | undefined): string | undefined {
  if (!cents) return undefined;
  for (const p of PLANS) {
    const dollars = Number(p.price.replace(/[^0-9.]/g, ""));
    if (dollars > 0 && Math.round(dollars * 100) === cents) return p.id;
  }
  return undefined;
}

/**
 * Optional defense-in-depth: when STRIPE_SECRET_KEY is configured, re-fetch the
 * session from Stripe and confirm it's paid. Returns null if unavailable so the
 * caller falls back to the (already signature-verified) event payload — a network
 * blip must never drop a legitimate paid order.
 */
async function confirmPaidViaApi(sessionId: string): Promise<boolean | null> {
  if (!ENV.stripeSecretKey) return null;
  try {
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { Authorization: `Bearer ${ENV.stripeSecretKey}` },
    });
    if (!res.ok) return null;
    const session = (await res.json()) as { payment_status?: string };
    return session.payment_status === "paid" || session.payment_status === "no_payment_required";
  } catch {
    return null;
  }
}

const isPaid = (s?: string) => s === "paid" || s === "no_payment_required";

/** Express handler for POST /api/stripe/webhook. Self-contained error handling. */
export async function handleStripeWebhook(req: Request, res: Response): Promise<void> {
  if (!ENV.stripeWebhookSecret) {
    res.status(503).send("Stripe webhook not configured.");
    return;
  }
  // Mounted with express.raw — req.body is a Buffer.
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  const verdict = constructEvent(raw, req.headers["stripe-signature"] as string | undefined, ENV.stripeWebhookSecret);
  if (!verdict.ok) {
    console.warn(`[stripe] webhook rejected: ${verdict.reason}`);
    res.status(400).send(`Webhook Error: ${verdict.reason}`);
    return;
  }

  const event = verdict.event;
  try {
    if (event.type === "checkout.session.completed") {
      const s = event.data.object;

      // Confirm payment: prefer a live API check when the secret key is set,
      // else trust the signed event's payment_status.
      const apiPaid = await confirmPaidViaApi(s.id);
      const paid = apiPaid === null ? isPaid(s.payment_status) : apiPaid;
      if (!paid) {
        res.json({ received: true, ignored: "not paid" });
        return;
      }

      const plan = s.metadata?.plan ?? planFromAmount(s.amount_total) ?? "unknown";
      const sourceRunId = s.client_reference_id ?? s.metadata?.run_id ?? null;
      const created = await upsertOrder({
        session_id: s.id,
        event_id: event.id,
        email: s.customer_details?.email ?? s.customer_email ?? null,
        plan,
        amount_usd: (s.amount_total ?? 0) / 100,
        currency: s.currency ?? "usd",
        status: "paid",
        source_run_id: sourceRunId,
      });

      // Only emit the funnel event for a genuinely new order (idempotency).
      if (created) {
        await insertEvent("payment_confirmed", sourceRunId ?? undefined, {
          plan,
          amountUsd: (s.amount_total ?? 0) / 100,
          sessionId: s.id,
        });
        console.log(JSON.stringify({ level: "info", msg: "paid order", plan, sessionId: s.id }));
      }
    }
    res.json({ received: true });
  } catch (err) {
    // Returning 500 makes Stripe retry — appropriate for a transient DB error.
    console.error(`[stripe] webhook handler error: ${(err as Error).message}`);
    res.status(500).send("Webhook handler error.");
  }
}
