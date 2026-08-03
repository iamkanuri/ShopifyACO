import test from "node:test";
import assert from "node:assert/strict";

import { zeroAwareMin } from "../src/server/productTest.js";

// ===========================================================================
// v4.5 — `$0.00` IS NOT A PRICE (ENGINE_GAPS P-19, first half).
//
// ⚠️ WHY THIS FILE EXISTS AT ALL, and it is not "because the function is new".
// The first implementation of `zeroAwareMin` refused whenever ANY readable price was
// zero, while the comment above it said "every readable price was zero". A $45 serum
// with a "Free gift with purchase" variant stopped reporting a price. NO REAL-STORE
// REPLAY COULD HAVE CAUGHT IT: the 335-store deduped corpus contains zero stores with a
// zero minimum beside a non-zero variant, and that absence was measured before the rule
// was written. The frozen fetch corpus caught it on the first run (`znn-02`).
//
// This repo's rule is that a comment claiming a behaviour owes a case in the same commit.
// The `all` vs `any` distinction is the whole rule, so it is the first thing asserted.
// ===========================================================================

test("[zero-price] a zero BESIDE a real price is not a zero-priced product", () => {
  // The exact shape of fetch-corpus case `znn-02`: a gift-with-purchase variant at 0.00
  // and a real variant at 45.00. The honest answer is 45, not a refusal.
  assert.deepEqual(zeroAwareMin([0, 45], null), { minPriceUsd: 45, publishedZeroPrice: false });
  assert.deepEqual(zeroAwareMin([45, 0], null), { minPriceUsd: 45, publishedZeroPrice: false });
  assert.deepEqual(zeroAwareMin([0, 12.5, 45], null), { minPriceUsd: 12.5, publishedZeroPrice: false });
});

test("[zero-price] every readable price zero => refuse, and SAY it was a zero", () => {
  // `publishedZeroPrice` is what lets the row distinguish "you published 0.00" from
  // "you published nothing". Collapsing them would tell two different merchants the
  // same untrue thing.
  assert.deepEqual(zeroAwareMin([0], null), { minPriceUsd: null, publishedZeroPrice: true });
  assert.deepEqual(zeroAwareMin([0, 0], null), { minPriceUsd: null, publishedZeroPrice: true });
});

test("[zero-price] it REFUSES rather than substituting a different number", () => {
  // ⚠️ THE INVARIANT v3.8 SHIPPED AND THIS MUST NOT BREAK: a wrong price may never become
  // a DIFFERENTLY-wrong price. When the variant tier publishes only zeros, the JSON-LD
  // offer is NOT consulted for a replacement — nobody looks twice at a plausible number.
  assert.deepEqual(zeroAwareMin([0], 45), { minPriceUsd: null, publishedZeroPrice: true });
  assert.deepEqual(zeroAwareMin([0, 0], 99.99), { minPriceUsd: null, publishedZeroPrice: true });
});

test("[zero-price] no variant tier => the offer fallback, under the same rule", () => {
  assert.deepEqual(zeroAwareMin([], 45), { minPriceUsd: 45, publishedZeroPrice: false });
  assert.deepEqual(zeroAwareMin([], 0), { minPriceUsd: null, publishedZeroPrice: true });
  assert.deepEqual(zeroAwareMin([], null), { minPriceUsd: null, publishedZeroPrice: false });
});

test("[zero-price] an ordinary product is untouched", () => {
  // The anti-vacuity anchor: if this file only ever exercised zeros, a function that
  // refused everything would pass every case above.
  assert.deepEqual(zeroAwareMin([24, 30, 48], null), { minPriceUsd: 24, publishedZeroPrice: false });
  assert.deepEqual(zeroAwareMin([9.35], null), { minPriceUsd: 9.35, publishedZeroPrice: false });
});
