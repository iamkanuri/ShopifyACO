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
