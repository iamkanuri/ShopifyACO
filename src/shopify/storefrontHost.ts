import { getAccessToken, getShop, setStorefrontHost, shopsNeedingHostRefresh, storefrontHostIsStale } from "../db/shops.js";
import { getShopifyClient } from "./client.js";

// ===========================================================================
// STOREFRONT HOST RESOLUTION (v2.6 CP1).
//
// `shops.storefront_host` is the host a shopper — and therefore a public Buyer
// Test — actually uses, and it is the load-bearing input to install-time
// reconciliation: a merchant tests `theirbrand.com`, so matching their carried
// public test needs that host and not `*.myshopify.com`.
//
// Migration 0029 resolved it in exactly one place, at install, and shipped no
// refresh and no backfill. Both failure modes were then observed on real rows:
// a shop installed before 0029 holds NULL forever, and the dev store holds a
// STALE value captured before its custom domain was connected and made primary.
// Connecting a custom domain after installing is the normal order of events.
//
// So resolution now happens on a freshness policy instead:
//   • lazily, on an authenticated request, when the stamp is old or absent;
//   • forced, on a `shop/update` webhook — the event that fires when a merchant
//     changes their domain, which is precisely when the stored value goes wrong;
//   • swept, for shops that never make an authenticated request of their own.
//
// EVERY path here is best-effort and non-blocking. A failed lookup leaves the
// previous value in place and does not move the freshness stamp, so a shop whose
// Shopify calls are failing is retried rather than trusted for a week.
// ===========================================================================

/** Resolve and persist the shop's primary storefront host. Returns the host on a
 *  successful resolve, or null when it could not be determined (never throws). */
export async function refreshStorefrontHost(shop: string): Promise<string | null> {
  try {
    const token = await getAccessToken(shop);
    if (!token) return null; // uninstalled / no credentials — nothing to ask with
    const hosts = await getShopifyClient().fetchShopHosts(shop, token);
    const host = hosts.primaryHost ?? hosts.myshopifyDomain ?? null;
    if (!host) return null;
    await setStorefrontHost(shop, host);
    return host;
  } catch (err) {
    console.warn(`[shopify] storefront host refresh failed for ${shop}: ${(err as Error).message}`);
    return null;
  }
}

/** In-process guard so a burst of requests from one shop triggers ONE lookup.
 *  The freshness stamp is the durable guard; this only stops a thundering herd
 *  between the first request and the write landing. */
const inFlight = new Set<string>();

/**
 * Refresh the host if it is stale, WITHOUT making the caller wait.
 *
 * Deliberately fire-and-forget: this sits on `requireShop`, which runs on every
 * merchant request, and a merchant must never pay a Shopify round-trip to load
 * their own dashboard. The value is used by reconciliation at install time and by
 * host matching later — both tolerate being right one request late.
 */
export function refreshStorefrontHostIfStale(shop: string, row: { storefront_host_checked_at: string | null }): void {
  if (!storefrontHostIsStale(row) || inFlight.has(shop)) return;
  inFlight.add(shop);
  void refreshStorefrontHost(shop).finally(() => inFlight.delete(shop));
}

/** Sweep stale shops. For shops that never make an authenticated request of their
 *  own, this is the only thing that ever repopulates them. Bounded per run. */
export async function sweepStorefrontHosts(limit = 25): Promise<{ checked: number; resolved: number }> {
  let shops: string[] = [];
  try {
    shops = await shopsNeedingHostRefresh(limit);
  } catch (err) {
    console.warn(`[shopify] storefront host sweep could not list shops: ${(err as Error).message}`);
    return { checked: 0, resolved: 0 };
  }
  let resolved = 0;
  for (const shop of shops) if (await refreshStorefrontHost(shop)) resolved++;
  if (shops.length) console.log(JSON.stringify({ at: "storefront_host_sweep", checked: shops.length, resolved }));
  return { checked: shops.length, resolved };
}

/** Force a refresh for one shop and report what changed — used by the `shop/update`
 *  webhook, where the whole point is that the domain may just have moved. */
export async function refreshStorefrontHostOnShopUpdate(shop: string): Promise<{ before: string | null; after: string | null }> {
  const before = (await getShop(shop).catch(() => null))?.storefront_host ?? null;
  const after = await refreshStorefrontHost(shop);
  if (after && after !== before) {
    console.log(JSON.stringify({ at: "storefront_host_changed", shop_known: true, changed: true }));
  }
  return { before, after };
}
