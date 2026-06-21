import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { NormalizedProduct } from "../src/catalog/normalize.js";
import { mapCatalog, mapProduct, resolveConfig } from "../src/feeds/map.js";
import {
  isHttpUrl, isHttpsUrl, isIso8601Date, isIsoCountry, isValidGtin, parsePrice,
  statusOf, validateFeed, validateRecord,
} from "../src/feeds/validate.js";
import { computeReadiness, summarizeIssues } from "../src/feeds/readiness.js";
import { toCSV, toJSON, toJSONL, columnsFor } from "../src/feeds/export.js";
import { requiredFields, specManifest, SPEC_VERSION_CONFIRMED } from "../src/feeds/spec.js";
import type { FeedRecord } from "../src/feeds/map.js";

// A complete, valid normalized product (1 variant, all required catalog data present).
function cleanProduct(over: Partial<NormalizedProduct> = {}): NormalizedProduct {
  return {
    productGid: "gid://shopify/Product/1001",
    handle: "ceramic-pan", title: "Ceramic Fry Pan", description: "Non-toxic ceramic coating.",
    vendor: "Caraway", productType: "Cookware", tags: ["ceramic"], status: "ACTIVE",
    onlineUrl: "https://shop.example.com/products/ceramic-pan", imageUrl: "https://cdn.example.com/x.jpg",
    seoTitle: null, seoDescription: null, metafields: [],
    variants: [{ variantGid: "gid://shopify/ProductVariant/2001", title: "10\"", sku: "CP-10", barcode: "0012345678905", price: 95, available: true, inventoryQuantity: 5, options: [{ name: "Size", value: "10\"" }] }],
    collections: [],
    ...over,
  };
}

// ---- spec ------------------------------------------------------------------
test("spec exposes the required-field set + auditable provenance", () => {
  const names = requiredFields().map((f) => f.name);
  for (const r of ["item_id", "title", "description", "url", "brand", "image_url", "price", "availability", "is_eligible_search", "is_eligible_checkout", "seller_name", "seller_url", "target_countries", "store_country"]) {
    assert.ok(names.includes(r), `required missing: ${r}`);
  }
  const m = specManifest("openai");
  assert.equal(m.format, "openai");
  assert.ok(m.source.includes("developers.openai.com"));
  assert.equal(m.versionConfirmed, SPEC_VERSION_CONFIRMED);
  assert.equal(SPEC_VERSION_CONFIRMED, false); // honest: version not machine-confirmed
});

// ---- mapping ---------------------------------------------------------------
test("mapProduct emits one record per variant with derived eligibility/seller/countries", () => {
  const cfg = resolveConfig("caraway-home.myshopify.com");
  const items = mapProduct(cleanProduct(), cfg);
  assert.equal(items.length, 1);
  const r = items[0]!.record;
  assert.equal(r.item_id, "CP-10");           // SKU preferred
  assert.equal(r.price, "95.00 USD");
  assert.equal(r.availability, "in_stock");
  assert.equal(r.gtin, "0012345678905");      // valid 13-digit barcode → GTIN
  assert.equal(r.is_eligible_search, true);
  assert.equal(r.is_eligible_checkout, false);
  assert.equal(r.seller_name, "Caraway Home"); // derived from domain
  assert.deepEqual(r.target_countries, ["US"]);
  assert.equal(r.store_country, "US");
  assert.equal(r.condition, "new");
});

test("multi-variant products get group_id + variant_dict; item_id falls back to gid tail", () => {
  const p = cleanProduct({
    variants: [
      { variantGid: "gid://shopify/ProductVariant/2001", title: "S", sku: "", barcode: null, price: 10, available: true, inventoryQuantity: 1, options: [{ name: "Color", value: "Cream" }] },
      { variantGid: "gid://shopify/ProductVariant/2002", title: "L", sku: "ABC", barcode: null, price: 12, available: false, inventoryQuantity: 0, options: [{ name: "Color", value: "Navy" }] },
    ],
  });
  const items = mapProduct(p, resolveConfig("s.myshopify.com"));
  assert.equal(items.length, 2);
  assert.equal(items[0]!.record.item_id, "2001");          // no SKU → gid tail
  assert.equal(items[0]!.record.group_id, p.productGid);
  assert.deepEqual(items[0]!.record.variant_dict, { Color: "Cream" });
  assert.equal(items[0]!.record.color, "Cream");
  assert.equal(items[1]!.record.availability, "out_of_stock");
});

test("mapCatalog excludes ARCHIVED + (by default) DRAFT products", () => {
  const products = [cleanProduct({ productGid: "a", status: "ACTIVE" }), cleanProduct({ productGid: "b", status: "DRAFT" }), cleanProduct({ productGid: "c", status: "ARCHIVED" })];
  assert.equal(mapCatalog(products, resolveConfig("s.myshopify.com")).length, 1);
  assert.equal(mapCatalog(products, resolveConfig("s.myshopify.com", { includeDrafts: true })).length, 2);
});

test("mapper never fabricates: missing catalog data stays absent", () => {
  const p = cleanProduct({ vendor: null, imageUrl: null, description: null, variants: [{ variantGid: "gid://shopify/ProductVariant/9", title: null, sku: null, barcode: null, price: null, available: null, inventoryQuantity: null, options: [] }] });
  const r = mapProduct(p, resolveConfig("s.myshopify.com"))[0]!.record;
  assert.equal(r.brand, undefined);
  assert.equal(r.image_url, undefined);
  assert.equal(r.price, undefined);
  assert.equal(r.gtin, undefined);
  assert.equal(r.availability, "unknown"); // null availability → unknown enum (honest)
});

// ---- validation ------------------------------------------------------------
test("a complete record validates clean; a bare record reports missing required", () => {
  const cfg = resolveConfig("caraway-home.myshopify.com");
  const ok = mapProduct(cleanProduct(), cfg)[0]!.record;
  assert.deepEqual(validateRecord(ok), []);

  const bare: FeedRecord = { item_id: "x" };
  const issues = validateRecord(bare);
  assert.ok(issues.some((i) => i.code === "missing_required" && i.field === "title"));
  assert.ok(issues.some((i) => i.code === "missing_required" && i.field === "price"));
  assert.equal(statusOf(issues), "error");
});

test("checkout eligibility requires policy URLs + the search invariant", () => {
  const base = mapProduct(cleanProduct(), resolveConfig("s.myshopify.com", { isEligibleCheckout: true }))[0]!.record;
  const issues = validateRecord(base);
  for (const f of ["seller_privacy_policy", "seller_tos", "return_policy"]) {
    assert.ok(issues.some((i) => i.code === "missing_checkout_field" && i.field === f), `expected ${f}`);
  }
  // search=false + checkout=true → invariant error
  const bad = validateRecord({ ...base, is_eligible_search: false });
  assert.ok(bad.some((i) => i.code === "eligibility_invariant"));
});

test("validation flags enums, urls, countries, dates, gtin, and price format", () => {
  assert.ok(validateRecord({ availability: "sold_out" } as FeedRecord).some((i) => i.code === "invalid_enum" && i.field === "availability"));
  assert.ok(validateRecord({ url: "ftp://x" } as FeedRecord).some((i) => i.code === "invalid_url" && i.field === "url"));
  assert.ok(validateRecord({ image_url: "http://x.com/a.jpg" } as FeedRecord).some((i) => i.code === "insecure_url"));
  assert.ok(validateRecord({ target_countries: ["US", "ZZ"] } as FeedRecord).some((i) => i.code === "invalid_country"));
  assert.ok(validateRecord({ price: "10 dollars" } as FeedRecord).some((i) => i.code === "invalid_price"));
  assert.ok(validateRecord({ gtin: "0012345678906" } as FeedRecord).some((i) => i.code === "invalid_gtin")); // bad check digit → warning
  assert.ok(validateRecord({ availability: "pre_order" } as FeedRecord).some((i) => i.code === "missing_availability_date"));
});

test("validateFeed flags duplicate item_id across the feed", () => {
  const mk = (record: FeedRecord) => ({ productGid: "p", variantGid: null, record });
  const out = validateFeed([mk({ item_id: "DUP" }), mk({ item_id: "DUP" }), mk({ item_id: "UNIQUE" })]);
  assert.equal(out.filter((v) => v.issues.some((i) => i.code === "duplicate_item_id")).length, 2);
  assert.equal(out[2]!.issues.some((i) => i.code === "duplicate_item_id"), false);
});

// ---- format helpers --------------------------------------------------------
test("format helpers: gtin check digit, price, country, date, url", () => {
  assert.equal(isValidGtin("0012345678905"), true);
  assert.equal(isValidGtin("0012345678906"), false);
  assert.equal(isValidGtin("123"), false);
  assert.deepEqual(parsePrice("95.00 USD"), { amount: 95, currency: "USD" });
  assert.equal(parsePrice("95 USD")!.amount, 95);
  assert.equal(parsePrice("95.00"), null);
  assert.equal(isIsoCountry("us"), true);
  assert.equal(isIsoCountry("ZZ"), false);
  assert.equal(isIso8601Date("2026-07-01"), true);
  assert.equal(isIso8601Date("July 1"), false);
  assert.equal(isHttpUrl("https://a.com"), true);
  assert.equal(isHttpUrl("javascript:alert(1)"), false);
  assert.equal(isHttpsUrl("http://a.com"), false);
});

// ---- readiness -------------------------------------------------------------
test("readiness is a transparent weighted score with components", () => {
  const cfg = resolveConfig("caraway-home.myshopify.com");
  const clean = validateFeed(mapProduct(cleanProduct(), cfg));
  const r = computeReadiness(clean);
  assert.equal(r.errorCount, 0);
  assert.equal(r.itemCount, 1);
  assert.equal(r.components.find((c) => c.key === "validity")!.value, 1);
  // weights sum to 1; score is the sum of contributions (rounded)
  assert.ok(Math.abs(r.components.reduce((s, c) => s + c.weight, 0) - 1) < 1e-9);
  assert.equal(r.score, Math.round(r.components.reduce((s, c) => s + c.contribution, 0)));
  // Clean item with a valid GTIN: validity+required+identifier are full, but not every
  // recommended field is populated, so it's high yet short of 100 (~88).
  assert.equal(r.components.find((c) => c.key === "identifier")!.value, 1);
  assert.ok(r.score >= 80 && r.score < 100, `clean record scores high but < 100, got ${r.score}`);

  // A broken catalog scores much lower (errors crush validity).
  const broken = validateFeed(mapProduct(cleanProduct({ title: null, vendor: null, imageUrl: null, onlineUrl: null, variants: [{ variantGid: "v", title: null, sku: null, barcode: null, price: null, available: null, inventoryQuantity: null, options: [] }] }), cfg));
  assert.ok(computeReadiness(broken).score < r.score);
  assert.ok(Object.keys(summarizeIssues(broken)).includes("missing_required"));
});

// ---- export ----------------------------------------------------------------
test("CSV escapes delimiters/quotes/newlines; columns follow spec order", () => {
  const records: FeedRecord[] = [
    { item_id: "1", title: "Plain", target_countries: ["US", "CA"], is_eligible_search: true },
    { item_id: "2", title: 'Has "quote", comma\nand newline', target_countries: ["US"], is_eligible_search: false },
  ];
  const cols = columnsFor(records);
  assert.ok(cols.indexOf("item_id") < cols.indexOf("title")); // spec order
  const csv = toCSV(records);
  assert.ok(csv.includes('"Has ""quote"", comma\nand newline"')); // escaped cell
  assert.ok(csv.includes("US,CA")); // list joined inside one cell
  const lines = csv.trimEnd().split("\r\n");
  assert.equal(lines.length, 3); // header + 2 rows
});

test("JSON is an array; JSONL is one record per line; undefined keys dropped", () => {
  const records: FeedRecord[] = [{ item_id: "1", title: "A", brand: undefined }, { item_id: "2", title: "B" }];
  const arr = JSON.parse(toJSON(records));
  assert.equal(Array.isArray(arr), true);
  assert.equal(arr.length, 2);
  assert.equal("brand" in arr[0], false); // undefined dropped
  assert.equal(toJSONL(records).trimEnd().split("\n").length, 2);
});

// ---- DB-gated end-to-end ---------------------------------------------------
const RUN_DB = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);

test("generateFeed maps the synced catalog → versioned snapshot + readiness + export", { skip: !RUN_DB }, async () => {
  const { upsertProduct } = await import("../src/db/catalog.js");
  const { upsertFeed, getFeedVersion, getFeedRecords, listFeedVersions } = await import("../src/db/feeds.js");
  const { generateFeed, NoCatalogError } = await import("../src/feeds/generate.js");
  const { pgQuery } = await import("../src/db/pg.js");

  const shop = `feed-${Date.now()}.myshopify.com`;
  const stamp = Date.now();
  const good = cleanProduct({ productGid: `gid://shopify/Product/${stamp}1`, variants: [{ variantGid: `gid://shopify/ProductVariant/${stamp}1`, title: "10\"", sku: `SKU-${stamp}-A`, barcode: "0012345678905", price: 95, available: true, inventoryQuantity: 5, options: [{ name: "Size", value: "10\"" }] }] });
  // A product with NO variants + missing data → mapped to 1 error item (missing price/url/etc.)
  const bad: NormalizedProduct = { ...cleanProduct({ productGid: `gid://shopify/Product/${stamp}2`, title: null, vendor: null, imageUrl: null, onlineUrl: null }), variants: [] };

  try {
    // Empty catalog → NoCatalogError.
    const feedId = await upsertFeed(shop, { name: "primary", config: { targetCountries: ["US"], storeCountry: "US" } });
    await assert.rejects(generateFeed(shop, feedId), (e) => e instanceof NoCatalogError);

    await upsertProduct(shop, good);
    await upsertProduct(shop, bad);

    const r1 = await generateFeed(shop, feedId);
    assert.equal(r1.version, 1);
    assert.equal(r1.readiness.itemCount, 2);
    assert.ok(r1.readiness.errorCount >= 1); // the bad product
    assert.ok(r1.readiness.validCount >= 1); // the good product

    const v = await getFeedVersion(r1.versionId);
    assert.equal(v!.item_count, 2);
    assert.equal(Number(v!.readiness_score), r1.readiness.score);

    const records = await getFeedRecords(r1.versionId);
    assert.equal(records.length, 2);
    assert.ok(records.some((rec) => rec.item_id === `SKU-${stamp}-A`));

    // Re-generating preserves history as a new version.
    const r2 = await generateFeed(shop, feedId);
    assert.equal(r2.version, 2);
    assert.equal((await listFeedVersions(feedId)).length, 2);
  } finally {
    await pgQuery("delete from feed_items where shop_domain=$1", [shop]);
    await pgQuery("delete from feed_versions where shop_domain=$1", [shop]);
    await pgQuery("delete from feeds where shop_domain=$1", [shop]);
    for (const t of ["product_variants", "product_collections", "collections", "products"]) {
      await pgQuery(`delete from ${t} where shop_domain=$1`, [shop]);
    }
  }
});
