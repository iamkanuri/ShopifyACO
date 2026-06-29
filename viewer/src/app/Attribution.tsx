import { useState } from "react";
import type { AppAttribution, AppPixelHealth } from "./fixtures";
import { activatePixel, getAttribution, getPixelHealth } from "./appApi";
import { DemoBadge, StatePane, useLoaded } from "./ui";

// AI-referral attribution (Phase 10). Surfaces the directional funnel of storefront sessions
// that arrived from an AI assistant (ChatGPT / Perplexity / Gemini / …), captured by the
// consent-gated Web Pixel. This is the merchant-facing home for the read_customer_events +
// write_pixels scopes. NEVER causal: assistants strip referrers, so it's an identifiable floor.

const DAY_OPTIONS = [7, 30, 90];
// Capped so a malformed/forged count can never render an impossible bar (the server funnel is
// already monotonic, but never trust a percentage to be ≤ 100 in the view).
const pct = (n: number, of: number) => (of > 0 ? Math.min(100, Math.round((n / of) * 100)) : 0);

function FunnelBar({ label, value, percent }: { label: string; value: number; percent: number }) {
  return (
    <div className="al-meter">
      <div className="al-meter-head"><span>{label}</span><span className="muted">{value}{value ? ` · ${percent}%` : ""}</span></div>
      <div className="al-meter-track"><div className="al-meter-fill" style={{ width: `${percent}%` }} /></div>
    </div>
  );
}

// Health panel: lets the merchant tell "no AI traffic yet" apart from "the pixel isn't running".
function PixelHealth({ h, demo, onReconnect }: { h: AppPixelHealth; demo: boolean; onReconnect: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "err" | "info" } | null>(null);

  async function reconnect() {
    setBusy(true); setMsg(null);
    const r = await activatePixel();
    setBusy(false);
    if (r.ok && r.data?.activated) { setMsg({ text: "Pixel reconnected.", tone: "ok" }); onReconnect(); }
    else if (r.demo) setMsg({ text: "Open the app from the Shopify admin to manage the pixel.", tone: "info" });
    else setMsg({ text: r.data?.message ?? r.error ?? "Couldn't reconnect the pixel.", tone: "err" });
  }

  const state = !h.hasScope ? "scope" : !h.activated ? "inactive" : h.totalEvents === 0 ? "quiet" : "ok";
  const tone = state === "ok" ? "ok" : state === "quiet" ? "info" : "warn";
  const headline = {
    scope: "Pixel needs permission",
    inactive: "Pixel not activated",
    quiet: "Pixel active — no beacons received yet",
    ok: "Pixel active",
  }[state];
  const detail = {
    scope: "Reconnect the app granting read_customer_events + write_pixels so the pixel can run.",
    inactive: "The Web Pixel isn't created for this store yet. Reconnect to activate it.",
    quiet: "We haven't received any storefront beacons. If shoppers have arrived from AI assistants, the pixel may not be live on the storefront — try reconnecting.",
    ok: "Receiving storefront beacons.",
  }[state];

  return (
    <div className="section">
      <div className="card">
        <div className="al-health-head">
          <span className={`al-dot ${state === "ok" ? "on" : "off"}`} />
          <b>{headline}</b>
          <span className={`al-status status-${tone === "ok" ? "live" : tone === "warn" ? "approved" : "mock"}`} style={{ marginLeft: "auto" }}>
            {state === "ok" ? "Healthy" : state === "quiet" ? "Idle" : "Action needed"}
          </span>
        </div>
        <p className="muted" style={{ margin: "6px 0 12px" }}>{detail}</p>
        <div className="al-health-grid">
          <div><div className="al-set-k">Activation</div><div>{h.activated ? "Activated" : "Not activated"}</div></div>
          <div><div className="al-set-k">Scopes</div><div>{h.hasScope ? "Granted" : "Missing"}</div></div>
          <div><div className="al-set-k">Ingest token</div><div>{h.ingestTokenSet ? "Set" : "Not set"}</div></div>
          <div><div className="al-set-k">Last beacon</div><div>{h.lastEventAt ? new Date(h.lastEventAt).toLocaleString() : "none yet"}</div></div>
          <div><div className="al-set-k">Sessions (7d)</div><div>{h.sessionsLast7d}</div></div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12 }}>
          {/* When healthy, the button is a quiet, optional action (not a prompt); when something's
              wrong it's the primary fix. */}
          <button className={`btn ${state === "ok" ? "al-ghost" : "btn-primary"}`} disabled={busy || demo} onClick={reconnect}>
            {busy ? "Reconnecting…" : "Reconnect pixel"}
          </button>
          {msg
            ? <span className={`al-note ${msg.tone}`} style={{ margin: 0 }}>{msg.text}</span>
            : state === "ok" && <span className="muted al-fineprint" style={{ margin: 0 }}>Healthy — no action needed. Only reconnect if it stops receiving beacons.</span>}
        </div>
        <p className="muted al-fineprint" style={{ marginTop: 10 }}>Only events captured with the shopper's analytics consent are stored — non-consented sessions are never recorded.</p>
      </div>
    </div>
  );
}

export function Attribution() {
  const [days, setDays] = useState(30);
  const a = useLoaded<AppAttribution>(() => getAttribution(days), [days]);
  const health = useLoaded<AppPixelHealth>(() => getPixelHealth(), []);
  const data = a.data;
  const totals = data?.totals ?? { sessions: 0, productViews: 0, checkouts: 0 };
  const sources = data?.bySource ?? [];
  const hasData = totals.sessions > 0;

  return (
    <div>
      <div className="al-page-head">
        <div>
          <h2>AI referral attribution <DemoBadge show={a.demo} error={a.error} /></h2>
          <p className="muted">
            Storefront sessions that arrived from an AI assistant, over the last {data?.windowDays ?? days} days.
            Browser-reported and directional — not causal attribution.
          </p>
        </div>
        <label className="al-range">
          <span className="muted">Window</span>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {DAY_OPTIONS.map((d) => <option key={d} value={d}>Last {d} days</option>)}
          </select>
        </label>
      </div>

      {health.data && <PixelHealth h={health.data} demo={health.demo} onReconnect={() => health.reload()} />}

      <StatePane
        loading={a.loading}
        empty={!hasData}
        emptyText="No AI-referred sessions in this window. When shoppers reach your store from ChatGPT, Perplexity, or Gemini, the funnel appears here. (Check the pixel status above to be sure it's running.)"
      >
        <div className="section">
          <h2>Funnel</h2>
          <div className="card">
            <FunnelBar label="AI-referred sessions" value={totals.sessions} percent={100} />
            <FunnelBar label="Viewed a product" value={totals.productViews} percent={pct(totals.productViews, totals.sessions)} />
            <FunnelBar label="Completed checkout" value={totals.checkouts} percent={pct(totals.checkouts, totals.sessions)} />
          </div>
        </div>

        <div className="section">
          <h2>By assistant</h2>
          <div className="grid">
            {sources.map((s) => (
              <div key={s.aiSource} className="card al-setrow">
                <div>
                  <div className="al-set-k">{s.aiSource}</div>
                  <div className="muted">{s.sessions} session{s.sessions === 1 ? "" : "s"}</div>
                </div>
                <div className="muted">{s.productViews} viewed · {s.checkouts} checkout{s.checkouts === 1 ? "" : "s"}</div>
              </div>
            ))}
          </div>
        </div>

        {data?.note && <p className="muted al-fineprint">{data.note}</p>}
        <p className="muted al-fineprint">
          Captured only with the shopper's analytics consent; no raw IP or customer identity is stored, and rows are deleted after 90 days.
        </p>
      </StatePane>
    </div>
  );
}
