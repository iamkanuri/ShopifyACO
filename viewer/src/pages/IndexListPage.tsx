import { useEffect, useState } from "react";
import { Link } from "../router";
import { getIndexes, type CategoryIndex } from "../api";

export function IndexListPage() {
  const [list, setList] = useState<CategoryIndex[] | null>(null);

  useEffect(() => {
    getIndexes().then(setList);
  }, []);

  return (
    <div className="indexpage">
      <div className="index-head">
        <h1>The AI Visibility Index</h1>
        <p className="index-sub">
          We asked <b>ChatGPT, Gemini &amp; Perplexity</b> what to buy across popular shopping
          categories — and tracked which brands they actually recommend. Pick a category to see the
          full ranking.
        </p>
      </div>

      {list === null ? (
        <div className="card empty">Loading…</div>
      ) : list.length === 0 ? (
        <div className="card empty">
          No category rankings published yet — check back soon, or{" "}
          <Link to="/scan">scan your own brand</Link>.
        </div>
      ) : (
        <div className="index-grid">
          {list.map((idx) => {
            const top = idx.entries.slice(0, 3);
            const maxRec = Math.max(...idx.entries.map((e) => e.recommendation), 0.01);
            return (
              <Link to={`/index/${idx.slug}`} className="index-card card" key={idx.slug}>
                <div className="index-card-label">{idx.label}</div>
                <div className="index-card-meta">{idx.entries.length} brands ranked · AI recommends most:</div>
                <ol className="index-card-top">
                  {top.map((e) => (
                    <li key={e.brand}>
                      <span className="icb-name">{e.brand}</span>
                      <span className="icb-bar">
                        <span style={{ width: `${Math.max(6, (e.recommendation / maxRec) * 100)}%` }} />
                      </span>
                      <span className="icb-pct">{Math.round(e.recommendation * 100)}%</span>
                    </li>
                  ))}
                </ol>
                <div className="index-card-go">View full leaderboard →</div>
              </Link>
            );
          })}

          {/* Trailing CTA — balances the grid and routes visitors to their own scan. */}
          <Link to="/scan" className="index-card index-card-cta card">
            <div className="index-card-label">Your category?</div>
            <div className="index-card-meta">
              Don't see your space — or want to know where your brand ranks?
            </div>
            <div className="index-card-go">Run a free scan →</div>
          </Link>
        </div>
      )}
    </div>
  );
}
