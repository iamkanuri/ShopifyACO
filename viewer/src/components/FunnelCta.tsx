import { trackEvent } from "../api";
import { useConfig } from "../config";

// Shopify-aware CTA routing. A detected Shopify store is sent to INSTALL (the compounding
// asset — installs drive App Store rank + the Pro subscription); everyone else is sent to the
// one-time $29 report. Both destinations are config/env-driven (appStoreUrl, the full_report
// Stripe link), never hardcoded. The $29 link is tagged with the source run so the webhook ties
// the paid order back to this report (mirrors the Pricing component).
//
// `purchased`: this viewer already bought THIS report — never show them the $29 upsell again;
// show only the install CTA (the tripwire→recurring-app bridge, which stays relevant post-purchase).
export function FunnelCta({ isShopify, runId, purchased }: { isShopify?: boolean; runId?: string; purchased?: boolean }) {
  const { appStoreUrl, brandName, plans } = useConfig();
  const installUrl = appStoreUrl || `https://apps.shopify.com/search?q=${encodeURIComponent(brandName || "AisleLens")}`;
  const full = plans.find((p) => p.id === "full_report");
  const reportUrl = full?.stripeUrl ?? null;

  function openInstall() {
    trackEvent("cta_install", runId, { isShopify: Boolean(isShopify) });
    window.open(installUrl, "_blank", "noopener");
  }
  function openReport() {
    if (!reportUrl) return;
    trackEvent("cta_full_report", runId, { plan: "full_report" });
    trackEvent("payment_link_clicked", runId, { plan: "full_report", ts: new Date().toISOString() });
    if (runId) { try { localStorage.setItem("al_last_run", runId); } catch { /* private mode */ } }
    let url = reportUrl;
    try { const u = new URL(reportUrl); if (runId) u.searchParams.set("client_reference_id", runId); url = u.toString(); } catch { /* non-URL */ }
    window.open(url, "_blank", "noopener");
  }

  const install = (primary: boolean) => (
    <button className={primary ? "btn btn-primary lg" : "btn"} onClick={openInstall}>
      {primary ? "Install AisleLens to fix this →" : "On Shopify? Install AisleLens free"}
    </button>
  );
  const report = (primary: boolean) =>
    reportUrl ? (
      <button className={primary ? "btn btn-primary lg" : "btn"} onClick={openReport}>
        {primary ? `Get the full report — ${full?.price ?? "$29"}` : "Prefer a one-time audit?"}
      </button>
    ) : null;

  // Already purchased → no $29 upsell, just the strategic bridge to the recurring Shopify app.
  if (purchased) {
    return <div className="funnel-cta">{install(true)}</div>;
  }

  // Shopify → Install primary; otherwise → the $29 report primary (falling back to Install
  // primary only if no Stripe link is configured).
  return (
    <div className="funnel-cta">
      {isShopify || !reportUrl ? <>{install(true)}{report(false)}</> : <>{report(true)}{install(false)}</>}
    </div>
  );
}
