import { useState } from "react";
import { getBilling, openBillingPortal } from "./appApi";
import type { AppBilling } from "./fixtures";
import { DemoBadge, StatePane, useLoaded } from "./ui";

// Billing & entitlements (Phase 11). Shows the merchant's effective plan, usage vs the
// plan's limits, a Manage-billing action (Stripe portal), and the upgrade catalogue.
// Honest by construction: when enforcement is dormant we SAY so; the portal button
// reflects whether a billing account actually exists.

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
  const [portalBusy, setPortalBusy] = useState(false);
  const [portalErr, setPortalErr] = useState<string | null>(null);
  const data = b.data;

  async function manage() {
    setPortalBusy(true); setPortalErr(null);
    const r = await openBillingPortal();
    setPortalBusy(false);
    if (r.ok && (r.data as { url?: string })?.url) window.location.href = (r.data as { url: string }).url;
    else setPortalErr(r.error ?? "Couldn't open the billing portal.");
  }

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
                    {data.plan.source === "default" ? "Free tier — no billing account yet." : `via ${data.plan.source}`}
                    {data.plan.currentPeriodEnd && (data.plan.recurring || data.plan.cancelAtPeriodEnd)
                      ? ` · ${data.plan.cancelAtPeriodEnd ? "access ends" : "renews"} ${new Date(data.plan.currentPeriodEnd).toLocaleDateString()}`
                      : ""}
                  </div>
                </div>
                <div>
                  <button className="btn btn-primary" disabled={!data.portal.available || portalBusy} onClick={manage}>
                    {portalBusy ? "Opening…" : "Manage billing"}
                  </button>
                  {!data.portal.available && <div className="muted al-fineprint">{data.demo ? "Connect your store to manage billing." : "Available after your first purchase."}</div>}
                </div>
              </div>
              {portalErr && <p className="al-gapmark al-fineprint">{portalErr}</p>}
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

            <div className="section">
              <h2>Plans</h2>
              <div className="grid al-plangrid">
                {data.plans.map((pl) => (
                  <div key={pl.id} className={`card al-plan2 ${pl.current ? "al-plan-current" : ""}`}>
                    <div className="al-plan2-name">{pl.name}{pl.current && <span className="al-demo" style={{ marginLeft: 6 }}>Current</span>}</div>
                    <div className="al-plan2-price">{pl.price}<span className="muted">{pl.cadence ? ` ${pl.cadence}` : ""}</span></div>
                    <p className="muted">{pl.blurb}</p>
                    <ul className="al-plan-feats">
                      {pl.features.slice(0, 4).map((f, i) => <li key={i}>{f}</li>)}
                    </ul>
                    {!pl.current && pl.tier > data.plan.tier && pl.stripeUrl && (
                      <a className="btn btn-primary" href={pl.stripeUrl}>Upgrade</a>
                    )}
                    {!pl.current && pl.tier > data.plan.tier && !pl.stripeUrl && (
                      <span className="muted al-fineprint">Checkout link not configured yet.</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </StatePane>
    </div>
  );
}
