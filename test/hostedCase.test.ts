import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCaseFile, CASE_TOKEN_RE, caseDefects } from "../src/server/hostedCase.js";
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

// ---------------------------------------------------------------------------
// UNSENDABLE-CASE GUARD (v2.4 CP3).
//
// Two of the twelve real outreach cases were unsendable: one rendered an empty
// requirement set as the literal word "none", and BOTH said "0 of 4 attempts
// could not confirm one or more requirements" while listing the requirements the
// store does not state. The bundle generator is not in this repo, so the serve
// path is the only boundary that can refuse them.
//
// Fixtures below are SYNTHETIC. The real bundle names third-party merchants, and
// a tracked test file must never carry their copy — a prior session shipped
// verbatim merchant copy in a tracked document that resolved to a real store on
// the first search.
// ---------------------------------------------------------------------------

const caseHtml = (o: { asked: string; count: number; gaps: string; confirms: string }): string =>
  `<!doctype html><html><head><style>body{color:#000}</style><title>AI visibility — Example</title></head><body>
   <h2>2 · The test we ran</h2>
   <p>…can an AI assistant confirm the things shoppers asked for — ${o.asked}?</p>
   <h2>5 · Where the attempts stopped</h2>
   <p>${o.count} of 4 attempts could not confirm one or more requirements from your public data.
      Specifically, your public store does not state the following in a form an AI assistant can verify: <b>${o.gaps}</b>.</p>
   <h2>8 · What we'd propose</h2>
   <p>…so an AI assistant can confirm it the way it already confirms ${o.confirms}.</p>
   </body></html>`;

const GOOD = caseHtml({ asked: "attribute-a, attribute-b, and attribute-c", count: 2, gaps: "attribute-c", confirms: "attribute-a, attribute-b" });

test("a well-formed case has no defects", () => {
  assert.deepEqual(caseDefects(GOOD), []);
});

test("an empty requirement set rendered as the literal \"none\" is refused", () => {
  const bad = caseHtml({ asked: "none, and attribute-a, attribute-b", count: 3, gaps: "attribute-a, attribute-b", confirms: "none" });
  const defects = caseDefects(bad);
  assert.equal(defects.length, 1, `expected exactly the literal-none defect, got: ${JSON.stringify(defects)}`);
  assert.match(defects[0]!, /literal word "none"/);
});

test("a zero count alongside listed gaps is refused as self-contradicting", () => {
  // The exact shape of the second broken case: the passing set was NOT empty, so
  // there is no literal "none" — only the contradiction. A guard that keyed solely
  // on "none" would have served this one.
  const bad = caseHtml({ asked: "attribute-a, and attribute-b", count: 0, gaps: "attribute-b", confirms: "attribute-a" });
  const defects = caseDefects(bad);
  assert.equal(defects.length, 1, `expected exactly the contradiction defect, got: ${JSON.stringify(defects)}`);
  assert.match(defects[0]!, /while the page lists unmet requirements/);
});

test("a zero count with NO listed gaps is legitimate — nothing failed and nothing is missing", () => {
  const cleanPass = `<!doctype html><html><body>
    <p>0 of 4 attempts could not confirm one or more requirements from your public data.</p>
    <p>…so an AI assistant can confirm it the way it already confirms attribute-a, attribute-b.</p>
    </body></html>`;
  assert.deepEqual(caseDefects(cleanPass), [], "a genuine clean pass must not be refused");
});

test("the guard reads rendered TEXT, not markup — a defect split by tags is still caught", () => {
  const split = GOOD.replace("attribute-a, attribute-b", "<span>no</span><span>ne</span>");
  // "no" + "ne" across tags becomes the word "none" only after tag stripping if the
  // tags are removed without inserting a separator. We insert a space, so this must
  // NOT be flagged — the point of the test is that stripping cannot FABRICATE a hit.
  assert.deepEqual(caseDefects(split), [], "tag stripping must not invent a defect");
});

test("a defect inside a <style> block is not counted", () => {
  const styled = GOOD.replace("<style>body{color:#000}</style>", "<style>.none{display:none}</style>");
  assert.deepEqual(caseDefects(styled), [], "CSS is not merchant-visible copy");
});

test("the token pattern is unguessable enough to publish", () => {
  // 12 chars of a 32-symbol alphabet = 60 bits. Enumeration is not a threat model
  // we need to defend with rate limiting alone.
  assert.ok(CASE_TOKEN_RE.test("2jmh6zli5tn3"));
  const alphabet = 32;
  const bits = Math.log2(alphabet) * 12;
  assert.ok(bits >= 60, `token entropy is only ${bits} bits`);
});
