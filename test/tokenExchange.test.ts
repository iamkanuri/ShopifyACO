import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

// Embedded install via token exchange (Phase 14 / workstream 2). DB-gated + mock-mode,
// like the other Shopify integration tests. Mints a real HS256 session token, then drives
// the handler end-to-end: verify → exchange → encrypt+store → idempotent re-call.
//   RUN_DB_TESTS=1 SHOPIFY_MODE=mock APP_ENCRYPTION_KEY=<base64-32> npm run test:db

const RUN = process.env.RUN_DB_TESTS === "1"
  && Boolean(process.env.DATABASE_URL)
  && Boolean(process.env.APP_ENCRYPTION_KEY)
  && process.env.SHOPIFY_MODE === "mock";

const b64url = (buf: Buffer | string) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function mintToken(shop: string, secret: string, apiKey: string | undefined): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = { iss: `https://${shop}/admin`, dest: `https://${shop}`, aud: apiKey, sub: "1", exp: nowSec + 60, nbf: nowSec - 5, iat: nowSec - 5 };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  return `${input}.${b64url(createHmac("sha256", secret).update(input).digest())}`;
}

function make(authHeader?: string) {
  const res = {
    code: 0, payload: null as unknown, cookies: [] as string[],
    status(c: number) { this.code = c; return this; },
    json(b: unknown) { this.payload = b; return this; },
    cookie(name: string) { this.cookies.push(name); return this; },
  };
  return { req: { headers: authHeader ? { authorization: authHeader } : {}, body: {}, params: {}, query: {} } as never, res };
}

test("token exchange: bad token → 401; valid token installs; idempotent re-call", { skip: !RUN }, async () => {
  const { tokenExchangeHandler } = await import("../src/server/shopify.js");
  const { effectiveSecrets } = await import("../src/shopify/client.js");
  const { ENV } = await import("../src/server/env.js");
  const { getShop, getAccessToken } = await import("../src/db/shops.js");
  const { pgQuery } = await import("../src/db/pg.js");

  const shop = `texch-${Date.now()}.myshopify.com`;
  const secret = effectiveSecrets()[0]!;
  try {
    // 1) No Authorization header → 401.
    const noTok = make();
    await tokenExchangeHandler(noTok.req, noTok.res as never);
    assert.equal(noTok.res.code, 401);
    assert.equal((noTok.res.payload as { code: string }).code, "bad_session_token");

    // 2) Tampered signature → 401 (no shop created).
    const bad = make(`Bearer ${mintToken(shop, "wrong-secret", ENV.shopify.apiKey)}`);
    await tokenExchangeHandler(bad.req, bad.res as never);
    assert.equal(bad.res.code, 401);
    assert.equal(await getShop(shop), null);

    // 3) Valid token → installs the shop (exchange + encrypted creds + webhooks + cookie).
    const good = make(`Bearer ${mintToken(shop, secret, ENV.shopify.apiKey)}`);
    await tokenExchangeHandler(good.req, good.res as never);
    assert.equal(good.res.code, 0); // res.json() without status() leaves the default
    const env1 = good.res.payload as { ok: boolean; shop: string; newInstall: boolean };
    assert.equal(env1.ok, true);
    assert.equal(env1.shop, shop);
    assert.equal(env1.newInstall, true);
    assert.ok(good.res.cookies.includes("al_shop"), "signed shop cookie set");

    const row = await getShop(shop);
    assert.equal(row?.status, "active");
    const tok = await getAccessToken(shop);
    assert.ok(tok && tok.length > 0, "offline token stored + decryptable");

    // 4) Re-call with a fresh valid token → no NEW install; the offline token is re-exchanged
    //    (refreshed) so it never lapses — in mock the exchange is deterministic, so the stored
    //    value is identical, proving the refresh path runs without disrupting the credentials.
    const again = make(`Bearer ${mintToken(shop, secret, ENV.shopify.apiKey)}`);
    await tokenExchangeHandler(again.req, again.res as never);
    const env2 = again.res.payload as { ok: boolean; newInstall: boolean };
    assert.equal(env2.ok, true);
    assert.equal(env2.newInstall, false);
    assert.equal(await getAccessToken(shop), tok, "offline token refreshed in place (mock deterministic)");
  } finally {
    await pgQuery("delete from audit_log where shop_domain=$1", [shop]);
    await pgQuery("delete from installations where shop_domain=$1", [shop]);
    await pgQuery("delete from shop_credentials where shop_domain=$1", [shop]);
    await pgQuery("delete from shops where shop_domain=$1", [shop]);
  }
});
