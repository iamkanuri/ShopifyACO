import { useEffect, useState } from "react";
import { getCatalog, getCatalogStatus, syncCatalog } from "./appApi";
import { DemoBadge, StatePane, useLoaded, useRefetchOnFocus } from "./ui";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const PAGE_SIZE = 50;

// Catalog: the synced product data the benchmarks + fixes operate on. Reads are free
// (Shopify Admin API), so syncing never spends money. We surface machine-readability
// gaps (missing SEO) right here so the merchant sees what the diagnosis acts on.
export function Catalog() {
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  // Debounce the search box; any new query resets to the first page.
  useEffect(() => {
    const t = setTimeout(() => { setQ(qInput.trim()); setOffset(0); }, 300);
    return () => clearTimeout(t);
  }, [qInput]);

  const c = useLoaded(() => getCatalog({ q, limit: PAGE_SIZE, offset }), [q, offset]);
  const s = useLoaded(() => getCatalogStatus(), []);
  // A product edited in the Shopify admin lands here via webhook; refetch when the
  // merchant switches back so the table reflects the store without a manual reload.
  useRefetchOnFocus(c.reload);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [noteTone, setNoteTone] = useState<"ok" | "info" | "err">("info");
  const say = (text: string, tone: "ok" | "info" | "err" = "info") => { setNote(text); setNoteTone(tone); };
  const products = c.data?.products ?? [];
  const demo = c.demo; // showing sample data (no store connected)
  const matchTotal = c.data?.total ?? products.length;       // matches the current search filter
  const syncedCount = s.data?.products ?? matchTotal;        // grand total synced (unfiltered)

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
        say(`Synced ${syncedCount} sample products · just now (demo)`, "ok");
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
  const rangeFrom = matchTotal === 0 ? 0 : offset + 1;
  const rangeTo = offset + products.length;
  const hasPrev = offset > 0;
  const hasNext = offset + products.length < matchTotal;
  const searching = q.length > 0;

  return (
    <div>
      <div className="al-page-head">
        <div>
          <h2>Catalog <DemoBadge show={c.demo} /></h2>
          <p className="muted">
            {syncedCount} products synced from Shopify{lastSync ? ` · last ${new Date(lastSync).toLocaleString()}` : ""}. Reads are free.
          </p>
        </div>
        <button className="btn" disabled={busy} onClick={sync}>{busy ? "Syncing…" : "Sync now"}</button>
      </div>
      {note && <div className={`al-note ${noteTone}`} style={{ marginBottom: 16 }}>{note}</div>}

      <div className="al-catalog-toolbar">
        <input
          className="al-catalog-search"
          type="search"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder="Search products by title, vendor or type…"
          aria-label="Search products"
        />
        <span className="muted al-catalog-count">
          {matchTotal === 0
            ? (searching ? `No matches for “${q}”` : "No products")
            : `Showing ${rangeFrom}–${rangeTo} of ${matchTotal}${searching ? ` matching “${q}”` : ""}`}
        </span>
      </div>

      <StatePane loading={c.loading} empty={products.length === 0} emptyText={searching ? `No products match “${q}”. Try a different search.` : "No products yet. Sync your Shopify catalog to begin."}>
        <div className="card al-table-wrap">
          <table className="al-table">
            <thead>
              <tr><th>Product</th><th>Type</th><th>Variants</th><th>SEO</th><th>Metafields</th></tr>
            </thead>
            <tbody>
              {products.map((p) => {
                // nested_truncated is product-level; a displayed count sitting AT its sync cap is
                // the one that overflowed — render it as "N+" (the admin shows the full count).
                // Truncation on a connection we don't display (collections) gets a generic marker.
                const varCapped = Boolean(p.nested_truncated) && p.variant_count >= 50;
                const metaCapped = Boolean(p.nested_truncated) && p.metafield_count >= 20;
                const otherTruncated = Boolean(p.nested_truncated) && !varCapped && !metaCapped;
                return (
                  <tr key={p.product_gid}>
                    <td>
                      <b>{p.title}</b>
                      {otherTruncated && <span className="al-gapmark" style={{ marginLeft: 6 }} title="Some of this product's nested data (e.g. collections) has more entries than were synced (caps: 50 variants / 20 collections / 20 metafields). The Shopify admin shows the full data; diagnosis uses what was synced.">partially synced</span>}
                      <div className="muted al-table-sub">{p.vendor}</div>
                    </td>
                    <td className="muted">{p.product_type ?? "—"}</td>
                    <td title={varCapped ? "This product has more variants than the 50 that were synced — the Shopify admin shows the full count." : undefined}>{varCapped ? `${p.variant_count}+` : p.variant_count}</td>
                    <td title="Explicit SEO title/description set on the product. When unset, Shopify falls back to the product title/description — the page still renders with defaults, but there's no intentional, machine-readable summary.">{p.seo_title && p.seo_description ? <span className="al-ok">complete</span> : <span className="al-gapmark">{p.seo_title || p.seo_description ? "partial" : "default"}</span>}</td>
                    <td title={metaCapped ? "This product has more metafields than the 20 that were synced — the Shopify admin shows the full count." : undefined}>{metaCapped ? `${p.metafield_count}+` : p.metafield_count}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </StatePane>

      {!demo && (hasPrev || hasNext) && (
        <div className="al-pager">
          <button className="btn" disabled={!hasPrev || c.loading} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>← Previous</button>
          <span className="muted">Page {Math.floor(offset / PAGE_SIZE) + 1} of {Math.max(1, Math.ceil(matchTotal / PAGE_SIZE))}</span>
          <button className="btn" disabled={!hasNext || c.loading} onClick={() => setOffset(offset + PAGE_SIZE)}>Next →</button>
        </div>
      )}
    </div>
  );
}
