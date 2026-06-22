import {
  refundEntitlementByPaymentIntent, setSubscriptionStatus, upsertOneTimeEntitlement,
  upsertSubscriptionEntitlement, getEntitlementBySubscription,
} from "../db/entitlements.js";
import { planEntitlement, stripeSubStatusToEntitlement } from "./entitlements.js";

// ===========================================================================
// Provisioning — maps verified Stripe events to entitlement state transitions.
// The PURE interpreters (plan resolution, period-end math, status mapping) are split
// from the DB-touching orchestrators so they unit-test without a database. Every
// orchestrator is idempotent on its own key (subscription id / shop+plan / email+plan /
// payment_intent), so a reprocessed event is safe even before the billing_events ledger.
// ===========================================================================

type Stripe = Record<string, any>;

/** A plan is "paid" (worth granting an entitlement for) when its tier is above free. */
export function isPaidPlan(plan: string | null | undefined): boolean {
  return planEntitlement(plan).tier > 0;
}

/** Reverse-map a Stripe Price id to one of our plan ids (pure). */
export function priceToPlan(priceId: string | undefined | null, priceMap: Record<string, string | undefined>): string | undefined {
  if (!priceId) return undefined;
  for (const [plan, id] of Object.entries(priceMap)) if (id && id === priceId) return plan;
  return undefined;
}

/** Stripe period-end (unix seconds) → ISO string, or null. */
export function unixToIso(seconds: number | undefined | null): string | null {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

/** Resolve the plan from a subscription object (price id → metadata.plan), pure. */
export function planFromSubscription(sub: Stripe, priceMap: Record<string, string | undefined>): string | undefined {
  const priceId = sub?.items?.data?.[0]?.price?.id ?? sub?.plan?.id;
  return priceToPlan(priceId, priceMap) ?? (typeof sub?.metadata?.plan === "string" ? sub.metadata.plan : undefined);
}

// ---- orchestrators (DB) ----------------------------------------------------

export interface CheckoutProvision {
  plan: string;
  mode: string; // "payment" | "subscription" | "setup"
  shopDomain: string | null;
  email: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  paymentIntent: string | null;
}

/**
 * Provision the entitlement implied by a paid checkout. Subscriptions are keyed on the
 * subscription id (the subscription.* events refine period/status); one-time payments
 * become a perpetual grant. Non-paid/unknown plans grant nothing (fail-safe).
 */
export async function provisionFromCheckout(args: CheckoutProvision): Promise<void> {
  if (!isPaidPlan(args.plan)) return;
  if (args.mode === "subscription") {
    // Subscriptions are keyed on the subscription id. If it's somehow absent on the
    // session, do NOT fall back to a perpetual one-time grant (that would never expire) —
    // the follow-up customer.subscription.created event provisions it correctly.
    if (!args.subscriptionId) return;
    await upsertSubscriptionEntitlement({
      subscriptionId: args.subscriptionId,
      customerId: args.customerId,
      plan: args.plan,
      status: "active",
      shopDomain: args.shopDomain,
      email: args.email,
    });
    return;
  }
  await upsertOneTimeEntitlement({
    plan: args.plan,
    shopDomain: args.shopDomain,
    email: args.email,
    customerId: args.customerId,
    paymentIntent: args.paymentIntent,
  });
}

/**
 * Apply a customer.subscription.created/updated/deleted event. Upserts the grant keyed
 * on the subscription id, mapping Stripe's status to ours and capturing the period end
 * + cancel-at-period-end so access lapses correctly.
 */
export async function provisionSubscriptionEvent(
  sub: Stripe,
  priceMap: Record<string, string | undefined>,
  opts: { deleted?: boolean } = {},
): Promise<void> {
  const subId = typeof sub?.id === "string" ? sub.id : null;
  if (!subId) return;
  // `customer.subscription.deleted` means the subscription is gone NOW → access ends
  // immediately. We map it to "expired" (never grants) rather than "canceled" so an
  // IMMEDIATE cancellation (which can carry a still-future current_period_end) doesn't
  // keep access alive. The cancel-AT-period-end grace is handled separately: Stripe keeps
  // the subscription "active" (with cancel_at_period_end=true) until the period truly ends.
  const status = opts.deleted ? "expired" : stripeSubStatusToEntitlement(sub?.status);
  const currentPeriodEnd = unixToIso(sub?.current_period_end);
  const cancelAtPeriodEnd = Boolean(sub?.cancel_at_period_end);

  const existing = await getEntitlementBySubscription(subId);
  const plan = planFromSubscription(sub, priceMap) ?? existing?.plan;

  // A status-only update for a subscription we've never seen and can't map → ignore
  // (we don't fabricate a plan). Once provisioned via checkout, `existing` carries it.
  if (!plan) {
    if (existing) await setSubscriptionStatus(subId, { status, currentPeriodEnd, cancelAtPeriodEnd });
    return;
  }

  await upsertSubscriptionEntitlement({
    subscriptionId: subId,
    customerId: typeof sub?.customer === "string" ? sub.customer : null,
    plan,
    status,
    shopDomain: typeof sub?.metadata?.shop_domain === "string" ? sub.metadata.shop_domain : null,
    email: typeof sub?.metadata?.email === "string" ? sub.metadata.email : null,
    currentPeriodEnd,
    cancelAtPeriodEnd,
  });
}

/** Apply an invoice.payment_failed → past_due (defense in depth; subscription.updated also covers it). */
export async function provisionInvoiceFailed(invoice: Stripe): Promise<number> {
  const subId = typeof invoice?.subscription === "string" ? invoice.subscription : null;
  if (!subId) return 0;
  return setSubscriptionStatus(subId, { status: "past_due" });
}

/** True when a charge is FULLY refunded (a partial refund leaves access intact). Pure. */
export function isFullRefund(charge: Stripe): boolean {
  if (charge?.refunded === true) return true;
  return charge?.amount_refunded != null && charge?.amount != null && charge.amount_refunded >= charge.amount && charge.amount > 0;
}

/** Apply a charge.refunded → revoke the matching one-time entitlement (by payment_intent). */
export async function provisionRefund(charge: Stripe): Promise<number> {
  const pi = typeof charge?.payment_intent === "string" ? charge.payment_intent : null;
  if (!pi || !isFullRefund(charge)) return 0;
  return refundEntitlementByPaymentIntent(pi);
}
