// ===========================================================================
// ADVERSARIAL CORPUS SUPPORT (v2.4 CP1) — the standing harness for probing the
// evidence matchers with hostile input.
//
// WHY THIS EXISTS. v2.3's evidence audit sampled 7 real stores, found zero false
// positives, and was close to worthless as a general claim: an adversarial review
// that EXECUTED the matcher against chosen sentences then found six more defects
// on copy those stores merely happened not to write — "Made with love in small
// batches" counted as a stated material, `mpn: "N/A"` as a published identifier,
// and a product titled "Lifetime Guarantee Leather Belt" returned the whole report
// as `unreachable`.
//
// Sampling real stores catches ARTEFACTS. Only executing the matcher against
// deliberately chosen input catches LOGIC. This module is the second thing, made
// permanent — so a new requirement kind cannot ship on a passing store sample
// alone.
//
// Pure: no network, no DB, no model calls. Every judge below runs the REAL
// production evaluator, never a reimplementation of it.
// ===========================================================================

import {
  evaluate, buildBuyerTask,
  type PublicProduct, type Requirement, type AssertionStatus, type Assertion,
} from "../../src/server/productTest.js";
import { buildEvidence, type QuotableSurface } from "../../src/server/testEvidence.js";

// ---- product construction ---------------------------------------------------

export interface MkOptions {
  /** Product-copy text. Split into sentences exactly as the real pipeline does. */
  description?: string;
  /** Extra evidence on a NON-description surface (title, FAQ, structured data …). */
  extraEvidence?: Array<{ surface: QuotableSurface; text: string }>;
  title?: string | null;
  productType?: string | null;
  vendor?: string | null;
  tags?: string[];
  optionValues?: string[];
  minPriceUsd?: number | null;
  variants?: PublicProduct["variants"];
  ldAvailability?: string | null;
  policyStatus?: PublicProduct["policyStatus"];
  degraded?: boolean;
  extracted?: PublicProduct["extracted"];
  /** Replace the evidence list wholesale (for surface-scoping probes). */
  evidence?: PublicProduct["evidence"];
}

/** A PublicProduct with realistic defaults — only the field under test varies. */
export function mkProduct(o: MkOptions = {}): PublicProduct {
  const description = o.description ?? "";
  const evidence =
    o.evidence ??
    buildEvidence([
      { surface: "product_description", text: description },
      ...(o.extraEvidence ?? []),
    ]);
  return {
    origin: "https://store.example",
    handle: "p",
    title: o.title === undefined ? "Thing" : o.title,
    vendor: o.vendor === undefined ? "Acme" : o.vendor,
    productType: o.productType === undefined ? "Thing" : o.productType,
    tags: o.tags ?? [],
    descriptionText: description,
    variants: o.variants ?? [{ title: "Default", priceUsd: 12, available: true, options: ["Default"] }],
    minPriceUsd: o.minPriceUsd === undefined ? 12 : o.minPriceUsd,
    optionNames: [],
    optionValues: o.optionValues ?? [],
    extracted: o.extracted ?? null,
    evidence,
    ldAvailability: o.ldAvailability ?? null,
    policyStatus: o.policyStatus ?? "not_fetched",
    fetched: { json: true, page: false, js: false, policy: false },
    diagnostics: {
      attempted: [], answeredBy: "json", throttled: [],
      degraded: o.degraded ?? false, robots: "ok", throttleSource: null,
    },
  } as PublicProduct;
}

/** An `extracted` page carrying only the structured-data identifier fields. */
export function mkExtracted(over: { gtin?: string | null; mpn?: string | null; sku?: string | null; productSchema?: boolean } = {}): NonNullable<PublicProduct["extracted"]> {
  const { gtin = null, mpn = null, sku = null, productSchema = true } = over;
  return {
    jsonLdTypes: productSchema ? ["Product"] : [],
    hasProductSchema: productSchema,
    product: { name: null, brand: null, sku, gtin, mpn, offer: null, rating: null, reviewCount: null },
    title: null, metaDescription: null, canonicalUrl: null, robotsIndex: true,
    headings: { h1: [], h2: [] }, faqs: [],
    signals: {
      jsonLd: productSchema, productSchema, offer: true, price: true, availability: true,
      gtin: Boolean(gtin), mpn: Boolean(mpn), sku: Boolean(sku), brand: false,
      rating: false, reviews: false, shipping: false, returns: false,
      faq: false, canonical: true, indexable: true,
    },
  } as NonNullable<PublicProduct["extracted"]>;
}

// ---- requirement constructors ----------------------------------------------

export const attr = (attribute: string): Requirement =>
  ({ id: `attr_${attribute}`, kind: "attribute", attribute, label: `attr:${attribute}` });
export const claimReq = (claim: string): Requirement =>
  ({ id: "claim0", kind: "claim", claim, label: `claim:${claim}` });
export const idsReq = (): Requirement =>
  ({ id: "ids", kind: "identifiers", label: "Product identifier (GTIN or MPN) is published" });
export const deliveryReq = (): Requirement =>
  ({ id: "delivery", kind: "delivery", label: "Delivery timing is stated" });
export const stockReq = (): Requirement =>
  ({ id: "stock", kind: "in_stock", label: "In stock and purchasable" });
export const subReq = (): Requirement =>
  ({ id: "sub", kind: "no_subscription", label: "Available as a one-time purchase" });
export const priceReq = (capUsd: number): Requirement =>
  ({ id: "price", kind: "price_under", capUsd, label: `Price under $${capUsd}` });
export const variantReq = (optionValue: string): Requirement =>
  ({ id: "variant", kind: "variant_option", optionValue, label: `${optionValue} option available` });

// ---- the judges -------------------------------------------------------------

/** Full assertion for a requirement against a constructed product. */
export function assess(product: PublicProduct, requirement: Requirement): Assertion {
  return evaluate(product, requirement);
}

/** The status a single sentence of product copy produces for a requirement. */
export function statusOf(sentence: string, requirement: Requirement, o: MkOptions = {}): AssertionStatus {
  return evaluate(mkProduct({ ...o, description: sentence }), requirement).status;
}

/** The status, plus the quote actually rendered — a pass with the WRONG quote is
 *  still a defect, and status alone cannot see it. */
export function verdictOf(sentence: string, requirement: Requirement, o: MkOptions = {}): {
  status: AssertionStatus; quote: string | undefined; detail: string; surface: string | undefined;
} {
  const a = evaluate(mkProduct({ ...o, description: sentence }), requirement);
  return { status: a.status, quote: a.evidenceQuote, detail: a.detail, surface: a.evidenceSurface };
}

/** The identifiers row, driven only by structured-data values. The product copy is
 *  irrelevant to it, so the sentence is fixed and only the identifier varies. */
export function verdictOfIds(ids: { gtin?: string | null; mpn?: string | null; sku?: string | null; productSchema?: boolean }): {
  status: AssertionStatus; detail: string;
} {
  const a = evaluate(mkProduct({ description: "A thing.", extracted: mkExtracted(ids) }), idsReq());
  return { status: a.status, detail: a.detail };
}

/** The requirement ids a product would actually be asked — for gating probes
 *  (`onlyFor`, category inference, merchant-string exclusion). */
export function requirementsFor(o: MkOptions = {}): Requirement[] {
  return buildBuyerTask(mkProduct(o)).requirements;
}

/** The first line the merchant reads. Linted; must never block the report. */
export function summaryFor(o: MkOptions = {}): string {
  return buildBuyerTask(mkProduct(o)).summary;
}

// ---- the corpus record ------------------------------------------------------

/**
 * One adversarial case. `why` is mandatory and load-bearing: a corpus entry
 * without a stated reason cannot be reviewed, and a future session cannot tell a
 * deliberate expectation from an accident of the current implementation.
 */
export interface CorpusCase {
  /** The hostile (or canonical-true) sentence, verbatim. */
  sentence: string;
  requirement: Requirement;
  expected: AssertionStatus;
  /** Why this is the right answer — in evidence-availability terms. */
  why: string;
  /** Hostile-input class, so coverage gaps are visible. */
  class: HostileClass;
  /** Product-shape overrides (title, category, structured data …). */
  opts?: MkOptions;
}

export type HostileClass =
  | "packaging-subject"     // the term is about the packaging, not the product
  | "shipment-subject"      // …about the shipment
  | "bundled-item"          // …about a different item in the box
  | "competitor"            // …about someone else's product
  | "review-quote"          // …inside a customer review
  | "placeholder"           // the value is a placeholder, not a value
  | "negation"              // the sentence denies the attribute
  | "marketing-idiom"       // "made with love", "built to last"
  | "canonical-true"        // a real statement that MUST still pass
  | "merchant-string"       // merchant-controlled text reaching a linted output
  | "category-gate"         // the requirement should/shouldn't be asked at all
  | "surface-scoping";      // evidence taken from a surface it may not come from

/** Run one case and report the disagreement, if any. */
export function checkCase(c: CorpusCase): { ok: boolean; actual: AssertionStatus; quote?: string } {
  const v = verdictOf(c.sentence, c.requirement, c.opts ?? {});
  return { ok: v.status === c.expected, actual: v.status, quote: v.quote };
}
