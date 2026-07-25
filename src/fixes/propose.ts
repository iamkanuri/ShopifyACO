import type { Finding } from "../diagnosis/diagnose.js";

// ===========================================================================
// Fix Studio proposal generation (Phase 6) — PURE. Turns diagnosis findings +
// the merchant's own catalog data into concrete, reviewable change proposals.
//
// Two tiers, mirroring the diagnosis layer:
//   • write_products — a direct Admin-API change to ONE product field. We ONLY
//     ever reformat/expose data the merchant already has (e.g. backfill an empty
//     SEO description from the existing product description). We NEVER fabricate
//     facts (review counts, GTINs, prices) — those are surfaced as copy_ready.
//   • copy_ready — validated, copy-pasteable theme output (JSON-LD snippets) the
//     merchant adds to their theme. Templates with placeholders are labeled so a
//     merchant can't accidentally publish fabricated numbers.
//
// Nothing here writes anything. Generation is deterministic + side-effect free.
// ===========================================================================

export interface CatalogProduct {
  productGid: string;
  title: string | null;
  description: string | null;
  vendor: string | null;
  productType: string | null;
  onlineUrl: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  price?: number | null;
  currency?: string | null;
}

export type ProposalKind = "write_products" | "copy_ready";

export interface FixProposal {
  productGid: string | null;
  kind: ProposalKind;
  target: string; // seo.title | seo.description | descriptionHtml | jsonld:<Type> | guidance:<signal>
  label: string;
  currentValue: string | null;
  proposedValue: string;
  /** The live value this change is based on; apply re-reads and must still match. */
  basedOn: string | null;
  rationale: string;
  evidence: { findingKind?: string; signal?: string; intervention?: string; mechanism?: string; citations?: string[] };
}

const SEO_TITLE_MAX = 60;
const SEO_DESC_MAX = 160;

function trunc(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + "…";
}

const evidenceOf = (f?: Finding): FixProposal["evidence"] =>
  f
    ? { findingKind: f.kind, signal: f.signal, intervention: f.recommendedIntervention, mechanism: f.expectedMechanism, citations: f.citations }
    : {};

/** Build a factual Product JSON-LD snippet from KNOWN catalog data only.
 *  We deliberately OMIT offers/price: our catalog doesn't record the store's
 *  currency, so emitting a priceCurrency would risk asserting the wrong one. The
 *  merchant's theme already renders price; an Offer block is left as copy_ready
 *  guidance with an explicit <YOUR_CURRENCY> placeholder when needed. */
function productJsonLd(p: CatalogProduct): string {
  const node: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.title ?? "",
  };
  if (p.description) node.description = trunc(p.description, 500);
  if (p.vendor) node.brand = { "@type": "Brand", name: p.vendor };
  if (p.onlineUrl) node.url = p.onlineUrl;
  return `<script type="application/ld+json">\n${JSON.stringify(node, null, 2)}\n</script>`;
}

// Copy-ready TEMPLATES for facts we won't invent. Placeholders are obvious.
const TEMPLATE: Partial<Record<string, (p: CatalogProduct) => { label: string; value: string }>> = {
  reviews: () => ({
    // Duplicate-schema guard: reviews apps (Judge.me, Loox, Shopify Reviews…) often already
    // inject AggregateRating client-side, which our raw-HTML crawl can't see — so tell the
    // merchant to check before pasting a second rating block (duplicates conflict).
    label: "Add review structured data (your REAL counts — check first: a reviews app may already emit AggregateRating; don't add a duplicate)",
    value: `"aggregateRating": {\n  "@type": "AggregateRating",\n  "ratingValue": "<YOUR_AVERAGE_RATING>",\n  "reviewCount": "<YOUR_REVIEW_COUNT>"\n}`,
  }),
  shipping: () => ({
    label: "Declare shipping terms in your Offer",
    // <YOUR_CURRENCY> like every other placeholder — we don't know the store's currency,
    // and hardcoding USD would assert wrong data for non-US merchants.
    value: `"shippingDetails": {\n  "@type": "OfferShippingDetails",\n  "shippingRate": { "@type": "MonetaryAmount", "value": "<COST_OR_0>", "currency": "<YOUR_CURRENCY>" },\n  "deliveryTime": { "@type": "ShippingDeliveryTime" }\n}`,
  }),
  returns: () => ({
    label: "Declare your return policy in your Offer",
    value: `"hasMerchantReturnPolicy": {\n  "@type": "MerchantReturnPolicy",\n  "merchantReturnDays": <YOUR_RETURN_WINDOW>,\n  "returnPolicyCategory": "https://schema.org/MerchantReturnFiniteReturnWindow"\n}`,
  }),
  faq: () => ({
    label: "Add an FAQ schema for the questions shoppers actually ask",
    value: `<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "FAQPage",\n  "mainEntity": [\n    { "@type": "Question", "name": "<QUESTION>", "acceptedAnswer": { "@type": "Answer", "text": "<ANSWER>" } }\n  ]\n}\n</script>`,
  }),
  gtin: () => ({
    label: "Add the product's barcode/GTIN",
    value: "Set the variant's Barcode (GTIN/UPC/EAN) in Shopify → Products → Variants. We won't invent an identifier.",
  }),
  indexable: () => ({
    label: "Remove the noindex directive",
    value: "This product page is set to noindex (theme/SEO setting, not the product API). Remove it so assistants can index and cite the page.",
  }),
  reachability: () => ({
    label: "Make the product page reachable",
    value: "The page could not be fetched. Ensure it returns HTTP 200 and isn't blocked by robots.txt before re-running the diagnosis.",
  }),
};

/** Compose an explicit SEO title that VISIBLY differs from Shopify's fallback (the bare
 *  product title): "{title} | {vendor}" (or product type). Purely existing catalog facts —
 *  no fabrication. Returns null when nothing distinct fits: when seo.title is unset Shopify
 *  already renders the product title, so proposing the title verbatim would be a write the
 *  merchant can't observe anywhere (the admin looks identical before and after — the exact
 *  "did nothing" failure an App Store reviewer flagged under 2.1.4). */
export function composeSeoTitle(p: CatalogProduct): string | null {
  const title = p.title?.replace(/\s+/g, " ").trim();
  if (!title) return null;
  for (const raw of [p.vendor, p.productType]) {
    const suffix = raw?.replace(/\s+/g, " ").trim();
    if (!suffix) continue;
    if (title.toLowerCase().includes(suffix.toLowerCase())) continue; // already conveyed by the title
    const composed = `${title} | ${suffix}`;
    if (composed.length <= SEO_TITLE_MAX) return composed;
  }
  return null;
}

/** SEO backfill: the only DIRECT write — reformat existing factual fields when the
 *  merchant left SEO empty. Never overwrites a non-empty SEO value, and never proposes
 *  a value identical to what Shopify already shows via fallback (no placebo fixes). */
export function proposeSeoBackfill(p: CatalogProduct, finding?: Finding): FixProposal[] {
  const out: FixProposal[] = [];
  if (!p.seoTitle && p.title) {
    const composed = composeSeoTitle(p);
    if (composed) {
      out.push({
        productGid: p.productGid, kind: "write_products", target: "seo.title",
        label: "Set an explicit SEO title (adds your brand to the page title)",
        currentValue: p.seoTitle, proposedValue: composed, basedOn: p.seoTitle,
        rationale: "No custom SEO title is set, so the page title falls back to the bare product title. This sets an explicit, brand-qualified title assistants and search can attribute — composed only from your existing catalog data.",
        evidence: evidenceOf(finding),
      });
    }
  }
  if (!p.seoDescription && p.description) {
    out.push({
      productGid: p.productGid, kind: "write_products", target: "seo.description",
      label: "Backfill the SEO description from the product description",
      currentValue: p.seoDescription, proposedValue: trunc(p.description, SEO_DESC_MAX), basedOn: p.seoDescription,
      rationale: "The SEO description is empty; it's a primary machine-readable summary. This only reuses your existing product description.",
      evidence: evidenceOf(finding),
    });
  }
  return out;
}

// ---- V2 CP3: merchant-confirmed claim statements ----------------------------
//
// THE RULE THIS ENFORCES: a Buyer Test finding is EVIDENCE-AVAILABILITY — "no
// statement an AI buyer could verify". That is never, on its own, grounds to write
// a claim into a store, because we do not know whether the claim is TRUE. Only the
// merchant knows. So a proposal here requires their explicit "yes", and the text we
// propose is a plain restatement of what they confirmed — never an embellishment,
// never a benefit, never a superlative.
//
// A "no" must reach this function as no call at all: the requirement is closed and
// an AI buyer is right not to verify it.

/** Sentence templates keyed by claim. Deliberately flat, factual and short — this
 *  is the merchant's assertion being written down, not marketing copy we invented. */
const CLAIM_SENTENCE: Record<string, string> = {
  aluminum_free: "This product is aluminum-free.",
  baking_soda_free: "This product is made without baking soda.",
  cruelty_free: "This product is cruelty-free and not tested on animals.",
  vegan: "This product is vegan.",
  fragrance_free: "This product is fragrance-free.",
  paraben_free: "This product is paraben-free.",
  sulfate_free: "This product is sulfate-free.",
  single_origin: "This product is single-origin.",
  organic: "This product is organic.",
  fair_trade: "This product is fair-trade.",
  gluten_free: "This product is gluten-free.",
  third_party_tested: "This product is third-party tested.",
  bpa_free: "This product is BPA-free.",
};

/** The sentence we would add for a confirmed claim, or null when we have no
 *  factual phrasing for it. Fail closed: no template ⇒ no proposal, rather than
 *  assembling a claim sentence out of a UI label. */
export function claimSentence(claimKey: string, label: string): string | null {
  const known = CLAIM_SENTENCE[claimKey];
  if (known) return known;
  // A label-derived sentence is still the merchant's own words (the label is the
  // requirement they confirmed), but only when it reads as a plain attribute.
  const clean = label.split("/")[0]!.trim();
  return /^[a-z0-9 \-]{3,40}$/i.test(clean) ? `This product is ${clean.toLowerCase()}.` : null;
}

export interface ConfirmedClaim {
  claimKey: string;
  label: string;
  /** The requirement_confirmations row that authorized this. Required. */
  confirmationId: number;
  buyerTestId?: number | null;
}

/**
 * Propose adding a merchant-CONFIRMED claim to the product description.
 *
 * Returns [] unless the claim already has nowhere to live — if the description
 * already states it, there is nothing to fix and we must not duplicate it.
 * The proposal APPENDS; it never rewrites or removes the merchant's copy.
 */
export function proposeClaimStatement(p: CatalogProduct, claim: ConfirmedClaim): FixProposal[] {
  const sentence = claimSentence(claim.claimKey, claim.label);
  if (!sentence) return [];
  const current = p.description ?? "";
  // Already stated ⇒ the gap was in a surface we couldn't read, not in the copy.
  const core = sentence.replace(/^This product is\s*/i, "").replace(/\.$/, "").toLowerCase();
  if (core && current.toLowerCase().includes(core)) return [];

  const proposed = current.trim() ? `${current.trim()}\n\n${sentence}` : sentence;
  return [{
    productGid: p.productGid,
    kind: "write_products",
    target: "descriptionHtml",
    label: `State "${claim.label}" in the product description`,
    currentValue: current || null,
    proposedValue: proposed,
    basedOn: current || null,
    rationale:
      `You confirmed this product is ${claim.label.toLowerCase()}. Your product description doesn't state it, so an AI buyer reading your public data has no way to verify it. This appends one plain sentence and changes nothing else.`,
    evidence: {
      findingKind: "buyer_test",
      signal: "claim_statement",
      intervention: "State the confirmed attribute in customer-readable product copy.",
      // Mechanism, hedged — never a promised outcome.
      mechanism: "An assistant that reads the product description can then find the attribute stated there. Whether any given assistant surfaces it depends on that assistant.",
    },
  }];
}

/** Generate proposals for one product from its findings + catalog data. */
export function proposeFixes(product: CatalogProduct, findings: Finding[]): FixProposal[] {
  const proposals: FixProposal[] = [];
  // Direct, factual SEO backfills (independent of findings).
  proposals.push(...proposeSeoBackfill(product, findings[0]));

  const seen = new Set<string>();
  for (const f of findings) {
    const sig = f.signal;
    if (!sig || seen.has(sig)) continue;
    seen.add(sig);

    if (sig === "productSchema") {
      proposals.push({
        productGid: product.productGid, kind: "copy_ready", target: "jsonld:Product",
        label: "Add Product structured data (built from your catalog)",
        currentValue: null, proposedValue: productJsonLd(product), basedOn: null,
        rationale: f.recommendedIntervention,
        evidence: evidenceOf(f),
      });
      continue;
    }
    const tpl = TEMPLATE[sig];
    if (tpl) {
      const { label, value } = tpl(product);
      proposals.push({
        productGid: product.productGid, kind: "copy_ready", target: `guidance:${sig}`,
        label, currentValue: null, proposedValue: value, basedOn: null,
        rationale: f.recommendedIntervention,
        evidence: evidenceOf(f),
      });
    }
  }
  return proposals;
}

export type WritableField = "seoTitle" | "seoDescription" | "descriptionHtml";

/**
 * The field on a re-read `NormalizedProduct` that holds a writable field's live
 * value — the conflict baseline. The names differ for the body: we WRITE
 * `descriptionHtml` but Shopify hands it back as plain-text `description`, so
 * comparing `live.descriptionHtml` would read `undefined` and treat every product
 * as unchanged. That would silently disable the one guard that stops us clobbering
 * a merchant's edit, so the mapping is explicit rather than incidental.
 */
export function liveFieldOf(field: WritableField): "seoTitle" | "seoDescription" | "description" {
  return field === "descriptionHtml" ? "description" : field;
}

/** Map a write_products proposal target → the NormalizedProduct field the apply
 *  engine re-reads (for the conflict check) and writes. Returns null for copy_ready
 *  or any target we will not directly write. We deliberately only auto-write the SEO
 *  fields — exact, reversible, factual reformats of data the merchant already has. */
export function writableField(target: string): WritableField | null {
  switch (target) {
    case "seo.title": return "seoTitle";
    case "seo.description": return "seoDescription";
    // V2 CP3 — the body copy, where a merchant-confirmed claim actually belongs.
    case "descriptionHtml": return "descriptionHtml";
    default: return null;
  }
}
