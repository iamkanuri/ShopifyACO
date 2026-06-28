import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { pgSslConfig } from "../src/db/pg.js";

// ---- pure: Postgres TLS selection (#20) ------------------------------------
test("pgSslConfig: local plaintext, cloud unverified by default, verify-full with a CA", () => {
  // Local dev Postgres (Supabase CLI) speaks plaintext → SSL off.
  assert.equal(pgSslConfig("postgres://postgres:postgres@localhost:5432/postgres"), false);
  assert.equal(pgSslConfig("postgres://postgres:postgres@127.0.0.1:54322/postgres"), false);
  assert.equal(pgSslConfig("postgres://u:p@host/db?sslmode=disable"), false);

  // Cloud with no CA configured → encrypted but unverified (prior behavior; explicit caCert arg
  // so the test is independent of the ambient DB_CA_CERT env var).
  assert.deepEqual(pgSslConfig("postgres://u:p@db.abc.supabase.co:5432/postgres", undefined), { rejectUnauthorized: false });

  // Cloud WITH a CA → strict verify-full (rejectUnauthorized + the CA).
  const ca = "-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----";
  assert.deepEqual(pgSslConfig("postgres://u:p@db.abc.supabase.co:5432/postgres", ca), { ca, rejectUnauthorized: true });
});
