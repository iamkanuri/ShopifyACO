import type { LostPrompt } from "../types";

function YesNo({ v, good }: { v: boolean; good?: boolean }) {
  return (
    <span className={`badge ${v ? (good ? "rec" : "men") : "abs"}`}>{v ? "Yes" : "No"}</span>
  );
}

const PRETTY: Record<string, string> = { openai: "ChatGPT", gemini: "Gemini", perplexity: "Perplexity" };

export function LostPrompts({ lost, brand, ownLeads = false }: { lost: LostPrompt[]; brand: string; ownLeads?: boolean }) {
  if (lost.length === 0) {
    return <div className="card" style={{ padding: 20 }}>No lost prompts — {brand} held its own everywhere in this scan.</div>;
  }
  return (
    <div className="card cardpad">
      {/* For a category leader these aren't "losses" — they're the few answers a rival edged ahead. */}
      {ownLeads && (
        <p className="muted" style={{ margin: "0 0 12px" }}>
          {brand} leads overall — these are the only answers a competitor edged ahead. Your growth edges.
        </p>
      )}
      <table>
        <thead>
          <tr>
            <th>Prompt</th>
            <th>Engine</th>
            <th>You mentioned</th>
            <th>You recommended</th>
            <th>{ownLeads ? "Rival that edged ahead" : "Winner(s)"}</th>
            <th>What the AI said</th>
          </tr>
        </thead>
        <tbody>
          {lost.map((l, i) => (
            <tr key={i}>
              <td style={{ maxWidth: 230 }}>{l.prompt}</td>
              <td>{PRETTY[l.engine] ?? l.engine}</td>
              <td><YesNo v={l.brandMentioned} /></td>
              <td><YesNo v={l.brandRecommended} good /></td>
              <td>{l.winners.slice(0, 3).join(", ") || "—"}</td>
              <td className="muted" style={{ maxWidth: 280, fontStyle: l.snippet ? "italic" : "normal" }}>
                {l.snippet ? `"${l.snippet}"` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
