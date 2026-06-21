import { useState } from "react";
import { applyFix, approveFix, dismissFix, getFixes } from "./appApi";
import { DemoBadge, KindTag, StatePane, useLoaded } from "./ui";

// Fix Studio: evidence-backed proposals. write_products are auto-applied (gated:
// approve → scope → re-read conflict check → rollback snapshot, server-side);
// copy_ready are validated snippets the merchant pastes into their theme.
export function Fixes() {
  const f = useLoaded(() => getFixes(), []);
  const proposals = f.data?.proposals ?? [];
  const [busy, setBusy] = useState<number | null>(null);
  const [note, setNote] = useState<{ id: number; text: string; ok: boolean } | null>(null);

  async function act(id: number, fn: (id: number) => Promise<{ ok: boolean; error?: string; demo?: boolean }>, okText: string) {
    setBusy(id); setNote(null);
    const r = await fn(id);
    setBusy(null);
    setNote({ id, text: r.ok ? okText : r.error ?? "Action unavailable", ok: r.ok });
    if (r.ok) f.reload();
  }

  return (
    <div>
      <div className="al-page-head">
        <div>
          <h2>Fix Studio <DemoBadge show={f.demo} /></h2>
          <p className="muted">Reviewable changes. Auto-applied fixes only reformat data you already have — we never invent reviews, prices or identifiers.</p>
        </div>
      </div>

      <StatePane loading={f.loading} empty={proposals.length === 0} emptyText="No proposals yet. Generate fixes from a finding.">
        <div className="grid">
          {proposals.map((p) => (
            <div key={p.id} className="card al-fix">
              <div className="al-fix-top">
                <KindTag kind={p.kind} />
                <span className="al-fix-target">{p.target}</span>
                <span className={`al-status status-${p.status}`}>{p.status}</span>
              </div>
              <div className="al-fix-label">{p.label}</div>
              <p className="muted">{p.rationale}</p>

              {p.kind === "write_products" ? (
                <div className="al-diff">
                  <div className="al-diff-row"><span className="al-diff-k del">current</span><code>{p.current_value || "(empty)"}</code></div>
                  <div className="al-diff-row"><span className="al-diff-k add">proposed</span><code>{p.proposed_value}</code></div>
                </div>
              ) : (
                <pre className="al-snippet"><code>{p.proposed_value}</code></pre>
              )}

              {note?.id === p.id && <div className={note.ok ? "al-note ok" : "al-note err"}>{note.text}</div>}

              <div className="al-fix-actions">
                {p.kind === "write_products" ? (
                  p.status === "proposed" ? (
                    <button className="btn" disabled={busy === p.id} onClick={() => act(p.id, approveFix, "Approved — ready to apply.")}>Approve</button>
                  ) : p.status === "approved" ? (
                    <button className="btn btn-primary" disabled={busy === p.id} onClick={() => act(p.id, applyFix, "Applied to your store (reversible).")}>Apply to store</button>
                  ) : null
                ) : (
                  <button className="btn" onClick={() => { navigator.clipboard?.writeText(p.proposed_value); setNote({ id: p.id, text: "Copied — paste into your theme.", ok: true }); }}>Copy snippet</button>
                )}
                {p.status !== "dismissed" && p.status !== "applied" && (
                  <button className="btn al-ghost" disabled={busy === p.id} onClick={() => act(p.id, dismissFix, "Dismissed.")}>Dismiss</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </StatePane>
    </div>
  );
}
