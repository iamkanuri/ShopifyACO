import { useSyncExternalStore } from "react";

// Tiny history router — no dependency. Routes: /, /demo, /scan, /report/:runId.

function subscribe(cb: () => void) {
  window.addEventListener("popstate", cb);
  window.addEventListener("navigate", cb);
  return () => {
    window.removeEventListener("popstate", cb);
    window.removeEventListener("navigate", cb);
  };
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

// Shopify's embedded context. App Bridge needs ?shop & ?host on every framed URL — without
// them a hard refresh / deep-link of an /app subroute has no shop, so the server serves
// `frame-ancestors 'none'` and the browser refuses the iframe. So we carry these across
// internal navigations (and onto link hrefs, for reload / open-in-new-tab). Only present
// when embedded, so this is a no-op on the public site. (Not the one-time hmac/id_token.)
const PRESERVED_PARAMS = ["shop", "host", "embedded", "locale"];

/** Merge the preserved Shopify params from `currentSearch` onto target `to` (unless `to`
 *  already sets them). Pure, so it's unit-testable without a DOM. */
export function withPreservedQuery(to: string, currentSearch: string): string {
  const cur = new URLSearchParams(currentSearch);
  const hashIdx = to.indexOf("#");
  const hash = hashIdx >= 0 ? to.slice(hashIdx) : "";
  const noHash = hashIdx >= 0 ? to.slice(0, hashIdx) : to;
  const qIdx = noHash.indexOf("?");
  const path = qIdx >= 0 ? noHash.slice(0, qIdx) : noHash;
  const out = new URLSearchParams(qIdx >= 0 ? noHash.slice(qIdx + 1) : "");
  for (const k of PRESERVED_PARAMS) {
    if (cur.has(k) && !out.has(k)) out.set(k, cur.get(k)!);
  }
  const q = out.toString();
  return path + (q ? `?${q}` : "") + hash;
}

export function navigate(to: string): void {
  const target = withPreservedQuery(to, window.location.search);
  if (target === window.location.pathname + window.location.search) return;
  window.history.pushState({}, "", target);
  window.dispatchEvent(new Event("navigate"));
}

export function Link(props: { to: string; className?: string; children: React.ReactNode }) {
  const href = typeof window === "undefined" ? props.to : withPreservedQuery(props.to, window.location.search);
  return (
    <a
      href={href}
      className={props.className}
      onClick={(e) => {
        e.preventDefault();
        navigate(props.to);
      }}
    >
      {props.children}
    </a>
  );
}
