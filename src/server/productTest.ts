import { safeFetch } from "../crawler/fetch.js";
import { validateUrl } from "../crawler/ssrf.js";
import { extractPage, type ExtractedPage } from "../crawler/extract.js";
import { htmlToText } from "../crawler/sanitize.js";
import { parseRobots, isAllowedByRobots, type RobotsPolicy } from "../crawler/robots.js";

// ===========================================================================
// PHASE B — the AI-buyer PRODUCT TEST (the funnel mechanic behind the reposition).
// Paste a Shopify product URL → build a buyer task of 4–6 requirements across
// different surface types (attribute claim · price · variant · purchase terms ·
// logistics) → run each requirement as an HONEST, deterministic assertion
// against the store's PUBLIC data → return an assertion-table result.
//
// Honesty discipline (the whole differentiator, ported from the Stage 5/6 engine):
//   • EVIDENCE-AVAILABILITY, never product truth. A claim not found is "no
//     evidence found", never "your product is not X".
//   • Surfaces we can't see from public data (metafields, full policy pages,
//     delivery timing) are "requires store access" — never "missing".
//   • Price is always public: an over-cap price is a READABLE value that doesn't
//     meet the ask, never a "not stated" gap.
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
  third_party_tested: { support: ["third-party tested", "third party tested", "independently tested", "lab tested", "certificate of analysis", "coa"], violating: [] },
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

const SUBSCRIPTION_REQUIRED = ["subscription required", "subscription only", "subscribe to purchase", "only available by subscription", "must subscribe"];
const DELIVERY_TERMS = ["ships within", "ships in", "business days", "delivery in", "arrives in", "delivered within", "free shipping", "same day", "2-day", "next day", "ships same"];

const norm = (s: string) => s.toLowerCase().replace(/[‐-―]/g, "-").replace(/\s+/g, " ");
const NEG = /(^|[^a-z])(not|never|isn't|isnt|no longer)([^a-z]|$)/;
/** True when EVERY occurrence of `term` in `text` is negated (so it's not support). */
function allNegated(text: string, term: string): boolean {
  const t = norm(term); const n = norm(text);
  let i = n.indexOf(t);
  if (i === -1) return true;
  while (i !== -1) { if (!NEG.test(n.slice(Math.max(0, i - 10), i))) return false; i = n.indexOf(t, i + 1); }
  return true;
}
function foundTerm(text: string, terms: string[]): string | null {
  const n = norm(text);
  for (const t of terms) if (n.includes(norm(t)) && !allNegated(text, t)) return t;
  return null;
}
/** A verbatim, length-capped sentence-ish window around the matched term. */
function quoteAround(text: string, term: string, max = 140): string | null {
  const n = norm(text); const idx = n.indexOf(norm(term));
  if (idx === -1) return null;
  const start = Math.max(0, idx - 40);
  const raw = text.slice(start, Math.min(text.length, idx + term.length + 60)).replace(/\s+/g, " ").trim();
  return raw.length > max ? raw.slice(0, max).trimEnd() + "…" : raw;
}

// ---- public product snapshot -------------------------------------------------
interface PublicVariant { title: string; priceUsd: number | null; available: boolean; options: string[] }
export interface PublicProduct {
  origin: string; handle: string; title: string | null; vendor: string | null; productType: string | null;
  tags: string[]; descriptionText: string; variants: PublicVariant[]; minPriceUsd: number | null;
  optionNames: string[]; optionValues: string[]; corpus: string; extracted: ExtractedPage | null;
  fetched: { js: boolean; page: boolean };
}

function parseProductUrl(raw: string): { origin: string; handle: string } | null {
  const check = validateUrl(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (!check.ok || !check.url) return null;
  const u = check.url;
  const m = u.pathname.match(/\/products\/([^/?#]+)/i);
  if (!m) return null;
  return { origin: `${u.protocol}//${u.host}`, handle: decodeURIComponent(m[1]!.replace(/\.(js|json)$/i, "")) };
}

/** Fetch robots.txt ONCE per run (a permissive default if it's missing/unreachable). */
async function loadRobots(origin: string): Promise<RobotsPolicy> {
  try {
    const r = await safeFetch(`${origin}/robots.txt`, LIMITS);
    return r.status === 200 ? parseRobots(r.body) : { rules: [], fetched: false };
  } catch { return { rules: [], fetched: false }; }
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
  if (typeof p === "number") return Number.isFinite(p) ? (p > 1000 && Number.isInteger(p) ? p / 100 : p) : null; // cents-guard for the .js shape
  if (typeof p === "string") { const n = Number(p.replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? n : null; }
  return null;
};

/** Fetch a product's PUBLIC data: /products/{handle}.json (structured) + the HTML
 *  page (JSON-LD/policies/FAQ). Robots-checked; SSRF-safe; byte-capped. */
export async function fetchPublicProduct(raw: string): Promise<{ product?: PublicProduct; error?: string }> {
  const parsed = parseProductUrl(raw);
  if (!parsed) return { error: "Paste a Shopify product URL (it should contain /products/…)." };
  const { origin, handle } = parsed;

  const robots = await loadRobots(origin); // one robots.txt fetch per run
  const jsPath = `/products/${encodeURIComponent(handle)}.json`;
  let js: ShopifyProductJson | null = null;
  if (isAllowedByRobots(robots, jsPath)) {
    try {
      const r = await safeFetch(`${origin}${jsPath}`, LIMITS);
      if (r.status === 200 && /json/i.test(r.contentType ?? "")) js = (JSON.parse(r.body) as { product?: ShopifyProductJson }).product ?? null;
    } catch { /* fall through */ }
  }

  let extracted: ExtractedPage | null = null;
  let pageText = "";
  const pagePath = `/products/${encodeURIComponent(handle)}`;
  if (isAllowedByRobots(robots, pagePath)) {
    try {
      const r = await safeFetch(`${origin}${pagePath}`, LIMITS);
      if (r.status === 200 && /html/i.test(r.contentType ?? "")) {
        extracted = extractPage(r.body);
        pageText = htmlToText(r.body).slice(0, 40_000);
      }
    } catch { /* fall through */ }
  }

  if (!js && !extracted) return { error: "Couldn't read this product's public data — check the URL, or the store may block bots." };

  const tags = Array.isArray(js?.tags) ? js!.tags! : typeof js?.tags === "string" ? js!.tags!.split(",").map((t) => t.trim()).filter(Boolean) : [];
  const optionNames = (js?.options ?? []).map((o) => o.name ?? "").filter(Boolean);
  const optionValues = [...new Set((js?.options ?? []).flatMap((o) => o.values ?? []))].filter((v) => v && !/^(default|title)/i.test(v));
  const variants: PublicVariant[] = (js?.variants ?? []).map((v) => ({
    title: v.title ?? "", priceUsd: priceToUsd(v.price), available: v.available !== false,
    options: v.options ?? [v.option1, v.option2, v.option3].filter((o): o is string => Boolean(o)),
  }));
  const prices = variants.map((v) => v.priceUsd).filter((p): p is number => p != null);
  const jsDescText = js?.body_html ? htmlToText(js.body_html) : "";
  const ld = extracted?.product;
  const corpus = [
    js?.title, jsDescText, tags.join(" "), optionValues.join(" "), js?.product_type,
    ld?.name, extracted?.metaDescription, extracted?.headings.h1.join(" "), extracted?.headings.h2.join(" "),
    (extracted?.faqs ?? []).map((f) => `${f.q} ${f.a}`).join(" "), pageText,
  ].filter(Boolean).join(" \n ");

  return {
    product: {
      origin, handle, title: js?.title ?? ld?.name ?? extracted?.title ?? null,
      vendor: js?.vendor ?? ld?.brand ?? null, productType: js?.product_type ?? null, tags,
      descriptionText: jsDescText, variants, minPriceUsd: prices.length ? Math.min(...prices) : (ld?.offer?.price ?? null),
      optionNames, optionValues, corpus, extracted,
      fetched: { js: Boolean(js), page: Boolean(extracted) },
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
  for (const key of Object.keys(CLAIM_TERMS)) if (foundTerm(tagHay, CLAIM_TERMS[key]!.support)) return [key];
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

// ---- honest assertion evaluation --------------------------------------------
export type AssertionStatus = "pass" | "fail_no_evidence" | "fail_value" | "requires_store_access";
export interface Assertion { label: string; status: AssertionStatus; detail: string; evidenceQuote?: string }

export function evaluate(p: PublicProduct, req: Requirement): Assertion {
  switch (req.kind) {
    case "claim": {
      const fx = CLAIM_TERMS[req.claim!]!;
      const contra = foundTerm(p.corpus, fx.violating);
      if (contra) return { label: req.label, status: "fail_value", detail: `Public copy indicates the opposite ("${contra}").` };
      const hit = foundTerm(p.corpus, fx.support);
      if (hit) return { label: req.label, status: "pass", detail: "Stated in your public product data.", evidenceQuote: quoteAround(p.corpus, hit) ?? undefined };
      return { label: req.label, status: "fail_no_evidence", detail: "No evidence of this claim in a form an AI buyer can read (product copy, details, or structured data)." };
    }
    case "price_under": {
      if (p.minPriceUsd == null) return { label: req.label, status: "requires_store_access", detail: "No public price on this page." };
      if (p.minPriceUsd < req.capUsd!) return { label: req.label, status: "pass", detail: `Lowest readable price is $${p.minPriceUsd.toFixed(2)}.` };
      return { label: req.label, status: "fail_value", detail: `Lowest readable price is $${p.minPriceUsd.toFixed(2)}, at or above the $${req.capUsd} requirement.` };
    }
    case "variant_option": {
      const v = p.variants.find((x) => x.options.some((o) => norm(o) === norm(req.optionValue!)) || norm(x.title).includes(norm(req.optionValue!)));
      if (v && v.available) return { label: req.label, status: "pass", detail: `A "${req.optionValue}" variant is available.` };
      if (v) return { label: req.label, status: "fail_value", detail: `The "${req.optionValue}" variant is listed but shows as unavailable.` };
      return { label: req.label, status: "fail_no_evidence", detail: `No "${req.optionValue}" variant found in the public variant list.` };
    }
    case "in_stock": {
      const any = p.variants.some((v) => v.available);
      return any ? { label: req.label, status: "pass", detail: "At least one variant is available." }
        : { label: req.label, status: p.variants.length ? "fail_value" : "requires_store_access", detail: p.variants.length ? "No variant shows as available." : "No public variant data on this page." };
    }
    case "no_subscription": {
      const hard = foundTerm(p.corpus, SUBSCRIPTION_REQUIRED);
      if (hard) return { label: req.label, status: "fail_value", detail: `Public copy indicates a subscription is required ("${hard}").` };
      return { label: req.label, status: "pass", detail: "No subscription-required signal; purchasable as a one-time order." };
    }
    case "delivery": {
      const hit = foundTerm(p.corpus, DELIVERY_TERMS);
      if (hit) return { label: req.label, status: "pass", detail: "Delivery/shipping timing is stated on the public page.", evidenceQuote: quoteAround(p.corpus, hit) ?? undefined };
      return { label: req.label, status: "requires_store_access", detail: "Delivery timing isn't on the public product page — confirming it needs store access to your shipping policy." };
    }
  }
}

// ---- orchestration + result assembly ----------------------------------------
export interface ProductTestResult {
  ok: boolean; error?: string; productUrl: string;
  storeName: string | null; productName: string | null;
  task: string; outcome: "passed" | "failed"; provenCount: number; total: number;
  assertions: Assertion[]; surfacesChecked: string[]; notInspectable: string[];
  suggestedCorrection: string | null;
}

const SURFACE_LABEL = "product copy · product details · variants · structured data";

export async function runProductTest(url: string): Promise<ProductTestResult> {
  const base: ProductTestResult = {
    ok: false, productUrl: url, storeName: null, productName: null, task: "", outcome: "failed",
    provenCount: 0, total: 0, assertions: [], surfacesChecked: [], notInspectable: [], suggestedCorrection: null,
  };
  const { product, error } = await fetchPublicProduct(url);
  if (!product) return { ...base, error };

  const { summary, requirements } = buildBuyerTask(product);
  const assertions = requirements.map((r) => evaluate(product, r));
  const proven = assertions.filter((a) => a.status === "pass").length;
  // A requirement "could not be proven" if it failed on evidence OR needs store access.
  const unproven = assertions.filter((a) => a.status !== "pass");
  const firstGap = assertions.find((a) => a.status === "fail_no_evidence");

  const surfaces = [SURFACE_LABEL];
  const notInspectable = ["product metafields"];
  if (assertions.some((a) => a.status === "requires_store_access" && /delivery|shipping/i.test(a.label)))
    notInspectable.push("full shipping/returns policy");

  return {
    ok: true, productUrl: url,
    storeName: product.vendor ?? new URL(product.origin).host.replace(/^www\./, ""),
    productName: product.title, task: summary,
    outcome: unproven.length === 0 ? "passed" : "failed",
    provenCount: proven, total: assertions.length, assertions, surfacesChecked: surfaces, notInspectable,
    suggestedCorrection: firstGap
      ? `Confirm whether this product is ${firstGap.label.toLowerCase()}. If it is, state it in a product field and in customer-readable copy so an AI buyer can verify it.`
      : null,
  };
}
