import { ENV } from "../server/env.js";
import { hasPg } from "../db/pg.js";
import { listEntitlementsForShop } from "../db/entitlements.js";
import {
  bestEntitlement, hasFeature, withinLimit, type ActiveEntitlement, type Feature, type PlanLimits,
} from "./entitlements.js";
import { activeSchedules, benchmarksLast30d, feedCount } from "./usage.js";

// ===========================================================================
// Entitlement ENFORCEMENT (Phase 11). Resolves a shop's effective plan and decides
// whether a gated action is allowed. Enforcement is DORMANT by default
// (ENV.billing.enforced) so deploying this never breaks existing behavior or the
// owner's own dev store — when off, `assert*` always allows but still returns the
// resolved plan so the UI can surface it. Flip BILLING_ENFORCED=1 to gate.
// ===========================================================================

/** Resolve a shop's effective entitlement from its grant rows (free tier if none/unconfigured). */
export async function entitlementForShop(shop: string): Promise<ActiveEntitlement> {
  if (!hasPg()) return bestEntitlement([]); // no store → free tier (read-only safe default)
  try {
    return bestEntitlement(await listEntitlementsForShop(shop));
  } catch (err) {
    console.error(`[billing] entitlement lookup failed for ${shop}:`, (err as Error).message);
    return bestEntitlement([]);
  }
}

export interface Gate {
  allowed: boolean;
  enforced: boolean; // whether enforcement is currently active (else allowed regardless)
  plan: string;
  reason?: string;
  code?: "feature_not_in_plan" | "limit_reached";
  /** What's needed to unlock (for the upgrade CTA). */
  needed?: { feature?: Feature; limit?: keyof PlanLimits; limitValue?: number; used?: number };
}

/**
 * Build an allow/deny gate for a feature against a resolved entitlement. `enforced` is
 * passed explicitly (the handlers pass ENV.billing.enforced) so the gate is a PURE
 * function — fully unit-testable with enforcement both on and off.
 */
export function gateFeature(eff: ActiveEntitlement, feature: Feature, enforced: boolean): Gate {
  const ok = hasFeature(eff, feature);
  if (ok || !enforced) return { allowed: true, enforced, plan: eff.plan };
  return {
    allowed: false, enforced: true, plan: eff.plan,
    reason: `Your ${eff.entitlement.label} plan does not include this. Upgrade to unlock it.`,
    code: "feature_not_in_plan", needed: { feature },
  };
}

/** Build an allow/deny gate for a numeric limit (used vs the plan's cap). Pure. */
export function gateLimit(eff: ActiveEntitlement, limit: keyof PlanLimits, used: number, enforced: boolean): Gate {
  const cap = eff.entitlement.limits[limit];
  const ok = withinLimit(cap, used);
  if (ok || !enforced) return { allowed: true, enforced, plan: eff.plan };
  return {
    allowed: false, enforced: true, plan: eff.plan,
    reason: `You've reached your ${eff.entitlement.label} plan limit (${cap}). Upgrade for more.`,
    code: "limit_reached", needed: { limit, limitValue: cap, used },
  };
}

// ---- convenience: resolve + gate in one call (used by route handlers) ------

/** Gate a feature for a shop (resolves the entitlement first). */
export async function assertFeature(shop: string, feature: Feature): Promise<Gate> {
  return gateFeature(await entitlementForShop(shop), feature, ENV.billing.enforced);
}

/** Gate a per-month benchmark-run limit for a shop. */
export async function assertBenchmarkQuota(shop: string): Promise<Gate> {
  const eff = await entitlementForShop(shop);
  return gateLimit(eff, "benchmarksPerMonth", hasPg() ? await benchmarksLast30d(shop) : 0, ENV.billing.enforced);
}

/** Gate creating another monitoring schedule for a shop (feature + count limit). */
export async function assertScheduleQuota(shop: string): Promise<Gate> {
  const eff = await entitlementForShop(shop);
  const feat = gateFeature(eff, "monitoring", ENV.billing.enforced);
  if (!feat.allowed) return feat;
  return gateLimit(eff, "monitoringSchedules", hasPg() ? await activeSchedules(shop) : 0, ENV.billing.enforced);
}

/** Gate defining/generating another feed for a shop (count limit). */
export async function assertFeedQuota(shop: string, existingFeeds?: number): Promise<Gate> {
  const eff = await entitlementForShop(shop);
  const used = existingFeeds ?? (hasPg() ? await feedCount(shop) : 0);
  return gateLimit(eff, "feeds", used, ENV.billing.enforced);
}

/** HTTP shape for a denied gate (402 Payment Required). */
export function gateDenial(gate: Gate): { error: string; code: string; plan: string; needed?: Gate["needed"] } {
  return { error: gate.reason ?? "Upgrade required.", code: gate.code ?? "upgrade_required", plan: gate.plan, needed: gate.needed };
}
