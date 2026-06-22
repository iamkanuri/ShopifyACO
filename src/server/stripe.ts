import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { ENV } from "./env.js";
import { insertEvent, refundOrderByPaymentIntent, upsertOrder } from "../db/supabase.js";
import { hasPg } from "../db/pg.js";
import { billingEventSeen, recordBillingEvent } from "../db/entitlements.js";
import { isFullRefund, priceToPlan, provisionFromCheckout, provisionInvoiceFailed, provisionRefund, provisionSubscriptionEvent } from "../billing/provision.js";
import { PLANS } from "../pricing.js";

// ---------------------------------------------------------------------------
// Minimal Stripe webhook — NO Stripe SDK. We verify the signature ourselves
// (HMAC-SHA256 over `${t}.${rawBody}`, constant-time) and read the event JSON.
//
// A verified `checkout.session.completed` is the ONLY proof of payment; it creates a
// paid `orders` row (unchanged, source of truth for payment). Phase 11 ADDS the
// entitlement lifecycle on top of the same verified events — provisioning on payment,
// subscription created/updated/deleted, failed payments, and refunds — WITHOUT changing
// the existing orders path. Idempotency is layered: `orders.session_id` (one-time),
// idempotent entitlement upserts (per subscription/shop/email), and a `billing_events`
// ledger that dedupes EVERY event id after successful processing.
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

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/**
 * Provision the paid `orders` row for a completed checkout (UNCHANGED behavior — payment
 * proof) and then, additively, the entitlement it confers. Entitlement provisioning is
 * best-effort so a billing-model hiccup never jeopardizes the live order/payment path.
 */
async function handleCheckoutCompleted(event: StripeEvent): Promise<void> {
  const s = event.data.object;

  // Confirm payment: prefer a live API check when the secret key is set, else trust the
  // signed event's payment_status.
  const apiPaid = await confirmPaidViaApi(s.id);
  const paid = apiPaid === null ? isPaid(s.payment_status) : apiPaid;
  if (!paid) return;

  // Accept either metadata key — we set both `plan` and `product_type` on the Payment
  // Link; for subscriptions prefer the line-item price id; fall back to amount, then "unknown".
  const plan =
    str(s.metadata?.plan) ??
    str(s.metadata?.product_type) ??
    priceToPlan(s.metadata?.price_id, ENV.stripePrices) ??
    planFromAmount(s.amount_total) ??
    "unknown";
  const sourceRunId = str(s.client_reference_id) ?? str(s.metadata?.run_id);
  const paymentIntent = str(s.payment_intent);
  const created = await upsertOrder({
    session_id: s.id,
    event_id: event.id,
    email: s.customer_details?.email ?? s.customer_email ?? null,
    plan,
    amount_usd: (s.amount_total ?? 0) / 100,
    currency: s.currency ?? "usd",
    status: "paid",
    source_run_id: sourceRunId,
    stripe_payment_intent: paymentIntent,
  });

  // Only emit the funnel event for a genuinely new order (idempotency).
  if (created) {
    await insertEvent("payment_confirmed", sourceRunId ?? undefined, {
      plan,
      productType: s.metadata?.product_type ?? plan,
      amountUsd: (s.amount_total ?? 0) / 100,
      sessionId: s.id,
    });
    console.log(JSON.stringify({ level: "info", msg: "paid order", plan, sessionId: s.id }));
  }

  // Additive: provision the entitlement. Best-effort + PG-gated so the order path above
  // (graceful supabase-js) is never coupled to the raw-pg entitlement store.
  if (hasPg()) {
    try {
      await provisionFromCheckout({
        plan,
        mode: str(s.mode) ?? "payment",
        shopDomain: str(s.metadata?.shop_domain),
        email: s.customer_details?.email ?? s.customer_email ?? null,
        customerId: str(s.customer),
        subscriptionId: str(s.subscription),
        paymentIntent,
      });
    } catch (err) {
      console.error(`[stripe] entitlement provisioning failed (order is recorded): ${(err as Error).message}`);
    }
  }
}

/** Dispatch a verified Stripe event to its lifecycle handler. Throws on a processing error
 *  (the caller maps that to a 500 so Stripe retries). */
async function processStripeEvent(event: StripeEvent): Promise<void> {
  // Subscription/invoice/refund events ONLY drive entitlements (the raw-pg store). With no
  // PG configured there's nowhere to record them — ack so Stripe doesn't retry forever.
  const entitlementOnly =
    event.type !== "checkout.session.completed" && !hasPg();
  if (entitlementOnly) {
    console.warn(`[stripe] ${event.type} ignored — entitlements store (DATABASE_URL) not configured.`);
    return;
  }

  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(event);
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
      await provisionSubscriptionEvent(event.data.object, ENV.stripePrices);
      break;
    case "customer.subscription.deleted":
      await provisionSubscriptionEvent(event.data.object, ENV.stripePrices, { deleted: true });
      break;
    case "invoice.payment_failed":
      await provisionInvoiceFailed(event.data.object);
      break;
    case "charge.refunded": {
      const charge = event.data.object;
      await provisionRefund(charge); // entitlement revoke (internally FULL-refund-gated)
      // Mark the order refunded ONLY on a full refund — a partial refund must leave both
      // the order and the entitlement intact (no false "refunded" state).
      const pi = str(charge?.payment_intent);
      if (pi && isFullRefund(charge)) await refundOrderByPaymentIntent(pi);
      break;
    }
    default:
      // Unhandled event types are acked (recorded) — Stripe sends many we don't act on.
      break;
  }
}

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

  // Idempotency ledger: if we've already FULLY processed this event id, ack without
  // reprocessing. Failures below are NOT recorded, so Stripe's retry reprocesses them.
  if (hasPg()) {
    try {
      if (await billingEventSeen(event.id)) {
        res.json({ received: true, duplicate: true });
        return;
      }
    } catch (err) {
      // Ledger unreachable — fall through; entity-level upserts are independently idempotent.
      console.error(`[stripe] billing-event ledger check failed: ${(err as Error).message}`);
    }
  }

  try {
    await processStripeEvent(event);
    if (hasPg()) {
      try {
        await recordBillingEvent(event.id, event.type);
      } catch (err) {
        console.error(`[stripe] failed to record billing event ${event.id}: ${(err as Error).message}`);
      }
    }
    res.json({ received: true });
  } catch (err) {
    // Returning 500 makes Stripe retry — appropriate for a transient DB error.
    console.error(`[stripe] webhook handler error: ${(err as Error).message}`);
    res.status(500).send("Webhook handler error.");
  }
}
