import { useEffect, useState } from "react";
import { Link } from "../router";
import { getIndex, trackEvent, type CategoryIndex } from "../api";
import { useConfig } from "../config";

const pct = (x: number) => `${Math.round(x * 100)}%`;

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

  const top = idx.entries[0];
  const maxRec = Math.max(...idx.entries.map((e) => e.recommendation), 0.01);

  return (
    <div className="indexpage">
      <div className="index-head">
        <Link to="/index" className="back-link">← All categories</Link>
        <h1>AI Visibility Index: {idx.label}</h1>
        <p className="index-sub">
          How often <b>ChatGPT, Gemini & Perplexity</b> recommend each {idx.label.toLowerCase()} brand when
          shoppers ask what to buy. {idx.entries.length} brands, ranked by recommendation rate.
        </p>
        {top && (
          <div className="index-insight card">
            <b>{top.brand}</b> leads — recommended {pct(top.recommendation)} of the time. Brands lower
            on the list are <i>known but rarely chosen</i>: that gap is the opportunity.
          </div>
        )}
      </div>

      <div className="card cardpad">
        <table className="index-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Brand</th>
              <th>Mentioned</th>
              <th>Recommended</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {idx.entries.map((e) => (
              <tr key={e.brand} className={e.rank === 1 ? "lead" : ""}>
                <td className="rank">{e.rank}</td>
                <td className="brand">{e.brand}</td>
                <td>{pct(e.mention)}</td>
                <td>
                  <div className="barcell">
                    <span style={{ minWidth: 38 }}>{pct(e.recommendation)}</span>
                    <span className="minibar">
                      <span style={{ width: `${(e.recommendation / maxRec) * 100}%`, background: "var(--good)" }} />
                    </span>
                  </div>
                </td>
                <td>
                  <Link
                    to={`/scan?brand=${encodeURIComponent(e.brand)}&category=${encodeURIComponent(idx.label)}`}
                    className="linkbtn"
                    onClick={() => trackEvent("index_claim_click", idx.run_id ?? undefined, { slug, brand: e.brand })}
                  >
                    This is us →
                  </Link>
                </td>
              </tr>
            ))}
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
