import { useEffect, useState } from "react";

// "Connect Shopify" trigger. The install endpoint needs to know WHICH store, so instead of
// linking straight to /api/shopify/install (which 400s with a raw error when there's no
// ?shop=), we first ask for the store's myshopify.com address, validate it the same way the
// server does, then redirect to install with the shop param. Reused everywhere a connect
// CTA appears (landing hero, /app connect banner, onboarding, settings).

/** Normalize a typed store to <name>.myshopify.com, mirroring the server's strict check. */
function normalizeShop(input: string): string | null {
  let s = input.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "");
  if (!s) return null;
  if (!s.includes(".")) s = `${s}.myshopify.com`;
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s) ? s : null;
}

export function ConnectShopify({ className = "", label = "Connect Shopify" }: { className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [err, setErr] = useState<string | null>(null);

  // a11y: close the dialog on Escape while it's open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const shop = normalizeShop(value);
    if (!shop) {
      setErr("Enter your store like yourstore.myshopify.com");
      return;
    }
    window.location.href = `/api/shopify/install?shop=${encodeURIComponent(shop)}`;
  }

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{label}</button>
      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="connect-title" onClick={(e) => e.stopPropagation()}>
            <button className="modal-x" onClick={() => setOpen(false)} aria-label="Close">×</button>
            <h3 id="connect-title">Connect your Shopify store</h3>
            <p className="muted">Enter your store's address — we'll send you to Shopify to review and approve the connection.</p>
            <form onSubmit={submit}>
              <label htmlFor="connect-shop-input" className="field-label">Store address</label>
              <input
                id="connect-shop-input"
                className="modal-input"
                placeholder="yourstore.myshopify.com"
                value={value}
                onChange={(e) => { setValue(e.target.value); setErr(null); }}
                autoFocus
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                aria-describedby={err ? "connect-shop-err" : undefined}
              />
              {err && <div id="connect-shop-err" className="modal-err">{err}</div>}
              <button type="submit" className="btn btn-primary">Continue to Shopify →</button>
              <p className="modal-fine">Shopify shows you exactly what's requested — read access to your product catalog, AI-referral attribution, and approval-gated SEO updates to your products. You approve it on Shopify and can disconnect anytime.</p>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
