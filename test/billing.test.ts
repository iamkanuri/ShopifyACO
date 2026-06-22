import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planEntitlement, effectiveEntitlement, isGrantActive, bestEntitlement,
  stripeSubStatusToEntitlement, hasFeature,
} from "../src/billing/entitlements.js";
import { gateFeature, gateLimit } from "../src/billing/enforce.js";
import { isFullRefund, isPaidPlan, planFromSubscription, priceToPlan, unixToIso } from "../src/billing/provision.js";

// Phase 11 — entitlements + billing lifecycle. Pure tests cover the config-driven plan
// model, grant resolution, the Stripe→entitlement mappings, and the (pure) enforcement
// gates. DB-gated tests exercise the idempotent provisioning lifecycle end-to-end.

// ---- plan model ------------------------------------------------------------
test("planEntitlement resolves known plans and falls back to free", () => {
  assert.equal(planEntitlement("monitoring").plan, "monitoring");
  assert.equal(planEntitlement("nope").plan, "free");
  assert.equal(planEntitlement(null).plan, "free");
  assert.ok(planEntitlement("founder_beta").tier > planEntitlement("full_report").tier);
});

test("free tier gates paid features; paid plans unlock them — no prices in the model", () => {
  const free = effectiveEntitlement(null);
  assert.equal(free.plan, "free");
  assert.equal(hasFeature(free, "live_benchmarks"), false);
  assert.equal(hasFeature(free, "monitoring"), false);
  assert.equal(hasFeature(free, "evidence"), true); // mock diagnosis is $0 → free-tier ok
  const mon = effectiveEntitlement({ plan: "monitoring", status: "active" });
  assert.equal(hasFeature(mon, "live_benchmarks"), true);
  assert.equal(hasFeature(mon, "monitoring"), true);
  // The entitlement object never carries a price.
  assert.equal((mon.entitlement as unknown as Record<string, unknown>).price, undefined);
});

// ---- grant resolution (the lifecycle's read side) --------------------------
test("isGrantActive: active/past_due grant; canceled grants until period end; expired/refunded never", () => {
  const now = new Date("2026-06-22T00:00:00Z");
  assert.equal(isGrantActive("active", null, now), true);
  assert.equal(isGrantActive("past_due", null, now), true); // dunning: keep access while Stripe retries
  assert.equal(isGrantActive("canceled", "2026-07-01T00:00:00Z", now), true);
  assert.equal(isGrantActive("canceled", "2026-06-01T00:00:00Z", now), false);
  assert.equal(isGrantActive("canceled", null, now), false);
  assert.equal(isGrantActive("expired", "2027-01-01T00:00:00Z", now), false);
  assert.equal(isGrantActive("refunded", null, now), false);
});

test("effectiveEntitlement lapses to free when the grant is inactive", () => {
  const now = new Date("2026-06-22T00:00:00Z");
  const refunded = effectiveEntitlement({ plan: "full_report", status: "refunded" }, now);
  assert.equal(refunded.plan, "free");
  assert.equal(refunded.active, false);
  const canceledFuture = effectiveEntitlement(
    { plan: "monitoring", status: "canceled", current_period_end: "2026-07-01T00:00:00Z" }, now,
  );
  assert.equal(canceledFuture.plan, "monitoring");
  assert.equal(canceledFuture.active, true);
});

test("bestEntitlement picks the highest-tier ACTIVE grant", () => {
  const now = new Date("2026-06-22T00:00:00Z");
  const best = bestEntitlement([
    { plan: "full_report", status: "active" },
    { plan: "monitoring", status: "active" },
    { plan: "founder_beta", status: "refunded" }, // inactive → ignored despite higher tier
  ], now);
  assert.equal(best.plan, "monitoring");
  assert.equal(bestEntitlement([{ plan: "monitoring", status: "expired" }], now).plan, "free");
  assert.equal(bestEntitlement([]).plan, "free");
});

// ---- Stripe → entitlement mappings (pure) ----------------------------------
test("stripeSubStatusToEntitlement maps Stripe statuses conservatively", () => {
  assert.equal(stripeSubStatusToEntitlement("active"), "active");
  assert.equal(stripeSubStatusToEntitlement("trialing"), "active");
  assert.equal(stripeSubStatusToEntitlement("past_due"), "past_due");
  assert.equal(stripeSubStatusToEntitlement("unpaid"), "past_due");
  assert.equal(stripeSubStatusToEntitlement("canceled"), "canceled");
  assert.equal(stripeSubStatusToEntitlement("incomplete"), "pending");
  assert.equal(stripeSubStatusToEntitlement("incomplete_expired"), "expired");
  assert.equal(stripeSubStatusToEntitlement("???"), "expired"); // unknown → fail-safe
});

test("priceToPlan reverse-maps; planFromSubscription reads the line item then metadata", () => {
  const map = { full_report: "price_FR", monitoring: "price_MON" };
  assert.equal(priceToPlan("price_MON", map), "monitoring");
  assert.equal(priceToPlan("price_X", map), undefined);
  assert.equal(priceToPlan(null, map), undefined);
  assert.equal(planFromSubscription({ items: { data: [{ price: { id: "price_MON" } }] } }, map), "monitoring");
  assert.equal(planFromSubscription({ metadata: { plan: "founder_beta" } }, map), "founder_beta");
  assert.equal(planFromSubscription({}, map), undefined);
});

test("unixToIso converts seconds; isFullRefund only on a full refund; isPaidPlan excludes free/unknown", () => {
  assert.equal(unixToIso(1750000000), new Date(1750000000000).toISOString());
  assert.equal(unixToIso(null), null);
  assert.equal(isFullRefund({ refunded: true }), true);
  assert.equal(isFullRefund({ amount: 2900, amount_refunded: 2900 }), true);
  assert.equal(isFullRefund({ amount: 2900, amount_refunded: 1000 }), false); // partial → keep access
  assert.equal(isFullRefund({ amount: 0, amount_refunded: 0 }), false);
  assert.equal(isPaidPlan("free"), false);
  assert.equal(isPaidPlan("unknown"), false);
  assert.equal(isPaidPlan("full_report"), true);
});

// ---- enforcement gates (pure; enforcement flag passed explicitly) ----------
test("gates allow freely when enforcement is OFF, block when ON", () => {
  const free = effectiveEntitlement(null);
  // off → always allowed (reports enforced:false)
  assert.equal(gateFeature(free, "live_benchmarks", false).allowed, true);
  assert.equal(gateFeature(free, "live_benchmarks", false).enforced, false);
  // on → blocked with an upgrade reason + code
  const denied = gateFeature(free, "live_benchmarks", true);
  assert.equal(denied.allowed, false);
  assert.equal(denied.code, "feature_not_in_plan");
  assert.equal(denied.needed?.feature, "live_benchmarks");
  // a feature the plan HAS is allowed even when enforced
  assert.equal(gateFeature(free, "evidence", true).allowed, true);
  // limits: free benchmarksPerMonth=3
  assert.equal(gateLimit(free, "benchmarksPerMonth", 2, true).allowed, true);
  assert.equal(gateLimit(free, "benchmarksPerMonth", 3, true).allowed, false);
  assert.equal(gateLimit(free, "benchmarksPerMonth", 3, false).allowed, true); // off → allowed
});

// ---- DB-gated lifecycle (needs migration 0017 applied) ---------------------
const RUN_DB = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);

test("billing-event ledger dedupes by event id", { skip: !RUN_DB }, async () => {
  const { billingEventSeen, recordBillingEvent } = await import("../src/db/entitlements.js");
  const { pgQuery } = await import("../src/db/pg.js");
  const id = `evt_test_${Date.now()}`;
  try {
    assert.equal(await billingEventSeen(id), false);
    await recordBillingEvent(id, "checkout.session.completed");
    assert.equal(await billingEventSeen(id), true);
    await recordBillingEvent(id, "checkout.session.completed"); // idempotent — no throw
  } finally {
    await pgQuery("delete from billing_events where event_id=$1", [id]);
  }
});

test("checkout → one-time entitlement is idempotent + resolvable; full refund revokes", { skip: !RUN_DB }, async () => {
  const { provisionFromCheckout, provisionRefund } = await import("../src/billing/provision.js");
  const { entitlementForShop } = await import("../src/billing/enforce.js");
  const { pgQuery } = await import("../src/db/pg.js");
  const shop = `bill-${Date.now()}.myshopify.com`;
  const pi = `pi_${Date.now()}`;
  try {
    const checkout = { plan: "full_report", mode: "payment", shopDomain: shop, email: "a@b.com", customerId: "cus_1", subscriptionId: null, paymentIntent: pi };
    await provisionFromCheckout(checkout);
    let eff = await entitlementForShop(shop);
    assert.equal(eff.plan, "full_report");
    assert.equal(eff.active, true);
    // Idempotent: re-provisioning the same purchase keeps a single grant.
    await provisionFromCheckout(checkout);
    const { rows } = await pgQuery<{ n: string }>("select count(*)::int n from entitlements where shop_domain=$1", [shop]);
    assert.equal(Number(rows[0]!.n), 1);
    // Full refund → entitlement revoked → lapses to free.
    assert.ok((await provisionRefund({ payment_intent: pi, refunded: true })) >= 1);
    eff = await entitlementForShop(shop);
    assert.equal(eff.plan, "free");
  } finally {
    await pgQuery("delete from entitlements where shop_domain=$1", [shop]);
  }
});

test("subscription lifecycle: active → past_due → canceled (period-end gating)", { skip: !RUN_DB }, async () => {
  const { provisionSubscriptionEvent } = await import("../src/billing/provision.js");
  const { entitlementForShop } = await import("../src/billing/enforce.js");
  const { pgQuery } = await import("../src/db/pg.js");
  const shop = `sub-${Date.now()}.myshopify.com`;
  const subId = `sub_${Date.now()}`;
  const priceMap = { monitoring: "price_MON" };
  const future = Math.floor(Date.now() / 1000) + 30 * 86400;
  const items = { data: [{ price: { id: "price_MON" } }] };
  try {
    // created → active (plan resolved from the price id; shop from metadata)
    await provisionSubscriptionEvent({ id: subId, status: "active", customer: "cus_9", current_period_end: future, items, metadata: { shop_domain: shop } }, priceMap);
    let eff = await entitlementForShop(shop);
    assert.equal(eff.plan, "monitoring");
    assert.equal(eff.active, true);
    // updated → past_due (dunning) keeps access; shop_domain preserved via coalesce
    await provisionSubscriptionEvent({ id: subId, status: "past_due", current_period_end: future, items }, priceMap);
    eff = await entitlementForShop(shop);
    assert.equal(eff.status, "past_due");
    assert.equal(eff.active, true);
    // deleted → expired → access ends immediately (even if a period end is still in the future)
    const future2 = Math.floor(Date.now() / 1000) + 10 * 86400;
    await provisionSubscriptionEvent({ id: subId, status: "canceled", current_period_end: future2, items }, priceMap, { deleted: true });
    eff = await entitlementForShop(shop);
    assert.equal(eff.plan, "free");
    assert.equal(eff.status, "expired");
  } finally {
    await pgQuery("delete from entitlements where stripe_subscription_id=$1", [subId]);
  }
});

test("usage counters read from the existing tables", { skip: !RUN_DB }, async () => {
  const { createBenchmark, createRun } = await import("../src/db/benchmarks.js");
  const { shopUsage } = await import("../src/billing/usage.js");
  const { pgQuery } = await import("../src/db/pg.js");
  const shop = `use-${Date.now()}.myshopify.com`;
  const config = { brand: { name: "X" }, category: "c", competitors: [], prompts: [{ text: "q" }], engines: ["openai"] };
  const benchmarkId = await createBenchmark(shop, "use-bench", "mini", config as never);
  try {
    await createRun(benchmarkId, shop, "mini", ["openai"], 5, 1);
    const u = await shopUsage(shop);
    assert.ok(u.benchmarksLast30d >= 1);
    assert.equal(u.monitoringSchedules, 0);
    assert.equal(u.feeds, 0);
  } finally {
    await pgQuery("delete from benchmark_runs where shop_domain=$1", [shop]);
    await pgQuery("delete from benchmarks where id=$1", [benchmarkId]);
  }
});
