import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBuyerTask, evaluate, runProductTest, type PublicProduct, type Requirement } from "../src/server/productTest.js";
import { buildEvidence, findSupport, findTimingSupport, presentableQuote, isNegated, passesAboutness } from "../src/server/testEvidence.js";

// ===========================================================================
// Phase B — assertion evaluator HONESTY tests. Pure (no network).
// The differentiator is evidence-availability scoping + validated support:
// a wrong Fail is recoverable, a wrong Pass is not.
// ===========================================================================

/** Build a product whose evidence comes from typed PRODUCT surfaces only. */
const mk = (over: Partial<PublicProduct> & { description?: string } = {}): PublicProduct => {
  const description = over.description ?? "";
  return {
    origin: "https://s.example", handle: "p", title: over.title ?? "Natural Deodorant", vendor: "Acme",
    productType: over.productType ?? "Deodorant", tags: over.tags ?? [], descriptionText: description,
    variants: over.variants ?? [{ title: "Default", priceUsd: 12, available: true, options: ["Default"] }],
    minPriceUsd: over.minPriceUsd !== undefined ? over.minPriceUsd : 12,
    optionNames: [], optionValues: over.optionValues ?? [], extracted: null,
    evidence: over.evidence ?? buildEvidence([{ surface: "product_description", text: description }]),
    fetched: { json: true, page: false },
  };
};
const claimReq = (claim: string): Requirement => ({ id: "c", kind: "claim", claim, label: claim });
const deliveryReq: Requirement = { id: "d", kind: "delivery", label: "Ships in the US within a week" };

// ---- 1. THE LIVE REGRESSION: free shipping is not a timing statement --------

test("1. a shipping quote with no timing term or digit does NOT satisfy the delivery requirement", () => {
  // The exact live false positive: a subscription widget credited as delivery timing.
  const chrome = "se $8.00 Selected Subscribe & Save save 25% $8.00 $6.00 Free shipping Cancel anytime Pause or skip anytime Build";
  const a = evaluate(mk({ description: chrome }), deliveryReq);
  assert.equal(a.status, "requires_store_access", `must not pass on chrome; got ${a.status}`);
  assert.equal(a.evidenceQuote, undefined, "no quote is shown for an unproven timing requirement");

  // "Free shipping" alone — price, not speed — never satisfies timing.
  assert.equal(evaluate(mk({ description: "Free shipping on all orders." }), deliveryReq).status, "requires_store_access");

  // A real timing statement WITH a number passes and quotes the sentence.
  const good = evaluate(mk({ description: "Orders ship within 2 business days from our facility." }), deliveryReq);
  assert.equal(good.status, "pass_evidenced");
  assert.match(good.evidenceQuote ?? "", /ships? within 2 business days/i);

  // An open-ended timing term with NO digit does not pass.
  assert.equal(evaluate(mk({ description: "Orders ship within a few business days." }), deliveryReq).status, "requires_store_access");
});

// ---- 2. chrome / widget / review text is never product evidence -------------

test("2. widget, review and upsell text is never quoted as product evidence", () => {
  const cases = [
    "Subscribe & Save save 25% — cancel anytime on every delivery.",
    "★★★★★ 412 reviews — one verified buyer said this soap is fragrance-free.",
    "You may also like our fragrance-free travel bar.",
  ];
  for (const text of cases) {
    const a = evaluate(mk({ description: text }), claimReq("fragrance_free"));
    assert.equal(a.status, "not_proven", `chrome must not evidence a claim: ${text}`);
    assert.equal(a.evidenceQuote, undefined);
  }
  // The same sentence in real product copy DOES evidence it.
  const real = evaluate(mk({ description: "This gentle bar is fragrance-free and made for sensitive skin." }), claimReq("fragrance_free"));
  assert.equal(real.status, "pass_evidenced");
});

// ---- 3. quotes are whole sentences, capped, never truncated mid-word --------

test("3. quotes are whole sentences, <=180 chars, cut at a word boundary", () => {
  const long = `Our formula is fragrance-free and ${"gentle ".repeat(60)}enough for daily use.`;
  const q = presentableQuote(long);
  assert.ok(q, "a long sentence still yields a quote");
  assert.ok(q!.length <= 181, `<=180 chars + ellipsis (got ${q!.length})`);
  assert.ok(q!.endsWith("…"), "ellipsis marks the cut");
  const body = q!.slice(0, -1);
  assert.ok(long.startsWith(body), "the quote is a verbatim prefix");
  const lastWord = body.trim().split(/\s+/).pop()!;
  assert.match(long, new RegExp(`\\b${lastWord}\\b`), "the final word is whole, never cut mid-word");

  // Junk yields no quote at all (the surface is named instead).
  assert.equal(presentableQuote("$8.00 $6.00 25% — —"), null, "no real words");
  assert.equal(presentableQuote("Free shipping"), null, "a 2-word fragment is not a sentence");
  assert.equal(presentableQuote("Save $8.00 now $6.00 then $4.00 later"), null, "a price list is widget chrome");
  // A short clean sentence is quoted whole, unchanged.
  assert.equal(presentableQuote("Aluminum-free and gentle."), "Aluminum-free and gentle.");
});

// ---- 4. negation prevents a claim match ------------------------------------

test("4. negation prevents a claim match", () => {
  assert.equal(evaluate(mk({ description: "This bar is not fragrance-free." }), claimReq("fragrance_free")).status, "not_proven");
  assert.equal(isNegated("This is not aluminum-free.", "aluminum-free"), true);
  assert.equal(isNegated("This is aluminum-free.", "aluminum-free"), false);
  // A negated mention plus a genuine one still supports.
  assert.equal(isNegated("Not the old formula. The new bar is aluminum-free.", "aluminum-free"), false);
});

// ---- 5. a claim about packaging / another subject does not count ------------

test("5. a claim that only modifies packaging or another subject is rejected (the Stage 3 TRAP)", () => {
  const trap = evaluate(mk({ description: "Ships in fragrance-free packaging to protect the bar." }), claimReq("fragrance_free"));
  assert.equal(trap.status, "not_proven", "the claim modifies packaging, not the product");
  assert.equal(passesAboutness("Ships in aluminum-free packaging.", "aluminum-free").ok, false);
  assert.equal(passesAboutness("The deodorant is aluminum-free.", "aluminum-free").ok, true);
  // Logistics requirements MAY talk about shipping subjects.
  assert.equal(passesAboutness("Ships within 2 business days.", "ships within", { allowLogisticsSubject: true }).ok, true);
});

// ---- 6. must_be_false absence is disclosed, never presented as proof --------

test("6. absence of a subscription blocker renders as pass_no_blocking, not pass_evidenced", () => {
  const a = evaluate(mk({ description: "A gentle daily deodorant." }), { id: "s", kind: "no_subscription", label: "Available as a one-time purchase" });
  assert.equal(a.status, "pass_no_blocking");
  assert.match(a.detail, /absence of a blocker/i, "the inference is disclosed in the copy");
  assert.equal(a.evidenceQuote, undefined, "an inference never carries a quote");

  // A real subscription-required signal is not proven.
  const blocked = evaluate(mk({ description: "This item is subscription only." }), { id: "s", kind: "no_subscription", label: "One-time" });
  assert.equal(blocked.status, "not_proven");
});

// ---- 7. the four states map to correct counts ------------------------------

test("7. result states produce a correct, separated breakdown", async () => {
  const html = [
    '{"product":{"title":"Cedar Bar Soap","vendor":"Acme","product_type":"Bar Soap","tags":"",',
    '"body_html":"<p>A cedar bar soap. Paraben-free and gentle.</p>",',
    '"options":[{"name":"Size","values":["Travel"]}],',
    '"variants":[{"title":"Travel","price":"9.00","option1":"Travel"}]}}',
  ].join("");
  const res = await runProductTest("https://s.example/products/cedar-bar", {
    loadRobots: async () => ({ rules: [], fetched: false }),
    fetchUrl: async (url) =>
      url.endsWith(".json")
        ? { status: 200, contentType: "application/json", body: html }
        : { status: 404, contentType: "text/html", body: "" },
  });
  assert.equal(res.ok, true);
  assert.equal(res.total, res.assertions.length);
  assert.equal(
    res.evidencedCount + res.noBlockingCount + res.notProvenCount + res.requiresAccessCount,
    res.total,
    "every assertion lands in exactly one of the four states",
  );
  // Paraben-free IS stated → evidenced; fragrance-free is NOT → not proven.
  const paraben = res.assertions.find((a) => /paraben/i.test(a.label))!;
  assert.equal(paraben.status, "pass_evidenced");
  assert.match(paraben.evidenceQuote ?? "", /paraben-free/i);
  const fragrance = res.assertions.find((a) => /fragrance/i.test(a.label))!;
  assert.equal(fragrance.status, "not_proven");
  assert.match(fragrance.detail, /checked .*product copy/i, "names the surfaces actually checked");
  // Subscription is an inference; delivery isn't public.
  assert.equal(res.assertions.find((a) => /one-time/i.test(a.label))!.status, "pass_no_blocking");
  assert.equal(res.assertions.find((a) => /ships/i.test(a.label))!.status, "requires_store_access");
  assert.ok(res.notInspectable.includes("product metafields"));
});

// ---- structural: price/variant use structured values only -------------------

test("price and variant assertions use structured values, never prose", () => {
  const under = evaluate(mk({ minPriceUsd: 12 }), { id: "p", kind: "price_under", capUsd: 20, label: "Price under $20" });
  assert.equal(under.status, "pass_evidenced");
  assert.equal(under.evidenceQuote, undefined, "a price is a value, not a quote");
  const over = evaluate(mk({ minPriceUsd: 25 }), { id: "p", kind: "price_under", capUsd: 20, label: "Price under $20" });
  assert.equal(over.status, "not_proven");
  assert.match(over.detail, /\$25\.00/, "reports the readable value");
  const noPrice = evaluate(mk({ minPriceUsd: null }), { id: "p", kind: "price_under", capUsd: 20, label: "Price under $20" });
  assert.equal(noPrice.status, "requires_store_access");

  const p = mk({ variants: [{ title: "Unscented / Travel", priceUsd: 10, available: true, options: ["Unscented", "Travel"] }] });
  assert.equal(evaluate(p, { id: "v", kind: "variant_option", optionValue: "Travel", label: "Travel option" }).status, "pass_evidenced");
  assert.equal(evaluate(p, { id: "v", kind: "variant_option", optionValue: "XL", label: "XL option" }).status, "not_proven");
});

test("buildBuyerTask: 4–6 requirements across surface types; category-aware claims", () => {
  const task = buildBuyerTask(mk({ productType: "Deodorant", optionValues: ["Unscented", "Travel"] }));
  assert.ok(task.requirements.length >= 4 && task.requirements.length <= 6, `4–6 requirements (${task.requirements.length})`);
  const kinds = new Set(task.requirements.map((r) => r.kind));
  assert.ok(kinds.has("claim") && kinds.has("price_under") && kinds.has("no_subscription") && kinds.has("delivery"), "spans surface types");
  assert.ok(task.requirements.some((r) => r.claim === "aluminum_free"), "deodorant → aluminum-free claim");
  const coffee = buildBuyerTask(mk({ title: "Ethiopia Whole Bean Coffee", productType: "Coffee" }));
  assert.ok(coffee.requirements.some((r) => r.claim === "single_origin"), "coffee → single-origin claim");
  // A coffee-SCENTED soap is a soap, not a coffee (tags must not classify).
  const soap = buildBuyerTask(mk({ title: "Coffee Scrub Bar", productType: "Bar Soap", tags: ["coffee"] }));
  assert.ok(soap.requirements.some((r) => r.claim === "fragrance_free"), "soap → skincare claims");
});

// ---- 10. the claim linter blocks overclaims in any rendered string ----------

test("10. claim linter blocks product-truth, ranking, revenue, causal and predictive phrasing", async () => {
  const { lintText, lintStrings } = await import("../src/server/claimLinter.js");

  // Compliant, evidence-availability-scoped copy passes.
  for (const good of [
    "Checked product copy, structured data and variant options — no statement an AI buyer could verify.",
    "Stated in your product copy.",
    "Nothing in your public product data requires a subscription. This is the absence of a blocker, not a stated one-time-purchase option.",
    "Lowest readable price is $23.00, at or above the $20 requirement.",
    "Your shipping policy isn't publicly inspectable per-product — confirming this needs store access.",
  ]) {
    assert.equal(lintText(good).ok, true, `should pass: ${good} → ${lintText(good).violations.map((v) => v.rule).join(",")}`);
  }

  // Each forbidden family is caught.
  const bad: Array<[string, string]> = [
    ["Your product is not aluminum-free.", "product-truth"],
    ["Your formula lacks a verifiable claim.", "product-truth"],
    ["You are losing $4,200 per month to competitors.", "revenue-loss"],
    ["Fixing this will increase your sales.", "revenue-promise"],
    ["Add this and you'll rank higher in AI answers.", "ranking-prediction"],
    ["This fix will improve your visibility.", "predictive"],
    ["We guarantee more recommendations.", "guarantee"],
    ["Your store does not state the price.", "price-is-always-public"],
    ["Missing metafields on this product.", "not-inspectable-mislabeled"],
  ];
  for (const [text, rule] of bad) {
    const r = lintText(text);
    assert.equal(r.ok, false, `should block: ${text}`);
    assert.ok(r.violations.some((v) => v.rule === rule), `${text} → expected ${rule}, got ${r.violations.map((v) => v.rule).join(",")}`);
  }

  // lintStrings aggregates and ignores empty slots.
  assert.equal(lintStrings([null, undefined, "Stated in your product copy."]).ok, true);
  assert.equal(lintStrings(["fine", "This fix will boost conversions."]).ok, false);
});

test("10b. a non-compliant result is NOT rendered (the linter is a blocking gate)", async () => {
  // A product whose own copy would produce a forbidden rendered string: the claim
  // label is injected via the product title path used by the task summary.
  const html = JSON.stringify({
    product: {
      title: "Rank Higher Serum", vendor: "Acme", product_type: "you'll rank higher serum", tags: "",
      body_html: "<p>A serum.</p>", options: [], variants: [{ title: "Default", price: "10.00" }],
    },
  });
  const res = await runProductTest("https://s.example/products/x", {
    loadRobots: async () => ({ rules: [], fetched: false }),
    fetchUrl: async (url) =>
      url.endsWith(".json")
        ? { status: 200, contentType: "application/json", body: html }
        : { status: 404, contentType: "text/html", body: "" },
  });
  // The task summary embeds product_type → "…rank higher…" trips the linter.
  assert.equal(res.ok, false, "a result containing a forbidden phrase is refused");
  assert.match(res.error ?? "", /reporting standard/i, "the refusal is honest, not a crash");
  assert.equal(res.assertions.length, 0, "nothing is rendered");
});

test("findSupport only reads product surfaces (chrome is not in the index at all)", () => {
  const ev = buildEvidence([
    { surface: "product_description", text: "A gentle bar." },
    { surface: "structured_data", text: "Certified organic and fair trade." },
  ]);
  assert.equal(findSupport(ev, ["organic"])?.surface, "structured_data");
  assert.equal(findTimingSupport(ev), null, "no timing statement anywhere");
});
