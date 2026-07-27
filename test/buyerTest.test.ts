import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { NormalizedProduct } from "../src/catalog/normalize.js";
import {
  snapshotFromCatalog, runAuthenticatedTest, diffAssertions, isEvidenceMetafield,
} from "../src/server/authenticatedTest.js";
import { contractFromPublicResult, claimKeyFromLabel, matchProductByUrl } from "../src/server/buyerTests.js";
import { contractVersion, ENGINE_VERSION, type Requirement } from "../src/server/productTest.js";
import { proposeClaimStatement, claimSentence, writableField, type CatalogProduct } from "../src/fixes/propose.js";

// ===========================================================================
// V2 CP2/CP3 — the walk from a public Buyer Test to a fixed, re-tested,
// permanently-saved regression test.
//
// The honesty spine is unchanged and is what these tests defend:
//   • authentication buys MORE SURFACES to look at, never a lower bar for proof;
//   • a claim we cannot verify is never grounds to write that claim into a store —
//     only the merchant's explicit "yes" is;
//   • a before/after whose contract or engine changed in between is refused, not
//     shown with a caveat.
// ===========================================================================

const mkProduct = (over: Partial<NormalizedProduct> = {}): NormalizedProduct => ({
  productGid: "gid://shopify/Product/1001",
  handle: "cedar-bar",
  title: "Cedar Bar Soap",
  description: "A cedar bar soap for daily use.",
  descriptionHtml: "<p>A cedar bar soap for daily use.</p>",
  vendor: "Acme",
  productType: "Bar Soap",
  tags: [],
  status: "ACTIVE",
  onlineUrl: "https://acme.example/products/cedar-bar",
  imageUrl: null,
  seoTitle: null,
  seoDescription: null,
  metafields: [],
  variants: [{
    variantGid: "gid://shopify/ProductVariant/1", title: "Default", sku: null, barcode: null,
    price: 9, available: true, inventoryQuantity: 5, options: [{ name: "Size", value: "Travel" }],
  }],
  collections: [],
  nestedTruncated: false,
  ...over,
});

// ---- 21. the public test survives the install handshake --------------------

test("21. a public test's contract is rebuilt intact, so the same task and assertions carry through install", () => {
  // What the merchant saw on the public page, verbatim in shape.
  const publicResult = {
    task: "Find this bar soap, confirm it's fragrance-free, purchasable one-time with fast US shipping.",
    assertions: [
      { label: "Fragrance-free / unscented", status: "not_proven", detail: "…", surfacesChecked: [] },
      { label: "Price under $10", status: "pass_evidenced", detail: "…", surfacesChecked: [] },
      { label: "Travel option available", status: "pass_evidenced", detail: "…", surfacesChecked: [] },
      { label: "In stock and purchasable", status: "pass_evidenced", detail: "…", surfacesChecked: [] },
      { label: "Available as a one-time purchase", status: "pass_no_blocking", detail: "…", surfacesChecked: [] },
    ],
    deferred: [
      { label: "Ships in the US within a week", status: "requires_store_access", detail: "…", surfacesChecked: [] },
    ],
  };

  const contract = contractFromPublicResult(publicResult);
  assert.equal(contract.summary, publicResult.task, "the task text is preserved exactly");
  assert.equal(contract.requirements.length, 6, "deferred rows are part of the contract too — they're the install argument");

  // Every requirement KIND round-trips, so the authenticated run asks the same question.
  const kinds = contract.requirements.map((r) => r.kind);
  assert.deepEqual(kinds, ["claim", "price_under", "variant_option", "in_stock", "no_subscription", "delivery"]);

  // The parameters that decide a verdict survive — not just the labels.
  const price = contract.requirements.find((r) => r.kind === "price_under")!;
  assert.equal(price.capUsd, 10, "the price cap is recovered from the label");
  const variant = contract.requirements.find((r) => r.kind === "variant_option")!;
  assert.equal(variant.optionValue, "Travel");
  const claim = contract.requirements.find((r) => r.kind === "claim")!;
  assert.equal(claim.claim, "fragrance_free", "the claim key is recovered so the same terms are matched");

  // And the contract fingerprints stably — this is what the rerun guard compares.
  assert.equal(contractVersion(contract.requirements), contractVersion(contractFromPublicResult(publicResult).requirements));
  assert.match(contractVersion(contract.requirements), /^c1-[0-9a-f]{8}$/);

  assert.equal(claimKeyFromLabel("Fragrance-free / unscented"), "fragrance_free");
  assert.equal(claimKeyFromLabel("Third-party tested"), "third_party_tested");
});

// ---- 22. authentication resolves rows the public test honestly deferred -----

test("22. an authenticated re-run resolves a previously requires_store_access row from metafield data", () => {
  // The public run could not read metafields, so this row was deferred, NOT failed.
  const publicAssertions = [
    { label: "Fragrance-free / unscented", status: "requires_store_access" as const, detail: "…", surfacesChecked: [] },
  ];
  const requirements: Requirement[] = [
    { id: "claim0", kind: "claim", claim: "fragrance_free", label: "Fragrance-free / unscented" },
  ];

  // The merchant DOES state it — in a metafield, which is exactly the surface the
  // public test told them we couldn't see.
  const product = mkProduct({
    metafields: [
      { namespace: "custom", key: "ingredients_note", value: "This bar is fragrance-free and made for sensitive skin.", type: "multi_line_text_field" },
    ],
  });

  const result = runAuthenticatedTest({ product, requirements, summary: "…", previous: publicAssertions });
  assert.equal(result.ok, true);
  const row = result.assertions[0]!;
  assert.equal(row.status, "pass_evidenced", "the metafield statement proves it");
  assert.match(row.detail, /product metafields/i, "and names the surface it came from");
  assert.ok(row.evidenceQuote, "with a real quote");

  assert.equal(result.resolvedCount, 1, "the delta reports the row as RESOLVED");
  assert.equal(result.deltas[0]!.change, "resolved");
  assert.equal(result.deltas[0]!.before, "requires_store_access");
  assert.equal(result.deltas[0]!.after, "pass_evidenced");

  // The bar did NOT move: without the statement anywhere, it stays unproven.
  const silent = runAuthenticatedTest({ product: mkProduct(), requirements, summary: "…", previous: publicAssertions });
  assert.equal(silent.assertions[0]!.status, "not_proven", "more access is not a lower standard of proof");

  // Chrome-shaped metafields are still not evidence.
  assert.equal(isEvidenceMetafield({ namespace: "reviews", key: "rating", type: "number_decimal" }), false);
  assert.equal(isEvidenceMetafield({ namespace: "custom", key: "review_count", type: "single_line_text_field" }), false);
  assert.equal(isEvidenceMetafield({ namespace: "custom", key: "ingredients", type: "single_line_text_field" }), true);

  // A synced policy resolves delivery the same way.
  const withPolicy = runAuthenticatedTest({
    product: mkProduct(),
    ctx: { policyText: "All orders ship within 2 business days of purchase." },
    requirements: [{ id: "d", kind: "delivery", label: "Ships in the US within a week" }],
    summary: "…",
    previous: [{ label: "Ships in the US within a week", status: "requires_store_access" as const, detail: "…", surfacesChecked: [] }],
  });
  assert.equal(withPolicy.assertions[0]!.status, "pass_evidenced");
  assert.equal(withPolicy.resolvedCount, 1);
});

test("22b. the delta classifier distinguishes resolved, improved, regressed and unchanged", () => {
  const before = [
    { label: "A", status: "requires_store_access" as const, detail: "", surfacesChecked: [] },
    { label: "B", status: "not_proven" as const, detail: "", surfacesChecked: [] },
    { label: "C", status: "pass_evidenced" as const, detail: "", surfacesChecked: [] },
    { label: "D", status: "pass_evidenced" as const, detail: "", surfacesChecked: [] },
  ];
  const after = [
    { label: "A", status: "not_proven" as const, detail: "", surfacesChecked: [] },
    { label: "B", status: "pass_evidenced" as const, detail: "", surfacesChecked: [] },
    { label: "C", status: "not_proven" as const, detail: "", surfacesChecked: [] },
    { label: "D", status: "pass_evidenced" as const, detail: "", surfacesChecked: [] },
  ];
  const d = diffAssertions(before, after);
  assert.equal(d.find((x) => x.label === "A")!.change, "resolved", "leaving requires_store_access is RESOLVED even when the answer is 'not proven'");
  assert.equal(d.find((x) => x.label === "B")!.change, "improved");
  assert.equal(d.find((x) => x.label === "C")!.change, "regressed");
  assert.equal(d.find((x) => x.label === "D")!.change, "unchanged");
});

// ---- 23. "No" closes the requirement and produces NOTHING -------------------

test("23. a claim the merchant has not confirmed produces no proposal text at all", () => {
  const catalogProduct: CatalogProduct = {
    productGid: "gid://shopify/Product/1001", title: "Cedar Bar Soap",
    description: "A cedar bar soap for daily use.",
    descriptionHtml: "<p>A cedar bar soap for daily use.</p>",
    vendor: "Acme", productType: "Bar Soap",
    onlineUrl: "https://acme.example/products/cedar-bar", seoTitle: null, seoDescription: null,
  };

  // A confirmed "yes" is the ONLY thing that yields a proposal. The generator is
  // only ever reached with one — the route refuses "no" and "unsure" outright —
  // and what it writes is a restatement of the merchant's own answer.
  const proposals = proposeClaimStatement(catalogProduct, {
    claimKey: "fragrance_free", label: "Fragrance-free / unscented", confirmationId: 42, buyerTestId: 7,
  });
  assert.equal(proposals.length, 1);
  const p = proposals[0]!;
  assert.equal(p.kind, "write_products");
  assert.equal(p.target, "descriptionHtml");
  // The proposal is built from the RAW body and is the original bytes plus ONE block.
  assert.equal(p.proposedValue, "<p>A cedar bar soap for daily use.</p>\n<p>This product is fragrance-free.</p>");
  assert.ok(p.proposedValue.startsWith(catalogProduct.descriptionHtml!), "APPENDS — never rewrites the merchant's copy");
  assert.equal(p.basedOn, catalogProduct.descriptionHtml, "the conflict baseline is the live RAW body, not the stripped view");

  // No invented benefit, no superlative, no promise.
  assert.doesNotMatch(p.proposedValue, /best|premium|luxur|perfect|guarantee|will (improve|boost|increase)/i);
  assert.match(p.rationale, /You confirmed/i, "the rationale attributes the fact to the merchant, not to us");
  assert.match(String(p.evidence.mechanism), /depends on that assistant/i, "the mechanism is hedged, never a promised outcome");

  // Already stated ⇒ nothing to change (we must not duplicate their sentence).
  assert.deepEqual(
    proposeClaimStatement({ ...catalogProduct, description: "This soap is fragrance-free already." }, {
      claimKey: "fragrance_free", label: "Fragrance-free / unscented", confirmationId: 42,
    }),
    [],
  );

  // No factual phrasing available ⇒ fail closed rather than assemble a claim.
  assert.equal(claimSentence("weird_key", "!!! ???"), null);
  assert.equal(
    proposeClaimStatement(catalogProduct, { claimKey: "weird_key", label: "!!! ???", confirmationId: 1 }).length,
    0,
  );
});

// ---- 24/25. the write path and the rerun guard ------------------------------

test("24. a confirmed-claim proposal preserves the merchant's markup byte for byte", () => {
  // The half-built seam Stage 4 left: buildProductInput could write descriptionHtml
  // but writableField() rejected it, so a description proposal could never apply.
  assert.equal(writableField("descriptionHtml"), "descriptionHtml");
  assert.equal(writableField("seo.title"), "seoTitle");
  assert.equal(writableField("jsonld:Product"), null, "copy_ready targets are still never directly written");

  // v2.1 CP2.5 — the blocker this replaces. The proposal used to be built from the
  // STRIPPED description and written into the HTML field, so applying a confirmed claim
  // destroyed every paragraph, list, bold and link, while the rationale promised it
  // "changes nothing else". The rationale is only true if this assertion holds.
  const html = [
    "<p>Cold-pressed in <b>small batches</b>.</p>",
    "<ul><li>Aluminum-free</li><li>Unscented</li></ul>",
    '<p>Free returns within 30 days. <a href="/pages/care">Care guide</a></p>',
  ].join("\n");
  const rich: CatalogProduct = {
    productGid: "gid://shopify/Product/1001", title: "Cedar Bar Soap",
    description: "Cold-pressed in small batches. Aluminum-free Unscented Free returns within 30 days. Care guide",
    descriptionHtml: html,
    vendor: "Acme", productType: "Bar Soap", onlineUrl: null, seoTitle: null, seoDescription: null,
  };

  const p = proposeClaimStatement(rich, {
    claimKey: "fragrance_free", label: "Fragrance-free / unscented", confirmationId: 1,
  })[0]!;

  // THE assertion: original bytes, untouched, plus exactly one appended block.
  assert.equal(p.proposedValue, `${html}\n<p>This product is fragrance-free.</p>`);
  assert.ok(p.proposedValue.startsWith(html), "the merchant's HTML is a byte-exact prefix of the proposal");
  for (const markup of ["<p>", "<ul>", "<li>", "<b>", '<a href="/pages/care">']) {
    assert.ok(p.proposedValue.includes(markup), `markup preserved: ${markup}`);
  }
  // Exactly ONE block was added — not a re-serialization that happens to contain the same tags.
  assert.equal(p.proposedValue.length, html.length + '\n<p>This product is fragrance-free.</p>'.length);
  assert.equal(p.proposedValue.split("<p>").length - 1, 3, "two original <p> blocks plus exactly one appended");
  // Rollback restores THIS, so the snapshot baseline must be the raw form too.
  assert.equal(p.basedOn, html);

  // A product with no body at all still gets a well-formed block, not bare text.
  assert.equal(
    proposeClaimStatement({ ...rich, description: null, descriptionHtml: null }, {
      claimKey: "fragrance_free", label: "Fragrance-free / unscented", confirmationId: 1,
    })[0]!.proposedValue,
    "<p>This product is fragrance-free.</p>",
  );

  // The "already stated" check reads the STRIPPED view on purpose: a merchant who wrote
  // the claim inside markup has still stated it, and we must not duplicate their sentence.
  assert.deepEqual(
    proposeClaimStatement({
      ...rich,
      description: "Gentle and fragrance-free.",
      descriptionHtml: "<p>Gentle and <b>fragrance-free</b>.</p>",
    }, { claimKey: "fragrance_free", label: "Fragrance-free / unscented", confirmationId: 1 }),
    [],
  );
});

test("25. a rerun is refused when the contract or the engine version differs", async () => {
  const { executeAuthenticatedRun } = await import("../src/server/buyerTests.js");
  const requirements: Requirement[] = [
    { id: "claim0", kind: "claim", claim: "fragrance_free", label: "Fragrance-free / unscented" },
  ];
  const base = {
    id: 1, shop_domain: "s.myshopify.com", product_gid: null, product_url: "https://acme.example/products/cedar-bar",
    product_title: "Cedar Bar Soap", name: null, contract: { summary: "…", requirements },
    contract_version: contractVersion(requirements), engine_version: ENGINE_VERSION,
    source: "public", origin_token: null, baseline_result: null, latest_result: null,
    created_at: "", updated_at: "",
  };

  // A contract that changed since the test was saved.
  const changedContract = await executeAuthenticatedRun("s.myshopify.com", { ...base, contract_version: "c1-deadbeef" });
  assert.ok("failed" in changedContract, "refused, not silently compared");
  assert.equal((changedContract as { status: number }).status, 409);
  assert.match((changedContract as { error: string }).error, /contract changed/i);

  // An engine whose semantics moved between the two runs.
  const changedEngine = await executeAuthenticatedRun("s.myshopify.com", { ...base, engine_version: "v0.0.1" });
  assert.ok("failed" in changedEngine, "refused, not silently compared");
  assert.equal((changedEngine as { status: number }).status, 409);
  assert.match((changedEngine as { error: string }).error, /aren't comparable/i);

  // Neither message dresses the refusal up as a result.
  for (const r of [changedContract, changedEngine]) {
    assert.match((r as { error: string }).error, /new test/i, "and it tells the merchant how to proceed honestly");
  }
});

test("matchProductByUrl joins a public product URL to the synced catalog by handle", () => {
  const products = [mkProduct(), mkProduct({ productGid: "gid://shopify/Product/2", handle: "other" })];
  assert.equal(matchProductByUrl(products, "https://acme.example/products/cedar-bar")?.handle, "cedar-bar");
  // A different storefront domain still matches — the merchant may have tested a
  // custom domain while the catalog knows the myshopify one.
  assert.equal(matchProductByUrl(products, "https://shop.acme.com/products/other?variant=9")?.handle, "other");
  assert.equal(matchProductByUrl(products, "https://acme.example/products/nope"), null);
  assert.equal(matchProductByUrl(products, "not a url"), null);
});

test("the authenticated snapshot never reads availability from a missing field", () => {
  // `available: null` means the field wasn't synced. Treating that as in-stock
  // would be a false Pass — the one unrecoverable failure mode.
  const p = mkProduct({
    variants: [{
      variantGid: "gid://shopify/ProductVariant/1", title: "Default", sku: null, barcode: null,
      price: 9, available: null, inventoryQuantity: null, options: [],
    }],
  });
  assert.equal(snapshotFromCatalog(p).variants[0]!.available, false, "unknown is not available");
});

// ---- DB-gated: 21/24/26 end-to-end persistence ------------------------------
const RUN_DB = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);

test("21b/26. a public test persists, is claimed by a shop, and re-executes as a saved regression bundle", { skip: !RUN_DB }, async () => {
  const { pgQuery } = await import("../src/db/pg.js");
  const { upsertShop } = await import("../src/db/shops.js");
  const {
    newTestToken, storePublicTest, claimPublicTest, getPublicTest, createBuyerTest,
    getBuyerTest, recordTestRun, listTestRuns, updateBuyerTestResult,
  } = await import("../src/db/buyerTests.js");

  const shop = `bt-${Date.now()}.myshopify.com`;
  const other = `bt-other-${Date.now()}.myshopify.com`;
  const token = newTestToken();
  const publicResult = {
    ok: true, task: "Find this bar soap, confirm it's fragrance-free.",
    assertions: [{ label: "Fragrance-free / unscented", status: "not_proven", detail: "…", surfacesChecked: [] }],
    deferred: [],
  };
  try {
    await upsertShop(shop, { status: "active", scopes: "read_products" });
    await upsertShop(other, { status: "active", scopes: "read_products" });

    await storePublicTest(token, "https://acme.example/products/cedar-bar", "acme.example", publicResult);
    assert.ok(await getPublicTest(token), "the public result persists across the install redirect");

    // TENANCY: another shop can never claim it.
    const claimed = await claimPublicTest(token, shop);
    assert.ok(claimed, "the installing shop claims it");
    assert.equal(await claimPublicTest(token, other), null, "a different shop is refused");
    // Re-claiming by the SAME shop is idempotent (a refresh must not break).
    assert.ok(await claimPublicTest(token, shop));

    const contract = contractFromPublicResult(publicResult);
    const cv = contractVersion(contract.requirements);
    const testId = await createBuyerTest({
      shop, productUrl: "https://acme.example/products/cedar-bar", productTitle: "Cedar Bar Soap",
      contract, contractVersion: cv, engineVersion: ENGINE_VERSION, source: "public",
      originToken: token, baselineResult: publicResult,
    });

    // The saved bundle round-trips with its pinned contract and versions.
    const row = await getBuyerTest(shop, testId);
    assert.ok(row, "the regression bundle persists");
    assert.equal(row!.contract_version, cv);
    assert.equal(row!.engine_version, ENGINE_VERSION);
    assert.equal(row!.contract.requirements.length, contract.requirements.length);
    assert.equal(await getBuyerTest(other, testId), null, "and is invisible to other tenants");

    // It re-executes, and every execution is kept as history.
    await recordTestRun({ shop, testId, mode: "public", result: publicResult, contractVersion: cv, engineVersion: ENGINE_VERSION, trigger: "public" });
    const after = { ...publicResult, assertions: [{ label: "Fragrance-free / unscented", status: "pass_evidenced", detail: "…", surfacesChecked: [] }] };
    await recordTestRun({ shop, testId, mode: "authenticated", result: after, contractVersion: cv, engineVersion: ENGINE_VERSION, trigger: "post_fix" });
    await updateBuyerTestResult(shop, testId, after);

    const runs = await listTestRuns(shop, testId);
    assert.equal(runs.length, 2, "the history list holds both runs");
    assert.equal(runs[0]!.trigger, "post_fix", "newest first");
    assert.equal((await getBuyerTest(shop, testId))!.latest_result!.assertions instanceof Array, true);
  } finally {
    await pgQuery("delete from buyer_test_runs where shop_domain=any($1::text[])", [[shop, other]]);
    await pgQuery("delete from buyer_tests where shop_domain=any($1::text[])", [[shop, other]]);
    await pgQuery("delete from public_tests where token=$1", [token]);
    await pgQuery("delete from shops where shop_domain=any($1::text[])", [[shop, other]]);
  }
});

test("23b/24b. a 'no' produces no proposal; a 'yes' produces one that applies only after approval", { skip: !RUN_DB }, async () => {
  const { pgQuery } = await import("../src/db/pg.js");
  const { upsertShop } = await import("../src/db/shops.js");
  const { createBuyerTest, recordConfirmation, latestConfirmations, linkProposalToConfirmation, listProposalsForTest } = await import("../src/db/buyerTests.js");
  const { createProposal, getProposal } = await import("../src/db/fixes.js");

  const shop = `btc-${Date.now()}.myshopify.com`;
  const requirements: Requirement[] = [
    { id: "claim0", kind: "claim", claim: "fragrance_free", label: "Fragrance-free / unscented" },
    { id: "claim1", kind: "claim", claim: "vegan", label: "Vegan" },
  ];
  try {
    await upsertShop(shop, { status: "active", scopes: "read_products,write_products" });
    const testId = await createBuyerTest({
      shop, productUrl: "https://acme.example/products/cedar-bar", productGid: "gid://shopify/Product/1001",
      contract: { summary: "…", requirements }, contractVersion: contractVersion(requirements),
      engineVersion: ENGINE_VERSION, source: "public",
    });

    // The merchant says NO to one claim and YES to the other.
    await recordConfirmation({ shop, testId, requirementId: "claim0", requirementLabel: "Fragrance-free / unscented", answer: "no" });
    await recordConfirmation({ shop, testId, requirementId: "claim1", requirementLabel: "Vegan", answer: "yes" });

    const answers = await latestConfirmations(shop, testId);
    assert.equal(answers.get("claim0")!.answer, "no", "the 'no' is recorded — it closes the requirement");
    assert.equal(answers.get("claim1")!.answer, "yes");

    // A merchant may change their mind; the LATEST answer is what counts.
    await recordConfirmation({ shop, testId, requirementId: "claim0", requirementLabel: "Fragrance-free / unscented", answer: "yes" });
    assert.equal((await latestConfirmations(shop, testId)).get("claim0")!.answer, "yes");

    // A proposal raised from the confirmed claim is auditably tied to it.
    const confirmationId = (await latestConfirmations(shop, testId)).get("claim1")!.id;
    const pid = await createProposal(shop, null, null, proposeClaimStatement(
      // `descriptionHtml` is REQUIRED for a body proposal: a row that has stripped text
      // but no raw HTML is a pre-0027 catalog row whose real body we don't hold, and
      // proposing from it would replace the merchant's whole description (v2.2 CP1).
      // This test is about the approval lifecycle, so it supplies a known body.
      { productGid: "gid://shopify/Product/1001", title: "Cedar", description: "A cedar bar.", descriptionHtml: "<p>A cedar bar.</p>", vendor: null, productType: null, onlineUrl: null, seoTitle: null, seoDescription: null },
      { claimKey: "vegan", label: "Vegan", confirmationId, buyerTestId: testId },
    )[0]!);
    await linkProposalToConfirmation(pid, confirmationId, testId);

    const stored = await getProposal(pid);
    assert.equal(stored!.status, "proposed", "it starts unapproved — nothing is written on creation");
    assert.equal(stored!.target, "descriptionHtml");
    const linked = await listProposalsForTest(shop, testId);
    assert.equal(linked.length, 1, "the proposal is discoverable from the test");
    assert.equal(Number(linked[0]!.confirmation_id), confirmationId, "and carries the confirmation that authorized it");
  } finally {
    await pgQuery("delete from fix_proposals where shop_domain=$1", [shop]);
    await pgQuery("delete from requirement_confirmations where shop_domain=$1", [shop]);
    await pgQuery("delete from buyer_tests where shop_domain=$1", [shop]);
    await pgQuery("delete from shops where shop_domain=$1", [shop]);
  }
});

// ---- 30. v3.1 CP1 — the crash in the public → install → re-run path ---------

test("30. every label the public path can render rebuilds into a requirement the evaluator can actually run", () => {
  // THE DEFECT, reproduced from the outside. `contractFromPublicResult` rebuilt the
  // contract from RENDERED LABELS with a keyword ladder whose last rung was an
  // unconditional `kind: "claim"`. Four labels the public path emits on ordinary
  // stores missed every rung — the three attribute rows and the identifiers row —
  // so each was pinned as a claim key no dictionary contains, and `evaluate` read
  // `.violating` off `undefined`. In `runAuthenticatedTest` that TypeError was
  // thrown inside a bare `.map()`, so ONE bad row destroyed the whole re-run.
  //
  // Written as "every label", not "these four", so a label added to the generator
  // without a matching reconstruction fails here rather than on a merchant.
  const LABELS = [
    "Fragrance-free / unscented",                     // claim, pretty label
    "Organic",                                        // claim, single word
    "Price under $10",                                // parametric
    "Travel option available",                        // parametric, merchant string
    "In stock and purchasable",
    "Available as a one-time purchase",
    "Delivery timing is stated",
    "Materials are stated",                           // ← threw before v3.1
    "Measurements are stated",                        // ← threw before v3.1
    "Care or use instructions are stated",            // ← threw before v3.1
    "Product identifier (GTIN or MPN) is published",  // ← threw before v3.1
  ];
  const publicResult = {
    task: "Find this cedar bar soap and confirm what it states.",
    assertions: LABELS.map((label) => ({ label, status: "not_proven" as const, detail: "…", surfacesChecked: [] })),
  };

  const contract = contractFromPublicResult(publicResult);
  assert.equal(contract.requirements.length, LABELS.length, "no row may be dropped — the merchant already saw them all");

  // The KIND round-trips, which is what makes the re-run ask the same question.
  assert.deepEqual(
    contract.requirements.map((r) => r.kind),
    ["claim", "claim", "price_under", "variant_option", "in_stock", "no_subscription",
     "delivery", "attribute", "attribute", "attribute", "identifiers"],
  );
  assert.deepEqual(
    contract.requirements.filter((r) => r.kind === "attribute").map((r) => r.attribute),
    ["materials", "dimensions", "care"],
    "the attribute KEY is recovered, not just the kind — a wrong key evaluates a different row",
  );
  assert.equal(contract.requirements.find((r) => r.kind === "claim")!.claim, "fragrance_free");

  // And the whole path survives: this is the assertion that would have thrown.
  const result = runAuthenticatedTest({
    product: mkProduct({ productType: "Bar Soap", description: "Made from 100% olive oil. Each bar is 4 oz. Care instructions: wipe clean." }),
    requirements: contract.requirements,
    summary: contract.summary,
  });
  assert.equal(result.ok, true);
  assert.equal(result.assertions.length, LABELS.length);
  assert.equal(result.assertions.filter((a) => a.status === "requires_store_access" &&
    /limitation on our side/.test(a.detail)).length, 0, "no row may degrade to the unsupported fallback");
});

test("30b. a label the engine cannot reconstruct is reported as unchecked, never as a finding and never as a crash", () => {
  // The safety net. A pinned contract is DATA: it can predate a rename, or come from
  // a standard whose vocabulary this build does not carry. The row must survive
  // (dropping it would silently shrink a contract the merchant saw, and would move
  // `contractVersion` so the rerun guard reports a drift that never happened) and it
  // must not be rendered as a verdict about the store.
  const contract = contractFromPublicResult({
    task: "t",
    assertions: [{ label: "Certified carbon-neutral shipping and packaging", status: "not_proven", detail: "…", surfacesChecked: [] }],
  });
  assert.equal(contract.requirements.length, 1);
  assert.equal(contract.requirements[0]!.kind, "unsupported");

  const result = runAuthenticatedTest({ product: mkProduct(), requirements: contract.requirements });
  assert.equal(result.ok, true, "one unknown row must not fail the run");
  const row = result.assertions[0]!;
  assert.equal(row.status, "requires_store_access", "not a pass, and not a not_proven — we did not look");
  assert.match(row.detail, /limitation on our side/, "the copy must blame us, not the store");
  assert.doesNotMatch(row.detail, /your store does not|no evidence/i);
});

test("30c. one unrunnable row costs exactly one row — it does not take the re-run down with it", () => {
  // Containment, measured rather than assumed. A hand-built contract carrying a
  // claim key that no longer exists is exactly what a database row from before a
  // rename looks like.
  const stale: Requirement[] = [
    { id: "a", kind: "claim", claim: "materials_are_stated", label: "Materials are stated" },   // the exact bad key
    { id: "b", kind: "attribute", attribute: "origin", label: "Country of origin is stated" },  // removed in v2.8 CP2
    { id: "c", kind: "in_stock", label: "In stock and purchasable" },
  ];
  const result = runAuthenticatedTest({ product: mkProduct(), requirements: stale });
  assert.equal(result.ok, true);
  assert.equal(result.assertions.length, 3, "all three rows come back");
  assert.equal(result.assertions[2]!.status, "pass_evidenced", "the healthy row is decided normally");
  for (const i of [0, 1]) {
    assert.equal(result.assertions[i]!.status, "requires_store_access");
    assert.match(result.assertions[i]!.detail, /limitation on our side/);
  }
});

test("30d. a contract pinned under an older label still round-trips — a rename must not silently break old merchants", () => {
  // A pinned contract is a database row, so it can be older than any rename. The
  // legacy set was enumerated by sweeping every historical revision of
  // productTest.ts for requirement labels, not from memory:
  //   "Ships in the US within a week"      -> delivery
  //   "Size, capacity or weight is stated" -> attribute:dimensions
  const contract = contractFromPublicResult({
    task: "t",
    assertions: [
      { label: "Ships in the US within a week", status: "not_proven", detail: "…", surfacesChecked: [] },
      { label: "Size, capacity or weight is stated", status: "not_proven", detail: "…", surfacesChecked: [] },
      { label: "Country of origin is stated", status: "not_proven", detail: "…", surfacesChecked: [] },
    ],
  });
  assert.deepEqual(contract.requirements.map((r) => r.kind), ["delivery", "attribute", "unsupported"]);
  assert.equal(contract.requirements[1]!.attribute, "dimensions");
  // `origin` is the deliberate exception: v2.8 CP2 removed the requirement, so there
  // is nothing honest to map it to. "We can no longer ask this" beats inventing a
  // verdict, and it must stay visible rather than being quietly dropped.
  assert.equal(contract.requirements[2]!.kind, "unsupported");
});
