import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { proposeFixes, proposeSeoBackfill, writableField, type CatalogProduct } from "../src/fixes/propose.js";
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
  assert.equal(backfills.find((p) => p.target === "seo.title")?.proposedValue, "Ceramic Sauté Pan");
  // With SEO already set, nothing is proposed (no clobber).
  assert.equal(proposeSeoBackfill({ ...PRODUCT, seoTitle: "x", seoDescription: "y" }).length, 0);
});

test("proposeFixes builds factual Product JSON-LD and placeholder templates (no fabrication)", () => {
  const proposals = proposeFixes(PRODUCT, [finding("productSchema"), finding("reviews"), finding("faq")]);
  const product = proposals.find((p) => p.target === "jsonld:Product")!;
  assert.equal(product.kind, "copy_ready");
  assert.match(product.proposedValue, /"@type": "Product"/);
  assert.match(product.proposedValue, /AisleLens Test Co/); // brand from real data
  assert.equal(/YOUR_/.test(product.proposedValue), false); // factual, no placeholders

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

test("buildProductInput shapes a minimal ProductInput", () => {
  assert.deepEqual(buildProductInput("gid://x", "seoTitle", "T"), { id: "gid://x", seo: { title: "T" } });
  assert.deepEqual(buildProductInput("gid://x", "seoDescription", "D"), { id: "gid://x", seo: { description: "D" } });
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

    // Rollback restores the snapshot (reread now reflects our applied value → no conflict).
    const rolled = await rollbackProposal(shop, id, "merchant");
    assert.equal(rolled.ok, true);
    assert.equal(rolled.status, "rolled_back");
  } finally {
    __resetMockWrites();
    await pgQuery("delete from fix_proposals where shop_domain=$1", [shop]);
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
