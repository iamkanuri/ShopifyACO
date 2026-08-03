import { htmlToText } from "./sanitize.js";

// ===========================================================================
// Structured extraction from an (untrusted) HTML page. Pure + dependency-free so
// it's fully unit-testable and reused by every agentic-readiness adapter (Phase 9).
//
// We extract the signals AI shopping assistants and their retrieval layers care
// about: Product/Offer JSON-LD, identifiers (GTIN/MPN/SKU/brand), price &
// availability, shipping & returns policy, ratings & review counts, headings &
// FAQ schema, and canonical/index signals. Absence is as meaningful as presence
// (a missing review count is a real, fixable gap), so every field is explicitly
// nullable and we record what we DID and DID NOT find.
// ===========================================================================

export interface OfferInfo {
  price: number | null;
  currency: string | null;
  availability: string | null; // e.g. InStock / OutOfStock
  hasShippingDetails: boolean;
  hasReturnPolicy: boolean;
}

export interface ProductInfo {
  name: string | null;
  brand: string | null;
  sku: string | null;
  gtin: string | null;
  mpn: string | null;
  offer: OfferInfo | null;
  rating: number | null;
  reviewCount: number | null;
}

export interface ExtractedPage {
  jsonLdTypes: string[];
  hasProductSchema: boolean;
  product: ProductInfo | null;
  title: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  robotsIndex: boolean | null; // null = unknown; false = noindex present
  headings: { h1: string[]; h2: string[] };
  faqs: Array<{ q: string; a: string }>;
  /** Quick presence booleans the diagnosis layer diffs across pages. */
  signals: {
    jsonLd: boolean;
    productSchema: boolean;
    offer: boolean;
    price: boolean;
    availability: boolean;
    gtin: boolean;
    mpn: boolean;
    sku: boolean;
    brand: boolean;
    rating: boolean;
    reviews: boolean;
    shipping: boolean;
    returns: boolean;
    faq: boolean;
    canonical: boolean;
    indexable: boolean;
  };
}

const MAX_JSONLD_BYTES = 512_000; // never JSON.parse an unbounded blob

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = typeof v === "string" ? Number(v.replace(/[^0-9.\-]/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

/** Parse every <script type="application/ld+json"> block into JS objects, safely
 *  (size-capped, try/catch). Flattens @graph. Returns a flat node list. */
export function extractJsonLd(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const blob = (m[1] ?? "").trim();
    if (!blob || blob.length > MAX_JSONLD_BYTES) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(blob);
    } catch {
      continue; // malformed JSON-LD is ignored, never executed
    }
    for (const node of flattenLd(parsed)) out.push(node);
  }
  return out;
}

function flattenLd(node: unknown): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  const visit = (n: unknown) => {
    if (Array.isArray(n)) {
      n.forEach(visit);
    } else if (n && typeof n === "object") {
      const obj = n as Record<string, unknown>;
      if (Array.isArray(obj["@graph"])) (obj["@graph"] as unknown[]).forEach(visit);
      result.push(obj);
    }
  };
  visit(node);
  return result;
}

function typesOf(node: Record<string, unknown>): string[] {
  const t = node["@type"];
  return arr(t).map((x) => String(x)).filter(Boolean);
}
const isType = (node: Record<string, unknown>, name: string) => typesOf(node).some((t) => t.toLowerCase() === name.toLowerCase());

/**
 * ⛔ v4.5 — TOMBSTONE: "TAKE THE MINIMUM OVER ALL OFFERS" WAS BUILT, MEASURED, AND
 * REVERTED. Do not rebuild it without first hardening `num()`. (ENGINE_GAPS P-19)
 *
 * The intent was right and is still right: an offers ARRAY has no ordering semantics in
 * schema.org, so reading the FIRST object means `templecoffee.com` reports $29.50 against
 * a true minimum of $23.00 for a row whose whole promise is the word "lowest". The
 * implementation — `Math.min` over every readable price on every offer — corrected exactly
 * 2 real stores and opened seven regression classes on chosen input.
 *
 * ⚠️ THE CAUSE IS `num()` ABOVE, NOT THE MINIMUM. It strips to `[0-9.\-]` and accepts
 * anything finite, and `Number("") === 0`. While only ONE offer was ever read, a junk
 * price field produced a lone bad answer. Under a minimum it produces a `0` that BEATS a
 * genuinely published price. Executed by an independent verifier against a product
 * publishing a real `45.00` beside one hostile sibling offer — 11 of 12 values regressed:
 *
 *     ""  "   "  "Sold out"  "Free with any order"  "Contact us"  "N/A"  "TBD"
 *     "$"  "USD"  "0.00"   ->  offer price 45 becomes 0
 *     "-5.00"                 ->  becomes -5, and renders "$-5.00"
 *
 * `priceToUsd` on the VARIANT path refuses all twelve — v3.9 CP-4 hardened it to
 * `/^\d+(\.\d+)?$/` for precisely this reason. `num()` is its unhardened sibling, so this
 * change re-opened, on the offer surface, the defect family v3.9 had closed on the variant
 * surface. The frozen corpus could not see it: `mm-17` and `znn-05` put the hostile string
 * in `json_tier.variants`, where it is already closed, and no case puts one in an offers
 * array beside a real price. "0 newly opened" was a statement about where the cases live.
 *
 * ⚠️ AND IT TURNED THE OTHER HALF OF THIS COMMIT AGAINST ITSELF. `zeroAwareMin` refuses
 * when every readable price is zero, and its safety argument is that no real store has a
 * zero minimum beside a non-zero price. That was measured on the VARIANT array. This
 * change manufactured exactly that condition on the OFFER path — which supplies the price
 * for 226 of 397 captured pages, because `pageSufficient` skips the variant tier — so a
 * product publishing $45 beside one junk offer stopped reporting a price at all.
 *
 * ⚠️ AND AN UNMEASURED CONSUMER MOVED ON REAL BYTES. `src/artifacts/merchantFacts.ts`
 * joins the catalog variant whose price matches the JSON-LD offer, by its own comment, so
 * that the price and the sale flag describe the variant the shopper actually SEES. A
 * minimum is not the displayed price, so that join's stated invariant became false by
 * construction, and the published price range in `llms.txt` moved with it.
 *
 * A 335-store replay reported this change clean, with 2 stores corrected and 0 other-kind
 * changes. It was right about the stores it had and blind to the shape it did not — the
 * ninth instance of the standing rule, and the second inside this one commit.
 *
 * WHAT A CORRECT VERSION NEEDS, in this order: harden `num()` to the tier contract
 * `priceToUsd` already enforces; decide whether a subscription/selling-plan offer is the
 * same commitment as the one-time purchase the `no_subscription` row asserts (it is not);
 * keep `priceSpecification` narrow — reading it unconditionally pulled in
 * `UnitPriceSpecification` (per-100g) and `DeliveryChargeSpecification` (shipping) as
 * product prices, both observed in real markup. Filed, not built.
 */
function parseOffer(raw: unknown): OfferInfo | null {
  const offers = arr(raw).find((o) => o && typeof o === "object") as Record<string, unknown> | undefined;
  if (!offers) return null;
  const availabilityRaw = str(offers.availability);
  return {
    price: num(offers.price ?? offers.lowPrice ?? (offers.priceSpecification as Record<string, unknown> | undefined)?.price),
    currency: str(offers.priceCurrency ?? (offers.priceSpecification as Record<string, unknown> | undefined)?.priceCurrency),
    availability: availabilityRaw ? availabilityRaw.replace(/^https?:\/\/schema\.org\//i, "") : null,
    hasShippingDetails: offers.shippingDetails != null,
    hasReturnPolicy: offers.hasMerchantReturnPolicy != null,
  };
}

/** The five GTIN keys, in the precedence order this extractor has always used. */
const GTIN_KEYS = ["gtin13", "gtin12", "gtin14", "gtin8", "gtin"] as const;

/**
 * The product's GTIN: the five keys on the TOP-LEVEL Product node, first non-empty
 * wins. Whether that value is a real GTIN is decided later, by `isPublishableGtin`
 * in the row that judges it.
 *
 * ⚠️ TOMBSTONE — v3.5 CP2a WIDENED THIS AND v3.5 CP2c REVERTED THE WIDENING. Do not
 * re-widen it without reading `standards/ENGINE_GAPS.md` P-06 first.
 *
 * CP2a descended into `offers[]`, `hasVariant[]` and `isVariantOf[]` when the product
 * node published nothing, taking the FIRST publishable value found. It was measured
 * as purely additive over 338 captured real stores — 32 merchants who publish a
 * check-digit-valid GTIN their theme emits per offer or per variant were being told
 * they publish no identifier at all, and the replay reported 0 rows lost. That
 * measurement was true and it was the wrong instrument: a 338-store replay cannot see
 * a page none of those stores happens to publish. An independent adversarial pass over
 * 78 constructed cases, executed in three worktrees, found **11 regressions and all of
 * them here** — 9 status and 2 quote-only.
 *
 * WHY IT IS NOT A TUNING PROBLEM. When a page publishes several DIFFERENT nested
 * GTINs, "the first that validates" answers for ONE variant. That is verbatim the
 * `when` of `conflict_rules[1]` in `ALS-COFFEE-1.3-IDENT-001`, whose resolution is
 * *"the engine reads the product-level node only; per-variant identity is a known
 * limitation published as a blocked entry"*. The engine was answering, from an
 * `executable` row, a question the same published document declares `blocked`. Worse,
 * on one case the descent carried the storefront's own product key in from a variant
 * list and named it as the merchant's GTIN — the exact value rule D exists to reject,
 * one field over.
 *
 * The narrowing that would make it safe — descend only when exactly ONE distinct
 * publishable GTIN is reachable — is measured only against the same 78 cases that
 * failed the wide rule, which is fitting to the test set. It is filed as a proposal
 * (ENGINE_GAPS P-06), not shipped.
 */
export function selectGtin(node: Record<string, unknown>): string | null {
  for (const key of GTIN_KEYS) {
    const v = str(node[key]);
    if (v) return v;
  }
  return null;
}

/** Pull the first Product node (if any) into our normalized shape. */
export function extractProduct(nodes: Record<string, unknown>[]): ProductInfo | null {
  const product = nodes.find((n) => isType(n, "Product") || isType(n, "ProductGroup"));
  if (!product) return null;
  const brand = product.brand;
  const brandName = typeof brand === "object" && brand ? str((brand as Record<string, unknown>).name) : str(brand);
  const rating = arr(product.aggregateRating).find((r) => r && typeof r === "object") as Record<string, unknown> | undefined;
  return {
    name: str(product.name),
    brand: brandName,
    sku: str(product.sku),
    gtin: selectGtin(product),
    mpn: str(product.mpn),
    offer: parseOffer(product.offers),
    rating: rating ? num(rating.ratingValue) : null,
    reviewCount: rating ? num(rating.reviewCount ?? rating.ratingCount) : null,
  };
}

function extractFaqs(nodes: Record<string, unknown>[]): Array<{ q: string; a: string }> {
  const faqs: Array<{ q: string; a: string }> = [];
  const page = nodes.find((n) => isType(n, "FAQPage"));
  const questions = page ? arr(page.mainEntity) : nodes.filter((n) => isType(n, "Question"));
  for (const qNode of questions) {
    if (!qNode || typeof qNode !== "object") continue;
    const q = qNode as Record<string, unknown>;
    const question = str(q.name) ?? str(q.text);
    const ansNode = arr(q.acceptedAnswer)[0] as Record<string, unknown> | undefined;
    const answer = ansNode ? str(ansNode.text) : null;
    if (question && answer) faqs.push({ q: htmlToText(question), a: htmlToText(answer) });
  }
  return faqs.slice(0, 25);
}

// ---- lightweight HTML signal extraction (regex; bounded) ------------------

function firstMatch(html: string, re: RegExp): string | null {
  const m = re.exec(html);
  return m ? (m[1] ?? "").trim() || null : null;
}
function allMatches(html: string, re: RegExp, limit = 20): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && out.length < limit) {
    const text = htmlToText(m[1] ?? "");
    if (text) out.push(text);
  }
  return out;
}

function extractCanonical(html: string): string | null {
  const m = /<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/i.exec(html);
  if (!m) return null;
  return firstMatch(m[0], /href\s*=\s*["']([^"']+)["']/i);
}

function extractRobotsIndex(html: string): boolean | null {
  const metas = html.match(/<meta\b[^>]*name\s*=\s*["']robots["'][^>]*>/gi) ?? [];
  let known: boolean | null = null;
  for (const tag of metas) {
    const content = firstMatch(tag, /content\s*=\s*["']([^"']*)["']/i);
    if (content == null) continue;
    known = true;
    if (/noindex/i.test(content)) return false;
  }
  return known ? true : null;
}

/** Full extraction over a page's RAW html + its final URL. */
export function extractPage(html: string): ExtractedPage {
  const nodes = extractJsonLd(html);
  const jsonLdTypes = [...new Set(nodes.flatMap(typesOf))];
  const product = extractProduct(nodes);
  const faqs = extractFaqs(nodes);

  const title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaDescription =
    firstMatch(html, /<meta\b[^>]*name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']*)["'][^>]*>/i) ??
    firstMatch(html, /<meta\b[^>]*content\s*=\s*["']([^"']*)["'][^>]*name\s*=\s*["']description["'][^>]*>/i);
  const canonicalUrl = extractCanonical(html);
  const robotsIndex = extractRobotsIndex(html);
  const h1 = allMatches(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi);
  const h2 = allMatches(html, /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi);

  const offer = product?.offer ?? null;
  return {
    jsonLdTypes,
    hasProductSchema: Boolean(product),
    product,
    title: title ? htmlToText(title) : null,
    metaDescription,
    canonicalUrl,
    robotsIndex,
    headings: { h1, h2 },
    faqs,
    signals: {
      jsonLd: nodes.length > 0,
      productSchema: Boolean(product),
      offer: Boolean(offer),
      price: offer?.price != null,
      availability: offer?.availability != null,
      gtin: Boolean(product?.gtin),
      mpn: Boolean(product?.mpn),
      sku: Boolean(product?.sku),
      brand: Boolean(product?.brand),
      rating: product?.rating != null,
      reviews: product?.reviewCount != null && product.reviewCount > 0,
      shipping: Boolean(offer?.hasShippingDetails),
      returns: Boolean(offer?.hasReturnPolicy),
      faq: faqs.length > 0,
      canonical: Boolean(canonicalUrl),
      indexable: robotsIndex !== false,
    },
  };
}

export type SignalKey = keyof ExtractedPage["signals"];
