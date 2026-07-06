import { useEffect, useState } from "react";
import { Link } from "../router";
import { getIndex, trackEvent, type CategoryIndex } from "../api";
import { useConfig } from "../config";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const andList = (xs: string[]) => (xs.length <= 1 ? xs[0] ?? "" : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

// Honest ranking view — KEEP IN SYNC with src/server/indexSsr.ts#rankView (the SSR must render the same
// story the crawler sees). Tie-aware ranks (equal recommendation → same rank), a dominance-gated crown
// (alone at top, 2×+ the runner-up, above an event floor) or "contested" otherwise, and visible counts.
type IdxEntry = { brand: string; mention: number; recommendation: number; n?: number };
type RankRow = { brand: string; mention: number; recommendation: number; count: number | null; rank: number };
function rankView(entries: IdxEntry[]) {
  const n = entries.find((e) => typeof e.n === "number" && e.n > 0)?.n ?? null;
  const sorted = [...entries].sort((a, b) => b.recommendation - a.recommendation);
  const rows: RankRow[] = sorted.map((e) => ({
    brand: e.brand, mention: e.mention, recommendation: e.recommendation,
    count: n ? Math.round(e.recommendation * n) : null,
    rank: 1 + sorted.filter((o) => o.recommendation > e.recommendation + 1e-9).length,
  }));
  const top = rows[0] ?? null;
  const runnerUp = rows.find((r) => r.rank > 1) ?? null;
  const topTied = rows.filter((r) => r.rank === 1);
  const ratioOk = runnerUp ? top!.recommendation >= 2 * runnerUp.recommendation : !!top && top.recommendation > 0;
  const floorOk = n ? (top?.count ?? 0) >= 8 : (top?.recommendation ?? 0) >= 0.18;
  const gated = !!top && topTied.length === 1 && ratioOk && floorOk;
  return { n, rows, top, runnerUp, topTied, gated };
}

export function IndexLeaderboardPage({ slug }: { slug: string }) {
  const { brandName } = useConfig();
  const [idx, setIdx] = useState<CategoryIndex | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");

  useEffect(() => {
    getIndex(slug).then((d) => {
      if (d && d.entries?.length) {
        setIdx(d);
        setState("ready");
        trackEvent("index_viewed", d.run_id ?? undefined, { slug });
      } else {
        setState("missing");
      }
    });
  }, [slug]);

  if (state === "loading") return <div className="card empty">Loading index…</div>;
  if (state === "missing" || !idx)
    return (
      <div className="card empty">
        That index isn't published yet. <Link to="/index">See all categories →</Link>
      </div>
    );

  const cat = idx.label.toLowerCase();
  const { n, rows, top, runnerUp, topTied, gated } = rankView(idx.entries as IdxEntry[]);
  const maxRec = Math.max(...rows.map((r) => r.recommendation), 0.01);
  const recPhrase = (r: RankRow) => (r.count != null ? `${r.count} of ${n} answers (${pct(r.recommendation)})` : `${pct(r.recommendation)} of answers`);
  const recShort = (r: RankRow) => (r.count != null ? `${r.count} of ${n}` : pct(r.recommendation));
  // No numeric 1..N ladder — only a gated leader is badged; everyone else sits under "Also recommended",
  // sorted by frequency with counts shown. leadCount = the top group above the divider (crown / tied top).
  const leadCount = gated ? 1 : Math.max(1, topTied.length);
  const dividerNote = "Also recommended — ordered by how often AI named each brand; positions a few recommendations apart can flip between scans.";

  // Gated crown / tied-at-top / narrow-lead — must match the SSR headline the crawler sees.
  const insight = !top ? null : gated ? (
    <><b>{top.brand}</b> is the clear AI favorite in {cat} — recommended in {recPhrase(top)}, more than 2× any other brand.</>
  ) : topTied.length > 1 ? (
    <><b>No single favorite.</b> {andList(topTied.map((r) => r.brand))} are tied at the top of {cat} — each recommended in {recPhrase(top)} in this scan. Positions below shift between scans.</>
  ) : (
    <><b>{top.brand}</b> is the most-recommended {cat} brand ({recShort(top)}){runnerUp ? <>, but <b>{runnerUp.brand}</b> ({recShort(runnerUp)}) is close behind — no runaway leader</> : null}.</>
  );

  return (
    <div className="indexpage">
      <div className="index-head">
        <Link to="/index" className="back-link">← All categories</Link>
        <h1>AI Visibility Index: {idx.label}</h1>
        <p className="index-sub">
          How often <b>ChatGPT, Gemini & Perplexity</b> recommend each {cat} brand when shoppers ask what to
          buy. Ranked by recommendation rate; positions within a few recommendations are effectively tied.
        </p>
        {insight && (
          <div className="index-insight card">
            {insight} {idx.updated_at && <span className="muted">Scanned {new Date(idx.updated_at).toLocaleDateString()}.</span>}
          </div>
        )}
      </div>

      <div className="card cardpad">
        <table className="index-table">
          <thead>
            <tr>
              <th>Brand</th>
              <th>Mentioned</th>
              <th>Recommended</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.flatMap((r, i) => {
              const isCrown = gated && i === 0;
              const out = [];
              if (i === leadCount && leadCount < rows.length) {
                out.push(
                  <tr key="__tail" className="tail-divider">
                    <td colSpan={4}>{dividerNote}</td>
                  </tr>,
                );
              }
              out.push(
                <tr key={r.brand} className={isCrown ? "lead" : ""}>
                  <td className="brand">
                    {isCrown && <span className="lead-badge">★ Leader</span>} {r.brand}
                  </td>
                  <td>{pct(r.mention)}</td>
                  <td>
                    <div className="barcell">
                      <span style={{ minWidth: 38 }}>
                        {pct(r.recommendation)}
                        {r.count != null && <span className="rec-count"> {r.count}/{n}</span>}
                      </span>
                      <span className="minibar">
                        <span style={{ width: `${(r.recommendation / maxRec) * 100}%`, background: "var(--good)" }} />
                      </span>
                    </div>
                  </td>
                  <td>
                    <Link
                      to={`/scan?brand=${encodeURIComponent(r.brand)}&category=${encodeURIComponent(idx.label)}`}
                      className="linkbtn"
                      onClick={() => trackEvent("index_claim_click", idx.run_id ?? undefined, { slug, brand: r.brand })}
                    >
                      This is us →
                    </Link>
                  </td>
                </tr>,
              );
              return out;
            })}
          </tbody>
        </table>
      </div>

      <div className="index-cta card">
        <h2>Is your brand on this list — or missing from it?</h2>
        <p className="muted">
          Run a free scan for your own brand and get the full report: where you're recommended, who
          beats you, and the exact content gaps that make AI choose someone else.
        </p>
        <Link to="/scan" className="btn btn-primary lg">
          Run free scan
        </Link>
      </div>

      <p className="index-foot muted">
        {brandName} · Directional market intelligence — AI answers vary by model, time, prompt, and
        location. {idx.updated_at ? `Updated ${new Date(idx.updated_at).toLocaleDateString()}.` : ""}{" "}
        {idx.run_id && (
          <Link to={`/report/${idx.run_id}`}>See the scan behind this index →</Link>
        )}
      </p>
    </div>
  );
}
