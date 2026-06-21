import { pgQuery } from "./pg.js";
import { ENV } from "../server/env.js";
import { decryptSecret, encryptSecret } from "../shopify/crypto.js";

// Persistence for Shopify multi-tenancy (Phase 2). Tokens are stored only as
// AES-256-GCM blobs; getAccessToken decrypts on read. All writes are shop-scoped.

export interface ShopRow {
  shop_domain: string;
  status: string;
  scopes: string | null;
  plan: string | null;
  installed_at: string;
  uninstalled_at: string | null;
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

/** Encrypt + store an offline access token for a shop. */
export async function storeCredentials(shopDomain: string, accessToken: string, scope: string): Promise<void> {
  const enc = encryptSecret(accessToken, ENV.appEncryptionKey!);
  await pgQuery(
    `insert into shop_credentials (shop_domain, access_token_enc, scope, encryption_version, updated_at)
       values ($1, $2, $3, 'v1', now())
     on conflict (shop_domain) do update
       set access_token_enc = excluded.access_token_enc, scope = excluded.scope,
           encryption_version = 'v1', updated_at = now()`,
    [shopDomain, enc, scope],
  );
}

/** Decrypt + return a shop's access token, or null if missing/undecryptable. */
export async function getAccessToken(shopDomain: string): Promise<string | null> {
  const { rows } = await pgQuery<{ access_token_enc: string }>(
    "select access_token_enc from shop_credentials where shop_domain = $1",
    [shopDomain],
  );
  if (!rows[0]) return null;
  try {
    return decryptSecret(rows[0].access_token_enc, ENV.appEncryptionKey!);
  } catch (err) {
    console.error(`[shops] token decrypt failed for ${shopDomain}:`, (err as Error).message);
    return null;
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
export async function saveOAuthState(state: string, shopDomain: string, ttlSec = 600): Promise<void> {
  await pgQuery(
    "insert into oauth_states (state, shop_domain, expires_at) values ($1,$2, now() + make_interval(secs => $3))",
    [state, shopDomain, ttlSec],
  );
}

/** Consume a state nonce: returns its shop if valid+unexpired, else null. Single-use
 *  (deleted on read) so a callback can't be replayed. */
export async function consumeOAuthState(state: string): Promise<string | null> {
  const { rows } = await pgQuery<{ shop_domain: string }>(
    "delete from oauth_states where state = $1 and expires_at > now() returning shop_domain",
    [state],
  );
  return rows[0]?.shop_domain ?? null;
}
