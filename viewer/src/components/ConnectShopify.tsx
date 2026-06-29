import { useConfig } from "../config";

// "Get it on the Shopify App Store" CTA.
//
// We deliberately do NOT ask the merchant to type their myshopify.com domain. Shopify App Store
// requirement 2.3.1 forbids manual shop-domain entry in the install/configuration flow —
// installation must start from a Shopify-owned surface. So this is just a link to our App Store
// listing; inside Shopify admin the app installs via managed install + token exchange
// automatically (no domain prompt anywhere). Reused wherever a connect CTA appears (landing
// hero, /app connect banner, onboarding, settings).
//
// Until the listing URL is configured (SHOPIFY_APP_STORE_URL — unset while the listing is in
// review), we fall back to the App Store SEARCH for the brand: still a Shopify-owned surface,
// still compliant, and it never 404s (it finds the listing the moment it goes live).
export function ConnectShopify({ className = "", label = "Get it on the Shopify App Store" }: { className?: string; label?: string }) {
  const { appStoreUrl, brandName } = useConfig();
  const href = appStoreUrl || `https://apps.shopify.com/search?q=${encodeURIComponent(brandName || "AisleLens")}`;
  return (
    <a className={className} href={href} target="_blank" rel="noopener noreferrer">{label}</a>
  );
}
