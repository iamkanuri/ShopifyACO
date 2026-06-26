// Pure helpers for resolving the scopes a shop ACTUALLY granted. The `scope` string
// Shopify returns from code/token exchange can under-report (it has, in practice, come
// back as just "read_products" even when the merchant approved write_products) — and we
// gate store writes on the recorded scopes, so an under-report wrongly blocks Fix Studio.
// The authoritative source is the live `currentAppInstallation { accessScopes }` query;
// these helpers pick the best available signal and normalize it.

/** Split a comma/space separated scope string into a clean, de-duped list. */
export function parseScopes(scope: string | null | undefined): string[] {
  if (!scope) return [];
  const seen = new Set<string>();
  for (const s of scope.split(/[,\s]+/)) {
    const t = s.trim();
    if (t) seen.add(t);
  }
  return [...seen];
}

/** Does this scope string include the given scope handle? */
export function hasScope(scope: string | null | undefined, handle: string): boolean {
  return parseScopes(scope).includes(handle);
}

/**
 * Choose the authoritative scope string to RECORD for a shop, in priority order:
 *   1. the live grant (from currentAppInstallation.accessScopes) — the source of truth;
 *   2. the scope reported by code/token exchange — used only if the live read failed;
 *   3. the app's configured scopes — last resort so we never record an empty grant.
 * Returned normalized (de-duped, comma-joined) so storage/compares are consistent.
 */
export function chooseScopes(
  liveGranted: string[],
  exchangeScope: string | null | undefined,
  configured: string[],
): string {
  const live = dedupe(liveGranted);
  if (live.length) return live.join(",");
  const exchanged = parseScopes(exchangeScope);
  if (exchanged.length) return exchanged.join(",");
  return dedupe(configured).join(",");
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  for (const s of list) {
    const t = s.trim();
    if (t) seen.add(t);
  }
  return [...seen];
}
