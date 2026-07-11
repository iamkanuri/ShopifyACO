import type { AppBilling } from "./fixtures";
import { getBilling } from "./appApi";
import { DemoBadge, StatePane, useLoaded, useRefetchOnFocus } from "./ui";

// Billing & entitlements (Phase 11) for Shopify-installed merchants. Charges go through
// Shopify MANAGED PRICING (App Store req 1.2 — no off-platform/Stripe checkout in the
// embedded app). We show the current plan + usage and link to Shopify's hosted plan page
// to upgrade/manage. The Stripe flow remains for the public web funnel only.

const cap = (n: number) => (n < 0 ? "∞" : String(n));
const pctOf = (used: number, limit: number) => (limit < 0 ? 0 : limit === 0 ? (used > 0 ? 100 : 0) : Math.min(100, Math.round((used / limit) * 100)));

function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const over = limit >= 0 && used >= limit && limit > 0;
  return (
    <div className="al-meter">
      <div className="al-meter-head"><span>{label}</span><span className="muted">{used} / {cap(limit)}</span></div>
      <div className="al-meter-track"><div className={`al-meter-fill ${over ? "over" : ""}`} style={{ width: `${pctOf(used, limit)}%` }} /></div>
    </div>
  );
}

function StatusPill({ status, active }: { status: string; active: boolean }) {
  const tone = !active ? "bad" : status === "active" ? "good" : status === "past_due" ? "warn" : "neutral";
  return <span className={`al-verdict tone-${tone}`}>{status}</span>;
}

export function Billing() {
  const b = useLoaded<AppBilling>(() => getBilling(), []);
  // A plan change happens on Shopify's hosted pricing page (another tab/top frame);
  // refetch on return so the screen shows the plan Shopify holds now (the endpoint
  // re-syncs from the Admin API on each read).
  useRefetchOnFocus(b.reload);
  const data = b.data;
  const pricingUrl = data?.managedPricingUrl ?? null;
  // Shopify's plan page is top-level (admin.shopify.com) — break out of the app iframe.
  const openPricing = () => { if (pricingUrl) window.open(pricingUrl, "_top"); };
  const isPaid = (data?.plan.tier ?? 0) > 0;

  return (
    <div>
      <div className="al-page-head">
        <div><h2>Billing &amp; plan <DemoBadge show={b.demo} /></h2><p className="muted">Your plan, usage, and how to upgrade.</p></div>
      </div>

      <StatePane loading={b.loading}>
        {data && (
          <>
            <div className="section">
              <div className="card al-setrow">
                <div>
                  <div className="al-set-k">Current plan</div>
                  <div className="al-plan2-name" style={{ fontSize: 16 }}>{data.plan.label} <StatusPill status={data.plan.status} active={data.plan.active} /></div>
                  <div className="muted al-fineprint">
                    {data.plan.source === "default" ? "Free tier." : `via ${data.plan.source}`}
                    {data.plan.currentPeriodEnd && (data.plan.recurring || data.plan.cancelAtPeriodEnd)
                      ? ` · ${data.plan.cancelAtPeriodEnd ? "access ends" : "renews"} ${new Date(data.plan.currentPeriodEnd).toLocaleDateString()}`
                      : ""}
                  </div>
                </div>
                <div>
                  <button className="btn btn-primary" disabled={!pricingUrl} onClick={openPricing}>
                    {isPaid ? "Manage plan" : "Upgrade to Pro"}
                  </button>
                  {!pricingUrl && <div className="muted al-fineprint">{b.demo ? "Connect your store to manage your plan." : "Plan management opens in Shopify."}</div>}
                </div>
              </div>
              <p className="muted al-fineprint">Plans are billed through Shopify. {isPaid ? "Manage or cancel from Shopify's plan page." : "Pro unlocks unlimited live benchmarks, Fix Studio apply, experiments and monitoring."}</p>
              {!data.enforced && (
                <p className="muted al-fineprint">Plan limits below are shown for transparency. Enforcement is not active yet — nothing is blocked.</p>
              )}
            </div>

            <div className="section">
              <h2>Usage <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>(last 30 days)</span></h2>
              <div className="card">
                <Meter label="Benchmark runs" used={data.usage.benchmarksLast30d} limit={data.plan.limits.benchmarksPerMonth} />
                <Meter label="Monitoring schedules" used={data.usage.monitoringSchedules} limit={data.plan.limits.monitoringSchedules} />
                <Meter label="Product feeds" used={data.usage.feeds} limit={data.plan.limits.feeds} />
              </div>
            </div>
          </>
        )}
      </StatePane>
    </div>
  );
}
