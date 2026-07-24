import { safeFetch } from "../crawler/fetch.js";
import { validateUrl } from "../crawler/ssrf.js";
import { extractPage, extractJsonLd, type ExtractedPage } from "../crawler/extract.js";
import { htmlToText } from "../crawler/sanitize.js";
import { parseRobots, isAllowedByRobots, type RobotsPolicy } from "../crawler/robots.js";
import {
  buildEvidence, findSupport, findTimingSupport, normalize,
  SURFACE_LABEL, type EvidenceSentence, type QuotableSurface,
} from "./testEvidence.js";
import { lintStrings } from "./claimLinter.js";
import {
  getCachedResult, storeResult, reserveHostSlot, getCachedRobots, storeRobots,
} from "./productTestCache.js";
import { judgeClaims, semanticSpendUsd, type SemanticDeps, type SemanticStats } from "./semanticTier.js";

// ===========================================================================
// PHASE B — the BUYER TEST (the funnel mechanic behind the reposition).
// Paste a Shopify product URL → build a buyer task of 4–6 requirements across
// different surface types (attribute claim · price · variant · purchase terms ·
// logistics) → run each requirement as an HONEST, deterministic assertion
// against the store's PUBLIC data → return an assertion-table result.
//
// Honesty discipline (the whole differentiator):
//   • EVIDENCE-AVAILABILITY, never product truth. A claim not found is "no
//     evidence found", never "your product is not X".
//   • Every Pass on positive evidence must clear the deterministic support gates
//     in ./testEvidence.ts (aboutness · product-surface · presentable quote), and
//     FAILS CLOSED otherwise. A wrong Pass is unrecoverable.
//   • An absence-based pass (`must_be_false`) is DISCLOSED as its own weaker
//     state — never presented as proof.
//   • Surfaces not publicly inspectable (metafields, full policy pages) are
//     "requires store access" — never "missing".
//   • $0, deterministic — NO model calls. Public data only, robots respected.
// ===========================================================================

const LIMITS = { maxBytes: 1_500_000, timeoutMs: 8_000, maxRedirects: 3 };

// ---- honest term dictionary (support = the positive claim; violating = contrary) ----
interface ClaimTerms { support: string[]; violating: string[] }
const CLAIM_TERMS: Record<string, ClaimTerms> = {
  aluminum_free: { support: ["aluminum-free", "aluminum free", "aluminium-free", "aluminium free", "no aluminum", "without aluminum", "free of aluminum"], violating: ["contains aluminum", "with aluminum", "aluminum-based"] },
  baking_soda_free: { support: ["baking soda free", "baking-soda-free", "without baking soda", "no baking soda", "free of baking soda"], violating: ["contains baking soda"] },
  cruelty_free: { support: ["cruelty-free", "cruelty free", "not tested on animals", "leaping bunny"], violating: ["tested on animals"] },
  vegan: { support: ["vegan", "100% vegan", "plant-based", "plant based"], violating: ["contains animal", "non-vegan"] },
  fragrance_free: { support: ["fragrance-free", "fragrance free", "unscented", "no added fragrance", "no fragrance"], violating: ["added fragrance"] },
  paraben_free: { support: ["paraben-free", "paraben free", "no parabens", "without parabens"], violating: ["contains parabens"] },
  sulfate_free: { support: ["sulfate-free", "sulfate free", "no sulfates", "without sulfates"], violating: ["contains sulfates"] },
  single_origin: { support: ["single origin", "single-origin", "single estate", "single-estate", "single farm"], violating: [] },
  organic: { support: ["organic", "usda organic", "certified organic"], violating: [] },
  fair_trade: { support: ["fair trade", "fair-trade", "fairtrade"], violating: [] },
  gluten_free: { support: ["gluten-free", "gluten free", "no gluten"], violating: ["contains gluten", "contains wheat"] },
  third_party_tested: { support: ["third-party tested", "third party tested", "independently tested", "lab tested", "certificate of analysis"], violating: [] },
  bpa_free: { support: ["bpa-free", "bpa free", "no bpa", "without bpa"], violating: ["contains bpa"] },
};
const CLAIM_LABEL: Record<string, string> = {
  aluminum_free: "Aluminum-free", baking_soda_free: "Baking-soda-free", cruelty_free: "Cruelty-free",
  vegan: "Vegan", fragrance_free: "Fragrance-free / unscented", paraben_free: "Paraben-free",
  sulfate_free: "Sulfate-free", single_origin: "Single-origin", organic: "Organic",
  fair_trade: "Fair-trade", gluten_free: "Gluten-free", third_party_tested: "Third-party tested",
  bpa_free: "BPA-free",
};
// Category keyword → the two claims a buyer most often asks about in that category.
// Ordered specific→general; matched against product_type first (authoritative), then
// title — NEVER tags (a coffee-SCENTED soap must not read as a coffee product).
const CATEGORY_CLAIMS: Array<{ kw: RegExp; claims: string[] }> = [
  { kw: /deodorant|antiperspirant/i, claims: ["aluminum_free", "baking_soda_free"] },
  { kw: /soap|skincare|serum|moisturizer|lotion|cream|cleanser|shampoo|conditioner|balm|body\s?wash/i, claims: ["fragrance_free", "paraben_free"] },
  { kw: /coffee|espresso|roast|whole\s?bean/i, claims: ["single_origin", "organic"] },
  { kw: /supplement|vitamin|protein|powder|capsule/i, claims: ["third_party_tested", "gluten_free"] },
  { kw: /\btea\b|snack|granola|cereal|jerky/i, claims: ["organic", "gluten_free"] },
  { kw: /bottle|container|storage|tumbler/i, claims: ["bpa_free"] },
];

/** Only "required" phrasings — a store merely OFFERING a subscription is not a blocker. */
const SUBSCRIPTION_REQUIRED = ["subscription required", "subscription is required", "subscription only", "subscribe to purchase", "only available by subscription", "must subscribe"];

const norm = normalize;

// ---- public product snapshot -------------------------------------------------
interface PublicVariant { title: string; priceUsd: number | null; available: boolean; options: string[] }
export interface PublicProduct {
  origin: string; handle: string; title: string | null; vendor: string | null; productType: string | null;
  tags: string[]; descriptionText: string; variants: PublicVariant[]; minPriceUsd: number | null;
  optionNames: string[]; optionValues: string[]; extracted: ExtractedPage | null;
  /** Sentence-level, chrome-free product evidence — the ONLY text we may match or
   *  quote. Raw page text is deliberately excluded (see testEvidence.ts). */
  evidence: EvidenceSentence[];
  /** Availability from JSON-LD `Offer.availability` ("InStock"/"OutOfStock"/…),
   *  the first source in the precedence order (before variants, before `.js`). */
  ldAvailability: string | null;
  /** How the shipping policy fetch went — drives an honest delivery verdict. */
  policyStatus: "not_fetched" | "readable" | "unreachable" | "robots_disallowed";
  fetched: { json: boolean; page: boolean; js: boolean; policy: boolean };
}

export type FetchErrorKind = "bad_url" | "not_shopify" | "not_found" | "rate_limited" | "robots_disallowed" | "unreachable";
export interface FetchError { kind: FetchErrorKind; message: string }

export const FETCH_ERROR_MESSAGE: Record<FetchErrorKind, string> = {
  bad_url: "Paste a Shopify product URL — it should contain /products/…",
  not_shopify: "This looks like it isn't a Shopify store — the test needs Shopify's public product data.",
  not_found: "We couldn't find a product at that URL.",
  rate_limited: "This store is limiting automated requests right now. We'll retry — try again in a few minutes.",
  robots_disallowed: "This store asks automated tools not to read this page, and we respect that.",
  unreachable: "We couldn't reach that store's public product data.",
};

function parseProductUrl(raw: string): { origin: string; handle: string } | null {
  const check = validateUrl(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (!check.ok || !check.url) return null;
  const u = check.url;
  const m = u.pathname.match(/\/products\/([^/?#]+)/i);
  if (!m) return null;
  return { origin: `${u.protocol}//${u.host}`, handle: decodeURIComponent(m[1]!.replace(/\.(js|json)$/i, "")) };
}

/** Normalized cache/throttle key for a product URL (origin + handle, no query). */
export function normalizeProductUrl(raw: string): string | null {
  const p = parseProductUrl(raw);
  return p ? `${p.origin.toLowerCase()}/products/${p.handle.toLowerCase()}` : null;
}

// Shape of Shopify's public /products/{handle}.json → { product: {...} }. Prices are
// STRING dollars ("8.50"); options carry values; variants use option1/2/3; `available`
// is often absent from the .json endpoint (defaulted true — a listed, sellable variant).
interface ShopifyProductJson {
  title?: string; vendor?: string; product_type?: string; tags?: string[] | string; body_html?: string;
  options?: Array<{ name?: string; values?: string[] }>;
  variants?: Array<{ title?: string; price?: string | number; available?: boolean; option1?: string; option2?: string; option3?: string; options?: string[] }>;
}
const priceToUsd = (p: string | number | undefined): number | null => {
  if (typeof p === "number") return Number.isFinite(p) ? (p > 1000 && Number.isInteger(p) ? p / 100 : p) : null; // cents-guard
  if (typeof p === "string") { const n = Number(p.replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? n : null; }
  return null;
};

/** Pull the JSON-LD Product node's own `description` (main's extractPage keeps only
 *  identifiers/offer, not the prose) — a legitimate structured_data text surface. */
export function jsonLdProductDescription(html: string): string | null {
  for (const node of extractJsonLd(html)) {
    const t = node["@type"];
    const types = (Array.isArray(t) ? t : [t]).map((x) => String(x).toLowerCase());
    if (!types.includes("product") && !types.includes("productgroup")) continue;
    const d = node.description;
    if (typeof d === "string" && d.trim()) return htmlToText(d);
  }
  return null;
}

export interface FetchDeps {
  /** `extraContentTypes` is an opt-in, per-call widening (the `.js` endpoint only). */
  fetchUrl?: (url: string, extraContentTypes?: RegExp[]) => Promise<{ status: number; contentType: string | null; body: string; finalUrl?: string }>;
  loadRobots?: (origin: string) => Promise<RobotsPolicy>;
  /** Injectable clock — cache/throttle windows are testable without real time. */
  now?: () => number;
}

const defaultFetchUrl: NonNullable<FetchDeps["fetchUrl"]> = async (url, extraContentTypes) => {
  const r = await safeFetch(url, extraContentTypes ? { ...LIMITS, extraContentTypes } : LIMITS);
  return { status: r.status, contentType: r.contentType, body: r.body, finalUrl: r.finalUrl };
};

/** Fetch a product's PUBLIC data: /products/{handle}.json (structured) + the HTML
 *  page (JSON-LD prose / FAQ). Robots-checked; SSRF-safe; byte-capped. Returns a
 *  TYPED error so the UI can be specific instead of generic. */
export interface FetchContext { fetchUrl: NonNullable<FetchDeps["fetchUrl"]>; robots: RobotsPolicy }

export async function fetchPublicProduct(
  raw: string,
  deps: FetchDeps = {},
): Promise<{ product?: PublicProduct; error?: FetchError; ctx?: FetchContext }> {
  const parsed = parseProductUrl(raw);
  if (!parsed) return { error: { kind: "bad_url", message: FETCH_ERROR_MESSAGE.bad_url } };
  const { origin, handle } = parsed;
  const host = new URL(origin).host.toLowerCase();
  const rawFetch = deps.fetchUrl ?? defaultFetchUrl;

  // Every outbound request passes the shared per-host throttle: ≥2s spacing and a
  // hard hourly budget. Exceeding the budget is reported honestly rather than
  // hammering a store we're already heavy on.
  let hostBudgetSpent = false;
  const fetchUrl: NonNullable<FetchDeps["fetchUrl"]> = async (url, extraContentTypes) => {
    const slot = reserveHostSlot(host, deps);
    if (!slot.ok) {
      hostBudgetSpent = true;
      throw new Error("host hourly budget exhausted");
    }
    if (slot.waitMs > 0) await new Promise((r) => setTimeout(r, slot.waitMs));
    return rawFetch(url, extraContentTypes);
  };

  // robots.txt: once per host per hour, shared across all users. Its redirect also
  // reveals the store's CANONICAL host — merchants paste apex URLs
  // (`store.com/products/x`) while the storefront serves `www.store.com`, and some
  // apex hosts throttle or refuse what the canonical host answers fine. Following it
  // turns an avoidable "rate limited" into a real result.
  let canonicalOrigin = origin;
  const getRobots = deps.loadRobots ?? (async (o: string) => {
    const cached = getCachedRobots<RobotsPolicy>(o, deps);
    if (cached) return cached;
    try {
      const r = await fetchUrl(`${o}/robots.txt`);
      if (r.finalUrl) {
        try {
          const f = new URL(r.finalUrl);
          if (f.host.toLowerCase() !== new URL(o).host.toLowerCase()) canonicalOrigin = `${f.protocol}//${f.host}`;
        } catch { /* keep the requested origin */ }
      }
      const policy: RobotsPolicy = r.status === 200 ? parseRobots(r.body) : { rules: [], fetched: false };
      storeRobots(o, policy, deps);
      return policy;
    } catch { return { rules: [], fetched: false }; }
  });

  const robots = await getRobots(origin);
  const jsonPath = `/products/${encodeURIComponent(handle)}.json`;
  const pagePath = `/products/${encodeURIComponent(handle)}`;
  if (!isAllowedByRobots(robots, jsonPath) && !isAllowedByRobots(robots, pagePath)) {
    return { error: { kind: "robots_disallowed", message: FETCH_ERROR_MESSAGE.robots_disallowed } };
  }

  let js: ShopifyProductJson | null = null;
  let sawRateLimit = false;
  let saw404 = false;
  let sawNonJson = false;
  if (isAllowedByRobots(robots, jsonPath)) {
    try {
      const r = await fetchUrl(`${canonicalOrigin}${jsonPath}`);
      if (r.status === 429 || r.status === 403) sawRateLimit = true;
      else if (r.status === 404) saw404 = true;
      else if (r.status === 200 && /json/i.test(r.contentType ?? "")) {
        js = (JSON.parse(r.body) as { product?: ShopifyProductJson }).product ?? null;
      } else if (r.status === 200) sawNonJson = true;
    } catch { /* fall through to the page fetch */ }
  }

  // The product PAGE is fetched only when we still need structured prose (JSON-LD /
  // FAQ) — i.e. when the .json gave us nothing, or gave us no description text.
  let extracted: ExtractedPage | null = null;
  let ldDescription: string | null = null;
  const needPage = !js || !js.body_html;
  if (needPage && isAllowedByRobots(robots, pagePath)) {
    try {
      const r = await fetchUrl(`${canonicalOrigin}${pagePath}`);
      if (r.status === 429 || r.status === 403) sawRateLimit = true;
      else if (r.status === 404) saw404 = true;
      else if (r.status === 200 && /html/i.test(r.contentType ?? "")) {
        extracted = extractPage(r.body);
        ldDescription = jsonLdProductDescription(r.body);
      }
    } catch { /* fall through */ }
  }

  if (!js && !extracted) {
    if (sawRateLimit || hostBudgetSpent) return { error: { kind: "rate_limited", message: FETCH_ERROR_MESSAGE.rate_limited } };
    if (saw404) return { error: { kind: "not_found", message: FETCH_ERROR_MESSAGE.not_found } };
    if (sawNonJson) return { error: { kind: "not_shopify", message: FETCH_ERROR_MESSAGE.not_shopify } };
    return { error: { kind: "unreachable", message: FETCH_ERROR_MESSAGE.unreachable } };
  }

  // Availability precedence (§3.1): JSON-LD Offer.availability → `.json` variants →
  // the `.js` endpoint (which carries the `available` flag `.json` often omits).
  // The `.js` fetch happens ONLY when the first two yielded nothing.
  const ldAvailability = extracted?.product?.offer?.availability ?? null;
  const jsonHasVariantSignal = (js?.variants ?? []).some((v) => typeof v.available === "boolean");
  let usedJsEndpoint = false;
  if (!ldAvailability && !jsonHasVariantSignal) {
    const dotJsPath = `/products/${encodeURIComponent(handle)}.js`;
    if (isAllowedByRobots(robots, dotJsPath)) {
      try {
        // Shopify serves this JSON as `text/javascript`; the allowance is scoped to
        // THIS call only (safeFetch's default allowlist is unchanged).
        const r = await fetchUrl(`${canonicalOrigin}${dotJsPath}`, [/^text\/javascript/i, /^application\/javascript/i]);
        if (r.status === 200 && /javascript|json/i.test(r.contentType ?? "")) {
          const dotJs = JSON.parse(r.body) as ShopifyProductJson;
          if (dotJs && Array.isArray(dotJs.variants)) {
            usedJsEndpoint = true;
            js = js ? { ...js, variants: dotJs.variants } : dotJs;
          }
        }
      } catch { /* the row stays honestly unadjudicated */ }
    }
  }

  const tags = Array.isArray(js?.tags) ? js!.tags! : typeof js?.tags === "string" ? js!.tags!.split(",").map((t) => t.trim()).filter(Boolean) : [];
  const optionNames = (js?.options ?? []).map((o) => o.name ?? "").filter(Boolean);
  const optionValues = [...new Set((js?.options ?? []).flatMap((o) => o.values ?? []))].filter((v) => v && !/^(default|title)/i.test(v));
  const variants: PublicVariant[] = (js?.variants ?? []).map((v) => ({
    title: v.title ?? "", priceUsd: priceToUsd(v.price), available: v.available !== false,
    options: v.options ?? [v.option1, v.option2, v.option3].filter((o): o is string => Boolean(o)),
  }));
  const prices = variants.map((v) => v.priceUsd).filter((p): p is number => p != null);
  const descriptionText = js?.body_html ? htmlToText(js.body_html) : "";
  const ld = extracted?.product;

  // The evidence index: PRODUCT surfaces only. Raw page text (nav, upsell, review
  // and subscription-widget chrome) is deliberately NOT an evidence surface — it is
  // what produced the live false positive this hardening exists to fix.
  const evidence = buildEvidence([
    { surface: "product_description", text: descriptionText },
    { surface: "structured_data", text: ldDescription },
    { surface: "product_faq", text: (extracted?.faqs ?? []).map((f) => `${f.q} ${f.a}`).join("\n") },
    { surface: "product_title", text: js?.title ?? ld?.name ?? null },
    { surface: "product_options", text: optionValues.join(". ") },
    { surface: "meta_description", text: extracted?.metaDescription ?? null },
  ]);

  return {
    product: {
      origin: canonicalOrigin, handle, title: js?.title ?? ld?.name ?? extracted?.title ?? null,
      vendor: js?.vendor ?? ld?.brand ?? null, productType: js?.product_type ?? null, tags,
      descriptionText, variants, minPriceUsd: prices.length ? Math.min(...prices) : (ld?.offer?.price ?? null),
      optionNames, optionValues, extracted, evidence, ldAvailability,
      policyStatus: "not_fetched",
      fetched: { json: Boolean(js), page: Boolean(extracted), js: usedJsEndpoint, policy: false },
    },
    ctx: { fetchUrl, robots },
  };
}

/** Fetch `/policies/shipping-policy` and fold it in as a `shipping_policy` evidence
 *  surface. Called ONLY when the task includes a delivery requirement (≤1 extra
 *  fetch per test), under the same robots + throttle + cache discipline. */
export async function attachShippingPolicy(
  product: PublicProduct,
  ctx: { fetchUrl: NonNullable<FetchDeps["fetchUrl"]>; robots: RobotsPolicy },
): Promise<PublicProduct> {
  const path = "/policies/shipping-policy";
  if (!isAllowedByRobots(ctx.robots, path)) return { ...product, policyStatus: "robots_disallowed" };
  try {
    const r = await ctx.fetchUrl(`${product.origin}${path}`);
    if (r.status !== 200 || !/html/i.test(r.contentType ?? "")) return { ...product, policyStatus: "unreachable" };
    // Policy pages are chrome-heavy; keep only the main text and cap it.
    const text = htmlToText(r.body).slice(0, 20_000);
    if (!text) return { ...product, policyStatus: "unreachable" };
    return {
      ...product,
      evidence: [...product.evidence, ...buildEvidence([{ surface: "shipping_policy", text }])],
      policyStatus: "readable",
      fetched: { ...product.fetched, policy: true },
    };
  } catch {
    return { ...product, policyStatus: "unreachable" };
  }
}

// ---- buyer task generation (4–6 requirements across surface types) -----------
export type ReqKind = "claim" | "price_under" | "variant_option" | "no_subscription" | "delivery" | "in_stock";
export interface Requirement { id: string; kind: ReqKind; label: string; claim?: string; capUsd?: number; optionValue?: string }

function inferClaims(p: PublicProduct): string[] {
  // product_type is the authoritative category signal; title is the fallback.
  // Tags are deliberately excluded — scent/ingredient tags ("coffee", "lavender")
  // routinely misclassify (a coffee-scented soap is not a coffee product).
  for (const src of [(p.productType ?? "").toLowerCase(), (p.title ?? "").toLowerCase()]) {
    if (!src) continue;
    for (const c of CATEGORY_CLAIMS) if (c.kw.test(src)) return c.claims;
  }
  // Fallback: a claim the product's own tags explicitly STATE (not a category guess).
  const tagHay = p.tags.join(" ");
  for (const key of Object.keys(CLAIM_TERMS)) {
    if (CLAIM_TERMS[key]!.support.some((t) => norm(tagHay).includes(norm(t)))) return [key];
  }
  return ["cruelty_free"];
}
function niceCap(min: number): number { return Math.max(10, Math.ceil((min + 0.01) / 5) * 5); }

/** Can PUBLIC data decide this requirement at all? Requirements the public surfaces
 *  can adjudicate rank first, so the table is full of findings a merchant can act on
 *  rather than rows that shrug (§4.1). */
function adjudicability(p: PublicProduct, r: Requirement): number {
  switch (r.kind) {
    // A claim is ALWAYS adjudicable: "no evidence found" is itself the most
    // actionable finding the tool produces (state it, and it becomes provable).
    case "claim": return 3;
    // These score 0 only when they'd be forced to say "requires store access".
    case "price_under": return p.minPriceUsd != null ? 3 : 0;
    case "variant_option": return p.optionValues.length ? 3 : 0;
    case "in_stock": return p.ldAvailability || p.variants.length ? 3 : 1;
    case "no_subscription": return 2; // absence-based, always answerable
    case "delivery": return 2;        // the policy fetch usually resolves it
  }
}

export function buildBuyerTask(p: PublicProduct): { summary: string; requirements: Requirement[] } {
  // Candidate pool, then ranked by whether public data can decide it.
  const candidates: Requirement[] = [];
  const claims = inferClaims(p).slice(0, 2);
  claims.forEach((c, i) => candidates.push({ id: `claim${i}`, kind: "claim", claim: c, label: CLAIM_LABEL[c] ?? c.replace(/_/g, " ") }));
  if (p.minPriceUsd != null) {
    const cap = niceCap(p.minPriceUsd);
    candidates.push({ id: "price", kind: "price_under", capUsd: cap, label: `Price under $${cap}` });
  }
  const optionValue = p.optionValues.find((v) => v && !/^(default|title)$/i.test(v));
  if (optionValue) candidates.push({ id: "variant", kind: "variant_option", optionValue, label: `${optionValue} option available` });
  candidates.push({ id: "stock", kind: "in_stock", label: "In stock and purchasable" });
  candidates.push({ id: "sub", kind: "no_subscription", label: "Available as a one-time purchase" });
  candidates.push({ id: "delivery", kind: "delivery", label: "Ships in the US within a week" });

  // Selection: keep 4–6 requirements that SPAN the surface types (claim · price ·
  // variant · purchase terms · logistics) — depth across surfaces is what makes the
  // result impressive — while preferring the publicly adjudicable candidates.
  const surfaceType = (r: Requirement): string =>
    r.kind === "variant_option" || r.kind === "in_stock" ? "variant"
    : r.kind === "no_subscription" ? "terms"
    : r.kind === "delivery" ? "logistics"
    : r.kind === "price_under" ? "price"
    : "claim";
  const pool = candidates
    .map((r, i) => ({ r, i, score: adjudicability(p, r) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i);

  // Pass 1: the best adjudicable candidate from each surface type.
  const picked = new Set<Requirement>();
  for (const type of ["claim", "price", "variant", "terms", "logistics"]) {
    const best = pool.find((x) => surfaceType(x.r) === type && !picked.has(x.r));
    if (best) picked.add(best.r);
  }
  // Pass 2: fill the remaining slots (up to 6) with the next-best candidates.
  for (const x of pool) {
    if (picked.size >= 6) break;
    picked.add(x.r);
  }
  const ordered = candidates.filter((c) => picked.has(c)); // restore reading order

  const claimWords = claims.map((c) => (CLAIM_LABEL[c] ?? c).toLowerCase()).join(", ");
  const summary = `Find this ${p.productType?.toLowerCase() || "product"}${claimWords ? `, confirm it's ${claimWords}` : ""}, purchasable one-time with fast US shipping.`;
  return { summary, requirements: ordered };
}

// ---- the four honest result states ------------------------------------------
// pass_evidenced       — positive evidence found AND validated (§2)
// pass_no_blocking     — a must_be_false requirement with nothing contradicting it,
//                        DISCLOSED as inference, never rendered as proof
// not_proven           — surface inspectable, no supporting evidence (or the
//                        readable value doesn't meet the ask)
// requires_store_access— the surface isn't publicly inspectable at all
export type AssertionStatus = "pass_evidenced" | "pass_no_blocking" | "not_proven" | "requires_store_access";
export const PASSING: AssertionStatus[] = ["pass_evidenced", "pass_no_blocking"];

export interface Assertion {
  label: string;
  status: AssertionStatus;
  detail: string;
  evidenceQuote?: string;
  /** Human label of the surface the evidence came from (or was sought on). */
  evidenceSurface?: string;
  /** The surfaces actually checked for THIS requirement (§4.4 specificity). */
  surfacesChecked: string[];
}

/** Distinct human labels of the product surfaces available on this snapshot. */
function textSurfaces(p: PublicProduct): string[] {
  const seen = new Set<QuotableSurface>(p.evidence.map((e) => e.surface));
  const order: QuotableSurface[] = ["product_description", "structured_data", "product_faq", "product_title", "product_options", "meta_description"];
  const labels = order.filter((s) => seen.has(s)).map((s) => SURFACE_LABEL[s]);
  return labels.length ? labels : ["product copy"];
}
const listPhrase = (items: string[]): string =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

export function evaluate(p: PublicProduct, req: Requirement): Assertion {
  switch (req.kind) {
    case "claim": {
      const fx = CLAIM_TERMS[req.claim!]!;
      const checked = textSurfaces(p);
      // Contrary evidence must clear the same aboutness gates before we report it.
      const contra = fx.violating.length ? findSupport(p.evidence, fx.violating) : null;
      if (contra) {
        return {
          label: req.label, status: "not_proven", surfacesChecked: checked,
          detail: `Your public copy states the opposite of this requirement.`,
          evidenceQuote: contra.quote ?? undefined, evidenceSurface: SURFACE_LABEL[contra.surface],
        };
      }
      const hit = findSupport(p.evidence, fx.support);
      if (hit) {
        return {
          label: req.label, status: "pass_evidenced", surfacesChecked: checked,
          detail: `Stated in your ${SURFACE_LABEL[hit.surface]}.`,
          evidenceQuote: hit.quote ?? undefined, evidenceSurface: SURFACE_LABEL[hit.surface],
        };
      }
      return {
        label: req.label, status: "not_proven", surfacesChecked: checked,
        detail: `Checked ${listPhrase(checked)} — no statement an AI buyer could verify.`,
      };
    }
    case "price_under": {
      const checked = ["variant prices", "structured data"];
      if (p.minPriceUsd == null) {
        return { label: req.label, status: "requires_store_access", surfacesChecked: checked, detail: "No public price is exposed on this product." };
      }
      if (p.minPriceUsd < req.capUsd!) {
        return { label: req.label, status: "pass_evidenced", surfacesChecked: checked, detail: `Lowest readable price is $${p.minPriceUsd.toFixed(2)}.`, evidenceSurface: "variant prices" };
      }
      return { label: req.label, status: "not_proven", surfacesChecked: checked, detail: `Lowest readable price is $${p.minPriceUsd.toFixed(2)}, at or above the $${req.capUsd} requirement.` };
    }
    case "variant_option": {
      const checked = ["variant options"];
      const v = p.variants.find((x) => x.options.some((o) => norm(o) === norm(req.optionValue!)) || norm(x.title).includes(norm(req.optionValue!)));
      if (v && v.available) return { label: req.label, status: "pass_evidenced", surfacesChecked: checked, detail: `A "${req.optionValue}" variant is listed and purchasable.`, evidenceSurface: "variant options" };
      if (v) return { label: req.label, status: "not_proven", surfacesChecked: checked, detail: `The "${req.optionValue}" variant is listed but shows as unavailable.` };
      return { label: req.label, status: "not_proven", surfacesChecked: checked, detail: `Checked the public variant list — no "${req.optionValue}" variant found.` };
    }
    case "in_stock": {
      // Precedence (§3.1): JSON-LD Offer.availability → variants (incl. the `.js`
      // fallback merged at fetch time). Only a genuine absence of BOTH is an
      // access limit — and then the reason is specific.
      const checked = ["structured data", "variant options"];
      if (p.ldAvailability) {
        const a = p.ldAvailability.toLowerCase();
        if (/instock|limitedavailability|onlineonly|instoreonly/.test(a)) {
          return { label: req.label, status: "pass_evidenced", surfacesChecked: checked, detail: "Your structured data marks this product in stock.", evidenceSurface: "structured data" };
        }
        if (/outofstock|soldout|discontinued/.test(a)) {
          return { label: req.label, status: "not_proven", surfacesChecked: checked, detail: "Your structured data marks this product out of stock." };
        }
        if (/preorder|backorder/.test(a)) {
          return { label: req.label, status: "not_proven", surfacesChecked: checked, detail: "Your structured data marks this product as pre-order, not immediately purchasable." };
        }
      }
      if (p.variants.length) {
        return p.variants.some((v) => v.available)
          ? { label: req.label, status: "pass_evidenced", surfacesChecked: checked, detail: "At least one variant is listed as purchasable.", evidenceSurface: "variant options" }
          : { label: req.label, status: "not_proven", surfacesChecked: checked, detail: "Checked the public variant list — no variant shows as available." };
      }
      return { label: req.label, status: "requires_store_access", surfacesChecked: checked, detail: "This product exposes no availability data publicly." };
    }
    case "no_subscription": {
      const checked = textSurfaces(p);
      const hard = findSupport(p.evidence, SUBSCRIPTION_REQUIRED);
      if (hard) {
        return {
          label: req.label, status: "not_proven", surfacesChecked: checked,
          detail: "Your public copy indicates a subscription is required.",
          evidenceQuote: hard.quote ?? undefined, evidenceSurface: SURFACE_LABEL[hard.surface],
        };
      }
      // Absence of a blocker is NOT positive proof — it gets its own weaker state.
      return {
        label: req.label, status: "pass_no_blocking", surfacesChecked: checked,
        detail: "Nothing in your public product data requires a subscription. This is the absence of a blocker, not a stated one-time-purchase option.",
      };
    }
    case "delivery": {
      const checked = textSurfaces(p);
      const hit = findTimingSupport(p.evidence);
      if (hit) {
        return {
          label: req.label, status: "pass_evidenced", surfacesChecked: checked,
          detail: `Delivery timing is stated in your ${SURFACE_LABEL[hit.surface]}.`,
          evidenceQuote: hit.quote ?? undefined, evidenceSurface: SURFACE_LABEL[hit.surface],
        };
      }
      // We READ the shipping policy but it states no window → a real, actionable
      // finding, not a shrug. Only an unreadable policy is an access limit (§3.2).
      if (p.policyStatus === "readable") {
        return {
          label: req.label, status: "not_proven", surfacesChecked: checked,
          detail: "Checked your product data and shipping policy — neither states a delivery window an AI buyer can read.",
        };
      }
      return {
        label: req.label, status: "requires_store_access", surfacesChecked: checked,
        detail: p.policyStatus === "robots_disallowed"
          ? "Your shipping policy asks automated tools not to read it, so we can't check delivery timing from public data."
          : "No delivery timing in your public product data, and your shipping policy page couldn't be read publicly.",
      };
    }
  }
}

// ---- semantic tier bridge (§5) ----------------------------------------------

/** Apply the bounded semantic tier to claim requirements the lexical pass left
 *  unresolved. Grants require a verbatim quote; `about_other_subject` can withdraw
 *  a lexical match. Any failure leaves `assertions` untouched (fail closed+silent). */
async function applySemanticTier(
  p: PublicProduct,
  requirements: Requirement[],
  assertions: Assertion[],
  deps: RunOptions,
): Promise<{ assertions: Assertion[]; stats: SemanticStats | undefined }> {
  const byLabel = new Map(requirements.map((r) => [r.label, r]));
  // Only unresolved CLAIM requirements are eligible.
  const unresolved = assertions
    .map((a, i) => ({ a, i, r: byLabel.get(a.label) }))
    .filter((x) => x.r?.kind === "claim" && x.a.status === "not_proven" && x.r?.claim);
  // Lexically-matched claims are eligible for a VETO only.
  const matched = assertions
    .map((a, i) => ({ a, i, r: byLabel.get(a.label) }))
    .filter((x) => x.r?.kind === "claim" && x.a.status === "pass_evidenced" && x.r?.claim);

  if (!unresolved.length && !matched.length) return { assertions, stats: undefined };
  const attributes = [...unresolved, ...matched].map((x) => ({ key: x.r!.claim!, label: x.a.label }));

  const outcome = await judgeClaims(p.evidence, attributes, deps.semantic ?? {});
  if (!outcome.stats.called) return { assertions, stats: undefined };

  const next = [...assertions];
  for (const g of outcome.grants) {
    const target = unresolved.find((x) => x.r!.claim === g.attribute);
    if (!target) continue; // grants only ever promote an UNRESOLVED claim
    next[target.i] = {
      ...target.a,
      status: "pass_evidenced",
      detail: `Stated in your ${g.surfaceLabel}.`,
      evidenceQuote: g.quote,
      evidenceSurface: g.surfaceLabel,
    };
  }
  for (const attr of outcome.vetoes) {
    const target = matched.find((x) => x.r!.claim === attr);
    if (!target) continue; // vetoes only ever withdraw a LEXICAL match
    next[target.i] = {
      ...target.a,
      status: "not_proven",
      detail: `Checked ${listPhrase(target.a.surfacesChecked)} — the matching text is about something else, not this product.`,
      evidenceQuote: undefined,
      evidenceSurface: undefined,
    };
  }
  console.log(JSON.stringify({
    at: "semantic_tier", granted: outcome.stats.granted, vetoed: outcome.stats.vetoed,
    discarded: outcome.stats.discarded, costUsd: Number(outcome.stats.costUsd.toFixed(5)),
    cumulativeUsd: Number(semanticSpendUsd().toFixed(5)), error: outcome.stats.error ?? null,
  }));
  return { assertions: next, stats: outcome.stats };
}

// ---- orchestration + result assembly ----------------------------------------
export interface ProductTestResult {
  ok: boolean;
  error?: string;
  errorKind?: FetchErrorKind;
  productUrl: string;
  storeName: string | null;
  productName: string | null;
  task: string;
  assertions: Assertion[];
  /** State breakdown — evidenced passes are reported SEPARATELY from inferred ones. */
  evidencedCount: number;
  noBlockingCount: number;
  notProvenCount: number;
  requiresAccessCount: number;
  total: number;
  surfacesChecked: string[];
  notInspectable: string[];
  /** One line per `not_proven` requirement — the actionable list. */
  suggestedCorrections: string[];
  /** Kept for compatibility with the first rendered version (the first correction). */
  suggestedCorrection: string | null;
  /** Requirements public data can't decide, shown BELOW the table as the
   *  "what authenticated testing adds" argument rather than as blind rows. */
  deferred: Assertion[];
  /** Semantic-tier accounting (grants/discards/cost) — surfaced for diagnosis. */
  semantic?: SemanticStats;
  /** Set when served from cache (ISO timestamp of the original run). */
  testedAt?: string;
  cached?: boolean;
}

export interface RunOptions extends FetchDeps {
  /** Explicit "Run again": bypasses the cache at most once per hour per URL. */
  force?: boolean;
  /** Injectable semantic-tier transport (tests never hit the network). */
  semantic?: SemanticDeps;
}

export async function runProductTest(url: string, deps: RunOptions = {}): Promise<ProductTestResult> {
  const base: ProductTestResult = {
    ok: false, productUrl: url, storeName: null, productName: null, task: "",
    assertions: [], evidencedCount: 0, noBlockingCount: 0, notProvenCount: 0, requiresAccessCount: 0,
    total: 0, surfacesChecked: [], notInspectable: [], suggestedCorrections: [], suggestedCorrection: null, deferred: [],
  };

  // Serve from cache first — the cheapest request is the one we never make.
  const cacheKey = normalizeProductUrl(url);
  if (cacheKey) {
    const cached = getCachedResult(cacheKey, deps);
    if (cached) return cached;
  }

  const { product: fetched, error, ctx } = await fetchPublicProduct(url, deps);
  if (!fetched) return { ...base, error: error?.message, errorKind: error?.kind };

  const { summary, requirements } = buildBuyerTask(fetched);

  // ONE extra fetch, only when the task actually needs delivery timing (§3.2).
  let product = fetched;
  if (ctx && requirements.some((r) => r.kind === "delivery")) {
    product = await attachShippingPolicy(fetched, ctx);
  }

  let assertions = requirements.map((r) => evaluate(product, r));

  // Semantic tier (§5): one batched model call for claim requirements the lexical
  // pass could not resolve. Grants require a verbatim quote; failures are silent.
  const semantic = await applySemanticTier(product, requirements, assertions, deps);
  assertions = semantic.assertions;

  // §4.2 — at most ONE "requires store access" row in the table. The rest move
  // below it, where they read as the install argument rather than a blind spot.
  const kindOf = (a: Assertion) => requirements.find((r) => r.label === a.label)?.kind;
  const deferred: Assertion[] = [];
  let accessShown = 0;
  const tableAssertions = assertions.filter((a) => {
    if (a.status !== "requires_store_access") return true;
    if (accessShown === 0) { accessShown++; return true; }
    deferred.push(a);
    return false;
  });
  assertions = tableAssertions;
  const count = (s: AssertionStatus) => assertions.filter((a) => a.status === s).length;

  const notInspectable = ["product metafields"];
  if ([...assertions, ...deferred].some((a) => a.status === "requires_store_access" && /ship|deliver/i.test(a.label))) {
    notInspectable.push("full shipping & returns policy");
  }

  // ONE correction line per not_proven requirement (§2), phrased per requirement kind.
  const suggestedCorrections = assertions
    .filter((a) => a.status === "not_proven")
    .map((a) => {
      switch (kindOf(a)) {
        case "claim":
          return `Confirm whether this product is ${a.label.toLowerCase()}. If it is, state it in a product field and in customer-readable copy so an AI buyer can verify it.`;
        case "delivery":
          return "State a delivery window (for example \"ships within 2 business days\") in your shipping policy or on the product page.";
        case "in_stock":
          return "Expose availability publicly — structured data with an in-stock offer, or a purchasable variant an AI buyer can read.";
        case "variant_option":
          return `Make the "${a.label.replace(/ option available$/, "")}" option visible and purchasable in your public variant list.`;
        case "no_subscription":
          return "State plainly that a one-time purchase is available, so an AI buyer doesn't have to infer it.";
        case "price_under":
          return `Your lowest readable price doesn't meet this buyer's cap — no evidence change needed, this is a pricing fact.`;
        default:
          return `State ${a.label.toLowerCase()} in a form an AI buyer can verify.`;
      }
    });
  const suggestedCorrection = suggestedCorrections[0] ?? null;

  // BLOCKING honesty gate: every merchant-visible string must clear the claim
  // linter. A result that can't meet the standard is not rendered (§7.10) — a
  // copy regression fails loudly here rather than shipping an overclaim.
  const lint = lintStrings([
    summary, ...suggestedCorrections,
    ...[...assertions, ...deferred].flatMap((a) => [a.label, a.detail, a.evidenceQuote]),
  ]);
  if (!lint.ok) {
    console.error(`[product-test] result BLOCKED by claim linter: ${lint.violations.map((v) => `${v.rule}: "${v.excerpt}"`).join(" | ")}`);
    return {
      ...base,
      error: "We couldn't produce a result that meets our reporting standard for this product.",
      errorKind: "unreachable",
    };
  }

  const result: ProductTestResult = {
    ok: true, productUrl: url,
    storeName: product.vendor ?? new URL(product.origin).host.replace(/^www\./, ""),
    productName: product.title, task: summary, assertions,
    evidencedCount: count("pass_evidenced"),
    noBlockingCount: count("pass_no_blocking"),
    notProvenCount: count("not_proven"),
    requiresAccessCount: count("requires_store_access"),
    total: assertions.length,
    surfacesChecked: textSurfaces(product),
    notInspectable,
    suggestedCorrections,
    suggestedCorrection,
    deferred,
    semantic: semantic.stats,
  };
  if (cacheKey) storeResult(cacheKey, result, deps);
  return result;
}
