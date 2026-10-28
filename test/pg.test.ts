import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { pgSslConfig } from "../src/db/pg.js";

test("only exact loopback hosts may use plaintext", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    assert.equal(pgSslConfig(`postgres://u:p@${host}:5432/db`, ""), false);
  }
  for (const host of ["localhost.attacker.test", "remote.test", "127.0.0.1.attacker.test"]) {
    assert.deepEqual(pgSslConfig(`postgres://u:p@${host}/db`, ""), { rejectUnauthorized: true });
  }
  assert.deepEqual(pgSslConfig("postgres://localhost:p@remote.test/db", ""), { rejectUnauthorized: true });
});

test("remote Supabase hosts use the official bundled CA and verify identity", () => {
  const pem = readFileSync(new URL("../certs/supabase-prod-ca-2021.crt", import.meta.url), "utf8");
  assert.equal(createHash("sha256").update(pem).digest("hex"), "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7");
  const certificate = new X509Certificate(pem);
  assert.ok(certificate.ca);
  assert.ok(Date.parse(certificate.validTo) > Date.now(), "bundled CA must remain valid");
  for (const host of ["db.fjrcdklpphmiouijdmuf.supabase.co", "aws-1-us-east-1.pooler.supabase.com"]) {
    assert.deepEqual(pgSslConfig(`postgres://u:p@${host}/db`, ""), { ca: pem, rejectUnauthorized: true });
  }
  assert.deepEqual(pgSslConfig("postgres://u:p@db.abc.supabase.co.attacker.test/db", ""), { rejectUnauthorized: true });
});

test("explicit CA remains strict and malformed connection URLs fail without leaking them", () => {
  assert.deepEqual(pgSslConfig("postgres://u:p@remote.test/db", "custom CA"), { ca: "custom CA", rejectUnauthorized: true });
  assert.throws(() => pgSslConfig("not-a-url-secret"), /^Error: DATABASE_URL must be a valid PostgreSQL URL$/);
  assert.throws(() => pgSslConfig("https://remote.test"), /postgres or postgresql/);
});

test("URL parameters cannot disable or override remote TLS or redirect a local connection", () => {
  for (const option of ["sslmode=disable", "sslmode=require", "sslmode=no-verify", "sslmode=verify-full", "ssl=false", "sslrootcert=other", "sslcert=other", "sslkey=other", "SSLMode=disable"]) {
    assert.throws(() => pgSslConfig(`postgres://u:p@remote.test/db?${option}`, ""), /Remove SSL query options/);
  }
  for (const option of ["host=remote.test", "hostaddr=1.2.3.4", "port=1234", "user=other", "password=other", "database=other"]) {
    assert.throws(() => pgSslConfig(`postgres://u:p@localhost/db?${option}`, ""), /must not override/);
  }
});
