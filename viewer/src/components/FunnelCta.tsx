import { useState } from "react";
import { setStoreUrl, trackEvent } from "../api";
import { useConfig } from "../config";
import { useModalFocus } from "../useModalFocus";

// Shopify-aware CTA routing. A detected Shopify store is sent to INSTALL (the compounding
// asset — installs drive App Store rank + the Pro subscription); everyone else is sent to the
// one-time $29 report. Both destinations are config/env-driven (appStoreUrl, the full_report
// Stripe link), never hardcoded. The $29 link is tagged with the source run so the webhook ties
// the paid order back to this report (mirrors the Pricing component).
//
// PAID-STEP STORE-URL CAPTURE: the $29 report promises done-for-you DRAFTS, and the crawler fills
// them from the merchant's live store — so before opening checkout we confirm the store URL (the
// free scan keeps it optional to stay frictionless). Persisted onto the run config so the webhook's
// paid generation crawls the confirmed URL. Honest escape → templates; no URL → placeholders.
//
// `purchased`: this viewer already bought THIS report — never show them the $29 upsell again;
// show only the install CTA (the tripwire→recurring-app bridge, which stays relevant post-purchase).
export function FunnelCta({ isShopify, runId, purchased, storeUrlHint }: { isShopify?: boolean; runId?: string; purchased?: boolean; storeUrlHint?: string | null }) {
  const { appStoreUrl, brandName, plans } = useConfig();
  const installUrl = appStoreUrl || `https://apps.shopify.com/search?q=${encodeURIComponent(brandName || "AisleLens")}`;
  const full = plans.find((p) => p.id === "full_report");
  const reportUrl = full?.stripeUrl ?? null;
  const [gateOpen, setGateOpen] = useState(false);

  function openInstall() {
    trackEvent("cta_install", runId, { isShopify: Boolean(isShopify) });
    window.open(installUrl, "_blank", "noopener");
  }
  /** The actual checkout hand-off (tag the link with the source run, then open Stripe). */
  function openStripeCheckout() {
    if (!reportUrl) return;
    trackEvent("cta_full_report", runId, { plan: "full_report" });
    trackEvent("payment_link_clicked", runId, { plan: "full_report", ts: new Date().toISOString() });
    if (runId) { try { localStorage.setItem("al_last_run", runId); } catch { /* private mode */ } }
    let url = reportUrl;
    try { const u = new URL(reportUrl); if (runId) u.searchParams.set("client_reference_id", runId); url = u.toString(); } catch { /* non-URL */ }
    window.open(url, "_blank", "noopener");
  }
  function onReportClick() {
    if (!reportUrl) return;
    // With a runId we can persist the confirmed URL onto the report → gate first. Without one
    // (shouldn't happen on a report page) fall back to opening checkout directly.
    if (runId) setGateOpen(true);
    else openStripeCheckout();
  }

  const install = (primary: boolean) => (
    <button className={primary ? "btn btn-primary lg" : "btn"} onClick={openInstall}>
      {primary ? "Install AisleLens to fix this →" : "On Shopify? Install AisleLens free"}
    </button>
  );
  const report = (primary: boolean) =>
    reportUrl ? (
      <button className={primary ? "btn btn-primary lg" : "btn"} onClick={onReportClick}>
        {primary ? `Get the full report — ${full?.price ?? "$29"}` : "Prefer a one-time audit?"}
      </button>
    ) : null;

  return (
    <>
      {purchased ? (
        // Already purchased → no $29 upsell, just the strategic bridge to the recurring Shopify app.
        <div className="funnel-cta">{install(true)}</div>
      ) : (
        // Shopify → Install primary; otherwise → the $29 report primary (falling back to Install
        // primary only if no Stripe link is configured).
        <div className="funnel-cta">
          {isShopify || !reportUrl ? <>{install(true)}{report(false)}</> : <>{report(true)}{install(false)}</>}
        </div>
      )}
      {gateOpen && runId && (
        <StoreUrlGate
          runId={runId}
          hint={storeUrlHint ?? ""}
          onProceed={() => { setGateOpen(false); openStripeCheckout(); }}
          onCancel={() => setGateOpen(false)}
        />
      )}
    </>
  );
}

/** Paid-step capture modal. The store URL is REQUIRED — the $29 report's whole value is drafts filled
 *  from the merchant's OWN live store, so a buyer without a URL isn't buying that value. Prefilled;
 *  a fast, SOFT, overridable liveness check catches a typo BEFORE payment (never hard-blocks the sale
 *  on a transient blip). No skip → no skip→placeholder mismatch. The one residual placeholder case —
 *  overriding an unreachable URL after the warning — stays honestly covered by the artifact's note. */
function StoreUrlGate({ runId, hint, onProceed, onCancel }: { runId: string; hint: string; onProceed: () => void; onCancel: () => void }) {
  const [url, setUrl] = useState(hint);
  const [busy, setBusy] = useState(false);
  const [warn, setWarn] = useState(false); // unreachable → soft warning, not a block
  const [error, setError] = useState("");
  const dialogRef = useModalFocus<HTMLDivElement>(true, onCancel);

  async function proceed(useAnyway = false) {
    const value = url.trim();
    if (!value) { setError("Add your store URL to generate your drafts."); return; }
    setBusy(true); setError("");
    try {
      const r = await setStoreUrl(runId, value); // persists (overwrites any stale value) + liveness
      if (!r.reachable && !useAnyway) { setWarn(true); return; } // saved, but warn once before checkout
      trackEvent("store_url_confirmed", runId, { reachable: r.reachable });
      onProceed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div ref={dialogRef} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="storeurl-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="storeurl-title" style={{ marginTop: 0 }}>Generate your done-for-you drafts</h3>
        <p className="muted">
          Enter your store URL so we can read your live product pages and fill your drafts with your
          real prices, ratings, and details.
        </p>
        <input
          type="text"
          value={url}
          onChange={(e) => { setUrl(e.target.value); setWarn(false); setError(""); }}
          placeholder="yourstore.com"
          aria-label="Your store URL"
          autoFocus
          style={{ width: "100%" }}
          onKeyDown={(e) => { if (e.key === "Enter") void proceed(warn); }}
        />
        {warn && (
          <p className="field-error" role="alert" style={{ marginTop: 8 }}>
            We couldn't reach that — double-check it's right, or continue anyway.
          </p>
        )}
        {error && <p className="field-error" role="alert" style={{ marginTop: 8 }}>{error}</p>}
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <button className="btn btn-primary" disabled={busy} onClick={() => proceed(warn)}>
            {busy ? "Checking…" : warn ? "Continue anyway →" : "Continue to checkout →"}
          </button>
          <button className="btn" disabled={busy} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
