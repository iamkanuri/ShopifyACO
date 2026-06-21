import { useEffect, useState } from "react";
import type { Loaded } from "./appApi";
import type { Proportion } from "./fixtures";

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
  useEffect(() => {
    let live = true;
    setLoading(true);
    fn().then((r) => { if (!live) return; setData(r.data); setDemo(r.demo); setError(r.error); setLoading(false); })
      .catch((e) => { if (!live) return; setError((e as Error).message); setLoading(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);
  return { data, loading, demo, error, reload: () => setNonce((n) => n + 1) };
}

export function DemoBadge({ show }: { show: boolean }) {
  if (!show) return null;
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

export function KindTag({ kind }: { kind: string }) {
  const label = kind === "evidence_backed" ? "Evidence-backed" : kind === "general_hygiene" ? "General hygiene" : kind === "write_products" ? "Auto-apply" : kind === "copy_ready" ? "Copy-ready" : kind;
  return <span className={`al-kind kind-${kind}`}>{label}</span>;
}
