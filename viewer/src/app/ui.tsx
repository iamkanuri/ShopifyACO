import { useEffect, useRef, useState } from "react";
import type { Loaded } from "./appApi";
import type { Proportion } from "./fixtures";
import { useModalFocus } from "../useModalFocus";

// Shared primitives for the embedded /app UI. Small, prop-driven, dark-theme.

/** Generic loader hook → { state, demo, reload }. Handles loading/error uniformly. */
export function useLoaded<T>(fn: () => Promise<Loaded<T>>, deps: unknown[] = []): {
  data: T | null; loading: boolean; demo: boolean; error?: string; reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [demo, setDemo] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [nonce, setNonce] = useState(0);
  const lastNonce = useRef(0);
  useEffect(() => {
    let live = true;
    // Stale-while-revalidate for reload() refetches (after an action, or a focus refetch):
    // keep the current data on screen and swap in the fresh result — no loading flash, and
    // the screen still ends up store-accurate. First load and deps-driven fetches (e.g.
    // pagination, whose controls gate on `loading`) keep the loading pane.
    const isReload = nonce !== lastNonce.current && data !== null;
    lastNonce.current = nonce;
    if (!isReload) setLoading(true);
    fn().then((r) => { if (!live) return; setData(r.data); setDemo(r.demo); setError(r.error); setLoading(false); })
      .catch((e) => { if (!live) return; setError((e as Error).message); setLoading(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);
  return { data, loading, demo, error, reload: () => setNonce((n) => n + 1) };
}

/** Refetch when the tab/iframe regains focus or becomes visible again — a merchant who
 *  edits a product in the Shopify admin and switches back should see the change without a
 *  manual reload (App Store req 2.1.4: app data consistent with the admin in real time). */
export function useRefetchOnFocus(reload: () => void): void {
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") reload(); };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function DemoBadge({ show, error }: { show: boolean; error?: string }) {
  if (!show) return null;
  // A connected store whose live request failed must NOT look like a clean demo — say so.
  if (error) return <span className="al-demo al-demo-err" title={`Couldn't load live data — showing sample (${error})`}>Live data unavailable</span>;
  return <span className="al-demo" title="Sample data — connect your store to see live results">Demo data</span>;
}

export function StatePane({ loading, empty, emptyText, children }: { loading: boolean; empty?: boolean; emptyText?: string; children: React.ReactNode }) {
  if (loading) return <div className="al-state">Loading…</div>;
  if (empty) return <div className="al-state al-empty">{emptyText ?? "Nothing here yet."}</div>;
  return <>{children}</>;
}

const fmtPct = (r: number | null) => (r == null ? "—" : `${Math.round(r * 100)}%`);

/** A proportion as "33% · n=60 · CI 22–46%". */
export function Pct({ p, ci = true }: { p: Proportion; ci?: boolean }) {
  return (
    <span className="al-pct">
      <b>{fmtPct(p.rate)}</b>
      <span className="al-pct-meta">n={p.n}{ci && p.n > 0 ? ` · CI ${fmtPct(p.ciLow)}–${fmtPct(p.ciHigh)}` : ""}</span>
    </span>
  );
}

/** Horizontal CI band on a 0–100% track with a point marker. */
export function CiBar({ p, tone = "neutral" }: { p: Proportion; tone?: "neutral" | "good" | "bad" }) {
  if (p.rate == null) return <div className="al-cibar"><span className="al-cibar-na">no data</span></div>;
  const lo = p.ciLow * 100, hi = p.ciHigh * 100, pt = p.rate * 100;
  return (
    <div className="al-cibar" title={`${fmtPct(p.rate)} (95% CI ${fmtPct(p.ciLow)}–${fmtPct(p.ciHigh)})`}>
      <div className={`al-cibar-band tone-${tone}`} style={{ left: `${lo}%`, width: `${Math.max(1, hi - lo)}%` }} />
      <div className="al-cibar-pt" style={{ left: `${pt}%` }} />
    </div>
  );
}

export function ConfidenceBadge({ level }: { level: string }) {
  const map: Record<string, string> = { strong: "Strong signal", moderate: "Moderate signal", directional: "Directional" };
  return <span className={`al-conf conf-${level}`}>{map[level] ?? level}</span>;
}

export function VerdictPill({ verdict }: { verdict: string }) {
  const tone = verdict === "improved" ? "good" : verdict === "regressed" ? "bad" : "neutral";
  return <span className={`al-verdict tone-${tone}`}>{verdict}</span>;
}

export function SeverityPill({ severity }: { severity: string }) {
  const tone = severity === "critical" ? "bad" : severity === "warning" ? "warn" : "neutral";
  return <span className={`al-sev tone-${tone}`}>{severity}</span>;
}

/** Shared cost-confirmation before any LIVE (real-spend) run — used by Measure and
 *  Monitoring "Run now" so real money is never spent on a single click without consent.
 *  Shows an estimated max cost when known, else a generic real-spend warning. */
export function ConfirmRun({ open, title, detail, estimateUsd, busy, confirmLabel = "Yes, run", onConfirm, onCancel }: {
  open: boolean; title: string; detail?: string; estimateUsd?: number | null; busy?: boolean;
  confirmLabel?: string; onConfirm: () => void; onCancel: () => void;
}) {
  // a11y: initial focus, focus trap, Escape, and focus restoration on close.
  const dialogRef = useModalFocus<HTMLDivElement>(open, onCancel);
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div ref={dialogRef} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="confirmrun-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="confirmrun-title">{title}</h3>
        {detail && <p className="muted">{detail}</p>}
        <p style={{ margin: "8px 0" }}>
          {estimateUsd != null
            ? <>Estimated max cost <b>${estimateUsd.toFixed(2)}</b> in real AI spend — within your daily cost cap.</>
            : <>This runs a <b>real</b> benchmark (real AI spend), within your daily cost cap.</>}
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="btn btn-primary" disabled={busy} onClick={onConfirm}>{busy ? "Running…" : confirmLabel}</button>
          <button className="btn" disabled={busy} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export function KindTag({ kind }: { kind: string }) {
  const label = kind === "evidence_backed" ? "Evidence-backed" : kind === "general_hygiene" ? "General hygiene" : kind === "write_products" ? "Auto-apply" : kind === "copy_ready" ? "Copy-ready" : kind;
  return <span className={`al-kind kind-${kind}`}>{label}</span>;
}
