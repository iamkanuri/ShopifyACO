import type { AppAttribution } from "./fixtures";
import { getAttribution } from "./appApi";
import { DemoBadge, StatePane, useLoaded } from "./ui";

// AI-referral attribution (Phase 10). Surfaces the directional funnel of storefront sessions
// that arrived from an AI assistant (ChatGPT / Perplexity / Gemini / …), captured by the
// consent-gated Web Pixel. This is the merchant-facing home for the read_customer_events +
// write_pixels scopes. NEVER causal: assistants strip referrers, so it's an identifiable floor.

const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);

function FunnelBar({ label, value, percent }: { label: string; value: number; percent: number }) {
  return (
    <div className="al-meter">
      <div className="al-meter-head"><span>{label}</span><span className="muted">{value}{value ? ` · ${percent}%` : ""}</span></div>
      <div className="al-meter-track"><div className="al-meter-fill" style={{ width: `${percent}%` }} /></div>
    </div>
  );
}

export function Attribution() {
  const a = useLoaded<AppAttribution>(() => getAttribution(30), []);
  const data = a.data;
  const totals = data?.totals ?? { sessions: 0, productViews: 0, checkouts: 0 };
  const sources = data?.bySource ?? [];
  const hasData = totals.sessions > 0;

  return (
    <div>
      <div className="al-page-head">
        <div>
          <h2>AI referral attribution <DemoBadge show={a.demo} /></h2>
          <p className="muted">
            Storefront sessions that arrived from an AI assistant, over the last {data?.windowDays ?? 30} days.
            Browser-reported and directional — not causal attribution.
          </p>
        </div>
      </div>

      <StatePane
        loading={a.loading}
        empty={!hasData}
        emptyText="No AI-referred sessions captured yet. When shoppers reach your store from ChatGPT, Perplexity, or Gemini, the funnel appears here."
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
