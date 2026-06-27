import { getAccessToken } from "../db/shops.js";
import { getShopifyClient } from "../shopify/client.js";
import { upsertShopifyEntitlement } from "../db/entitlements.js";
import { planFromShopify } from "../shopify/managedPricing.js";
import { isGrantActive, type EntitlementStatus } from "./entitlements.js";

// Mirror a Shopify-installed merchant's current Managed Pricing subscription into our
// entitlements table, so the existing (channel-agnostic) gating resolves it unchanged.
// Best-effort: never throws — a billing hiccup must not break the app load.

/** Map Shopify's AppSubscription status to our entitlement status. */
function toEntitlementStatus(shopifyStatus: string | undefined): EntitlementStatus {
  switch ((shopifyStatus ?? "").toUpperCase()) {
    case "ACTIVE": return "active";
    case "FROZEN": return "past_due"; // payment issue — keep access while Shopify retries
    case "CANCELLED":
    case "EXPIRED":
    case "DECLINED": return "expired";
    case "PENDING": return "pending";
    default: return "expired";
  }
}

/**
 * Read the shop's active app subscription and upsert its entitlement. Returns the resolved
 * plan id ("pro" | "free"). No active subscription → records a free grant so the shop
 * resolves cleanly to free. Safe to call on every embedded load (keeps the plan current).
 */
export async function syncShopifyEntitlement(shop: string): Promise<"pro" | "free"> {
  try {
    const token = await getAccessToken(shop);
    if (!token) return "free";
    const sub = await getShopifyClient().fetchActiveSubscription(shop, token);
    if (!sub) {
      await upsertShopifyEntitlement(shop, "free", "active", null);
      return "free";
    }
    const status = toEntitlementStatus(sub.status);
    // If the grant has lapsed (e.g. cancelled with no remaining period), record free.
    const active = isGrantActive(status, sub.currentPeriodEnd);
    const plan = active ? planFromShopify(sub.name) : "free";
    await upsertShopifyEntitlement(shop, plan, active ? status : "active", active ? sub.currentPeriodEnd : null);
    return plan === "pro" ? "pro" : "free";
  } catch (err) {
    console.error(`[billing] shopify entitlement sync failed for ${shop}:`, (err as Error).message);
    return "free";
  }
}
