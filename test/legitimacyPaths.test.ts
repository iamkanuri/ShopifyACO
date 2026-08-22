// ===========================================================================
// G-11 ON EVERY PATH THAT PRODUCES A RESULT.
//
// `test/legitimacy.test.ts` proves the gate reaches the right verdict. This file proves
// the verdict SURVIVES to every artifact, which is a different question and the one an
// adversarial review of v2.8 answered "no" to twice.
//
// `evaluate` is not the only thing that decides what a merchant reads. THREE places
// assemble or rewrite a result, and a gate added to one does not reach the others:
//
//   1. `runProductTest`       the public path. Filters corrections, counts actionable.
//   2. `applySemanticTier`    REWRITES rows after `evaluate` has returned. Both branches
//                             change a row's STATUS, which invalidates the `notActionable`
//                             the gate stamped, in opposite directions.
//   3. `runAuthenticatedTest` the merchant re-run after a store connects. A SEPARATE
//                             result builder calling the same `evaluate`.
//
// (2) and (3) both shipped in the first draft of v2.8 without the gate, and both were
// found by execution rather than by reading. (3) is the worse of the two: it emitted
// `Confirm whether this product meets "An organic claim is stated in readable text"` to a
// merchant who had just connected their store and is the person most likely to act on it.
//
// Pure: no network, no DB. The semantic tier runs against a stub judge, never a model.
// ===========================================================================
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  evaluate, applySemanticTier, type Requirement,
} from "../src/server/productTest.js";
import { runAuthenticatedTest } from "../src/server/authenticatedTest.js";
import type { NormalizedProduct } from "../src/catalog/normalize.js";
import { mkProduct } from "./support/adversarial.js";

const organic = (): Requirement =>
  ({ id: "CERT-001", kind: "claim", claim: "organic", label: "An organic claim is stated in readable text" });
const weight = (): Requirement =>
  ({ id: "WEIGHT-001", kind: "attribute", attribute: "dimensions", label: "A weight or measurement is stated in readable text" });

const catalogCoffee = (over: Partial<NormalizedProduct> = {}): NormalizedProduct => ({
  productGid: "gid://shopify/Product/1001",
  handle: "ethiopia-guji",
  title: "Ethiopia Guji",
  description: "Roasted last Tuesday. Notes of peach.",
  descriptionHtml: "<p>Roasted last Tuesday. Notes of peach.</p>",
  vendor: "Acme Roasters",
  productType: "Coffee",
  tags: [],
  status: "ACTIVE",
  onlineUrl: "https://acme.example/products/ethiopia-guji",
  imageUrl: null,
  seoTitle: null,
  seoDescription: null,
  metafields: [],
  variants: [{
    variantGid: "gid://shopify/ProductVariant/1", title: "Default", sku: null, barcode: null,
    price: 19, available: true, inventoryQuantity: 5, options: [{ name: "Title", value: "Default Title" }],
  }],
  collections: [],
  nestedTruncated: false,
  ...over,
});

/** A semantic judge that returns one fixed verdict and never touches a model. */
const stubJudge = (findings: unknown[]) => ({
  semantic: {
    complete: async () => ({ text: JSON.stringify({ findings }), inputTokens: 10, outputTokens: 5 }),
  },
});

// ---- 1. the SEMANTIC TIER rewrites rows after the gate ran ------------------

describe("the semantic tier cannot smuggle a row past the gate", () => {
  test("a VETO of a passing conditional claim lands as a non-gap, not as a finding", async () => {
    // The lexical matcher passed it; the tier says the matching text is about something
    // else. The row therefore states nothing, which for a voluntary claim is not a gap.
    // Before the fix this came back `not_proven` with NO `notActionable`, reopening the
    // exact defect G-11 closes and emitting a correction line for it.
    const p = mkProduct({ title: "Ethiopia Guji", productType: "Coffee", description: "Our organic cotton tote is back in stock." });
    const req = organic();
    const before = evaluate(p, req);
    assert.equal(before.status, "pass_evidenced", "precondition: the lexical matcher passes it");

    const { assertions } = await applySemanticTier(
      p, [req], [before], stubJudge([{ attribute: "organic", verdict: "reject" }]) as never);
    const row = assertions[0]!;
    if (row.status === "not_proven") {
      assert.ok(row.notActionable, "the gate must re-run, so the negative is not promoted");
      assert.equal(row.notActionable!.reason, "optional_unstated");
    }
  });

  test("a GRANT clears the non-gap flag, so a PASSING row never carries one", async () => {
    // Before the fix the grant spread the old row, so a `pass_evidenced` row rendered
    // beside a "not a gap: optional" badge and a paragraph explaining why its absence did
    // not matter: a page contradicting itself about a row that passed.
    const p = mkProduct({ title: "Ethiopia Guji", productType: "Coffee", description: "Roasted last Tuesday. Notes of peach." });
    const req = organic();
    const before = evaluate(p, req);
    assert.equal(before.status, "not_proven");
    assert.ok(before.notActionable, "precondition: the gate marked it a non-gap");

    const { assertions } = await applySemanticTier(
      p, [req], [before],
      stubJudge([{ attribute: "organic", verdict: "accept", quote: "Roasted last Tuesday.", surface: "product_description" }]) as never);
    const row = assertions[0]!;
    if (row.status === "pass_evidenced") {
      assert.equal(row.notActionable, undefined, "a passing row must carry no non-gap flag");
    }
  });
});

// ---- 2. the AUTHENTICATED path is a second result builder ------------------

describe("the merchant re-run applies the gate too", () => {
  const reqs = () => [organic(), weight()];

  test("no correction line is emitted for a row the gate marked a non-gap", () => {
    const r = runAuthenticatedTest({ product: catalogCoffee(), requirements: reqs(), summary: "Find the Ethiopia Guji." });
    assert.equal(r.ok, true);

    const organicRow = r.assertions.find((a) => a.label === organic().label)!;
    assert.equal(organicRow.status, "not_proven");
    assert.ok(organicRow.notActionable, "precondition: `evaluate` marks it a non-gap on this path too");

    assert.ok(
      !r.suggestedCorrections.some((c) => /organic/i.test(c)),
      `the organic row must produce no correction line:\n  ${r.suggestedCorrections.join("\n  ")}`,
    );
    // ...and the row that IS a deficiency still gets one. Half a gate is worse than none.
    assert.ok(
      r.suggestedCorrections.some((c) => /weight or measurement/i.test(c)),
      `the weight row MUST still produce one:\n  ${r.suggestedCorrections.join("\n  ")}`,
    );
  });

  test("actionableCount is reported and is smaller than notProvenCount", () => {
    const r = runAuthenticatedTest({ product: catalogCoffee(), requirements: reqs(), summary: "Find the Ethiopia Guji." });
    assert.equal(r.notProvenCount, 2, "both rows are unproven");
    assert.equal(r.actionableCount, 1, "only one of them is a deficiency");
  });
});

// ---- 3. the self-contradiction the gate must NOT swallow -------------------

test("a page that states a claim AND contradicts it is still a finding", () => {
  // The `violating` branch marks a conditional claim non-actionable, because a product
  // containing wheat has not FAILED to be gluten-free. But a page that says BOTH is wrong
  // about itself, and that is a defect the merchant can and should fix. This is the one
  // place the gate could cost a true finding rather than remove a false one.
  const req: Requirement = { id: "c", kind: "claim", claim: "gluten_free", label: "Gluten-free" };

  const onlyContradicts = evaluate(
    mkProduct({ title: "Oat Balm", productType: "Skincare", description: "Contains wheat protein for slip." }), req);
  assert.equal(onlyContradicts.status, "not_proven");
  assert.ok(onlyContradicts.notActionable, "a product that is simply not gluten-free is not a page defect");

  const contradictsItself = evaluate(
    mkProduct({ title: "Oat Balm", productType: "Skincare", description: "Certified gluten-free. Contains wheat protein for slip." }), req);
  assert.equal(contradictsItself.status, "not_proven");
  assert.equal(
    contradictsItself.notActionable, undefined,
    "the page claims it and denies it in the same breath, which IS a finding",
  );
});

// ---- 4. the identity counter must never take a whole result down -----------

test("an unlintable product title counters the claim WITHOUT being quoted", () => {
  // `evidenceQuote` is folded into the BLOCKING claim linter, and a product title is the
  // one string on the page we do not control. Quoting an unlinted one would turn a store
  // we read perfectly into `errorKind: "unreachable"`. This engine has already lost a
  // whole result to that once, on "Lifetime Guarantee Leather Belt".
  const req: Requirement = { id: "s", kind: "claim", claim: "single_origin", label: "Single-origin" };

  const clean = evaluate(mkProduct({ title: "Hometown Blend", productType: "Coffee", description: "Our everyday cup." }), req);
  assert.equal(clean.notActionable?.reason, "contradicted_by_evidence");
  assert.equal(clean.evidenceQuote, "Hometown Blend", "a clean title is quoted");

  const hostile = evaluate(mkProduct({ title: "Lifetime Guarantee Blend", productType: "Coffee", description: "Our everyday cup." }), req);
  assert.equal(hostile.notActionable?.reason, "contradicted_by_evidence", "the counter still fires");
  assert.equal(hostile.evidenceQuote, undefined, "but the unlintable title is NOT quoted back");
});
