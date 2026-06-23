import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifySessionToken } from "../src/shopify/sessionToken.js";

// Shopify App Bridge session-token verification (pure, $0). Mints real HS256 JWTs so the
// signature/claim checks are exercised end-to-end.

const SECRET = "shpss_test_secret_v1";
const API_KEY = "test_api_key_clientid";
const SHOP = "demo-store.myshopify.com";
const NOW = 1_750_000_000_000; // fixed clock (ms)
const nowSec = Math.floor(NOW / 1000);

const b64url = (buf: Buffer | string) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function mint(opts: { secret?: string; payload?: Record<string, unknown>; header?: Record<string, unknown> } = {}): string {
  const header = opts.header ?? { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: `https://${SHOP}/admin`, dest: `https://${SHOP}`, aud: API_KEY,
    sub: "42", exp: nowSec + 60, nbf: nowSec - 5, iat: nowSec - 5, jti: "x", sid: "s",
    ...(opts.payload ?? {}),
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = b64url(createHmac("sha256", opts.secret ?? SECRET).update(signingInput).digest());
  return `${signingInput}.${sig}`;
}

test("verifies a well-formed token and extracts the shop", () => {
  const r = verifySessionToken(mint(), [SECRET], API_KEY, NOW);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.shop, SHOP);
});

test("accepts either secret during a rotation", () => {
  const tok = mint({ secret: "new_secret_v2" });
  assert.equal(verifySessionToken(tok, ["old_secret_v1", "new_secret_v2"], API_KEY, NOW).ok, true);
  assert.equal(verifySessionToken(tok, ["old_secret_v1"], API_KEY, NOW).ok, false);
});

test("rejects a bad signature", () => {
  const r = verifySessionToken(mint({ secret: "wrong" }), [SECRET], API_KEY, NOW);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "signature mismatch");
});

test("rejects alg:none / non-HS256 (no algorithm confusion)", () => {
  const r = verifySessionToken(mint({ header: { alg: "none", typ: "JWT" } }), [SECRET], API_KEY, NOW);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "unexpected alg");
});

test("rejects an expired token (beyond leeway)", () => {
  const r = verifySessionToken(mint({ payload: { exp: nowSec - 60 } }), [SECRET], API_KEY, NOW);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "token expired");
});

test("rejects a not-yet-valid token (nbf in the future)", () => {
  const r = verifySessionToken(mint({ payload: { nbf: nowSec + 120 } }), [SECRET], API_KEY, NOW);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "token not yet valid");
});

test("rejects an audience mismatch (token minted for another app)", () => {
  const r = verifySessionToken(mint({ payload: { aud: "some_other_app" } }), [SECRET], API_KEY, NOW);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "audience mismatch");
});

test("rejects a non-myshopify / malformed dest", () => {
  assert.equal(verifySessionToken(mint({ payload: { dest: "https://evil.com" } }), [SECRET], API_KEY, NOW).ok, false);
  assert.equal(verifySessionToken(mint({ payload: { dest: "https://a.myshopify.com", iss: "https://b.myshopify.com/admin" } }), [SECRET], API_KEY, NOW).ok, false);
});

test("rejects structurally malformed input", () => {
  for (const bad of ["", "a.b", "a.b.c.d", "not-a-token"]) {
    assert.equal(verifySessionToken(bad, [SECRET], API_KEY, NOW).ok, false);
  }
  assert.equal(verifySessionToken(mint(), [], API_KEY, NOW).ok, false); // no secret configured
});
