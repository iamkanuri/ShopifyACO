import { useState } from "react";
import { getCatalog, getCatalogStatus, syncCatalog } from "./appApi";
import { DemoBadge, StatePane, useLoaded } from "./ui";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Catalog: the synced product data the benchmarks + fixes operate on. Reads are free
// (Shopify Admin API), so syncing never spends money. We surface machine-readability
// gaps (missing SEO) right here so the merchant sees what the diagnosis acts on.
export function Catalog() {
  const c = useLoaded(() => getCatalog(), []);
  const s = useLoaded(() => getCatalogStatus(), []);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [noteTone, setNoteTone] = useState<"ok" | "info" | "err">("info");
  const say = (text: string, tone: "ok" | "info" | "err" = "info") => { setNote(text); setNoteTone(tone); };
  const products = c.data?.products ?? [];
  const demo = c.demo; // showing sample data (no store connected)
  const total = c.data?.total ?? products.length;

  // Poll the status endpoint until the background sync reports done (bounded). Returns
  // true if it completed, false if we gave up waiting (the worker is still finishing).
  async function waitForSync(maxMs = 30_000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      await delay(2000);
      const st = await getCatalogStatus();
      const status = st.data?.lastSync?.status;
      if (status === "completed" || status === "failed") return true;
    }
    return false;
  }

  async function sync() {
    if (busy) return; // guard against spam-clicks while a sync is in flight
    setBusy(true); setNote("");
    try {
      if (demo) {
        // No real store connected — illustrate the capability on the sample catalog.
        // Clearly a demo (the "Demo data" badge is right here); we never imply a real pull.
        await delay(1500);
        say(`Synced ${total} sample products · just now (demo)`, "ok");
        return;
      }
      // Connected store → real pull. In prod the queue runs it in the background, so keep
      // the button disabled and poll until it finishes instead of freeing up immediately.
      say("Syncing your Shopify catalog…", "info");
      const r = await syncCatalog();
      if (!r.ok) { say(r.error ?? "Couldn't start the sync. Try again.", "err"); return; }
      const queued = Boolean((r.data as { queued?: boolean } | undefined)?.queued);
      const done = queued ? await waitForSync() : true; // inline runs already finished
      c.reload(); s.reload();
      say(done ? "Catalog synced." : "Sync is running — your products will refresh shortly.", done ? "ok" : "info");
    } finally {
      setBusy(false);
    }
  }

  const lastSync = s.data?.lastSync?.finished_at;
  return (
    <div>
      <div className="al-page-head">
        <div>
          <h2>Catalog <DemoBadge show={c.demo} /></h2>
          <p className="muted">
            {c.data?.total ?? products.length} products synced from Shopify{lastSync ? ` · last ${new Date(lastSync).toLocaleString()}` : ""}. Reads are free.
          </p>
        </div>
        <button className="btn" disabled={busy} onClick={sync}>{busy ? "Syncing…" : "Sync now"}</button>
      </div>
      {note && <div className={`al-note ${noteTone}`} style={{ marginBottom: 16 }}>{note}</div>}

      <StatePane loading={c.loading} empty={products.length === 0} emptyText="No products yet. Sync your Shopify catalog to begin.">
        <div className="card al-table-wrap">
          <table className="al-table">
            <thead>
              <tr><th>Product</th><th>Type</th><th>Variants</th><th>SEO</th><th>Metafields</th></tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.product_gid}>
                  <td><b>{p.title}</b><div className="muted al-table-sub">{p.vendor}</div></td>
                  <td className="muted">{p.product_type ?? "—"}</td>
                  <td>{p.variant_count}</td>
                  <td>{p.seo_title && p.seo_description ? <span className="al-ok">complete</span> : <span className="al-gapmark">{p.seo_title || p.seo_description ? "partial" : "missing"}</span>}</td>
                  <td>{p.metafield_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </StatePane>
    </div>
  );
}
