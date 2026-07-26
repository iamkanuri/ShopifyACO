import { randomBytes } from "node:crypto";
import { pgQuery } from "./pg.js";
import { ENV } from "../server/env.js";
import { decryptSecret, encryptSecret } from "../shopify/crypto.js";
import { getShopifyClient } from "../shopify/client.js";
import { shouldRefreshToken } from "../shopify/tokens.js";

// Persistence for Shopify multi-tenancy (Phase 2). Tokens are stored only as
// AES-256-GCM blobs; getAccessToken decrypts on read. All writes are shop-scoped.

export interface ShopRow {
  shop_domain: string;
  status: string;
  scopes: string | null;
  plan: string | null;
  installed_at: string;
  uninstalled_at: string | null;
  web_pixel_id: string | null;
  pixel_ingest_token: string | null;
  /** The shop's PRIMARY storefront host (custom domain when one is configured).
   *  The host a shopper — and therefore a public Buyer Test — actually uses.
   *  Null when the query failed or predates migration 0029. See setStorefrontHost. */
  storefront_host: string | null;
  /** When the host was last CONFIRMED against Shopify (migration 0030). Null means
   *  never — which is true of every row written before 0030, and is what makes them
   *  stale by construction rather than needing a separate backfill script. */
  storefront_host_checked_at: string | null;
}

/** How long a resolved host is trusted before it is re-confirmed. A merchant
 *  connecting a custom domain after installing is normal, so "resolved once at
 *  install" was never going to stay true. Seven days keeps the refresh cost at
 *  roughly one Shopify call per shop per week. */
export const STOREFRONT_HOST_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Is this row's storefront host due for re-confirmation? Pure, so the policy is
 *  testable without a database. */
export function storefrontHostIsStale(row: Pick<ShopRow, "storefront_host_checked_at">, now = Date.now()): boolean {
  if (!row.storefront_host_checked_at) return true; // never confirmed (incl. pre-0030 rows)
  const at = Date.parse(row.storefront_host_checked_at);
  if (!Number.isFinite(at)) return true;
  return now - at >= STOREFRONT_HOST_TTL_MS;
}

export async function upsertShop(shopDomain: string, opts: { scopes?: string; status?: string } = {}): Promise<void> {
  await pgQuery(
    `insert into shops (shop_domain, scopes, status, last_seen_at)
       values ($1, $2, coalesce($3,'installed'), now())
     on conflict (shop_domain) do update
       set scopes = coalesce(excluded.scopes, shops.scopes),
           status = coalesce($3, shops.status),
           last_seen_at = now(), updated_at = now(),
           uninstalled_at = case when coalesce($3, shops.status) <> 'uninstalled' then null else shops.uninstalled_at end`,
    [shopDomain, opts.scopes ?? null, opts.status ?? null],
  );
}

export async function getShop(shopDomain: string): Promise<ShopRow | null> {
  const { rows } = await pgQuery<ShopRow>("select * from shops where shop_domain = $1", [shopDomain]);
  return rows[0] ?? null;
}

/** Record the app-owned Web Pixel id (Phase 10) so re-activation updates in place. */
export async function setWebPixelId(shopDomain: string, webPixelId: string): Promise<void> {
  await pgQuery("update shops set web_pixel_id = $2, updated_at = now() where shop_domain = $1", [shopDomain, webPixelId]);
}

/** Persist the shop's primary storefront host (migration 0029). Written at install
 *  time so host-match reconciliation never depends on a catalog sync having run.
 *  Stored lowercase and host-only; a null/blank resolve is a no-op rather than a
 *  write, so a failed query never ERASES a host we already knew. */
export async function setStorefrontHost(shopDomain: string, host: string | null): Promise<void> {
  const clean = (host ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!clean) return;
  // The freshness stamp moves ONLY on a successful resolve. A failed lookup must not
  // look like a confirmation, or a shop whose Shopify calls are failing would go
  // quiet for a week holding a value nobody checked.
  await pgQuery(
    "update shops set storefront_host = $2, storefront_host_checked_at = now(), updated_at = now() where shop_domain = $1",
    [shopDomain, clean],
  );
}

/** Shops whose storefront host is due for re-confirmation, oldest first.
 *  Bounded by `limit` so a sweep can never fan out to every shop at once. */
export async function shopsNeedingHostRefresh(limit = 25): Promise<string[]> {
  const { rows } = await pgQuery<{ shop_domain: string }>(
    `select shop_domain from shops
      where status <> 'uninstalled'
        and (storefront_host_checked_at is null or storefront_host_checked_at < now() - ($1 || ' milliseconds')::interval)
      order by storefront_host_checked_at asc nulls first
      limit $2`,
    [String(STOREFRONT_HOST_TTL_MS), limit],
  );
  return rows.map((r) => r.shop_domain);
}

/** Every host a carried public test could plausibly have been run against, for this
 *  shop: the `*.myshopify.com` domain plus the persisted primary storefront host.
 *  Deliberately does NOT consult the catalog — that dependency is exactly what §F1
 *  was. Callers may append catalog-derived hosts as a fallback. */
export async function shopCandidateHosts(shopDomain: string): Promise<string[]> {
  const row = await getShop(shopDomain).catch(() => null);
  const hosts = [shopDomain];
  if (row?.storefront_host) hosts.push(row.storefront_host);
  return [...new Set(hosts.filter(Boolean))];
}

/** The shop's per-shop pixel ingest token, generating + persisting one on first use. Injected
 *  into the shop's Web Pixel settings and checked at ingest (anti-abuse, not auth — it ships to
 *  the browser, so it only scopes forgery to a single shop). Race-safe via coalesce. */
export async function getOrCreatePixelIngestToken(shopDomain: string): Promise<string> {
  const fresh = randomBytes(24).toString("base64url");
  const { rows } = await pgQuery<{ pixel_ingest_token: string | null }>(
    `update shops set pixel_ingest_token = coalesce(pixel_ingest_token, $2), updated_at = now()
       where shop_domain = $1 returning pixel_ingest_token`,
    [shopDomain, fresh],
  );
  return rows[0]?.pixel_ingest_token ?? fresh;
}

/** Encrypt + store an offline access token (and its rotating refresh token + expiries, for
 *  expiring tokens) for a shop. Omit the token fields for legacy/non-expiring tokens. */
export async function storeCredentials(
  shopDomain: string,
  accessToken: string,
  scope: string,
  opts: { refreshToken?: string | null; expiresIn?: number | null; refreshTokenExpiresIn?: number | null } = {},
): Promise<void> {
  const enc = encryptSecret(accessToken, ENV.appEncryptionKey!);
  const refreshEnc = opts.refreshToken ? encryptSecret(opts.refreshToken, ENV.appEncryptionKey!) : null;
  const expiresAt = opts.expiresIn ? new Date(Date.now() + opts.expiresIn * 1000).toISOString() : null;
  const refreshExpiresAt = opts.refreshTokenExpiresIn ? new Date(Date.now() + opts.refreshTokenExpiresIn * 1000).toISOString() : null;
  await pgQuery(
    `insert into shop_credentials
       (shop_domain, access_token_enc, refresh_token_enc, scope, access_token_expires_at, refresh_token_expires_at, encryption_version, updated_at)
       values ($1, $2, $3, $4, $5, $6, 'v1', now())
     on conflict (shop_domain) do update
       set access_token_enc = excluded.access_token_enc,
           refresh_token_enc = excluded.refresh_token_enc,
           scope = excluded.scope,
           access_token_expires_at = excluded.access_token_expires_at,
           refresh_token_expires_at = excluded.refresh_token_expires_at,
           encryption_version = 'v1', updated_at = now()`,
    [shopDomain, enc, refreshEnc, scope, expiresAt, refreshExpiresAt],
  );
}

/** Decrypt + return a shop's access token, or null if missing/undecryptable. Expiring tokens
 *  are refreshed in place when stale (Shopify rejects expired/non-expiring tokens) using the
 *  rotating refresh token — so background paths (webhooks, jobs) without a session token to
 *  re-exchange keep working. A refresh failure falls back to the current token (the caller
 *  surfaces any resulting auth error rather than us masking it). */
export async function getAccessToken(shopDomain: string): Promise<string | null> {
  const { rows } = await pgQuery<{ access_token_enc: string; refresh_token_enc: string | null; access_token_expires_at: string | null; scope: string | null }>(
    "select access_token_enc, refresh_token_enc, access_token_expires_at, scope from shop_credentials where shop_domain = $1",
    [shopDomain],
  );
  const row = rows[0];
  if (!row) return null;
  let token: string;
  try {
    token = decryptSecret(row.access_token_enc, ENV.appEncryptionKey!);
  } catch (err) {
    console.error(`[shops] token decrypt failed for ${shopDomain}:`, (err as Error).message);
    return null;
  }
  // Fresh, or nothing to refresh with → return as-is. (Concurrency note: the refresh token
  // rotates, so two simultaneous refreshes for one shop would conflict; in practice the
  // embedded app re-exchanges on load and background jobs are serialized per shop, so this
  // path is hit rarely and singly.)
  if (!shouldRefreshToken(row.access_token_expires_at) || !row.refresh_token_enc) return token;
  try {
    const refreshToken = decryptSecret(row.refresh_token_enc, ENV.appEncryptionKey!);
    const fresh = await getShopifyClient().refreshAccessToken(shopDomain, refreshToken);
    await storeCredentials(shopDomain, fresh.accessToken, fresh.scope || row.scope || "", {
      refreshToken: fresh.refreshToken, expiresIn: fresh.expiresIn, refreshTokenExpiresIn: fresh.refreshTokenExpiresIn,
    });
    return fresh.accessToken;
  } catch (err) {
    console.error(`[shops] token refresh failed for ${shopDomain}:`, (err as Error).message);
    return token;
  }
}

export async function recordInstallation(shopDomain: string, event: string, scopes?: string): Promise<void> {
  await pgQuery("insert into installations (shop_domain, event, scopes) values ($1,$2,$3)", [shopDomain, event, scopes ?? null]);
}

export async function markUninstalled(shopDomain: string): Promise<void> {
  await pgQuery(
    "update shops set status = 'uninstalled', uninstalled_at = now(), updated_at = now() where shop_domain = $1",
    [shopDomain],
  );
  // Offline token is invalid after uninstall — remove it.
  await pgQuery("delete from shop_credentials where shop_domain = $1", [shopDomain]);
}

/** Idempotent webhook record. Returns true if this is the FIRST time we've seen it. */
export async function webhookSeen(dedupeKey: string, topic: string, shopDomain: string | null, payloadHash: string | null): Promise<boolean> {
  const { rowCount } = await pgQuery(
    `insert into webhook_events (dedupe_key, topic, shop_domain, payload_hash)
       values ($1,$2,$3,$4) on conflict (dedupe_key) do nothing`,
    [dedupeKey, topic, shopDomain, payloadHash],
  );
  return (rowCount ?? 0) > 0;
}

/** Undo a webhookSeen mark (inline path only) so a FAILED delivery can be re-processed when
 *  Shopify re-delivers it — otherwise the mark would dedupe the retry and drop the effect. */
export async function unmarkWebhookSeen(dedupeKey: string): Promise<void> {
  await pgQuery("delete from webhook_events where dedupe_key = $1", [dedupeKey]);
}

export async function audit(
  shopDomain: string | null,
  actor: string,
  action: string,
  target?: string,
  before?: unknown,
  after?: unknown,
): Promise<void> {
  await pgQuery(
    "insert into audit_log (shop_domain, actor, action, target, before, after) values ($1,$2,$3,$4,$5::jsonb,$6::jsonb)",
    [shopDomain, actor, action, target ?? null, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after)],
  );
}

// ---- OAuth state (single-use nonce, replay-proof, multi-instance safe) -----
/** `testToken` (V2 CP2) carries the merchant's PUBLIC Buyer Test across the install
 *  redirect, so the first authenticated screen can be their own test continued
 *  rather than a cold dashboard. It rides on the server-side state row, never on the
 *  authorize URL — Shopify echoes `state` back to us verbatim, and putting a token
 *  in a URL that transits a third party is a needless exposure. */
export async function saveOAuthState(state: string, shopDomain: string, ttlSec = 600, testToken?: string | null): Promise<void> {
  await pgQuery(
    "insert into oauth_states (state, shop_domain, test_token, expires_at) values ($1,$2,$3, now() + make_interval(secs => $4))",
    [state, shopDomain, testToken ?? null, ttlSec],
  );
}

export interface ConsumedOAuthState { shop: string; testToken: string | null }

/** Consume a state nonce: returns its shop (+ any carried test token) if
 *  valid+unexpired, else null. Single-use (deleted on read) so a callback can't be
 *  replayed. */
export async function consumeOAuthState(state: string): Promise<ConsumedOAuthState | null> {
  const { rows } = await pgQuery<{ shop_domain: string; test_token: string | null }>(
    "delete from oauth_states where state = $1 and expires_at > now() returning shop_domain, test_token",
    [state],
  );
  const r = rows[0];
  return r ? { shop: r.shop_domain, testToken: r.test_token } : null;
}
