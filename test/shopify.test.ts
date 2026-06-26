import "dotenv/config"; // DATABASE_URL for the opt-in DB tests
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { decryptSecret, encryptSecret, reEncrypt, EncryptionError } from "../src/shopify/crypto.js";
import { isValidShopDomain, normalizeShopDomain } from "../src/shopify/domain.js";
import { verifyOAuthHmac, verifyWebhookHmac, webhookHmac } from "../src/shopify/hmac.js";
import { chooseScopes, parseScopes, hasScope } from "../src/shopify/scopes.js";
import { shouldRefreshToken } from "../src/shopify/tokens.js";

const KEY = Buffer.alloc(32, 9).toString("base64");
const KEY2 = Buffer.alloc(32, 4).toString("base64");

// ---- crypto (token encryption at rest) ------------------------------------
test("encrypt → decrypt round-trips", () => {
  const blob = encryptSecret("shpat_secret_token", KEY);
  assert.match(blob, /^v1:/);
  assert.notEqual(blob, "shpat_secret_token");
  assert.equal(decryptSecret(blob, KEY), "shpat_secret_token");
});

test("decrypt fails on tamper and on wrong key", () => {
  const blob = encryptSecret("tok", KEY);
  const tampered = blob.slice(0, -2) + (blob.endsWith("AA") ? "BB" : "AA");
  assert.throws(() => decryptSecret(tampered, KEY), EncryptionError);
  assert.throws(() => decryptSecret(blob, KEY2), EncryptionError);
});

test("key rotation re-encrypts", () => {
  const v1 = encryptSecret("tok", KEY);
  const v2 = reEncrypt(v1, KEY, KEY2);
  assert.equal(decryptSecret(v2, KEY2), "tok");
  assert.throws(() => decryptSecret(v2, KEY), EncryptionError);
});

test("rejects malformed key", () => {
  assert.throws(() => encryptSecret("x", "tooshort"), EncryptionError);
  assert.throws(() => encryptSecret("x", undefined as unknown as string), EncryptionError);
});

// ---- shop-domain validation -----------------------------------------------
test("isValidShopDomain only accepts canonical myshopify.com", () => {
  assert.ok(isValidShopDomain("acme.myshopify.com"));
  assert.ok(!isValidShopDomain("acme.com"));
  assert.ok(!isValidShopDomain("evil.myshopify.com.attacker.com"));
  assert.ok(!isValidShopDomain("acme.myshopify.com/path"));
  assert.ok(!isValidShopDomain("-acme.myshopify.com"));
});

test("normalizeShopDomain canonicalizes handles/urls and rejects junk", () => {
  assert.equal(normalizeShopDomain("Acme"), "acme.myshopify.com");
  assert.equal(normalizeShopDomain("https://acme.myshopify.com/admin"), "acme.myshopify.com");
  assert.equal(normalizeShopDomain("acme.myshopify.com:443"), "acme.myshopify.com");
  assert.equal(normalizeShopDomain("attacker.com"), null);
  assert.equal(normalizeShopDomain(""), null);
});

// ---- HMAC verification -----------------------------------------------------
test("webhook HMAC verifies and rejects tampering", () => {
  const secret = "shh";
  const body = Buffer.from(JSON.stringify({ id: 1 }));
  const sig = webhookHmac(body, secret);
  assert.ok(verifyWebhookHmac(body, sig, secret));
  assert.ok(!verifyWebhookHmac(body, sig, "wrong"));
  assert.ok(!verifyWebhookHmac(Buffer.from("tampered"), sig, secret));
  assert.ok(!verifyWebhookHmac(body, undefined, secret));
});

test("OAuth HMAC verifies the sorted query and rejects tampering", () => {
  const secret = "shh";
  const q: Record<string, string> = { code: "abc", shop: "acme.myshopify.com", state: "xyz", timestamp: "123" };
  const message = Object.keys(q).sort().map((k) => `${k}=${q[k]}`).join("&");
  const hmac = createHmac("sha256", secret).update(message).digest("hex");
  assert.ok(verifyOAuthHmac({ ...q, hmac }, secret));
  assert.ok(!verifyOAuthHmac({ ...q, hmac, shop: "evil.myshopify.com" }, secret)); // tampered param
  assert.ok(!verifyOAuthHmac({ ...q }, secret)); // missing hmac
});

// ---- OAuth authorize URL (pure) -------------------------------------------
test("buildAuthorizeUrl targets the shop with offline scope + state", async () => {
  const { buildAuthorizeUrl } = await import("../src/shopify/oauth.js");
  const url = buildAuthorizeUrl("acme.myshopify.com", "nonce123");
  assert.ok(url.startsWith("https://acme.myshopify.com/admin/oauth/authorize?"));
  assert.match(url, /state=nonce123/);
  assert.match(url, /redirect_uri=/);
  assert.ok(!/grant_options/.test(url), "offline token: no per-user grant");
});

// ---- granted-scope resolution (the Fix Studio write-gate fix) -------------
test("parseScopes splits, trims, and de-dupes", () => {
  assert.deepEqual(parseScopes("read_products, write_products"), ["read_products", "write_products"]);
  assert.deepEqual(parseScopes("read_products read_products"), ["read_products"]);
  assert.deepEqual(parseScopes("  read_products  "), ["read_products"]);
  assert.deepEqual(parseScopes(null), []);
  assert.deepEqual(parseScopes(""), []);
});

test("hasScope detects a granted handle regardless of separators", () => {
  assert.ok(hasScope("read_products,write_products", "write_products"));
  assert.ok(hasScope("read_products write_products", "write_products"));
  assert.ok(!hasScope("read_products", "write_products"));
  assert.ok(!hasScope(null, "write_products"));
});

test("chooseScopes prefers the LIVE grant over an under-reporting exchange scope", () => {
  // The bug: exchange returns only read_products, but the merchant approved write_products.
  // The live grant must win so the write gate isn't wrongly closed.
  assert.equal(
    chooseScopes(["read_products", "write_products"], "read_products", ["read_products"]),
    "read_products,write_products",
  );
});

test("chooseScopes falls back to exchange scope, then configured, when the live read is empty", () => {
  assert.equal(chooseScopes([], "read_products,write_products", ["read_products"]), "read_products,write_products");
  assert.equal(chooseScopes([], null, ["read_products", "write_products"]), "read_products,write_products");
  assert.equal(chooseScopes([], "", ["read_products"]), "read_products");
});

test("chooseScopes normalizes (de-dupes) whatever source it picks", () => {
  assert.equal(chooseScopes(["read_products", "read_products"], null, []), "read_products");
  assert.equal(chooseScopes([], "read_products read_products", []), "read_products");
});

// ---- expiring-token refresh decision (pure) -------------------------------
test("shouldRefreshToken: stale within buffer → refresh; fresh/unknown → don't", () => {
  const now = Date.parse("2026-06-26T12:00:00Z");
  assert.equal(shouldRefreshToken(new Date(now + 3600_000).toISOString(), now), false); // 1h out → fresh
  assert.equal(shouldRefreshToken(new Date(now + 60_000).toISOString(), now), true);    // 1m out → within 2m buffer
  assert.equal(shouldRefreshToken(new Date(now - 1000).toISOString(), now), true);       // already expired
  assert.equal(shouldRefreshToken(null, now), false);       // legacy / non-expiring row
  assert.equal(shouldRefreshToken(undefined, now), false);
  assert.equal(shouldRefreshToken("not-a-date", now), false);
});

// ===========================================================================
// DB integration — opt-in. Needs DATABASE_URL + APP_ENCRYPTION_KEY. Self-cleaning.
//   RUN_DB_TESTS=1 SHOPIFY_MODE=mock APP_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))") \
//     node --import tsx --test test/shopify.test.ts
// ===========================================================================
const RUN_DB = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL) && Boolean(process.env.APP_ENCRYPTION_KEY);
const dbTest = (name: string, fn: () => Promise<void>) => test(name, { skip: !RUN_DB }, fn);

dbTest("oauth state is single-use (replay-proof)", async () => {
  const { saveOAuthState, consumeOAuthState } = await import("../src/db/shops.js");
  const { pgQuery } = await import("../src/db/pg.js");
  const shop = `t-${Date.now()}.myshopify.com`;
  const state = `state-${Date.now()}`;
  try {
    await saveOAuthState(state, shop, 600);
    assert.equal(await consumeOAuthState(state), shop);
    assert.equal(await consumeOAuthState(state), null); // already consumed
  } finally {
    await pgQuery("delete from oauth_states where state = $1", [state]);
  }
});

dbTest("credentials encrypt at rest and round-trip; uninstall clears them", async () => {
  const { upsertShop, storeCredentials, getAccessToken, getShop, markUninstalled } = await import("../src/db/shops.js");
  const { pgQuery } = await import("../src/db/pg.js");
  const shop = `t-${Date.now()}.myshopify.com`;
  try {
    await upsertShop(shop, { scopes: "read_products", status: "active" });
    await storeCredentials(shop, "shpat_supersecret", "read_products");
    // Stored value must NOT be plaintext.
    const raw = await pgQuery<{ access_token_enc: string }>("select access_token_enc from shop_credentials where shop_domain=$1", [shop]);
    assert.ok(!raw.rows[0].access_token_enc.includes("shpat_supersecret"));
    assert.equal(await getAccessToken(shop), "shpat_supersecret");
    await markUninstalled(shop);
    assert.equal((await getShop(shop))?.status, "uninstalled");
    assert.equal(await getAccessToken(shop), null);
  } finally {
    await pgQuery("delete from shops where shop_domain = $1", [shop]); // cascades credentials
  }
});

// Needs mock mode so the refresh hits the MockClient (no network). Skipped otherwise.
const dbMockTest = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !(RUN_DB && process.env.SHOPIFY_MODE === "mock") }, fn);

dbMockTest("getAccessToken refreshes an expired expiring token (rotating refresh, mock)", async () => {
  const { upsertShop, storeCredentials, getAccessToken } = await import("../src/db/shops.js");
  const { pgQuery } = await import("../src/db/pg.js");
  const shop = `tref-${Date.now()}.myshopify.com`;
  try {
    await upsertShop(shop, { scopes: "read_products", status: "active" });
    // Store an expiring token + refresh token, then force the access token to look stale.
    await storeCredentials(shop, "stale_token", "read_products", { refreshToken: "mock_refresh::x", expiresIn: 3600, refreshTokenExpiresIn: 7_776_000 });
    await pgQuery("update shop_credentials set access_token_expires_at = now() - interval '1 minute' where shop_domain=$1", [shop]);

    // getAccessToken sees it as stale and refreshes via the mock client (…::refreshed).
    const tok = await getAccessToken(shop);
    assert.match(tok ?? "", /::refreshed$/);

    // The refresh is persisted: a fresh future expiry + a rotated refresh token are stored.
    const { rows } = await pgQuery<{ access_token_expires_at: string; refresh_token_enc: string }>(
      "select access_token_expires_at, refresh_token_enc from shop_credentials where shop_domain=$1", [shop]);
    assert.ok(Date.parse(rows[0].access_token_expires_at) > Date.now(), "expiry refreshed into the future");
    assert.ok(rows[0].refresh_token_enc, "rotated refresh token stored");
  } finally {
    await pgQuery("delete from shop_credentials where shop_domain=$1", [shop]);
    await pgQuery("delete from shops where shop_domain=$1", [shop]);
  }
});

dbTest("webhook receipts are idempotent", async () => {
  const { webhookSeen } = await import("../src/db/shops.js");
  const { pgQuery } = await import("../src/db/pg.js");
  const key = `wh-${Date.now()}`;
  try {
    assert.equal(await webhookSeen(key, "products/update", null, "h"), true);
    assert.equal(await webhookSeen(key, "products/update", null, "h"), false);
  } finally {
    await pgQuery("delete from webhook_events where dedupe_key = $1", [key]);
  }
});
