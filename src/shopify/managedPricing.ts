import { ENV } from "../server/env.js";

// Shopify Managed Pricing — the COMPLIANT in-app upgrade path for Shopify-installed
// merchants. Charges go through Shopify (App Store requirement 1.2), so the embedded app
// links merchants to Shopify's hosted plan page instead of an off-platform (Stripe) link.
// The Stripe flow stays for the public web funnel only.

/** The shop's admin handle (the `:store` slug) — the part before `.myshopify.com`. */
export function storeHandle(shop: string): string {
  return shop.replace(/\.myshopify\.com$/i, "");
}

/**
 * Shopify's hosted plan-selection page for this app + shop:
 *   https://admin.shopify.com/store/{store}/charges/{appHandle}/pricing_plans
 * Null when SHOPIFY_APP_HANDLE isn't configured (the UI then shows a note instead of a link).
 */
export function managedPricingUrl(shop: string): string | null {
  const appHandle = ENV.shopify.appHandle;
  if (!appHandle || !shop) return null;
  return `https://admin.shopify.com/store/${storeHandle(shop)}/charges/${appHandle}/pricing_plans`;
}

/** Map a Shopify subscription/plan name (or handle) to one of our entitlement plan ids.
 *  Anything that looks like the paid tier → `pro`; everything else → `free`. */
export function planFromShopify(nameOrHandle: string | null | undefined): "pro" | "free" {
  return /pro/i.test(nameOrHandle ?? "") ? "pro" : "free";
}
