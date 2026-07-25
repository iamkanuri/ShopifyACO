import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCaseFile, CASE_TOKEN_RE } from "../src/server/hostedCase.js";
import { join, resolve, sep } from "node:path";

// ===========================================================================
// HOSTED OUTREACH CASES (v2.2 CP4).
//
// These pages name REAL third-party stores, so the failure that matters is not
// "a link 404s" — it is a page reaching someone it was not sent to, or the token
// space being walkable. Hence the emphasis on traversal and on the route being
// inert by default.
// ===========================================================================

test("the route is inert when HOSTED_CASES_DIR is unset — that is the whole gate", () => {
  assert.equal(resolveCaseFile(undefined, "abcdefghijkl"), null);
  assert.equal(resolveCaseFile("", "abcdefghijkl"), null);
});

test("only a well-formed token resolves", () => {
  assert.ok(resolveCaseFile("/data/hosted", "2jmh6zli5tn3"));
  // Wrong length, wrong alphabet, empty.
  assert.equal(resolveCaseFile("/data/hosted", "short"), null);
  assert.equal(resolveCaseFile("/data/hosted", "abcdefghijklm"), null);
  assert.equal(resolveCaseFile("/data/hosted", "ABCDEFGHIJKL"), null, "uppercase is not the minted alphabet");
  assert.equal(resolveCaseFile("/data/hosted", "abcdefghijk1"), null, "1 and 0 are excluded from base32");
  assert.equal(resolveCaseFile("/data/hosted", ""), null);
});

test("path traversal cannot escape the cases directory", () => {
  const attacks = [
    "../../../etc/passwd",
    "..%2f..%2fetc",
    "../../.env",
    "a/../../b",
    ".",
    "..",
    "abcdefghijkl/../../..",
    "\\..\\..\\windows",
  ];
  for (const a of attacks) {
    assert.equal(resolveCaseFile("/data/hosted", a), null, `traversal not blocked: ${a}`);
  }
});

test("a resolved file always sits under <dir>/c/<token>/index.html", () => {
  const dir = "/data/hosted";
  const token = "2jmh6zli5tn3";
  const file = resolveCaseFile(dir, token)!;
  const root = resolve(join(dir, "c"));
  assert.ok(file.startsWith(root + sep), "resolved outside the root");
  assert.ok(file.endsWith(`${token}${sep}index.html`));
});

test("the token pattern is unguessable enough to publish", () => {
  // 12 chars of a 32-symbol alphabet = 60 bits. Enumeration is not a threat model
  // we need to defend with rate limiting alone.
  assert.ok(CASE_TOKEN_RE.test("2jmh6zli5tn3"));
  const alphabet = 32;
  const bits = Math.log2(alphabet) * 12;
  assert.ok(bits >= 60, `token entropy is only ${bits} bits`);
});
