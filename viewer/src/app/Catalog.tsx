import { useState } from "react";
import { getCatalog, getCatalogStatus, syncCatalog } from "./appApi";
import { DemoBadge, StatePane, useLoaded } from "./ui";

// Catalog: the synced product data the benchmarks + fixes operate on. Reads are free
// (Shopify Admin API), so syncing never spends money. We surface machine-readability
// gaps (missing SEO) right here so the merchant sees what the diagnosis acts on.
export function Catalog() {
  const c = useLoaded(() => getCatalog(), []);
  const s = useLoaded(() => getCatalogStatus(), []);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const products = c.data?.products ?? [];

  async function sync() {
    setBusy(true); setNote("");
    const r = await syncCatalog();
    setBusy(false);
    setNote(r.ok ? "Sync started — products refresh in the background." : r.error ?? "Connect your store to sync.");
    if (r.ok) { c.reload(); s.reload(); }
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
      {note && <div className="al-note ok" style={{ marginBottom: 16 }}>{note}</div>}

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
