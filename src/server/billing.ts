import type { Request, Response } from "express";
import { ENV } from "./env.js";
import { shopOf } from "./shopify.js";
import { entitlementForShop } from "../billing/enforce.js";
import { shopUsage } from "../billing/usage.js";
import { planEntitlement, samePlan } from "../billing/entitlements.js";
import { createPortalSession } from "../billing/portal.js";
import { stripeCustomerForShop } from "../db/entitlements.js";
import { hasPg } from "../db/pg.js";
import { PLANS } from "../pricing.js";

// Shop-scoped Billing & entitlements API (Phase 11). requireShop sets req.shopDomain.
// Read surfaces the merchant's effective plan, usage vs limits, and the upgrade
// catalogue; the portal action opens Stripe's hosted billing portal. Stripe stays in
// TEST mode — going live is a credentials-only swap (KYC-gated), no code change.

// The Stripe portal redirects the merchant back here, so never derive it from the
// spoofable Host header in production — require a configured URL. Dev keeps the host
// fallback for convenience; prod with neither configured returns null → 503.
function returnUrl(req: Request): string | null {
  if (ENV.stripePortalReturnUrl) return ENV.stripePortalReturnUrl;
  if (ENV.publicBaseUrl) return `${ENV.publicBaseUrl}/app/settings`;
  if (!ENV.isProd) return `${req.protocol}://${req.get("host")}/app/settings`;
  return null;
}

/** GET /app/api/billing — effective plan, usage vs limits, and the plan catalogue. */
export async function billingStatusHandler(req: Request, res: Response): Promise<void> {
  const shop = shopOf(req);
  const eff = await entitlementForShop(shop);
  const usage = hasPg() ? await shopUsage(shop) : { benchmarksLast30d: 0, monitoringSchedules: 0, feeds: 0 };
  const customerId = hasPg() ? await stripeCustomerForShop(shop) : null;

  // Plan catalogue: display copy (pricing.ts) merged with capability limits (entitlements).
  const plans = PLANS.map((p) => {
    const ent = planEntitlement(p.id);
    return {
      id: p.id, name: p.name, price: p.price, cadence: p.cadence, blurb: p.blurb,
      features: p.features, limits: ent.limits, tier: ent.tier,
      stripeUrl: ENV.stripe[p.id] ?? null,
      current: samePlan(p.id, eff.plan),
    };
  });

  res.json({
    plan: {
      id: eff.plan, label: eff.entitlement.label, status: eff.status, active: eff.active,
      source: eff.source, tier: eff.entitlement.tier, recurring: eff.entitlement.recurring,
      currentPeriodEnd: eff.currentPeriodEnd, cancelAtPeriodEnd: eff.cancelAtPeriodEnd,
      features: eff.entitlement.features, limits: eff.entitlement.limits,
    },
    usage,
    enforced: ENV.billing.enforced,
    portal: { available: Boolean(ENV.stripeSecretKey) && Boolean(customerId) },
    plans,
  });
}

/** POST /app/api/billing/portal — open the Stripe billing portal for this shop. */
export async function billingPortalHandler(req: Request, res: Response): Promise<void> {
  const shop = shopOf(req);
  const ret = returnUrl(req);
  if (!ret) {
    res.status(503).json({ error: "Billing portal return URL is not configured.", code: "not_configured" });
    return;
  }
  const customerId = hasPg() ? await stripeCustomerForShop(shop) : null;
  const result = await createPortalSession(customerId, ret);
  if (!result.ok) {
    const status = result.code === "not_configured" ? 503 : result.code === "no_customer" ? 409 : 502;
    res.status(status).json({ error: result.error, code: result.code });
    return;
  }
  res.json({ url: result.url });
}
