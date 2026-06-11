import type { LeaderboardRow, RateStat } from "../types";

function Bar({ r, color }: { r: RateStat; color: string }) {
  return (
    <div className="barcell">
      <span style={{ minWidth: 64 }}>
        {Math.round(r.rate * 100)}% <span className="muted">({r.count}/{r.total})</span>
      </span>
      <span className="minibar">
        <span style={{ width: `${Math.round(r.rate * 100)}%`, background: color }} />
      </span>
    </div>
  );
}

export function Leaderboard({ rows }: { rows: LeaderboardRow[] }) {
  return (
    <div className="card cardpad">
      <table>
        <thead>
          <tr>
            <th>Brand</th>
            <th>Mention rate</th>
            <th>Recommendation rate</th>
            <th>Avg rank</th>
            <th>Strongest on</th>
            <th>Top winning prompt</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.brand} className={r.isOwn ? "you" : ""}>
              <td>
                {r.brand}
                {r.isOwn && <span className="muted"> (you)</span>}
              </td>
              <td>
                <Bar r={r.mention} color="var(--ink-3)" />
              </td>
              <td>
                <Bar r={r.recommendation} color="var(--good)" />
              </td>
              <td>{r.avgRankWhenMentioned != null ? r.avgRankWhenMentioned.toFixed(1) : "—"}</td>
              <td className="muted">{r.strongestEngines.join(", ") || "—"}</td>
              <td className="muted" style={{ maxWidth: 230 }}>
                {r.topWinningPrompts[0] ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
