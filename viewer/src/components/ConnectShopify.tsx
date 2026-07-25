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
// Because the click leaves for a Shopify-owned surface, it hits NO route of ours —
// so without a beacon the funnel shows tests and installs with nothing between them,
// and "nobody clicked" is indistinguishable from "clicking doesn't convert". Sent
// fire-and-forget (sendBeacon survives the navigation); a failure is ignored, and a
// blocked beacon must never stop the merchant reaching the listing.
//
// OPT-IN per call site (`countAsFunnelStep`), and only the post-test CTA opts in.
// This component renders in six places and the other five are not funnel steps: the
// global header nav, the landing hero, and — worse — three surfaces inside /app
// (the demo-data banner, onboarding, settings), which are only ever seen by
// merchants who have ALREADY INSTALLED. Beaconing all of them made
// `installClickRate = clicks / completed tests` a ratio between two unrelated
// populations, which can exceed 1 and means nothing. CP2 defines the event as
// "install_clicked | originating test id", so a click with no originating test is
// not the event.
function beaconInstallClick(): void {
  try {
    const payload = JSON.stringify({
      testToken: localStorage.getItem("al_last_test_token") || undefined,
      host: localStorage.getItem("al_last_test_host") || undefined,
    });
    const url = "/api/funnel/install-click";
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));
      return;
    }
    void fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: payload, keepalive: true });
  } catch {
    /* telemetry is never worth breaking a CTA for */
  }
}

export function ConnectShopify({
  className = "",
  label = "Get it on the Shopify App Store",
  countAsFunnelStep = false,
}: { className?: string; label?: string; countAsFunnelStep?: boolean }) {
  const { appStoreUrl, brandName } = useConfig();
  const href = appStoreUrl || `https://apps.shopify.com/search?q=${encodeURIComponent(brandName || "AisleLens")}`;
  return (
    <a
      className={className}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={countAsFunnelStep ? beaconInstallClick : undefined}
    >{label}</a>
  );
}
