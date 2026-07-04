import type { CrawledPage } from "../crawler/crawl.js";
import { detectInjection } from "../crawler/sanitize.js";

// ===========================================================================
// MerchantFacts (tier 2a) — PURE: CrawledPage[] → typed, sourced facts about the MERCHANT's own
// store, for filling the paid artifacts with REAL data instead of [placeholders]. No I/O.
//
// THE TWO-CLASS RULE (the honesty spine):
//   • Structured facts  — typed values from PDP Product JSON-LD only (price/currency/rating/
//     reviewCount/availability/schema-presence/GTIN). These RECONCILE (ranges, counts).
//   • Stated claims     — verbatim merchant copy from page text (headings/meta/FAQ). These NEVER
//     reconcile — they ATTRIBUTE: a ≤200-char quote pinned to its own URL. No synthesized "your
//     materials" attribute can exist because extract.ts has no materials field.
// A stated claim never promotes to a structured fact; a structured fact is never invented from prose.
// ===========================================================================

export interface FactSource {
  url: string; // the crawler's vetted finalUrl — NEVER a URL found in page text
  fetchedAt: string;
  via: "json-ld" | "page-text";
}

export interface PriceFacts {
  currency: string;
  min: number; // EVERYDAY/regular-price range when basis="regular"; current prices when "as_listed"
  max: number; // min === max when only one product priced
  productCount: number;
  currencyConflict: boolean;
  /** "regular" = we had Shopify compare_at data (sale-aware; the range is everyday prices, not sale
   *  prices). "as_listed" = only current prices were available (a fallback discovery path with no
   *  products.json), so an undetected sale could sit in the range — phrased honestly as "prices". */
  basis: "regular" | "as_listed";
  onSaleCount: number; // how many priced products were on sale when crawled
  sources: FactSource[];
}

/** One Shopify variant's pricing. `compareAt` is set ONLY when it exceeds `price` (a genuine markdown). */
export interface DiscoveredVariant {
  price: number | null;
  compareAt: number | null;
}

/** Per-PDP price data captured at DISCOVERY from Shopify /products.json — the only source that carries
 *  BOTH the current price and the `compare_at_price` regular price (the PDP JSON-LD carries only the
 *  live/sale price). Carries ALL variants so buildMerchantFacts can pick the variant whose price matches
 *  the PDP's DISPLAYED price — keeping the price AND the sale flag on the SAME variant the shopper sees
 *  (a product can have some variants on sale and others not). Lets the facts range on EVERYDAY prices. */
export interface DiscoveredProduct {
  url: string;
  variants: DiscoveredVariant[]; // products.json order; variants[0] is the fallback representative
}

export interface RatingExemplar {
  productName: string | null;
  rating: number;
  reviewCount: number | null;
  source: FactSource;
}

export interface RatingFacts {
  productsWithRating: number;
  productsChecked: number;
  min: number;
  max: number;
  top: RatingExemplar | null; // highest reviewCount — the citable flagship
}

export interface StatedClaim {
  kind: "shipping" | "returns" | "materials" | "guarantee" | "awards" | "other";
  text: string; // verbatim, ≤200 chars, URLs stripped, injection-clean
  source: FactSource; // via: "page-text"
}

export interface PdpSnapshot {
  name: string | null;
  url: string;
  price: number | null; // current price (what's charged now; may be a sale price)
  compareAtPrice: number | null; // the "was"/regular price when on sale (from products.json), else null
  onSale: boolean; // compareAtPrice != null && compareAtPrice > price
  currency: string | null;
  availability: string | null;
  rating: number | null;
  reviewCount: number | null;
  fetchedAt: string;
}

export interface FactConflict {
  field: string;
  kept: string;
  keptFrom: string;
  dropped: string;
  droppedFrom: string;
  rule: string;
}

export interface MerchantFacts {
  brand: string;
  storeUrl: string;
  crawledAt: string; // YYYY-MM-DD — used in every provenance tag
  coverage: { pagesAttempted: number; pagesOk: number; pdpCount: number };
  price: PriceFacts | null;
  ratings: RatingFacts | null;
  inStock: { count: number; of: number } | null;
  schemaPresence: { productSchema: number; shipping: number; returns: number; gtin: number; of: number };
  products: PdpSnapshot[]; // ≤ 8
  stated: StatedClaim[]; // ≤ 12, injection-clean by construction (R6/B2)
  conflicts: FactConflict[];
  excluded: { injectionFlaggedPages: number; droppedStrings: number; terms: string[]; nonProducts: string[]; unresolved: string[] };
}

const MAX_STATED = 12;
const MAX_PRODUCTS = 8;
const STATED_MAX_LEN = 200;
const NAME_MAX_LEN = 120;

const today = (): string => new Date().toISOString().slice(0, 10);
const stripUrls = (s: string) => s.replace(/https?:\/\/\S+/gi, "").replace(/\bwww\.\S+/gi, "").replace(/\s+/g, " ").trim();

const cp = (code: number): string => (code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "");
/** Decode HTML entities so quoted claims read cleanly ("FREE shipping &amp; returns" → "…& returns").
 *  metaDescription is extracted raw (unlike headings/FAQs, which are htmlToText'd), so entities leak
 *  into stated claims without this. Decoding BEFORE the injection scan also catches entity-encoded
 *  injection cues (&#105;gnore…). &amp; is decoded LAST to avoid re-forming a following entity. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => cp(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => cp(parseInt(d, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&(?:apos|rsquo|lsquo|#8217|#8216);/gi, "'")
    .replace(/&(?:quot|rdquo|ldquo|#8220|#8221);/gi, '"')
    .replace(/&(?:mdash|#8212);/gi, "—").replace(/&(?:ndash|#8211);/gi, "–")
    .replace(/&(?:hellip|#8230);/gi, "…")
    .replace(/&trade;/gi, "™").replace(/&reg;/gi, "®").replace(/&copy;/gi, "©").replace(/&deg;/gi, "°")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

/** A single untrusted string entering MerchantFacts: entity-decode, injection-screen (drop if
 *  flagged), URL-strip, length-cap. Returns null when dropped (caller counts it in `excluded`). B2. */
function cleanString(raw: string | null | undefined, maxLen: number, dropped: { n: number; terms: string[] }): string | null {
  if (!raw) return null;
  const decoded = decodeEntities(raw);
  const scan = detectInjection(decoded);
  if (scan.flagged) { dropped.n += 1; dropped.terms.push(...scan.terms); return null; }
  const cleaned = stripUrls(decoded).slice(0, maxLen).trim();
  return cleaned.length >= 2 ? cleaned : null;
}

// A store's /products list mixes real products with add-on SKUs — gift cards, warranties, shipping/
// returns "protection", insurance, donations, samples. These are NOT products and MUST NOT enter the
// price range, rating range, or product counts (a merchant page reading "prices from $0" is a real
// harm). Matched on the handle/URL slug (segment-bounded so "returns-coverage" hits but a normal
// product name doesn't). Live-verified against Allbirds' free-returns-coverage (type=return,package_protection).
const NON_PRODUCT_PATTERNS =
  /(?:^|[/_-])(?:gift-?cards?|e-?gift|returns?-(?:coverage|protection|insurance)|package-?protection|shipping-(?:protection|insurance|coverage)|route-?(?:protection|insurance)|order-?protection|worry-?free|warranty|protection-plan|insurance|donations?|donate|gift-?wrap(?:ping)?|samples?|swatch(?:es)?|carbon-(?:offset|removal|credit))(?:[/_-]|$)/i;

/** True if a handle/URL slug names a non-product add-on (gift card, warranty, shipping/returns
 *  protection, …). Shared with seed discovery so we don't even spend a crawl slot on one. */
export function isNonProductRef(handleOrUrl: string): boolean {
  const slug = handleOrUrl.replace(/^https?:\/\/[^/]+/i, "").split(/[?#]/)[0] ?? handleOrUrl;
  return NON_PRODUCT_PATTERNS.test(slug);
}

/** A page that returned 200 with Product JSON-LD but does NOT resolve to a live PDP — a soft-404 /
 *  error page served at 200 (its "price" would come from a recommendation carousel or a stale cache).
 *  A real Shopify PDP canonicals to `/products/…`; a soft-404 canonicals to `/404` (or home/collection)
 *  or titles "Page Not Found". Such a page must NEVER become a fact. Hard 404s are already dropped
 *  upstream (non-2xx → ok:false); this closes the 200-soft-404 hole (browser-check finding, 2026-07-04). */
function looksUnresolved(p: CrawledPage): boolean {
  const canon = p.extracted?.canonicalUrl || p.canonicalUrl;
  if (canon) {
    try {
      const path = new URL(canon, p.finalUrl || p.url).pathname;
      if (!/^\/products\//i.test(path)) return true; // canonical points off-product (e.g. /404, /, /collections)
    } catch { /* unparseable canonical — fall through to the title check */ }
  }
  const title = p.extracted?.title || p.title || "";
  return /page not found|nothing to see here|doesn.?t exist|\b404\b/i.test(title);
}

/** Whether a crawled PDP is a non-product to exclude from all facts: a non-product slug, OR a
 *  nameless $0 entry (an add-on placeholder — real products have a name and a price). Never drops a
 *  real product merely for being cheap (a $4 sock is a product; a $0 nameless "coverage" SKU is not). */
function isNonProductPage(p: CrawledPage): boolean {
  const url = p.finalUrl || p.url;
  if (isNonProductRef(url)) return true;
  const prod = p.extracted?.product;
  if (!prod) return false;
  const noName = !prod.name || String(prod.name).trim().length < 2;
  const price = prod.offer?.price;
  return noName && (price == null || price === 0);
}

// Section/nav/review headings are chrome, not merchant claims. A PDP's h1/h2 is often the product
// NAME or a "Reviews for …" label; promoting those as "materials"/"shipping" claims (because the name
// contains "wool"/"leather") pads the fact list with junk. Meta descriptions + FAQ answers are real
// claim text and skip this filter.
const CHROME_HEADING_PATTERNS =
  /^\s*(?:reviews?|ratings?|customer reviews?|reviews for\b|write a review|you (?:may|might) (?:also )?like|related(?: products)?|recently viewed|frequently bought|more from|shop(?: all| now| the)?\b|home|menu|cart|account|search|newsletter|sign up|subscribe|follow us|share|size (?:guide|chart)|as (?:seen|featured) in|quick view|add to (?:cart|bag))/i;

const CLAIM_KINDS: Array<[StatedClaim["kind"], RegExp]> = [
  ["shipping", /\b(free shipping|ships? free|fast shipping|shipping|delivery|deliver)\b/i],
  ["returns", /\b(returns?|refund|money[- ]back|exchange)\b/i],
  ["guarantee", /\b(guarantee|warranty|lifetime|risk[- ]free|satisfaction)\b/i],
  ["awards", /\b(award|voted|editor'?s? (pick|choice)|as seen in|featured in|#1|best of)\b/i],
  ["materials", /\b(material|leather|cotton|wool|silk|cashmere|ceramic|stainless|organic|hand[- ]?(made|crafted)|pfas|ptfe|bpa)\b/i],
];
function classifyClaim(text: string): StatedClaim["kind"] {
  for (const [kind, re] of CLAIM_KINDS) if (re.test(text)) return kind;
  return "other";
}

const canonical = (p: CrawledPage): string => p.extracted?.canonicalUrl || p.finalUrl || p.url;
const normUrl = (u: string): string => (u || "").split(/[?#]/)[0]!.replace(/\/+$/, "").toLowerCase();

/** Build MerchantFacts from crawled pages. Pure, deterministic. Enforces R1–R8 + B2. `discovered`
 *  carries per-PDP price + compare_at from products.json so the price range uses EVERYDAY prices
 *  (not sale prices); omit it (fallback discovery paths) → the range is current prices, "as_listed". */
export function buildMerchantFacts(pages: CrawledPage[], brand: string, storeUrl: string, discovered: DiscoveredProduct[] = []): MerchantFacts {
  const crawledAt = today();
  const discMap = new Map(discovered.map((d) => [normUrl(d.url), d]));
  const dropped = { n: 0, terms: [] as string[] };
  const okPages = pages.filter((p) => p.ok && p.extracted);
  const flaggedPages = okPages.filter((p) => p.injection.flagged).length;

  // ---- PDP snapshots (structured facts, from Product JSON-LD only) --------------------------------
  // Dedupe by canonical URL (R2). R6: from an injection-flagged page keep NUMBERS, drop every STRING.
  // Non-product add-ons (gift cards / warranties / shipping-returns "protection") are excluded FIRST so
  // they never pollute the price/rating ranges or the product counts (recorded in `excluded`).
  const byCanonical = new Map<string, CrawledPage>();
  const nonProducts: string[] = [];
  const unresolved: string[] = [];
  for (const p of okPages) {
    if (!p.extracted!.hasProductSchema) continue;
    const u = p.finalUrl || p.url;
    if (looksUnresolved(p)) { // a soft-404 / non-PDP served at 200 — never a fact
      if (!unresolved.includes(u)) unresolved.push(u);
      continue;
    }
    if (isNonProductPage(p)) {
      if (!nonProducts.includes(u)) nonProducts.push(u);
      continue;
    }
    const key = canonical(p);
    if (!byCanonical.has(key)) byCanonical.set(key, p);
  }
  const conflicts: FactConflict[] = [];
  const products: PdpSnapshot[] = [];
  for (const p of [...byCanonical.values()].slice(0, MAX_PRODUCTS)) {
    const ex = p.extracted!;
    const prod = ex.product!;
    const flagged = p.injection.flagged;
    const url = p.finalUrl || p.url;
    // products.json (when present) is the authoritative price source: it alone carries compare_at.
    // The PDP JSON-LD carries only the live/sale price, so a "$4" final-sale sock would be extracted
    // as the merchant's price without this. Pick the variant whose price matches the PDP's DISPLAYED
    // price (the JSON-LD offer) so the price AND the sale flag are for the SAME variant the shopper
    // sees — never a $10 sale variant's price under a $20 regular variant's (missing) flag, and vice
    // versa. Falls back to variant[0] when the displayed price isn't in the list.
    const disc = discMap.get(normUrl(url));
    const jsonLdPrice = prod.offer?.price ?? null;
    let current = jsonLdPrice;
    let compareAt: number | null = null;
    if (disc && disc.variants.length) {
      const match = (jsonLdPrice != null && disc.variants.find((v) => v.price === jsonLdPrice)) || disc.variants[0]!;
      current = match.price ?? jsonLdPrice;
      compareAt = match.compareAt;
    }
    const onSale = compareAt != null && current != null && compareAt > current;
    products.push({
      // strings only from non-flagged pages, and each still injection-screened (R6/B2)
      name: flagged ? null : cleanString(prod.name, NAME_MAX_LEN, dropped),
      url,
      price: current,
      compareAtPrice: compareAt,
      onSale,
      currency: prod.offer?.currency ?? null,
      availability: prod.offer?.availability ?? null,
      rating: prod.rating ?? null,
      reviewCount: prod.reviewCount != null && prod.reviewCount > 0 ? prod.reviewCount : null,
      fetchedAt: crawledAt,
    });
  }

  // ---- Price facts: modal currency (R4), range only, never averaged/summed (R3). Range on EVERYDAY
  //      prices — compare_at when on sale (R: a temporary sale must not become the merchant's headline
  //      price). "regular" basis only when we had compare_at capability for every priced product. -----
  let price: PriceFacts | null = null;
  const priced = products.filter((p) => p.price != null && p.price > 0 && p.currency);
  if (priced.length > 0) {
    const currencyCounts = new Map<string, number>();
    for (const p of priced) currencyCounts.set(p.currency!, (currencyCounts.get(p.currency!) ?? 0) + 1);
    const modal = [...currencyCounts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    const inModal = priced.filter((p) => p.currency === modal);
    // Sale-aware only if products.json gave us a price for every priced product (else an undetected
    // sale could hide in the range → be honest and label the range "as_listed").
    const haveSaleData = discovered.length > 0 && inModal.every((p) => (discMap.get(normUrl(p.url))?.variants.length ?? 0) > 0);
    const basis: "regular" | "as_listed" = haveSaleData ? "regular" : "as_listed";
    const everydayOf = (p: PdpSnapshot) => (basis === "regular" && p.onSale && p.compareAtPrice != null ? p.compareAtPrice : p.price!);
    const values = inModal.map(everydayOf);
    price = {
      currency: modal,
      min: Math.min(...values),
      max: Math.max(...values),
      productCount: inModal.length,
      currencyConflict: currencyCounts.size > 1,
      basis,
      onSaleCount: inModal.filter((p) => p.onSale).length,
      sources: inModal.map((p) => ({ url: p.url, fetchedAt: p.fetchedAt, via: "json-ld" as const })),
    };
  }

  // ---- Rating facts: range + one exemplar (highest reviewCount). NO synthetic averages (R3) ------
  let ratings: RatingFacts | null = null;
  const rated = products.filter((p) => p.rating != null);
  if (rated.length > 0) {
    const values = rated.map((p) => p.rating!);
    const withReviews = rated.filter((p) => p.reviewCount != null);
    const flagship = (withReviews.length ? withReviews : rated)
      .slice()
      .sort((a, b) => (b.reviewCount ?? 0) - (a.reviewCount ?? 0))[0]!;
    ratings = {
      productsWithRating: rated.length,
      productsChecked: products.length,
      min: Math.min(...values),
      max: Math.max(...values),
      top: {
        productName: flagship.name,
        rating: flagship.rating!,
        reviewCount: flagship.reviewCount,
        source: { url: flagship.url, fetchedAt: flagship.fetchedAt, via: "json-ld" },
      },
    };
  }

  // ---- Availability + schema-presence (PRESENCE facts only — R5) ---------------------------------
  const withAvail = products.filter((p) => p.availability);
  const inStock = withAvail.length
    ? { count: withAvail.filter((p) => /InStock/i.test(p.availability!)).length, of: withAvail.length }
    : null;

  const pdpPages = [...byCanonical.values()];
  const schemaPresence = {
    productSchema: pdpPages.filter((p) => p.extracted!.signals.productSchema).length,
    shipping: pdpPages.filter((p) => p.extracted!.signals.shipping).length,
    returns: pdpPages.filter((p) => p.extracted!.signals.returns).length,
    gtin: pdpPages.filter((p) => p.extracted!.signals.gtin).length,
    of: pdpPages.length,
  };

  // ---- Stated claims: verbatim merchant copy, attributed (never reconciled). Skip flagged pages. -
  const stated: StatedClaim[] = [];
  const seenClaims = new Set<string>();
  for (const p of okPages) {
    if (p.injection.flagged) continue; // R6: no words from a flagged page
    const ex = p.extracted!;
    const url = p.finalUrl || p.url;
    const src: FactSource = { url, fetchedAt: crawledAt, via: "page-text" };
    const productName = (ex.product?.name ?? "").trim().toLowerCase();
    // meta + FAQ answers are claim text; h1/h2 are headings that must clear the chrome/name filter.
    const candidates: Array<{ raw: string | null; heading: boolean }> = [
      { raw: ex.metaDescription, heading: false },
      ...ex.headings.h1.map((h) => ({ raw: h, heading: true })),
      ...ex.headings.h2.map((h) => ({ raw: h, heading: true })),
      ...ex.faqs.map((f) => ({ raw: f.a, heading: false })),
    ];
    for (const cand of candidates) {
      if (stated.length >= MAX_STATED) break;
      const text = cleanString(cand.raw, STATED_MAX_LEN, dropped);
      if (!text) continue;
      if (cand.heading) {
        if (CHROME_HEADING_PATTERNS.test(text)) continue; // review/section/nav chrome, not a claim
        const lc = text.toLowerCase();
        if (productName && (lc === productName || productName.includes(lc) || lc.includes(productName))) continue; // the product NAME, not a claim
      }
      const kind = classifyClaim(text);
      if (kind === "other") continue; // only keep claims that map to a real category (signal, not chrome)
      const dedupeKey = text.toLowerCase();
      if (seenClaims.has(dedupeKey)) continue;
      seenClaims.add(dedupeKey);
      stated.push({ kind, text, source: src });
    }
  }

  return {
    brand,
    storeUrl,
    crawledAt,
    coverage: { pagesAttempted: pages.length, pagesOk: okPages.length, pdpCount: byCanonical.size },
    price,
    ratings,
    inStock,
    schemaPresence,
    products,
    stated,
    conflicts,
    excluded: { injectionFlaggedPages: flaggedPages, droppedStrings: dropped.n, terms: [...new Set(dropped.terms)], nonProducts, unresolved },
  };
}
