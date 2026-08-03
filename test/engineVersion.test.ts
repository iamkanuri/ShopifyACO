import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ENGINE_VERSION } from "../src/server/productTest.js";

// ===========================================================================
// THE ENGINE-VERSION TRIPWIRE (v3.8).
//
// WHY THIS EXISTS, and it is not a style rule.
//
// `src/server/buyerTests.ts` refuses a merchant's before/after comparison when
// the saved `engine_version` differs from the running one, because results from
// two different matchers are not comparable. That refusal is the only thing
// standing between a merchant and a silent regression in their own trend line.
//
// **It was dead for most of its life.** `ENGINE_VERSION` sat at `v2.0.0` from
// v2.0 through v3.7 while the matcher changed repeatedly — v3.5's rule D flipped
// identifier rows on real stores under that same tag, and v3.0's `care` guard,
// v2.8's quantity guard and v2.5's subject rule all shipped under it too. Every
// record tagged `v2.0.0` may therefore have come from any of a dozen engines, and
// two of them compared as if identical.
//
// Nothing was broken. The number simply depended on somebody remembering, and a
// guard that depends on memory is not a guard. This test replaces the memory:
// change a matcher without bumping the version and `npm test` fails.
//
// ⚠️ WHEN THIS TEST FAILS, THE FIX IS TO BUMP `ENGINE_VERSION` AND RE-PIN THE
// HASH — in that order, in the same commit. Re-pinning the hash alone silently
// restores the exact condition this exists to prevent, and is worse than deleting
// the test, because the file would still look like a guard.
//
// Pure: no network, no database, no clock, no model calls.
// ===========================================================================

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");

/**
 * The files that decide a row.
 *
 * Derived from the repo's own matcher list (`experiments/v3-7/gates.mjs`), MINUS
 * `src/detection/`. That exclusion is deliberate and argued: `src/detection/` is
 * the AI-answer detection module for share-of-voice scans. It never runs inside
 * `evaluate` and cannot change a `buyer_test` row, so hashing it would fail this
 * test for changes that carry no comparability consequence — and a tripwire that
 * fires on unrelated work is a tripwire people learn to re-pin without thinking.
 *
 * `src/crawler/extract.ts` IS included: it parses the JSON-LD offer, its price
 * and its currency, and v3.8's own measurement found real price defects
 * originating there (`parseOffer` takes the first offer, never a minimum).
 */
const MATCHER_FILES = [
  "src/server/productTest.ts",
  "src/server/testEvidence.ts",
  "src/server/subject.ts",
  "src/crawler/extract.ts",
] as const;

/** Content hash over the matcher files, in a fixed order, newline-normalised so
 *  a checkout with different line endings does not read as a matcher change. */
function matcherHash(): string {
  const h = createHash("sha256");
  for (const rel of MATCHER_FILES) {
    const body = readFileSync(join(REPO, rel), "utf8").replace(/\r\n/g, "\n");
    h.update(`${rel}\n${body}\n`);
  }
  return h.digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// THE PIN. Both values move together, or neither moves.
// ---------------------------------------------------------------------------
// v3.9 CP-4 — `priceToUsd`'s `.json` tier now fails closed. The tripwire fired on the
// matcher edit, which is it working; both pins move together, as this file requires.
//
// v4.0 CP-1b — P-22 closed: `presentableQuote` takes the matched span and slides its
// window so the rendered quote always contains the term the row proves.
//
// ⚠️ THE BRIEF PREDICTED THIS TRIPWIRE WOULD STAY QUIET, AND IT WAS WRONG ABOUT THE
// MECHANISM. It reasoned that a quote change is "renderer surface, not matcher". This
// pin is a CONTENT HASH over whole files, and `src/server/testEvidence.ts` is one of
// them, so any edit to it fires — the hash cannot and should not try to classify an
// edit as renderer-only. It fired, it was read rather than re-pinned, and the bump
// followed. Two independent reasons the bump is also right on the merits: 10 asked
// rows over 8 real stores changed the sentence a merchant is shown, and this test's
// own rule is "if the change can alter ANY row a merchant sees".
// v4.0 CP-1a — `plant-based` / `plant based` removed from `vegan`'s supporting terms.
// A dictionary change is a matcher change: it decides rows. Two bumps land in this one
// release (v2.3.0 for CP-1b, v2.4.0 for CP-1a) and that is deliberate rather than untidy —
// this file's rule is that BOTH pins move together in the SAME commit, and re-pinning the
// hash alone on the second commit "restores exactly the condition this test exists to
// prevent". Version numbers are free; a silently-shared version is not. Only the final
// deployed value is ever recorded against a merchant's saved test, so the intermediate
// v2.3.0 costs nothing.
// v4.4 — v2.5.0. THE TRIPWIRE DID NOT FIND THIS ONE, AND THAT IS THE POINT WORTH
// RECORDING. The change is a route-level pin (`semantic: { disabled: true }` on the two
// public routes that store a permanent result) plus this file's own bump; no matcher
// LOGIC moved. Had the version literal not lived inside `productTest.ts`, the content
// hash would have stayed identical while live verdicts changed — a claim row the
// semantic tier would have promoted to `pass_evidenced` now stays `not_proven`.
//
// So the hash is a floor, not a ceiling: it catches matcher edits, and it is blind to a
// behaviour change made anywhere else — a route, a dep, an env var. The rule that
// governs is the prose one ("if the change can alter ANY row a merchant sees"), and it
// has to be applied by a person. Do not read a quiet tripwire as "no bump needed".
// v4.5 — v2.6.0. ENGINE_GAPS P-19. Unlike the v4.4 entry above, this one the tripwire
// DID catch on its own: `productTest.ts` and `extract.ts` are both hashed files and both
// moved. Measured effect on the 335-store deduped corpus, quote-level A/B: 11 price rows
// stop being generated (10 of them false `Lowest readable price is $0.00.` passes), 2
// stores have their stated price corrected to the minimum their own markup publishes,
// 0 rows of any other kind change, 2804 rows unchanged.
const PINNED_ENGINE_VERSION = "v2.6.0";
const PINNED_MATCHER_HASH = "e68bd69e98d02a78";

test("[engine-version] the matcher files have not changed without a version bump", () => {
  const actual = matcherHash();
  assert.equal(
    actual,
    PINNED_MATCHER_HASH,
    `A MATCHER FILE CHANGED.\n\n` +
    `  files hashed: ${MATCHER_FILES.join(", ")}\n` +
    `  pinned hash : ${PINNED_MATCHER_HASH}\n` +
    `  actual hash : ${actual}\n\n` +
    `If the change can alter ANY row a merchant sees, bump ENGINE_VERSION in\n` +
    `src/server/productTest.ts and re-pin BOTH constants in this file, in the same\n` +
    `commit. buyerTests.ts refuses a before/after across two engine versions, and\n` +
    `that refusal is what stops a merchant's trend line comparing two different\n` +
    `matchers as if they were one. ENGINE_VERSION sat at v2.0.0 from v2.0 through\n` +
    `v3.7 while the matcher changed repeatedly — this test exists so that cannot\n` +
    `happen silently again.\n\n` +
    `Re-pinning the hash WITHOUT bumping the version restores exactly the condition\n` +
    `this test exists to prevent.`,
  );
});

test("[engine-version] the pinned version and the exported version agree", () => {
  assert.equal(
    ENGINE_VERSION,
    PINNED_ENGINE_VERSION,
    "ENGINE_VERSION was bumped without re-pinning this test, or vice versa. " +
    "Both constants must move in the same commit, or the tripwire is measuring a version nobody ships.",
  );
});

test("[engine-version] the hash is SENSITIVE — a matcher edit must change it", () => {
  // ANTI-VACUITY. A hash function that returned a constant would make the first
  // test pass for ever. This proves the hash actually depends on the bytes, by
  // hashing a mutated copy of the same input and requiring a different answer.
  // Without it, `matcherHash` could be silently broken and the guard would read
  // green — the flattering direction, and the exact failure v3.4 found in
  // discrimination.test.ts's vacuous mutation group.
  const h = createHash("sha256");
  for (const rel of MATCHER_FILES) {
    const body = readFileSync(join(REPO, rel), "utf8").replace(/\r\n/g, "\n");
    h.update(`${rel}\n${body}\n${rel === MATCHER_FILES[0] ? "// mutation" : ""}`);
  }
  assert.notEqual(
    h.digest("hex").slice(0, 16),
    matcherHash(),
    "the matcher hash does not depend on the file contents — this tripwire cannot detect anything",
  );
});

test("[engine-version] every hashed file exists and is non-trivial", () => {
  // A file that silently stopped existing would be readFileSync's problem, but a
  // file that became EMPTY would hash fine and guard nothing.
  for (const rel of MATCHER_FILES) {
    const body = readFileSync(join(REPO, rel), "utf8");
    assert.ok(body.length > 1000, `${rel} is ${body.length} bytes — too small to be the matcher file this pin assumes`);
  }
});
