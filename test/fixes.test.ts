import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { composeSeoTitle, proposeFixes, proposeSeoBackfill, writableField, type CatalogProduct } from "../src/fixes/propose.js";
import { buildProductInput } from "../src/fixes/source.js";
import { hasWriteScope } from "../src/fixes/apply.js";
import type { Finding } from "../src/diagnosis/diagnose.js";

const PRODUCT: CatalogProduct = {
  productGid: "gid://shopify/Product/1001",
  title: "Ceramic Sauté Pan",
  description: "A nonstick ceramic sauté pan, oven-safe to 600F.",
  vendor: "AisleLens Test Co",
  productType: "Cookware",
  onlineUrl: "https://merchant.example.com/products/ceramic-saute-pan",
  seoTitle: null,
  seoDescription: null,
  price: 129,
  currency: "USD",
};

function finding(signal: Finding["signal"], kind: Finding["kind"] = "evidence_backed"): Finding {
  return {
    kind, signal, intent: "comparison", promptText: "best pan?", engine: "openai",
    merchantBrand: "MyBrand", winningCompetitor: "GreenPan", aiAnswerSnippet: "GreenPan…",
    citations: ["https://competitor.example.com/x"], merchantGap: ["gap"], competitorAdvantage: ["adv"],
    confidenceLevel: "directional", basisN: 2, limits: "small sample",
    recommendedIntervention: "do the thing", expectedMechanism: "MAY help; mechanism not guarantee",
  };
}

// ---- pure proposal generation ---------------------------------------------
test("proposeSeoBackfill backfills empty SEO and never overwrites non-empty", () => {
  const backfills = proposeSeoBackfill(PRODUCT);
  assert.equal(backfills.length, 2);
  assert.ok(backfills.every((p) => p.kind === "write_products"));
  // The proposed title must DIFFER from the bare product title — when seo.title is unset,
  // Shopify already falls back to the product title, so proposing it verbatim would be an
  // unobservable no-op write (the App Store 2.1.4 kickback).
  assert.equal(backfills.find((p) => p.target === "seo.title")?.proposedValue, "Ceramic Sauté Pan | AisleLens Test Co");
  // With SEO already set, nothing is proposed (no clobber).
  assert.equal(proposeSeoBackfill({ ...PRODUCT, seoTitle: "x", seoDescription: "y" }).length, 0);
});

test("composeSeoTitle only composes values that visibly differ from the fallback", () => {
  // Vendor is the preferred suffix.
  assert.equal(composeSeoTitle(PRODUCT), "Ceramic Sauté Pan | AisleLens Test Co");
  // Vendor already conveyed by the title → fall through to the product type.
  assert.equal(
    composeSeoTitle({ ...PRODUCT, title: "AisleLens Test Co Ceramic Pan" }),
    "AisleLens Test Co Ceramic Pan | Cookware",
  );
  // Nothing factual to add → no proposal at all (never a placebo identical to the fallback).
  assert.equal(composeSeoTitle({ ...PRODUCT, vendor: null, productType: null }), null);
  assert.equal(composeSeoTitle({ ...PRODUCT, vendor: "Ceramic", productType: "Pan" }), null);
  // Composed value must fit the 60-char SEO budget — no truncated/ellipsized titles.
  const long = "An Exceptionally Long Handcrafted Ceramic Sauté Pan Edition";
  assert.equal(composeSeoTitle({ ...PRODUCT, title: long }), null);
  // And a proposed title never equals the bare title.
  const p = proposeSeoBackfill(PRODUCT).find((x) => x.target === "seo.title")!;
  assert.notEqual(p.proposedValue, PRODUCT.title);
});

test("proposeFixes builds factual Product JSON-LD and placeholder templates (no fabrication)", () => {
  const proposals = proposeFixes(PRODUCT, [finding("productSchema"), finding("reviews"), finding("faq")]);
  const product = proposals.find((p) => p.target === "jsonld:Product")!;
  assert.equal(product.kind, "copy_ready");
  assert.match(product.proposedValue, /"@type": "Product"/);
  assert.match(product.proposedValue, /AisleLens Test Co/); // brand from real data
  assert.equal(/YOUR_/.test(product.proposedValue), false); // factual, no placeholders
  // Never assert a currency we don't actually store (would risk wrong priceCurrency).
  assert.equal(/priceCurrency|"USD"/.test(product.proposedValue), false);

  const reviews = proposals.find((p) => p.target === "guidance:reviews")!;
  assert.match(reviews.proposedValue, /<YOUR_REVIEW_COUNT>/); // template must NOT invent numbers
  assert.ok(proposals.some((p) => p.target === "guidance:faq"));
});

test("writableField only maps the two SEO targets", () => {
  assert.equal(writableField("seo.title"), "seoTitle");
  assert.equal(writableField("seo.description"), "seoDescription");
  assert.equal(writableField("jsonld:Product"), null);
  assert.equal(writableField("guidance:reviews"), null);
});

test("buildProductInput shapes a minimal ProductInput; empty clears with null", () => {
  assert.deepEqual(buildProductInput("gid://x", "seoTitle", "T"), { id: "gid://x", seo: { title: "T" } });
  assert.deepEqual(buildProductInput("gid://x", "seoDescription", "D"), { id: "gid://x", seo: { description: "D" } });
  // Rollback to an empty original clears the override with null (not "").
  assert.deepEqual(buildProductInput("gid://x", "seoTitle", ""), { id: "gid://x", seo: { title: null } });
  assert.deepEqual(buildProductInput("gid://x", "seoDescription", ""), { id: "gid://x", seo: { description: null } });
});

test("hasWriteScope requires the granted write_products scope", () => {
  assert.equal(hasWriteScope("read_products,write_products"), true);
  assert.equal(hasWriteScope("read_products write_products"), true);
  assert.equal(hasWriteScope("read_products"), false);
  assert.equal(hasWriteScope(null), false);
  assert.equal(hasWriteScope(""), false);
});

// ---- DB-gated: full apply lifecycle (mock store writes, $0) ----------------
const RUN_DB = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
const SHOPIFY_MOCK = process.env.SHOPIFY_MODE === "mock" && Boolean(process.env.APP_ENCRYPTION_KEY);
const gate = RUN_DB && SHOPIFY_MOCK;

test("apply lifecycle: approve → conflict-checked apply → rollback (mock)", { skip: !gate }, async () => {
  const { upsertShop, storeCredentials } = await import("../src/db/shops.js");
  const { createProposal, getProposal } = await import("../src/db/fixes.js");
  const { approveProposal, applyProposal, rollbackProposal } = await import("../src/fixes/apply.js");
  const { __resetMockWrites } = await import("../src/fixes/source.js");
  const { pgQuery } = await import("../src/db/pg.js");

  const shop = `fix-${Date.now()}.myshopify.com`;
  const gid = "gid://shopify/Product/1001"; // mock reread → seoDescription "SEO desc 1"
  __resetMockWrites();
  try {
    await upsertShop(shop, { status: "active", scopes: "read_products,write_products" });
    await storeCredentials(shop, "mock_token", "read_products,write_products");

    // based_on matches the live (mock) value → no conflict on apply.
    const id = await createProposal(shop, null, null, {
      productGid: gid, kind: "write_products", target: "seo.description",
      label: "Update SEO description", currentValue: "SEO desc 1", proposedValue: "New, better SEO description",
      basedOn: "SEO desc 1", rationale: "test", evidence: {},
    });

    // Can't apply before approval.
    assert.equal((await applyProposal(shop, id, "merchant")).status, "rejected");
    assert.equal((await approveProposal(shop, id, "merchant")).ok, true);

    const applied = await applyProposal(shop, id, "merchant");
    assert.equal(applied.ok, true);
    assert.equal(applied.status, "applied");
    const afterApply = await getProposal(id);
    assert.equal(afterApply!.status, "applied");
    assert.equal((afterApply!.applied_snapshot as { before: string }).before, "SEO desc 1");
    // The post-write value the store actually holds is captured for an accurate rollback check.
    assert.equal((afterApply!.applied_snapshot as { applied: string }).applied, "New, better SEO description");
    // The synced catalog mirrors the write IMMEDIATELY (2.1.4: app data == store data), so
    // the proposals list's live value shows the applied change without waiting for a webhook.
    const mirrored = await pgQuery<{ seo_description: string | null }>(
      "select seo_description from products where shop_domain=$1 and product_gid=$2", [shop, gid]);
    assert.equal(mirrored.rows[0]?.seo_description, "New, better SEO description");

    // Rollback restores the snapshot (reread now reflects our applied value → no conflict).
    const rolled = await rollbackProposal(shop, id, "merchant");
    assert.equal(rolled.ok, true);
    assert.equal(rolled.status, "rolled_back");
    // ...and the catalog mirror follows the rollback too.
    const restored = await pgQuery<{ seo_description: string | null }>(
      "select seo_description from products where shop_domain=$1 and product_gid=$2", [shop, gid]);
    assert.equal(restored.rows[0]?.seo_description, "SEO desc 1");
  } finally {
    __resetMockWrites();
    await pgQuery("delete from fix_proposals where shop_domain=$1", [shop]);
    for (const t of ["product_variants", "product_collections", "products"]) {
      await pgQuery(`delete from ${t} where shop_domain=$1`, [shop]);
    }
    await pgQuery("delete from shop_credentials where shop_domain=$1", [shop]);
    await pgQuery("delete from shops where shop_domain=$1", [shop]);
  }
});

test("rollback compares against the post-apply value, not the raw proposal (normalization)", { skip: !gate }, async () => {
  const { upsertShop, storeCredentials } = await import("../src/db/shops.js");
  const { createProposal, updateProposal } = await import("../src/db/fixes.js");
  const { rollbackProposal } = await import("../src/fixes/apply.js");
  const { __resetMockWrites } = await import("../src/fixes/source.js");
  const { pgQuery } = await import("../src/db/pg.js");

  const shop = `fixnorm-${Date.now()}.myshopify.com`;
  const gid = "gid://shopify/Product/1001"; // mock seoDescription = "SEO desc 1"
  __resetMockWrites();
  try {
    await upsertShop(shop, { status: "active", scopes: "read_products,write_products" });
    await storeCredentials(shop, "mock_token", "read_products,write_products");
    // An applied proposal whose proposed_value DIFFERS from what the store actually holds
    // (simulating Shopify normalizing the SEO value on write). applied = the live store value.
    const id = await createProposal(shop, null, null, {
      productGid: gid, kind: "write_products", target: "seo.description", label: "x",
      currentValue: null, proposedValue: "raw value we SENT (pre-normalization)", basedOn: null, rationale: "t", evidence: {},
    });
    await updateProposal(id, { status: "applied", appliedSnapshot: { field: "seoDescription", before: null, applied: "SEO desc 1" }, markApplied: true });

    // The OLD check (compare to proposed_value) would wrongly flag a conflict here; the fix
    // compares to snap.applied (= the live value) → a clean rollback.
    const rolled = await rollbackProposal(shop, id, "merchant");
    assert.equal(rolled.ok, true, rolled.detail);
    assert.equal(rolled.status, "rolled_back");
  } finally {
    __resetMockWrites();
    await pgQuery("delete from fix_proposals where shop_domain=$1", [shop]);
    for (const t of ["product_variants", "product_collections", "products"]) {
      await pgQuery(`delete from ${t} where shop_domain=$1`, [shop]);
    }
    await pgQuery("delete from shop_credentials where shop_domain=$1", [shop]);
    await pgQuery("delete from shops where shop_domain=$1", [shop]);
  }
});

// The mutation response proves Shopify ACCEPTED the write, not that anything changed.
// A write that leaves the store's value identical (e.g. Shopify normalizing it back to
// the default — the shipped placebo bug) must NOT be reported "applied".
test("apply reports failure when the write has no observable effect", { skip: !gate }, async () => {
  const { upsertShop, storeCredentials } = await import("../src/db/shops.js");
  const { createProposal, getProposal } = await import("../src/db/fixes.js");
  const { approveProposal, applyProposal } = await import("../src/fixes/apply.js");
  const { __resetMockWrites } = await import("../src/fixes/source.js");
  const { pgQuery } = await import("../src/db/pg.js");

  const shop = `fixnoop-${Date.now()}.myshopify.com`;
  const gid = "gid://shopify/Product/1001"; // mock reread → seoDescription "SEO desc 1"
  __resetMockWrites();
  try {
    await upsertShop(shop, { status: "active", scopes: "read_products,write_products" });
    await storeCredentials(shop, "mock_token", "read_products,write_products");
    // Proposes the value the store ALREADY holds → the write is accepted but changes nothing.
    const id = await createProposal(shop, null, null, {
      productGid: gid, kind: "write_products", target: "seo.description", label: "no-op",
      currentValue: "SEO desc 1", proposedValue: "SEO desc 1", basedOn: "SEO desc 1", rationale: "t", evidence: {},
    });
    await approveProposal(shop, id, "merchant");
    const out = await applyProposal(shop, id, "merchant");
    assert.equal(out.ok, false);
    assert.equal(out.status, "failed");
    assert.match(out.detail ?? "", /no observable effect/i);
    assert.equal((await getProposal(id))!.status, "failed");
  } finally {
    __resetMockWrites();
    await pgQuery("delete from fix_proposals where shop_domain=$1", [shop]);
    for (const t of ["product_variants", "product_collections", "products"]) {
      await pgQuery(`delete from ${t} where shop_domain=$1`, [shop]);
    }
    await pgQuery("delete from shop_credentials where shop_domain=$1", [shop]);
    await pgQuery("delete from shops where shop_domain=$1", [shop]);
  }
});

// ---------------------------------------------------------------------------
// v2.1 CP2.5 — the raw-HTML body write path.
//
// The blocker these defend: `proposeClaimStatement` built its value from the STRIPPED
// plain-text description and wrote it into Shopify's HTML body, so applying a
// merchant-confirmed claim destroyed their paragraphs, lists, bold and links — while
// the proposal's own rationale promised it "appends one plain sentence and changes
// nothing else". Worse, the rollback snapshot stored the stripped value, so the write
// was NOT reversible. Neither the conflict guard nor the no-observable-effect guard
// could see it, because both sides of every comparison were already stripped.
// ---------------------------------------------------------------------------

/** A body with everything a merchant would lose: paragraphs, a list, bold, a link. */
const RICH_HTML = [
  "<p>Cold-pressed in <b>small batches</b>.</p>",
  "<ul><li>Aluminum-free</li><li>Unscented</li></ul>",
  '<p>Free returns within 30 days. <a href="/pages/care">Care guide</a></p>',
].join("\n");

test("a confirmed-claim apply preserves the merchant's markup and rolls back byte-identically", { skip: !gate }, async () => {
  const { upsertShop, storeCredentials } = await import("../src/db/shops.js");
  const { createProposal, getProposal } = await import("../src/db/fixes.js");
  const { approveProposal, applyProposal, rollbackProposal } = await import("../src/fixes/apply.js");
  const { __resetMockWrites, productUpdate, rereadProduct } = await import("../src/fixes/source.js");
  const { proposeClaimStatement } = await import("../src/fixes/propose.js");
  const { pgQuery } = await import("../src/db/pg.js");

  const shop = `fixhtml-${Date.now()}.myshopify.com`;
  const gid = "gid://shopify/Product/1001";
  __resetMockWrites();
  try {
    await upsertShop(shop, { status: "active", scopes: "read_products,write_products" });
    await storeCredentials(shop, "mock_token", "read_products,write_products");

    // Give the mock store a body worth preserving, then read it back the way the apply
    // engine will — this is the pre-write baseline the rollback must restore exactly.
    await productUpdate(shop, "mock_token", { id: gid, descriptionHtml: RICH_HTML });
    const before = await rereadProduct(shop, "mock_token", gid);
    assert.equal(before!.descriptionHtml, RICH_HTML, "the live body is raw HTML, not stripped text");

    // Build the proposal the way the route does: from the catalog product's BOTH views.
    const proposal = proposeClaimStatement({
      productGid: gid, title: before!.title, description: before!.description,
      descriptionHtml: before!.descriptionHtml, vendor: before!.vendor, productType: before!.productType,
      onlineUrl: before!.onlineUrl, seoTitle: before!.seoTitle, seoDescription: before!.seoDescription,
    }, { claimKey: "fragrance_free", label: "Fragrance-free / unscented", confirmationId: 1 })[0]!;
    const expected = `${RICH_HTML}\n<p>This product is fragrance-free.</p>`;
    assert.equal(proposal.proposedValue, expected);

    const id = await createProposal(shop, null, null, proposal);
    assert.equal((await applyProposal(shop, id, "merchant")).status, "rejected", "approval gates the write");
    assert.equal((await approveProposal(shop, id, "merchant")).ok, true);

    const applied = await applyProposal(shop, id, "merchant");
    assert.equal(applied.ok, true, applied.detail);
    assert.equal(applied.status, "applied");

    // THE assertion: the store now holds the original bytes plus exactly one block.
    const after = await rereadProduct(shop, "mock_token", gid);
    assert.equal(after!.descriptionHtml, expected);
    assert.ok(after!.descriptionHtml!.startsWith(RICH_HTML), "the merchant's HTML survived as a byte-exact prefix");
    for (const markup of ["<ul>", "<li>", "<b>", '<a href="/pages/care">']) {
      assert.ok(after!.descriptionHtml!.includes(markup), `markup preserved through the write: ${markup}`);
    }

    // The snapshot stores the RAW before-state — the only thing that makes rollback real.
    const snap = (await getProposal(id))!.applied_snapshot as { before: string; applied: string };
    assert.equal(snap.before, RICH_HTML);
    assert.equal(snap.applied, expected);

    // The catalog mirror carries both views, so Fix Studio agrees with the Shopify admin.
    const mirrored = await pgQuery<{ description_html: string | null; description: string | null }>(
      "select description_html, description from products where shop_domain=$1 and product_gid=$2", [shop, gid]);
    assert.equal(mirrored.rows[0]?.description_html, expected);
    assert.match(String(mirrored.rows[0]?.description), /fragrance-free/, "the stripped view stays in sync");

    // Rollback restores the original markup byte for byte — not flattened text.
    const rolled = await rollbackProposal(shop, id, "merchant");
    assert.equal(rolled.ok, true, rolled.detail);
    const restored = await rereadProduct(shop, "mock_token", gid);
    assert.equal(restored!.descriptionHtml, RICH_HTML, "REVERSIBLE: the original HTML is back, byte for byte");
  } finally {
    __resetMockWrites();
    await pgQuery("delete from fix_proposals where shop_domain=$1", [shop]);
    for (const t of ["product_variants", "product_collections", "products"]) {
      await pgQuery(`delete from ${t} where shop_domain=$1`, [shop]);
    }
    await pgQuery("delete from shop_credentials where shop_domain=$1", [shop]);
    await pgQuery("delete from shops where shop_domain=$1", [shop]);
  }
});

test("the descriptionHtml conflict guard ENGAGES when the merchant edits the body between proposal and apply", { skip: !gate }, async () => {
  const { upsertShop, storeCredentials } = await import("../src/db/shops.js");
  const { createProposal } = await import("../src/db/fixes.js");
  const { approveProposal, applyProposal } = await import("../src/fixes/apply.js");
  const { __resetMockWrites, productUpdate, rereadProduct } = await import("../src/fixes/source.js");
  const { pgQuery } = await import("../src/db/pg.js");

  const shop = `fixconf-${Date.now()}.myshopify.com`;
  const gid = "gid://shopify/Product/1001";
  __resetMockWrites();
  try {
    await upsertShop(shop, { status: "active", scopes: "read_products,write_products" });
    await storeCredentials(shop, "mock_token", "read_products,write_products");
    await productUpdate(shop, "mock_token", { id: gid, descriptionHtml: RICH_HTML });

    // Proposed against the body as it stood; approved by the merchant.
    const id = await createProposal(shop, null, null, {
      productGid: gid, kind: "write_products", target: "descriptionHtml", label: "State the claim",
      currentValue: RICH_HTML, proposedValue: `${RICH_HTML}\n<p>This product is fragrance-free.</p>`,
      basedOn: RICH_HTML, rationale: "t", evidence: {},
    });
    await approveProposal(shop, id, "merchant");

    // ...and THEN the merchant edits their own description in the Shopify admin.
    const merchantEdit = `${RICH_HTML}\n<p>Now made in Vermont.</p>`;
    await productUpdate(shop, "mock_token", { id: gid, descriptionHtml: merchantEdit });

    // The guard must engage. Previously both sides of this comparison were stripped
    // text, so this is the case that proves it is reading the raw body it writes.
    const out = await applyProposal(shop, id, "merchant");
    assert.equal(out.ok, false);
    assert.equal(out.status, "conflict");
    assert.equal(out.conflict, true);

    // And the merchant's newer edit is untouched — refusing means NOT clobbering.
    const live = await rereadProduct(shop, "mock_token", gid);
    assert.equal(live!.descriptionHtml, merchantEdit, "the merchant's edit was never overwritten");
  } finally {
    __resetMockWrites();
    await pgQuery("delete from fix_proposals where shop_domain=$1", [shop]);
    for (const t of ["product_variants", "product_collections", "products"]) {
      await pgQuery(`delete from ${t} where shop_domain=$1`, [shop]);
    }
    await pgQuery("delete from shop_credentials where shop_domain=$1", [shop]);
    await pgQuery("delete from shops where shop_domain=$1", [shop]);
  }
});

test("the proposals list resolves a body proposal's live value from the body, not an SEO field", { skip: !gate }, async () => {
  const { upsertShop } = await import("../src/db/shops.js");
  const { getLiveSeoFields } = await import("../src/db/fixes.js");
  const { upsertProduct } = await import("../src/db/catalog.js");
  const { pgQuery } = await import("../src/db/pg.js");

  const shop = `fixdrift-${Date.now()}.myshopify.com`;
  const gid = "gid://shopify/Product/1001";
  try {
    await upsertShop(shop, { status: "active", scopes: "read_products,write_products" });
    await upsertProduct(shop, {
      productGid: gid, handle: "h", title: "T", description: "stripped view",
      descriptionHtml: RICH_HTML, vendor: null, productType: null, tags: [], status: "ACTIVE",
      onlineUrl: null, imageUrl: null, seoTitle: "SEO title", seoDescription: "SEO description",
      metafields: [], variants: [], collections: [], nestedTruncated: false,
    });

    // Before the fix, a `descriptionHtml` proposal fell through to seo_description here —
    // so Fix Studio showed the merchant the wrong "current value" and, because an SEO field
    // never equals a body, flagged every body proposal as drifted forever.
    const live = (await getLiveSeoFields(shop, [gid])).get(gid)!;
    assert.equal(live.descriptionHtml, RICH_HTML, "the body is available to the list enrichment");
    assert.equal(live.seoDescription, "SEO description", "…and is distinct from the SEO field");
    assert.notEqual(live.descriptionHtml, live.seoDescription);
  } finally {
    for (const t of ["product_variants", "product_collections", "products"]) {
      await pgQuery(`delete from ${t} where shop_domain=$1`, [shop]);
    }
    await pgQuery("delete from shops where shop_domain=$1", [shop]);
  }
});

test("the no-observable-effect guard still fires on the raw-HTML body path", { skip: !gate }, async () => {
  const { upsertShop, storeCredentials } = await import("../src/db/shops.js");
  const { createProposal, getProposal } = await import("../src/db/fixes.js");
  const { approveProposal, applyProposal } = await import("../src/fixes/apply.js");
  const { __resetMockWrites, productUpdate } = await import("../src/fixes/source.js");
  const { pgQuery } = await import("../src/db/pg.js");

  const shop = `fixnoop-${Date.now()}.myshopify.com`;
  const gid = "gid://shopify/Product/1001";
  __resetMockWrites();
  try {
    await upsertShop(shop, { status: "active", scopes: "read_products,write_products" });
    await storeCredentials(shop, "mock_token", "read_products,write_products");
    await productUpdate(shop, "mock_token", { id: gid, descriptionHtml: RICH_HTML });

    // A write whose value equals what the store already holds. Shopify ACCEPTS it, but
    // nothing observable changed, so "applied" would be a placebo (App Store 2.1.4).
    const id = await createProposal(shop, null, null, {
      productGid: gid, kind: "write_products", target: "descriptionHtml", label: "no-op",
      currentValue: RICH_HTML, proposedValue: RICH_HTML, basedOn: RICH_HTML, rationale: "t", evidence: {},
    });
    await approveProposal(shop, id, "merchant");

    const out = await applyProposal(shop, id, "merchant");
    assert.equal(out.ok, false);
    assert.equal(out.status, "failed");
    assert.match(out.detail ?? "", /unchanged|no observable effect/i);
    assert.equal((await getProposal(id))!.status, "failed", "never recorded as applied");
  } finally {
    __resetMockWrites();
    await pgQuery("delete from fix_proposals where shop_domain=$1", [shop]);
    for (const t of ["product_variants", "product_collections", "products"]) {
      await pgQuery(`delete from ${t} where shop_domain=$1`, [shop]);
    }
    await pgQuery("delete from shop_credentials where shop_domain=$1", [shop]);
    await pgQuery("delete from shops where shop_domain=$1", [shop]);
  }
});

test("apply is refused on stale baseline (conflict) and without write scope", { skip: !gate }, async () => {
  const { upsertShop, storeCredentials } = await import("../src/db/shops.js");
  const { createProposal } = await import("../src/db/fixes.js");
  const { approveProposal, applyProposal } = await import("../src/fixes/apply.js");
  const { __resetMockWrites } = await import("../src/fixes/source.js");
  const { pgQuery } = await import("../src/db/pg.js");

  const gid = "gid://shopify/Product/1002"; // mock reread → seoDescription "SEO desc 2"
  const shopOk = `fixc-${Date.now()}.myshopify.com`;
  const shopNoScope = `fixn-${Date.now()}.myshopify.com`;
  __resetMockWrites();
  try {
    // Conflict: based_on doesn't match the live value.
    await upsertShop(shopOk, { status: "active", scopes: "read_products,write_products" });
    await storeCredentials(shopOk, "mock_token", "read_products,write_products");
    const conflictId = await createProposal(shopOk, null, null, {
      productGid: gid, kind: "write_products", target: "seo.description", label: "x",
      currentValue: "STALE", proposedValue: "new", basedOn: "STALE", rationale: "t", evidence: {},
    });
    await approveProposal(shopOk, conflictId, "merchant");
    const conflict = await applyProposal(shopOk, conflictId, "merchant");
    assert.equal(conflict.status, "conflict");
    assert.equal(conflict.conflict, true);

    // Scope gate: same proposal shape, but the shop lacks write_products.
    await upsertShop(shopNoScope, { status: "active", scopes: "read_products" });
    await storeCredentials(shopNoScope, "mock_token", "read_products");
    const scopeId = await createProposal(shopNoScope, null, null, {
      productGid: gid, kind: "write_products", target: "seo.description", label: "x",
      currentValue: "SEO desc 2", proposedValue: "new", basedOn: "SEO desc 2", rationale: "t", evidence: {},
    });
    await approveProposal(shopNoScope, scopeId, "merchant");
    const denied = await applyProposal(shopNoScope, scopeId, "merchant");
    assert.equal(denied.ok, false);
    assert.match(denied.detail ?? "", /scope/i);
  } finally {
    __resetMockWrites();
    for (const s of [shopOk, shopNoScope]) {
      await pgQuery("delete from fix_proposals where shop_domain=$1", [s]);
      await pgQuery("delete from shop_credentials where shop_domain=$1", [s]);
      await pgQuery("delete from shops where shop_domain=$1", [s]);
    }
  }
});
