import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBuyerTask, evaluate, type PublicProduct, type Requirement } from "../src/server/productTest.js";

// ===========================================================================
// Phase B — product-test assertion evaluator: HONESTY tests. Pure (no network).
// The whole differentiator is evidence-availability scoping, never product truth.
// ===========================================================================

const mk = (over: Partial<PublicProduct> = {}): PublicProduct => ({
  origin: "https://s.example", handle: "p", title: "Natural Deodorant", vendor: "Acme",
  productType: "Deodorant", tags: [], descriptionText: "", variants: [{ title: "Default", priceUsd: 12, available: true, options: ["Default"] }],
  minPriceUsd: 12, optionNames: [], optionValues: [], corpus: "", extracted: null, fetched: { js: true, page: false }, ...over,
});
const claimReq = (claim: string): Requirement => ({ id: "c", kind: "claim", claim, label: claim });

test("claim assertion: pass with verbatim quote / fail-no-evidence / fail-value (never product-truth)", () => {
  // Stated → PASS with a verbatim substring quote.
  const pass = evaluate(mk({ corpus: "A gentle aluminum-free deodorant for daily use." }), claimReq("aluminum_free"));
  assert.equal(pass.status, "pass");
  assert.ok(pass.evidenceQuote && "A gentle aluminum-free deodorant for daily use.".toLowerCase().includes(pass.evidenceQuote.replace(/…$/, "").toLowerCase()), "quote is verbatim");

  // Not stated → FAIL-NO-EVIDENCE (evidence-availability, NOT "your product is not X").
  const gap = evaluate(mk({ corpus: "A gentle natural deodorant for daily use." }), claimReq("aluminum_free"));
  assert.equal(gap.status, "fail_no_evidence");
  assert.ok(/no evidence/i.test(gap.detail) && !/is not|isn't/i.test(gap.detail), "no product-truth phrasing");

  // Contrary evidence → FAIL-VALUE.
  const contra = evaluate(mk({ corpus: "This formula contains aluminum for extra protection." }), claimReq("aluminum_free"));
  assert.equal(contra.status, "fail_value");

  // Negated support term is NOT a pass.
  const negated = evaluate(mk({ corpus: "This is not aluminum-free." }), claimReq("aluminum_free"));
  assert.notEqual(negated.status, "pass");
});

test("price is always public: under cap → pass; over cap → fail_value (a readable value, never 'not stated')", () => {
  const under = evaluate(mk({ minPriceUsd: 12 }), { id: "p", kind: "price_under", capUsd: 20, label: "Price under $20" });
  assert.equal(under.status, "pass");
  const over = evaluate(mk({ minPriceUsd: 25 }), { id: "p", kind: "price_under", capUsd: 20, label: "Price under $20" });
  assert.equal(over.status, "fail_value");
  assert.ok(/\$25/.test(over.detail) && !/not stated|missing|no evidence/i.test(over.detail), "reports the readable value, not a gap");
});

test("variant / stock / subscription assertions", () => {
  const p = mk({ variants: [{ title: "Unscented / Travel", priceUsd: 10, available: true, options: ["Unscented", "Travel"] }] });
  assert.equal(evaluate(p, { id: "v", kind: "variant_option", optionValue: "Travel", label: "Travel option available" }).status, "pass");
  assert.equal(evaluate(p, { id: "v", kind: "variant_option", optionValue: "XL", label: "XL option available" }).status, "fail_no_evidence");
  // no-subscription: default pass; hard subscription-required signal → fail_value.
  assert.equal(evaluate(mk(), { id: "s", kind: "no_subscription", label: "One-time" }).status, "pass");
  assert.equal(evaluate(mk({ corpus: "This item is subscription only." }), { id: "s", kind: "no_subscription", label: "One-time" }).status, "fail_value");
});

test("delivery timing not on the public page → requires_store_access (never a failure)", () => {
  const noInfo = evaluate(mk({ corpus: "A gentle deodorant." }), { id: "d", kind: "delivery", label: "Ships within a week" });
  assert.equal(noInfo.status, "requires_store_access");
  assert.ok(/store access/i.test(noInfo.detail));
  const stated = evaluate(mk({ corpus: "Ships within 2 business days across the US." }), { id: "d", kind: "delivery", label: "Ships within a week" });
  assert.equal(stated.status, "pass");
});

test("buildBuyerTask: 4–6 requirements across surface types; category-aware claims", () => {
  const task = buildBuyerTask(mk({ productType: "Deodorant", optionValues: ["Unscented", "Travel"] }));
  assert.ok(task.requirements.length >= 4 && task.requirements.length <= 6, `4–6 requirements (${task.requirements.length})`);
  const kinds = new Set(task.requirements.map((r) => r.kind));
  assert.ok(kinds.has("claim") && kinds.has("price_under") && kinds.has("no_subscription") && kinds.has("delivery"), "spans surface types");
  const claims = task.requirements.filter((r) => r.kind === "claim").map((r) => r.claim);
  assert.ok(claims.includes("aluminum_free"), "deodorant → aluminum-free claim");
  // Coffee infers single-origin.
  const coffee = buildBuyerTask(mk({ title: "Ethiopia Whole Bean Coffee", productType: "Coffee" }));
  assert.ok(coffee.requirements.some((r) => r.claim === "single_origin"), "coffee → single-origin claim");
});
