import type { NormalizedProduct, NormalizedVariant } from "../catalog/normalize.js";

// Pure mapping: normalized catalog → OpenAI-shaped feed records (Phase 9). One record
// per VARIANT (the OpenAI feed's per-item granularity; `group_id` ties a product's
// variants together). Deterministic + dependency-free so it's fully unit-testable at $0.
//
// NEVER FABRICATES (same discipline as Phase 6 fixes): a field is only set when the
// catalog actually has the value, or when it's a merchant DECISION supplied via config
// (currency, eligibility flags, seller identity, countries). Missing catalog data is
// left undefined so the validator can honestly flag it — we don't invent prices,
// GTINs, ratings, or policies.

export type FeedValue = string | number | boolean | string[] | Record<string, string>;

/** An OpenAI feed record. All fields optional at the type level; required-ness is
 *  enforced by the validator, not the mapper (so gaps surface as findings). */
export interface FeedRecord {
  item_id?: string;
  title?: string;
  description?: string;
  url?: string;
  brand?: string;
  image_url?: string;
  additional_image_urls?: string;
  price?: string;
  sale_price?: string;
  availability?: string;
  availability_date?: string;
  is_eligible_search?: boolean;
  is_eligible_checkout?: boolean;
  seller_name?: string;
  seller_url?: string;
  seller_privacy_policy?: string;
  seller_tos?: string;
  return_policy?: string;
  target_countries?: string[];
  store_country?: string;
  gtin?: string;
  mpn?: string;
  condition?: string;
  product_category?: string;
  group_id?: string;
  variant_dict?: Record<string, string>;
  item_group_title?: string;
  color?: string;
  size?: string;
  material?: string;
  [key: string]: FeedValue | undefined;
}

/** Merchant decisions the catalog can't supply. Sensible defaults derived from the
 *  shop domain; the merchant overrides them per feed. */
export interface FeedConfig {
  currency?: string;            // ISO 4217; catalog doesn't store shop currency yet (see limits)
  isEligibleSearch?: boolean;   // default true (visibility is the whole point)
  isEligibleCheckout?: boolean; // default false (instant checkout needs onboarding + policy URLs)
  sellerName?: string;
  sellerUrl?: string;
  sellerPrivacyPolicy?: string;
  sellerTos?: string;
  returnPolicy?: string;
  targetCountries?: string[];   // default ["US"]
  storeCountry?: string;        // default "US"
  condition?: string;           // default "new"
  includeDrafts?: boolean;      // default false — only ACTIVE products are feed-eligible
}

export interface ResolvedFeedConfig {
  currency: string;
  isEligibleSearch: boolean;
  isEligibleCheckout: boolean;
  sellerName: string;
  sellerUrl: string;
  sellerPrivacyPolicy?: string;
  sellerTos?: string;
  returnPolicy?: string;
  targetCountries: string[];
  storeCountry: string;
  condition: string;
  includeDrafts: boolean;
}

/** Derive a human seller name + canonical store URL from the *.myshopify.com domain. */
function deriveSeller(shopDomain: string): { name: string; url: string } {
  const handle = shopDomain.replace(/\.myshopify\.com$/i, "");
  const name = handle
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ") || shopDomain;
  return { name, url: `https://${shopDomain}` };
}

export function resolveConfig(shopDomain: string, config: FeedConfig = {}): ResolvedFeedConfig {
  const seller = deriveSeller(shopDomain);
  return {
    currency: (config.currency ?? "USD").toUpperCase(),
    isEligibleSearch: config.isEligibleSearch ?? true,
    isEligibleCheckout: config.isEligibleCheckout ?? false,
    sellerName: config.sellerName?.trim() || seller.name,
    sellerUrl: config.sellerUrl?.trim() || seller.url,
    sellerPrivacyPolicy: config.sellerPrivacyPolicy?.trim() || undefined,
    sellerTos: config.sellerTos?.trim() || undefined,
    returnPolicy: config.returnPolicy?.trim() || undefined,
    targetCountries: config.targetCountries?.length ? config.targetCountries.map((c) => c.trim().toUpperCase()) : ["US"],
    storeCountry: (config.storeCountry ?? "US").trim().toUpperCase(),
    condition: config.condition?.trim() || "new",
    includeDrafts: config.includeDrafts ?? false,
  };
}

/** A stable, unique-per-variant item id: the merchant SKU when present, else the
 *  numeric id parsed from the variant (or product) GID. */
function deriveItemId(product: NormalizedProduct, variant: NormalizedVariant | null): string {
  if (variant?.sku && variant.sku.trim()) return variant.sku.trim();
  const gid = variant?.variantGid ?? product.productGid;
  const tail = gid.split("/").pop();
  return tail && tail.trim() ? tail.trim() : gid;
}

const optionValue = (variant: NormalizedVariant | null, name: string): string | undefined => {
  const hit = variant?.options.find((o) => o.name.toLowerCase() === name.toLowerCase());
  return hit?.value?.trim() || undefined;
};

const metafieldValue = (product: NormalizedProduct, key: string): string | undefined => {
  const hit = product.metafields.find((m) => m.key.toLowerCase() === key.toLowerCase());
  return hit?.value?.trim() || undefined;
};

function availabilityOf(variant: NormalizedVariant | null): string {
  if (variant?.available === true) return "in_stock";
  if (variant?.available === false) return "out_of_stock";
  return "unknown";
}

/** Map one (product, variant) pair to a feed record. Pure. */
export function mapVariant(
  product: NormalizedProduct,
  variant: NormalizedVariant | null,
  cfg: ResolvedFeedConfig,
): FeedRecord {
  const multiVariant = product.variants.length > 1;
  const rec: FeedRecord = {
    item_id: deriveItemId(product, variant),
    is_eligible_search: cfg.isEligibleSearch,
    is_eligible_checkout: cfg.isEligibleCheckout,
    seller_name: cfg.sellerName,
    seller_url: cfg.sellerUrl,
    target_countries: cfg.targetCountries,
    store_country: cfg.storeCountry,
    condition: cfg.condition,
    availability: availabilityOf(variant),
  };

  // Catalog-sourced fields — only set when present (no fabrication).
  if (product.title) rec.title = product.title;
  if (product.description) rec.description = product.description;
  if (product.onlineUrl) rec.url = product.onlineUrl;
  if (product.vendor) rec.brand = product.vendor;
  if (product.imageUrl) rec.image_url = product.imageUrl;
  if (product.productType) rec.product_category = product.productType;

  if (variant?.price != null) rec.price = `${variant.price.toFixed(2)} ${cfg.currency}`;
  // barcode commonly carries the GTIN/UPC; only set when it looks like one (digits).
  if (variant?.barcode && /^\d{8,14}$/.test(variant.barcode.trim())) rec.gtin = variant.barcode.trim();

  if (multiVariant) {
    rec.group_id = product.productGid;
    if (product.title) rec.item_group_title = product.title;
    const dict: Record<string, string> = {};
    for (const o of variant?.options ?? []) if (o.name && o.value) dict[o.name] = o.value;
    if (Object.keys(dict).length) rec.variant_dict = dict;
  }

  const color = optionValue(variant, "color");
  const size = optionValue(variant, "size");
  const material = metafieldValue(product, "material");
  if (color) rec.color = color;
  if (size) rec.size = size;
  if (material) rec.material = material;

  // Conditional/checkout policy URLs (merchant-supplied).
  if (cfg.sellerPrivacyPolicy) rec.seller_privacy_policy = cfg.sellerPrivacyPolicy;
  if (cfg.sellerTos) rec.seller_tos = cfg.sellerTos;
  if (cfg.returnPolicy) rec.return_policy = cfg.returnPolicy;

  return rec;
}

export interface MappedItem {
  productGid: string;
  variantGid: string | null;
  record: FeedRecord;
}

/** Map a product to one record per variant (or a single record if it has none). */
export function mapProduct(product: NormalizedProduct, cfg: ResolvedFeedConfig): MappedItem[] {
  if (!product.variants.length) {
    return [{ productGid: product.productGid, variantGid: null, record: mapVariant(product, null, cfg) }];
  }
  return product.variants.map((v) => ({
    productGid: product.productGid,
    variantGid: v.variantGid,
    record: mapVariant(product, v, cfg),
  }));
}

/** Map a whole catalog. ARCHIVED products are always excluded; DRAFT products are
 *  excluded unless config.includeDrafts (a draft can't be surfaced/sold). */
export function mapCatalog(products: NormalizedProduct[], cfg: ResolvedFeedConfig): MappedItem[] {
  return products
    .filter((p) => {
      const status = (p.status ?? "").toUpperCase();
      if (status === "ARCHIVED") return false;
      if (status === "DRAFT" && !cfg.includeDrafts) return false;
      return true;
    })
    .flatMap((p) => mapProduct(p, cfg));
}
