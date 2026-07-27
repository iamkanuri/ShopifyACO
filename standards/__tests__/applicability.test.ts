import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classify, applyApplicability, assertSidecarCoversStandard, renderApplicability,
  type Sidecar, type ClassifiableProduct, type CategoryRule,
} from "../applicability.js";
import { compileStandard, type Standard } from "../compile.js";
import { loadJson } from "./support.js";

// ===========================================================================
// G-10 — APPLICABILITY GATING.
//
// The first Coffee Standard run measured what its absence costs: 11 of 25 captured
// "coffee" products were merchandise, and with nothing enforcing `applicability`
// every entry fired on all of them. Six entries were then reported as carrying ~no
// information, on a sample that was partly measuring whether a tote bag states an
// organic certification.
//
// These tests hold the two honesty properties, not just the happy path:
//   • an excluded entry is REPORTED, never silently dropped;
//   • excluding everything is a LOUD ERROR with includedCount null, never 0.
// ===========================================================================

const std = loadJson<Standard>("coffee/v1.0/standard.json");
const sidecar = loadJson<Sidecar>("coffee/v1.0/applicability.json");
const report = compileStandard(std);

const rule: CategoryRule = {
  inCategory: new RegExp(sidecar.category.in_category, "i"),
  outOfCategory: new RegExp(sidecar.category.out_of_category, "i"),
};

const coffee = (over: Partial<ClassifiableProduct> = {}): ClassifiableProduct => ({
  productType: "Coffee", title: "Kirinyaga AA", hasProductSchema: true, optionValues: ["Whole Bean", "12 oz"], ...over,
});

test("[applicability] the sidecar covers exactly the standard's executable entries", () => {
  // Without this, a new entry silently defaults to "always applies" — which is the
  // state G-10 exists to end, reintroduced one entry at a time.
  const ids = report.requirements.map((r) => r.id);
  const cov = assertSidecarCoversStandard(sidecar, ids);
  assert.deepEqual(cov.missing, [], "executable entries with no applicability rule");
  assert.deepEqual(cov.stale, [], "sidecar rules for entries that no longer exist");
  assert.ok(ids.length >= 10, `expected the standard's 10 executable entries, got ${ids.length}`);
});

test("[applicability] product_type is authoritative and beats a matching title", () => {
  // THE MEASURED DEFECT. A roaster's first product handle is often a t-shirt, and
  // the shirt is called "Coffee Lovers Tee". If the title could rescue it, the gate
  // would pass exactly the products it exists to exclude.
  const tee = classify({ productType: "Apparel", title: "Coffee Lovers Tee" }, rule);
  assert.equal(tee.verdict, "out_of_category");
  assert.equal(tee.signal, "product_type");

  // And the same product with NO product_type is decided by the title, correctly,
  // because `t-shirt`/`tee` is in the envelope's exclusion list.
  assert.equal(classify({ title: "Coffee Lovers Tee" }, rule).verdict, "out_of_category");
});

test("[applicability] tags cannot be read, structurally", () => {
  // A coffee-SCENTED soap must never read as a coffee product. This is not enforced
  // by a convention that reviewers must remember — `ClassifiableProduct` has no tags
  // field at all, so the module cannot read them even by accident. The cast is the
  // point of the test: even when tags are handed in, they change nothing.
  const withTags = { productType: "Soap", title: "Espresso Bar Soap", tags: ["coffee", "espresso", "single-origin"] };
  assert.equal(classify(withTags as ClassifiableProduct, rule).verdict, "out_of_category");
});

test("[applicability] an authoritative signal that matches NEITHER list is decisive against", () => {
  // The merchant categorised this product and did not categorise it here. Falling
  // through to the title would let "Apparel" be rescued by the word coffee.
  const c = classify({ productType: "Home Goods", title: "Single Origin Ethiopia" }, rule);
  assert.equal(c.verdict, "out_of_category");
  assert.equal(c.signal, "product_type");
});

test("[applicability] `unknown` is its own class and never renders as a pass", () => {
  // A coffee bag titled "Kirinyaga AA" with no product_type says nothing either way.
  // The title is a FALLBACK, so its silence is not decisive.
  const c = classify({ title: "Kirinyaga AA" }, rule);
  assert.equal(c.verdict, "unknown");
  assert.equal(classify({}, rule).verdict, "unknown");

  const r = applyApplicability(report.requirements, sidecar, { title: "Kirinyaga AA" });
  assert.equal(r.state, "INCOMPLETE");
  assert.equal(r.includedCount, null, "INCOMPLETE must carry null, never 0 — a caller reading the number must not see a pass");
  assert.ok(r.decisions.every((d) => !d.asked));
  assert.ok(r.decisions.some((d) => d.reason === "unknown_category"));
  assert.match(r.blockedBy!, /must never render the same/);
});

test("[applicability] a coffee product is asked every entry that applies to it", () => {
  const r = applyApplicability(report.requirements, sidecar, coffee());
  assert.equal(r.state, "APPLIED");
  assert.equal(r.includedCount, report.requirements.length, "nothing should be excluded for a plain whole-bean bag");
  assert.equal(r.classification.signal, "product_type");
});

test("[applicability] pods are excluded from the four format/grind entries and kept for the rest", () => {
  // The envelope excludes pods from FORMAT and GRIND (the state is inherent to the
  // format) but deliberately KEEPS them for WEIGHT — "coffee sold by mass, including
  // pod packs that also declare a net weight". A gate that dropped all four plus
  // WEIGHT would be over-applying the exclusion, which is just as wrong.
  const pods = coffee({ title: "Decaf Espresso Capsules — 10 pack", optionValues: ["10 capsules"] });
  const r = applyApplicability(report.requirements, sidecar, pods);
  assert.equal(r.state, "APPLIED");
  const skipped = r.decisions.filter((d) => !d.asked).map((d) => d.entry);
  assert.deepEqual(skipped.sort(), [
    "ALS-COFFEE-1.0-FORMAT-001", "ALS-COFFEE-1.0-FORMAT-002",
    "ALS-COFFEE-1.0-GRIND-001", "ALS-COFFEE-1.0-GRIND-002",
  ]);
  assert.ok(r.requirements.some((x) => x.id === "ALS-COFFEE-1.0-WEIGHT-001"), "WEIGHT applies to pod packs by the envelope's own words");
  for (const d of r.decisions.filter((x) => !x.asked)) assert.equal(d.reason, "preportioned_format");
});

test("[applicability] the identifiers entry is gated on readable Product markup, not asserted against it", () => {
  // "the page markup could not be read, which the engine reports as requiring store
  // access rather than as an absence" — the standard's own words. Asking the entry
  // anyway converts an access limit into a finding about the merchant.
  const r = applyApplicability(report.requirements, sidecar, coffee({ hasProductSchema: false }));
  assert.equal(r.state, "APPLIED");
  const ident = r.decisions.find((d) => d.entry === "ALS-COFFEE-1.0-IDENT-001")!;
  assert.equal(ident.asked, false);
  assert.equal(ident.reason, "no_product_schema");
});

test("[applicability] EVERY excluded entry is reported with a reason — nothing is dropped silently", () => {
  // A conformance list that quietly drops entries is worse than one that runs them
  // all, because the reader cannot tell "passed" from "was never asked".
  for (const p of [coffee(), coffee({ title: "Pods" }), coffee({ hasProductSchema: false })]) {
    const r = applyApplicability(report.requirements, sidecar, p);
    assert.equal(r.decisions.length, report.requirements.length, "one decision per compiled entry, always");
    for (const d of r.decisions) {
      if (d.asked) continue;
      assert.ok(d.reason, `${d.entry} was skipped with no reason`);
      assert.ok(d.detail && d.detail.length > 20, `${d.entry} was skipped with no readable explanation`);
    }
  }
  // And the rendering carries it, so a run record cannot omit it by accident.
  const text = renderApplicability(applyApplicability(report.requirements, sidecar, coffee({ hasProductSchema: false })));
  assert.match(text, /SKIP\s+ALS-COFFEE-1\.0-IDENT-001\s+— no_product_schema/);
  assert.match(text, /asked 9 of 10/);
});

test("[applicability] an out-of-category product is INCOMPLETE, not an empty pass", () => {
  const shirt = { productType: "Apparel", title: "Coffee Lovers Tee", hasProductSchema: true };
  const r = applyApplicability(report.requirements, sidecar, shirt);
  assert.equal(r.state, "INCOMPLETE");
  assert.equal(r.includedCount, null);
  assert.match(r.blockedBy!, /excluded all 10 compiled entries/);
  assert.match(r.blockedBy!, /out_of_category via product_type/);
});

test("[applicability] applying an EMPTY requirement list is INCOMPLETE, not a clean run", () => {
  // The `confirmed: 0` failure one layer up: a compile that produced nothing, then
  // "applied", looks identical to a product that was asked everything and passed.
  const r = applyApplicability([], sidecar, coffee());
  assert.equal(r.state, "INCOMPLETE");
  assert.equal(r.includedCount, null);
  assert.match(r.blockedBy!, /no requirements were compiled/);
});

test("[applicability] an entry with no sidecar rule is excluded LOUDLY, never silently asked", () => {
  const thin: Sidecar = { ...sidecar, rules: sidecar.rules.filter((x) => !x.entry.endsWith("CERT-001")) };
  const r = applyApplicability(report.requirements, thin, coffee());
  const cert = r.decisions.find((d) => d.entry === "ALS-COFFEE-1.0-CERT-001")!;
  assert.equal(cert.asked, false);
  assert.equal(cert.reason, "no_sidecar_rule");
  assert.match(cert.detail!, /gap in the sidecar, not a finding about the product/);
});

test("[applicability] every sidecar rule quotes the prose it is the reading of", () => {
  // The sidecar is subordinate to the document. A rule that cites nothing cannot be
  // reviewed against the text it claims to implement.
  for (const r of sidecar.rules) {
    assert.ok(r.from && r.from.length > 30, `${r.entry} has no \`from\` citation`);
    assert.ok(r.requires.length >= 1, `${r.entry} requires nothing, so it gates nothing`);
  }
});
