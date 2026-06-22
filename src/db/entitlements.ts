import { pgQuery } from "./pg.js";

// Persistence for Phase 11 entitlements + the Stripe billing-event idempotency ledger.
// All grant identity is dual-keyed (shop_domain and/or email). The plan→capability
// mapping lives in src/billing/entitlements.ts; this module only records WHICH plan is
// active for WHOM plus the Stripe references that drive the lifecycle. Raw pg (not
// supabase-js) because the webhook upserts use ON CONFLICT against partial unique indexes.

export interface EntitlementRow {
  id: number;
  shop_domain: string | null;
  email: string | null;
  plan: string;
  status: string;
  source: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_payment_intent: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

function toRow(r: Record<string, unknown>): EntitlementRow {
  return { ...(r as unknown as EntitlementRow), id: Number(r.id) };
}

// ---- billing-event idempotency ledger --------------------------------------
/** True if we've already fully processed this Stripe event id. */
export async function billingEventSeen(eventId: string): Promise<boolean> {
  const { rows } = await pgQuery("select 1 from billing_events where event_id = $1", [eventId]);
  return rows.length > 0;
}

/** Record a successfully-processed Stripe event (idempotent insert). */
export async function recordBillingEvent(eventId: string, type: string): Promise<void> {
  await pgQuery(
    "insert into billing_events (event_id, type) values ($1, $2) on conflict (event_id) do nothing",
    [eventId, type],
  );
}

// ---- subscription entitlements (recurring) ---------------------------------
export interface SubscriptionGrant {
  subscriptionId: string;
  customerId?: string | null;
  plan: string;
  status: string;
  shopDomain?: string | null;
  email?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  metadata?: Record<string, unknown>;
}

/** Upsert a subscription's entitlement, keyed on stripe_subscription_id (idempotent). */
export async function upsertSubscriptionEntitlement(g: SubscriptionGrant): Promise<number> {
  const { rows } = await pgQuery<{ id: string }>(
    `insert into entitlements
       (shop_domain, email, plan, status, source, stripe_customer_id, stripe_subscription_id,
        current_period_end, cancel_at_period_end, metadata)
     values ($1,$2,$3,$4,'stripe',$5,$6,$7,$8,$9::jsonb)
     on conflict (stripe_subscription_id) where stripe_subscription_id is not null do update set
       plan = excluded.plan,
       status = excluded.status,
       shop_domain = coalesce(excluded.shop_domain, entitlements.shop_domain),
       email = coalesce(excluded.email, entitlements.email),
       stripe_customer_id = coalesce(excluded.stripe_customer_id, entitlements.stripe_customer_id),
       current_period_end = coalesce(excluded.current_period_end, entitlements.current_period_end),
       cancel_at_period_end = excluded.cancel_at_period_end,
       metadata = entitlements.metadata || excluded.metadata,
       updated_at = now()
     returning id`,
    [
      g.shopDomain ?? null, g.email ?? null, g.plan, g.status, g.customerId ?? null, g.subscriptionId,
      g.currentPeriodEnd ?? null, Boolean(g.cancelAtPeriodEnd), JSON.stringify(g.metadata ?? {}),
    ],
  );
  return Number(rows[0]!.id);
}

/** Set a subscription's status (+ period/cancel). No-op if the subscription is unknown. */
export async function setSubscriptionStatus(
  subscriptionId: string,
  patch: { status?: string; currentPeriodEnd?: string | null; cancelAtPeriodEnd?: boolean },
): Promise<number> {
  const { rowCount } = await pgQuery(
    `update entitlements set
       status = coalesce($2, status),
       current_period_end = coalesce($3, current_period_end),
       cancel_at_period_end = coalesce($4, cancel_at_period_end),
       updated_at = now()
     where stripe_subscription_id = $1`,
    [subscriptionId, patch.status ?? null, patch.currentPeriodEnd ?? null,
      patch.cancelAtPeriodEnd == null ? null : patch.cancelAtPeriodEnd],
  );
  return rowCount ?? 0;
}

// ---- one-time entitlements (perpetual) -------------------------------------
export interface OneTimeGrant {
  plan: string;
  shopDomain?: string | null;
  email?: string | null;
  customerId?: string | null;
  paymentIntent?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Upsert a perpetual one-time entitlement. Keyed on (shop_domain, plan) when a shop is
 * known, else on (lower(email), plan) — so re-purchasing the same one-time plan refreshes
 * the single grant instead of duplicating it. At least one of shop/email must be present.
 */
export async function upsertOneTimeEntitlement(g: OneTimeGrant): Promise<number | null> {
  if (!g.shopDomain && !g.email) return null; // nothing to key on
  const meta = JSON.stringify(g.metadata ?? {});
  if (g.shopDomain) {
    const { rows } = await pgQuery<{ id: string }>(
      `insert into entitlements
         (shop_domain, email, plan, status, source, stripe_customer_id, stripe_payment_intent, metadata)
       values ($1,$2,$3,'active','stripe',$4,$5,$6::jsonb)
       on conflict (shop_domain, plan) where shop_domain is not null and stripe_subscription_id is null do update set
         status = 'active',
         email = coalesce(excluded.email, entitlements.email),
         stripe_customer_id = coalesce(excluded.stripe_customer_id, entitlements.stripe_customer_id),
         stripe_payment_intent = coalesce(excluded.stripe_payment_intent, entitlements.stripe_payment_intent),
         metadata = entitlements.metadata || excluded.metadata,
         updated_at = now()
       returning id`,
      [g.shopDomain, g.email ?? null, g.plan, g.customerId ?? null, g.paymentIntent ?? null, meta],
    );
    return Number(rows[0]!.id);
  }
  const { rows } = await pgQuery<{ id: string }>(
    `insert into entitlements
       (shop_domain, email, plan, status, source, stripe_customer_id, stripe_payment_intent, metadata)
     values (null,$1,$2,'active','stripe',$3,$4,$5::jsonb)
     on conflict (lower(email), plan) where email is not null and shop_domain is null and stripe_subscription_id is null do update set
       status = 'active',
       stripe_customer_id = coalesce(excluded.stripe_customer_id, entitlements.stripe_customer_id),
       stripe_payment_intent = coalesce(excluded.stripe_payment_intent, entitlements.stripe_payment_intent),
       metadata = entitlements.metadata || excluded.metadata,
       updated_at = now()
     returning id`,
    [g.email, g.plan, g.customerId ?? null, g.paymentIntent ?? null, meta],
  );
  return Number(rows[0]!.id);
}

/** Mark a one-time entitlement refunded by its payment_intent. Returns affected rows. */
export async function refundEntitlementByPaymentIntent(paymentIntent: string): Promise<number> {
  const { rowCount } = await pgQuery(
    "update entitlements set status = 'refunded', updated_at = now() where stripe_payment_intent = $1 and status <> 'refunded'",
    [paymentIntent],
  );
  return rowCount ?? 0;
}

// ---- reads -----------------------------------------------------------------
export async function listEntitlementsForShop(shop: string): Promise<EntitlementRow[]> {
  const { rows } = await pgQuery("select * from entitlements where shop_domain = $1 order by created_at desc", [shop]);
  return rows.map(toRow);
}

export async function listEntitlementsForEmail(email: string): Promise<EntitlementRow[]> {
  const { rows } = await pgQuery("select * from entitlements where lower(email) = lower($1) order by created_at desc", [email]);
  return rows.map(toRow);
}

export async function getEntitlementBySubscription(subscriptionId: string): Promise<EntitlementRow | null> {
  const { rows } = await pgQuery("select * from entitlements where stripe_subscription_id = $1", [subscriptionId]);
  return rows[0] ? toRow(rows[0]) : null;
}

/** First known Stripe customer id for a shop (for opening the billing portal). */
export async function stripeCustomerForShop(shop: string): Promise<string | null> {
  const { rows } = await pgQuery<{ stripe_customer_id: string }>(
    "select stripe_customer_id from entitlements where shop_domain = $1 and stripe_customer_id is not null order by updated_at desc limit 1",
    [shop],
  );
  return rows[0]?.stripe_customer_id ?? null;
}
