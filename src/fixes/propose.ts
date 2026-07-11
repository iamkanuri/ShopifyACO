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

export type WritableField = "seoTitle" | "seoDescription";

/** Map a write_products proposal target → the NormalizedProduct field the apply
 *  engine re-reads (for the conflict check) and writes. Returns null for copy_ready
 *  or any target we will not directly write. We deliberately only auto-write the SEO
 *  fields — exact, reversible, factual reformats of data the merchant already has. */
export function writableField(target: string): WritableField | null {
  switch (target) {
    case "seo.title": return "seoTitle";
    case "seo.description": return "seoDescription";
    default: return null;
  }
}
