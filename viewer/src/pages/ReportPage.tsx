import { useEffect, useState } from "react";
import type { RunResults } from "../types";
import { Link } from "../router";
import { Report } from "./Report";
import { ShareBar } from "../components/ShareBar";
import { FunnelCta } from "../components/FunnelCta";

// The ungated preview slice (mirrors the server's reportPreview). No PII.
interface Preview {
  brand: string; category: string; score: number | null;
  mentionRate: number | null; recommendationRate: number | null; gapPoints: number | null;
  gapLine: string;
  weakestEngine: string | null; headline: string | null; isShopify: boolean; basedOnResponses: number;
}
type RunsResponse = { claimed: false; preview: Preview } | ({ claimed: true; paid: boolean } & RunResults);

export function ReportPage({ runId }: { runId: string }) {
  const [data, setData] = useState<RunsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    fetch(`/api/runs/${runId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("This report isn't available — it may still be running, or the link is wrong."))))
      .then((d: RunsResponse) => setData(d))
      .catch((e) => setError(e.message));
  }
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/runs/${runId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("This report isn't available — it may still be running, or the link is wrong."))))
      .then((d: RunsResponse) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [runId]);

  if (error)
    return (
      <div className="card center-card">
        <h2>Report not available</h2>
        <p className="muted">{error}</p>
        <Link to="/scan" className="btn btn-primary">Run a free scan</Link>
      </div>
    );
  if (!data)
    return (
      <div className="card center-card">
        <div className="spinner" />
        <h2 style={{ marginTop: 18 }}>Loading your report…</h2>
        <p className="muted">Fetching results and AI-visibility analysis.</p>
      </div>
    );

  // Ungated preview — score + gap + weakest engine, with an email step to unlock + share.
  if (!data.claimed) return <PreviewClaim runId={runId} preview={data.preview} onClaimed={load} />;

  // Claimed → the free diagnosis (or, once paid, the full report) + share + Shopify-aware CTA.
  const a = data.analysis;
  const shareText = a ? `${a.brand} scores ${a.visibilityScore.score}/100 on AI shopping visibility.` : "My AI shopping visibility scorecard";
  return (
    <>
      <ShareBar runId={runId} shareText={shareText} />
      <Report
        run={data}
        runId={runId}
        paid={data.paid}
        reportMdUrl={data.paid ? `/api/runs/${runId}/report.md` : undefined}
        isShopify={Boolean(data.meta?.isShopify)}
      />
    </>
  );
}

// Value-first: the headline number + the lost-demand gap, shown WITHOUT an email. Email saves
// the full breakdown and turns this into a shareable /report/:id (which then unfurls + spreads).
function PreviewClaim({ runId, preview: p, onClaimed }: { runId: string; preview: Preview; onClaimed: () => void }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  async function claim() {
    if (!valid) { setErr("Enter a valid email to save your scorecard."); return; }
    setBusy(true); setErr("");
    try {
      const r = await fetch(`/api/runs/${runId}/claim`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), sourcePage: window.location.pathname }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr((d as { error?: string }).error ?? "Couldn't save — try again."); return; }
      onClaimed(); // re-fetch → the now-claimed full report
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="preview-claim">
      <div className="runmeta">
        <span className="chip" style={{ fontWeight: 700 }}>{p.brand}{p.category ? ` · ${p.category}` : ""}</span>
        <span className="chip">{p.basedOnResponses} answers analyzed</span>
      </div>
      <h1 className="report-headline">{p.headline ?? "Your AI visibility scorecard"}</h1>

      <section className="hero section">
        <div className="card preview-score">
          <div className="preview-score-num">{p.score ?? "—"}<span className="preview-score-den"> / 100</span></div>
          <div className="muted">AI Visibility Score</div>
        </div>
        <div className="card preview-gap">
          <p className="preview-gap-line">{p.gapLine}</p>
          {p.weakestEngine && <p className="muted">Weakest assistant: <b>{p.weakestEngine}</b> recommends you the least.</p>}
        </div>
      </section>

      <div className="card claim-card">
        <h2>Save &amp; share your scorecard</h2>
        <p className="muted">Unlock the full competitor leaderboard, the per-assistant breakdown, and every score component — and get a shareable link.</p>
        <div className="claim-form">
          <input type="email" placeholder="you@example.com" value={email} aria-label="Your email address"
            onChange={(e) => { setEmail(e.target.value); setErr(""); }}
            onKeyDown={(e) => e.key === "Enter" && claim()} />
          <button className="btn btn-primary lg" disabled={busy} onClick={claim}>{busy ? "Saving…" : "Save & share your scorecard"}</button>
        </div>
        {err && <div className="banner-error" role="alert">{err}</div>}
        <p className="muted al-fineprint">Your full scorecard opens right here — no waiting on email. This page's link then works for anyone you share it with, showing only public AI answers about public brands (no personal data). The URL is unguessable, so it stays private until you share it.</p>
      </div>

      <section className="section">
        <FunnelCta isShopify={p.isShopify} runId={runId} />
      </section>
    </div>
  );
}
