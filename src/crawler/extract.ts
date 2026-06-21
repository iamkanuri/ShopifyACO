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

function firstGtin(node: Record<string, unknown>): string | null {
  for (const key of ["gtin13", "gtin12", "gtin14", "gtin8", "gtin"]) {
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
    gtin: firstGtin(product),
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
