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
  fetched: { json: boolean; page: boolean };
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
  fetchUrl?: (url: string) => Promise<{ status: number; contentType: string | null; body: string }>;
  loadRobots?: (origin: string) => Promise<RobotsPolicy>;
  /** Injectable clock — cache/throttle windows are testable without real time. */
  now?: () => number;
}

const defaultFetchUrl: NonNullable<FetchDeps["fetchUrl"]> = async (url) => {
  const r = await safeFetch(url, LIMITS);
  return { status: r.status, contentType: r.contentType, body: r.body };
};

/** Fetch a product's PUBLIC data: /products/{handle}.json (structured) + the HTML
 *  page (JSON-LD prose / FAQ). Robots-checked; SSRF-safe; byte-capped. Returns a
 *  TYPED error so the UI can be specific instead of generic. */
export async function fetchPublicProduct(
  raw: string,
  deps: FetchDeps = {},
): Promise<{ product?: PublicProduct; error?: FetchError }> {
  const parsed = parseProductUrl(raw);
  if (!parsed) return { error: { kind: "bad_url", message: FETCH_ERROR_MESSAGE.bad_url } };
  const { origin, handle } = parsed;
  const host = new URL(origin).host.toLowerCase();
  const rawFetch = deps.fetchUrl ?? defaultFetchUrl;

  // Every outbound request passes the shared per-host throttle: ≥2s spacing and a
  // hard hourly budget. Exceeding the budget is reported honestly rather than
  // hammering a store we're already heavy on.
  let hostBudgetSpent = false;
  const fetchUrl: NonNullable<FetchDeps["fetchUrl"]> = async (url) => {
    const slot = reserveHostSlot(host, deps);
    if (!slot.ok) {
      hostBudgetSpent = true;
      throw new Error("host hourly budget exhausted");
    }
    if (slot.waitMs > 0) await new Promise((r) => setTimeout(r, slot.waitMs));
    return rawFetch(url);
  };

  // robots.txt: once per host per hour, shared across all users.
  const getRobots = deps.loadRobots ?? (async (o: string) => {
    const cached = getCachedRobots<RobotsPolicy>(o, deps);
    if (cached) return cached;
    try {
      const r = await fetchUrl(`${o}/robots.txt`);
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
      const r = await fetchUrl(`${origin}${jsonPath}`);
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
      const r = await fetchUrl(`${origin}${pagePath}`);
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
      origin, handle, title: js?.title ?? ld?.name ?? extracted?.title ?? null,
      vendor: js?.vendor ?? ld?.brand ?? null, productType: js?.product_type ?? null, tags,
      descriptionText, variants, minPriceUsd: prices.length ? Math.min(...prices) : (ld?.offer?.price ?? null),
      optionNames, optionValues, extracted, evidence,
      fetched: { json: Boolean(js), page: Boolean(extracted) },
    },
  };
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

export function buildBuyerTask(p: PublicProduct): { summary: string; requirements: Requirement[] } {
  const reqs: Requirement[] = [];
  const claims = inferClaims(p).slice(0, 2);
  claims.forEach((c, i) => reqs.push({ id: `claim${i}`, kind: "claim", claim: c, label: CLAIM_LABEL[c] ?? c.replace(/_/g, " ") }));
  if (p.minPriceUsd != null) {
    const cap = niceCap(p.minPriceUsd);
    reqs.push({ id: "price", kind: "price_under", capUsd: cap, label: `Price under $${cap}` });
  }
  // A specific variant a buyer might want (first distinctive option value).
  const optionValue = p.optionValues.find((v) => v && !/^(default|title)$/i.test(v));
  if (optionValue) reqs.push({ id: "variant", kind: "variant_option", optionValue, label: `${optionValue} option available` });
  else reqs.push({ id: "stock", kind: "in_stock", label: "In stock and purchasable" });
  reqs.push({ id: "sub", kind: "no_subscription", label: "Available as a one-time purchase" });
  reqs.push({ id: "delivery", kind: "delivery", label: "Ships in the US within a week" });

  const claimWords = claims.map((c) => (CLAIM_LABEL[c] ?? c).toLowerCase()).join(", ");
  const summary = `Find this ${p.productType?.toLowerCase() || "product"}${claimWords ? `, confirm it's ${claimWords}` : ""}, purchasable one-time with fast US shipping.`;
  return { summary, requirements: reqs };
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
      const checked = ["variant options"];
      if (!p.variants.length) return { label: req.label, status: "requires_store_access", surfacesChecked: checked, detail: "No public variant data is exposed on this product." };
      return p.variants.some((v) => v.available)
        ? { label: req.label, status: "pass_evidenced", surfacesChecked: checked, detail: "At least one variant is listed as purchasable.", evidenceSurface: "variant options" }
        : { label: req.label, status: "not_proven", surfacesChecked: checked, detail: "Checked the public variant list — no variant shows as available." };
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
      return {
        label: req.label, status: "requires_store_access", surfacesChecked: checked,
        detail: "No delivery timing on the public product data. Your shipping policy isn't publicly inspectable per-product — confirming this needs store access.",
      };
    }
  }
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
  suggestedCorrection: string | null;
  /** Set when served from cache (ISO timestamp of the original run). */
  testedAt?: string;
  cached?: boolean;
}

export interface RunOptions extends FetchDeps {
  /** Explicit "Run again": bypasses the cache at most once per hour per URL. */
  force?: boolean;
}

export async function runProductTest(url: string, deps: RunOptions = {}): Promise<ProductTestResult> {
  const base: ProductTestResult = {
    ok: false, productUrl: url, storeName: null, productName: null, task: "",
    assertions: [], evidencedCount: 0, noBlockingCount: 0, notProvenCount: 0, requiresAccessCount: 0,
    total: 0, surfacesChecked: [], notInspectable: [], suggestedCorrection: null,
  };

  // Serve from cache first — the cheapest request is the one we never make.
  const cacheKey = normalizeProductUrl(url);
  if (cacheKey) {
    const cached = getCachedResult(cacheKey, deps);
    if (cached) return cached;
  }

  const { product, error } = await fetchPublicProduct(url, deps);
  if (!product) return { ...base, error: error?.message, errorKind: error?.kind };

  const { summary, requirements } = buildBuyerTask(product);
  const assertions = requirements.map((r) => evaluate(product, r));
  const count = (s: AssertionStatus) => assertions.filter((a) => a.status === s).length;

  const notInspectable = ["product metafields"];
  if (assertions.some((a) => a.status === "requires_store_access" && /ship|deliver/i.test(a.label))) {
    notInspectable.push("full shipping & returns policy");
  }
  const firstGap = assertions.find((a) => a.status === "not_proven" && requirements.find((r) => r.label === a.label)?.kind === "claim");
  const suggestedCorrection = firstGap
    ? `Confirm whether this product is ${firstGap.label.toLowerCase()}. If it is, state it in a product field and in customer-readable copy so an AI buyer can verify it.`
    : null;

  // BLOCKING honesty gate: every merchant-visible string must clear the claim
  // linter. A result that can't meet the standard is not rendered (§7.10) — a
  // copy regression fails loudly here rather than shipping an overclaim.
  const lint = lintStrings([
    summary, suggestedCorrection,
    ...assertions.flatMap((a) => [a.label, a.detail, a.evidenceQuote]),
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
    suggestedCorrection,
  };
  if (cacheKey) storeResult(cacheKey, result, deps);
  return result;
}
