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
          We asked <b>ChatGPT, Gemini & Perplexity</b> what to buy — and tracked who they actually
          recommend. Browse the leaderboards by category, or run a scan for your own brand.
        </p>
        <Link to="/scan" className="btn btn-primary">
          Run my free scan
        </Link>
      </div>

      {list === null ? (
        <div className="card empty">Loading…</div>
      ) : list.length === 0 ? (
        <div className="card empty">
          No category indexes published yet — check back soon, or{" "}
          <Link to="/scan">run your own scan</Link>.
        </div>
      ) : (
        <div className="index-grid">
          {list.map((idx) => {
            const top = idx.entries.slice(0, 3);
            return (
              <Link to={`/index/${idx.slug}`} className="index-card card" key={idx.slug}>
                <div className="index-card-label">{idx.label}</div>
                <div className="index-card-meta">{idx.entries.length} brands ranked</div>
                <ol className="index-card-top">
                  {top.map((e) => (
                    <li key={e.brand}>
                      <span>{e.brand}</span>
                      <span className="muted">{Math.round(e.recommendation * 100)}%</span>
                    </li>
                  ))}
                </ol>
                <div className="index-card-go">View leaderboard →</div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
