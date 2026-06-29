import { useState } from "react";
import { useConfig } from "../config";
import { Link } from "../router";
import { ConnectShopify } from "../components/ConnectShopify";
import { getSchedules, getShopInfo, updateSchedule } from "./appApi";
import { CADENCE_OPTIONS } from "./constants";
import { DemoBadge, StatePane, useLoaded } from "./ui";

// Settings: connection state, granted scopes, plan pointer, and recurring-schedule controls.
// Plan/billing for the embedded app is Shopify Managed Pricing (Free/Pro) — surfaced in full
// on the Billing screen; here we just link to it (never the public web Stripe catalogue).
export function Settings({ connected }: { connected: boolean }) {
  const { contactEmail } = useConfig();
  const s = useLoaded(() => getSchedules(), []);
  const info = useLoaded(() => getShopInfo(), []);
  const schedules = s.data?.schedules ?? [];
  const scopes = info.data?.scopes ?? [];
  const [busy, setBusy] = useState<number | null>(null);

  async function toggle(id: number, enabled: boolean) { setBusy(id); await updateSchedule(id, { enabled }); setBusy(null); s.reload(); }
  async function setCadence(id: number, cadence: string) { setBusy(id); await updateSchedule(id, { cadence }); setBusy(null); s.reload(); }

  return (
    <div>
      <div className="al-page-head">
        <div><h2>Settings <DemoBadge show={!connected} /></h2><p className="muted">Connection, plan, and monitoring schedules.</p></div>
      </div>

      <div className="section">
        <h2>Store connection</h2>
        <div className="card al-setrow">
          <div><div className="al-set-k">Status</div><div className={connected ? "al-ok" : "al-gapmark"}>{connected ? "Connected" : "Not connected (demo)"}</div></div>
          <div><div className="al-set-k">Scopes</div><div className="muted">{scopes.length ? scopes.join(", ") : info.loading ? "…" : "—"}</div></div>
          {!connected && <ConnectShopify className="btn btn-primary" label="Get it on the Shopify App Store" />}
        </div>
        <p className="muted al-fineprint">
          {info.data?.writeProducts
            ? <>Write-back (Fix Studio apply) is enabled — <code>write_products</code> is granted. Every write is approval-gated, conflict-checked, and reversible.</>
            : <>Write-back (Fix Studio apply) requests <code>write_products</code> only when you enable it — least privilege.</>}
        </p>
      </div>

      <div className="section">
        <h2>Plan</h2>
        <div className="card al-setrow">
          <div><div className="al-set-k">Billing</div><div className="muted">Plans are billed through Shopify — Free &amp; Pro.</div></div>
          <Link to="/app/billing" className="btn">Manage plan</Link>
        </div>
      </div>

      <div className="section">
        <h2>Monitoring schedules</h2>
        <StatePane loading={s.loading} empty={schedules.length === 0} emptyText="No schedules yet. Create one from Monitoring.">
          <div className="grid">
            {schedules.map((sc) => (
              <div key={sc.id} className="card al-setrow">
                <div><div className="al-set-k">{sc.kind === "verification" ? "Re-verify fix" : "Re-run benchmark"}</div><div className="muted">next {new Date(sc.next_run_at).toLocaleDateString()}</div></div>
                <label className="al-field"><span className="al-set-k">Cadence</span>
                  <select value={sc.cadence} disabled={busy === sc.id} onChange={(e) => setCadence(sc.id, e.target.value)}>
                    {CADENCE_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className="al-toggle"><input type="checkbox" checked={sc.enabled} disabled={busy === sc.id} onChange={(e) => toggle(sc.id, e.target.checked)} /> Enabled</label>
              </div>
            ))}
          </div>
        </StatePane>
      </div>

      {contactEmail && <p className="muted al-fineprint">Questions? <a href={`mailto:${contactEmail}`}>{contactEmail}</a></p>}
    </div>
  );
}
