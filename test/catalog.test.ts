import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeProduct, stripHtml } from "../src/catalog/normalize.js";

// ---- pure: normalization ---------------------------------------------------
const RAW = {
  id: "gid://shopify/Product/1001",
  title: "  Ceramic Pan  ",
  handle: "ceramic-pan",
  descriptionHtml: "<p>Non-toxic <b>ceramic</b> coating.</p><script>x()</script>",
  vendor: "Caraway",
  productType: "Cookware",
  tags: ["nonstick", " ceramic "],
  status: "ACTIVE",
  onlineStoreUrl: "https://shop.example.com/products/ceramic-pan",
  seo: { title: "Ceramic Pan SEO", description: "best ceramic pan" },
  featuredImage: { url: "https://cdn/x.jpg" },
  variants: { nodes: [
    { id: "gid://shopify/ProductVariant/2001", title: "10\"", sku: "CP-10", barcode: "0001", price: "95.00", availableForSale: true, selectedOptions: [{ name: "Size", value: "10\"" }] },
    { id: null, title: "broken" }, // missing id → dropped
  ] },
  collections: { nodes: [{ id: "gid://shopify/Collection/3001", title: "Pans", handle: "pans" }] },
  metafields: { nodes: [{ namespace: "custom", key: "material", value: "ceramic", type: "single_line_text_field" }, { namespace: "", key: "x", value: "y" }] },
};

test("normalizeProduct maps + trims + strips HTML + filters bad children", () => {
  const p = normalizeProduct(RAW)!;
  assert.equal(p.productGid, "gid://shopify/Product/1001");
  assert.equal(p.title, "Ceramic Pan");
  assert.equal(p.description, "Non-toxic ceramic coating."); // script removed, tags stripped
  assert.deepEqual(p.tags, ["nonstick", "ceramic"]);
  assert.equal(p.variants.length, 1); // the id-less variant dropped
  assert.equal(p.variants[0]!.sku, "CP-10");
  assert.equal(p.variants[0]!.price, 95);
  assert.equal(p.variants[0]!.available, true);
  assert.equal(p.collections[0]!.handle, "pans");
  assert.equal(p.metafields.length, 1); // the namespace-less metafield dropped
  assert.equal(p.seoTitle, "Ceramic Pan SEO");
});

test("normalizeProduct tolerates comma-string tags and missing fields", () => {
  const p = normalizeProduct({ id: "gid://shopify/Product/9", tags: "a, b ,c" } as never)!;
  assert.deepEqual(p.tags, ["a", "b", "c"]);
  assert.equal(p.title, null);
  assert.deepEqual(p.variants, []);
});

test("normalizeProduct returns null without an id", () => {
  assert.equal(normalizeProduct({ title: "no id" } as never), null);
});

test("stripHtml handles entities and nullish", () => {
  assert.equal(stripHtml("<p>a&amp;b&nbsp;c</p>"), "a&b c");
  assert.equal(stripHtml(undefined), null);
});

// ---- DB-gated --------------------------------------------------------------
const RUN_DB = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
const dbTest = (name: string, fn: () => Promise<void>) => test(name, { skip: !RUN_DB }, fn);

dbTest("upsertProduct is deterministic and prunes removed variants", async () => {
  const { upsertProduct } = await import("../src/db/catalog.js");
  const { pgQuery } = await import("../src/db/pg.js");
  const shop = `cat-${Date.now()}.myshopify.com`;
  const base = normalizeProduct({ ...RAW, id: `gid://shopify/Product/${Date.now()}` })!;
  try {
    await upsertProduct(shop, base);
    await upsertProduct(shop, base); // idempotent
    let n = await pgQuery<{ c: string }>("select count(*)::int c from products where shop_domain=$1", [shop]);
    assert.equal(Number(n.rows[0].c), 1);
    // add a 2nd variant, then remove it → prune
    const withTwo = { ...base, variants: [...base.variants, { variantGid: base.productGid + "/v2", title: "B", sku: "B", barcode: null, price: 1, available: true, inventoryQuantity: null, options: [] }] };
    await upsertProduct(shop, withTwo);
    let v = await pgQuery<{ c: string }>("select count(*)::int c from product_variants where shop_domain=$1", [shop]);
    assert.equal(Number(v.rows[0].c), 2);
    await upsertProduct(shop, base); // back to 1 variant → 2nd pruned
    v = await pgQuery<{ c: string }>("select count(*)::int c from product_variants where shop_domain=$1", [shop]);
    assert.equal(Number(v.rows[0].c), 1);
  } finally {
    for (const t of ["product_variants", "product_collections", "collections", "products"]) {
      await pgQuery(`delete from ${t} where shop_domain=$1`, [shop]);
    }
  }
});

dbTest("getStorefrontUrl returns a live product's public URL (skips archived/empty)", async () => {
  const { upsertProduct, getStorefrontUrl } = await import("../src/db/catalog.js");
  const { pgQuery } = await import("../src/db/pg.js");
  const shop = `caturl-${Date.now()}.myshopify.com`;
  try {
    assert.equal(await getStorefrontUrl(shop), null); // nothing synced yet

    // An ARCHIVED product with a URL must not be chosen.
    const archived = normalizeProduct({ ...RAW, id: `gid://shopify/Product/${Date.now()}1`, status: "ARCHIVED", onlineStoreUrl: "https://shop.example.com/products/archived" })!;
    await upsertProduct(shop, archived);
    assert.equal(await getStorefrontUrl(shop), null);

    // An active product with a public URL is returned.
    const active = normalizeProduct({ ...RAW, id: `gid://shopify/Product/${Date.now()}2`, status: "ACTIVE", onlineStoreUrl: "https://shop.example.com/products/live" })!;
    await upsertProduct(shop, active);
    assert.equal(await getStorefrontUrl(shop), "https://shop.example.com/products/live");
  } finally {
    for (const t of ["product_variants", "product_collections", "collections", "products"]) {
      await pgQuery(`delete from ${t} where shop_domain=$1`, [shop]);
    }
  }
});

// Full mock sync — needs SHOPIFY_MODE=mock + APP_ENCRYPTION_KEY.
const RUN_SYNC = RUN_DB && process.env.SHOPIFY_MODE === "mock" && Boolean(process.env.APP_ENCRYPTION_KEY);
test("full mock catalog sync pulls + upserts 7 products (idempotent)", { skip: !RUN_SYNC }, async () => {
  const { upsertShop, storeCredentials } = await import("../src/db/shops.js");
  const { syncCatalog } = await import("../src/catalog/sync.js");
  const { countProducts } = await import("../src/db/catalog.js");
  const { pgQuery } = await import("../src/db/pg.js");
  const shop = `cat-sync-${Date.now()}.myshopify.com`;
  try {
    await upsertShop(shop, { status: "active", scopes: "read_products" });
    await storeCredentials(shop, "mock_token", "read_products");
    const r = await syncCatalog(shop);
    assert.equal(r.productsSynced, 7);
    assert.equal(await countProducts(shop), 7);
    await syncCatalog(shop); // re-sync converges
    assert.equal(await countProducts(shop), 7);
  } finally {
    for (const t of ["catalog_snapshots", "catalog_syncs", "product_variants", "product_collections", "collections", "products", "shop_credentials", "shops"]) {
      await pgQuery(`delete from ${t} where shop_domain=$1`, [shop]);
    }
  }
});
