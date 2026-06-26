// Pure helper for the expiring-offline-token lifecycle. Shopify access tokens now expire
// (~1h); we refresh proactively, a little before expiry, so a call never races the deadline.

/**
 * Should the stored access token be refreshed before use? True when it expires within
 * `bufferMs`. A null/absent/unparseable expiry (legacy non-expiring rows, or mock rows
 * stored without an expiry) returns false — there's nothing to refresh against.
 */
export function shouldRefreshToken(expiresAt: string | null | undefined, nowMs = Date.now(), bufferMs = 120_000): boolean {
  if (!expiresAt) return false;
  const exp = Date.parse(expiresAt);
  if (!Number.isFinite(exp)) return false;
  return exp - nowMs < bufferMs;
}
