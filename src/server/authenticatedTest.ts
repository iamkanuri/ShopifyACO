import type { NormalizedProduct } from "../catalog/normalize.js";
import { buildEvidence, SURFACE_LABEL, type EvidenceSentence } from "./testEvidence.js";
import { lintStrings } from "./claimLinter.js";
import {
  evaluate, buildBuyerTask, contractVersion, ENGINE_VERSION, PASSING,
  isPlaceholderIdentifier, isPublishableGtin,
  type Assertion, type AssertionStatus, type ProductTestResult, type PublicProduct, type Requirement,
} from "./productTest.js";

// ===========================================================================
// V2 CP2 — THE SAME BUYER TEST, RUN WITH FULL STORE ACCESS.
//
// The public test honestly reports certain surfaces as "requires store access":
// metafields, the complete variant list, the full policy text. Those are not
// evasions — they are the precise argument for installing. This module is what
// makes that argument pay off: it re-runs the IDENTICAL contract against the
// synced catalog, so the rows that previously said "we can't see this" resolve.
//
// The discipline is unchanged and non-negotiable:
//   • The SAME pure `evaluate()` decides every row. There is no second, laxer
//     evaluator for paying customers — that would make the free test a demo of a
//     different product.
//   • Still EVIDENCE-AVAILABILITY, never product truth. More surfaces means more
//     places to look, not a lower bar for what counts as proof.
//   • Fail closed. A surface we did not sync is still "requires store access".
//   • The claim linter still gates every merchant-visible string.
// ===========================================================================

/** Metafield namespaces whose values are merchant-authored product facts. Shopify
 *  apps write a great deal of operational junk into metafields (review aggregates,
 *  theme settings, cart scripts); treating all of it as product evidence would
 *  reintroduce exactly the chrome problem `testEvidence` exists to prevent. */
const EVIDENCE_NAMESPACES = new Set([
  "custom", "my_fields", "product", "specs", "specifications", "details",
  "descriptors", "facts", "attributes", "ingredients", "compliance", "shopify",
]);
/** Metafield value types that are human-readable prose. Everything else (json,
 *  file_reference, dimension, money, boolean…) is not a quotable sentence. */
const EVIDENCE_TYPES = /^(single_line_text_field|multi_line_text_field|rich_text_field|list\.single_line_text_field)$/;

/** True when a metafield is plausibly a merchant statement about the product. */
export function isEvidenceMetafield(m: { namespace: string; key: string; type: string | null }): boolean {
  if (!EVIDENCE_NAMESPACES.has(m.namespace.toLowerCase())) return false;
  if (m.type && !EVIDENCE_TYPES.test(m.type)) return false;
  // Review/rating aggregates are never product evidence (see testEvidence.ts).
  return !/(review|rating|star|score|_count|uuid|handle|id)$/i.test(m.key);
}

/** Rich-text metafields arrive as Shopify's JSON AST; flatten to readable text. */
function metafieldText(value: string, type: string | null): string {
  if (type === "rich_text_field" || (value.startsWith("{") && value.includes("\"children\""))) {
    try {
      const out: string[] = [];
      const walk = (n: unknown): void => {
        if (Array.isArray(n)) return void n.forEach(walk);
        if (!n || typeof n !== "object") return;
        const node = n as { value?: unknown; children?: unknown };
        if (typeof node.value === "string") out.push(node.value);
        if (node.children) walk(node.children);
      };
      walk(JSON.parse(value));
      return out.join(" ");
    } catch { /* fall through to the raw value */ }
  }
  if (type === "list.single_line_text_field" && value.startsWith("[")) {
    try {
      const arr = JSON.parse(value) as unknown[];
      if (Array.isArray(arr)) return arr.filter((x) => typeof x === "string").join(". ");
    } catch { /* fall through */ }
  }
  return value;
}

// ---- G-07: identifiers in the authenticated path (v3.0 CP3) -----------------
//
// `snapshotFromCatalog` used to set `extracted: null`, so `evaluate`'s `identifiers`
// branch took the `!p.extracted` path and answered "We couldn't read this product's
// page markup" — REQUIRES STORE ACCESS, FOR A STORE THAT GRANTED US ACCESS — while
// the barcode sat in the synced catalog on `NormalizedVariant`. Worse than a gap: a
// regression triggered by the merchant doing the thing the product asked them to do.
// `diffAssertions` then recorded the row as `unchanged` rather than `resolved`, so the
// install-value metric quietly under-counted the one row install exists to fix.
//
// WHICH VARIANT'S BARCODE REPRESENTS THE PRODUCT — the one real decision here, since a
// 12 oz bag and a 5 lb bag are different GTINs.
//
//   RULE: the first variant, in Shopify's own ordering, that publishes a PUBLISHABLE
//   GTIN; failing that, the first non-placeholder barcode; failing that, none.
//
// Why "any variant" rather than "the default" or "all of them". The row asserts
// EVIDENCE AVAILABILITY at product level — "a machine buyer can match this product to
// a catalogue entry". A roaster who barcodes their retail 12 oz bag and not the 5 lb
// foodservice sack HAS published a machine-readable identifier for this product, so
// answering "no identifier published" would be false. Requiring every variant to carry
// one would produce exactly that false statement, which is the direction this project
// treats as unrecoverable. Resolving evidence per PURCHASABLE OFFER is a real and
// separate gap (G-12); until it exists, product-level availability is the honest claim
// and it is what the row's own wording says.
//
// The fallback tier matters and is not decoration: without it, a first variant holding
// "N/A" would mask a real barcode on the second. With it, the placeholder is still
// rejected — by `evaluate`, not here — so `isPlaceholderIdentifier` and the check-digit
// arithmetic stay LOAD-BEARING on this path instead of being pre-empted by selection.
//
// ⚠️ SKU IS DELIBERATELY NOT MAPPED TO MPN. G-07 says `barcode` -> `gtin`, `sku` -> `sku`,
// and `evaluate` reads only gtin and mpn — so mapping sku onto mpn is the only way a
// SKU could change this verdict, and it would be inventing evidence. A SKU is a
// store-local stock-keeping unit; it cannot match a product to an external catalogue,
// which is precisely what the row promises. It is carried as `sku` for signal parity
// and decides nothing.
function identifiersFromCatalog(p: NormalizedProduct): { gtin: string | null; sku: string | null } {
  const barcodes = p.variants
    .map((v) => (v.barcode ?? "").trim())
    .filter((b) => b.length > 0 && !isPlaceholderIdentifier(b));
  const chosen = barcodes.find((b) => isPublishableGtin(b)) ?? barcodes[0] ?? null;
  // The SKU reported alongside is the one belonging to the variant we chose, so the
  // two fields describe the same offer rather than two different ones.
  const owner = chosen ? p.variants.find((v) => (v.barcode ?? "").trim() === chosen) : undefined;
  return { gtin: chosen, sku: (owner?.sku ?? p.variants[0]?.sku ?? null) || null };
}

/**
 * A synthetic `ExtractedPage` carrying the catalog's identifiers, so the SHARED
 * `identifiers` evaluation can adjudicate a connected store instead of claiming it
 * cannot see the page.
 *
 * `productSchema: true` is a deliberate and defensible reading, not a convenience.
 * The row's copy calls its surface "structured data", and the synced Admin API catalog
 * IS a structured product record — a more authoritative one than page JSON-LD. Setting
 * it false would make the not_proven branch say "This product publishes no Product
 * structured data", a claim about page markup we never fetched on this path: the
 * accusation-versus-finding line the engine works hard not to cross.
 *
 * ⚠️ KNOWN WORDING LIMIT, recorded rather than hidden: the not_proven copy still says
 * "structured data" where a connected merchant would rather read "your product
 * catalog". Fixing that means teaching `evaluate` which path it is on, and the ENGINE
 * CONTRACT's first rule is that the SAME pure evaluator decides every row. Not worth
 * breaking for a noun.
 */
function extractedFromCatalog(p: NormalizedProduct): PublicProduct["extracted"] {
  const { gtin, sku } = identifiersFromCatalog(p);
  return {
    jsonLdTypes: [], hasProductSchema: true,
    // `gtinSource` is null BY CONSTRUCTION on this path: the value came from
    // `identifiersFromCatalog`, not from `selectGtin`'s JSON-LD precedence walk, and
    // claiming a source we did not derive would be inventing provenance. The row reads
    // a missing source as the unqualified phrasing, so this path's copy is unchanged.
    product: { name: p.title, brand: p.vendor, sku, gtinSource: null, gtin, mpn: null, offer: null, rating: null, reviewCount: null },
    title: p.title, metaDescription: p.seoDescription, canonicalUrl: p.onlineUrl, robotsIndex: true,
    headings: { h1: [], h2: [] }, faqs: [],
    signals: {
      jsonLd: false, productSchema: true, offer: p.variants.length > 0,
      price: p.variants.some((v) => v.price != null),
      availability: p.variants.some((v) => v.available != null),
      gtin: Boolean(gtin), mpn: false, sku: Boolean(sku), brand: Boolean(p.vendor),
      rating: false, reviews: false, shipping: false, returns: false,
      faq: false, canonical: Boolean(p.onlineUrl), indexable: true,
    },
  } as PublicProduct["extracted"];
}

export interface AuthenticatedContext {
  /** Full shipping/refund policy bodies from the shop, when synced. */
  policyText?: string | null;
  /** The storefront URL, used only for display. */
  storefrontUrl?: string | null;
}

/**
 * Build the assertion engine's product snapshot from AUTHENTICATED catalog data.
 * Produces the same `PublicProduct` shape the public path produces, so the pure
 * evaluator is genuinely shared — the only difference is that more surfaces are
 * populated, and `policyStatus` can be `readable` from synced policy text.
 */
export function snapshotFromCatalog(p: NormalizedProduct, ctx: AuthenticatedContext = {}): PublicProduct {
  const metafields = p.metafields.filter(isEvidenceMetafield);
  const metaText = metafields
    .map((m) => metafieldText(m.value, m.type))
    .filter((t) => t && t.trim().length > 2)
    .join("\n");

  const optionValues = [
    ...new Set(p.variants.flatMap((v) => v.options.map((o) => o.value))),
  ].filter((v) => v && !/^(default|title)/i.test(v));

  const evidence: EvidenceSentence[] = buildEvidence([
    { surface: "product_description", text: p.description },
    { surface: "product_title", text: p.title },
    { surface: "product_options", text: optionValues.join(". ") },
    // Authenticated-only surfaces — these are what the install buys.
    { surface: "product_metafield", text: metaText },
    { surface: "seo_description", text: p.seoDescription },
    { surface: "shipping_policy", text: ctx.policyText ?? null },
  ]);

  const prices = p.variants.map((v) => v.price).filter((n): n is number => n != null);
  // Shopify's `available` is authoritative here; a null means the field wasn't
  // synced, which must NOT be read as "in stock".
  const variants = p.variants.map((v) => ({
    title: v.title ?? "",
    priceUsd: v.price,
    available: v.available === true,
    options: v.options.map((o) => o.value),
  }));

  return {
    origin: ctx.storefrontUrl ?? "",
    handle: p.handle ?? "",
    title: p.title,
    vendor: p.vendor,
    productType: p.productType,
    tags: p.tags,
    descriptionText: p.description ?? "",
    variants,
    minPriceUsd: prices.length ? Math.min(...prices) : null,
    optionNames: [...new Set(p.variants.flatMap((v) => v.options.map((o) => o.name)))],
    optionValues,
    // G-07 (v3.0 CP3): the catalog's own identifiers, so the `identifiers` row stops
    // answering "requires store access" to a store that granted store access.
    extracted: extractedFromCatalog(p),
    evidence,
    // The catalog carries no JSON-LD; availability comes from the (complete,
    // authenticated) variant list instead, which is strictly better.
    ldAvailability: null,
    // v3.5 CP2b rule D — null, i.e. UNDECIDABLE, because this path never fetched page
    // HTML and so never saw the analytics bootstrap. Null disqualifies nothing, which
    // is the fail-open direction; and this path maps `barcode`->gtin and never
    // populates `mpn` at all, so rule D has nothing to judge here in the first place.
    storefrontObjectId: null,
    policyStatus: ctx.policyText ? "readable" : "not_fetched",
    fetched: { json: true, page: false, js: false, policy: Boolean(ctx.policyText) },
    // The authenticated run reads the synced catalog over the Admin API — it makes no
    // storefront fetch at all, so there is no robots.txt request and nothing can throttle
    // it. `not_fetched` is the honest value here, not a missing measurement.
    diagnostics: {
      attempted: [], answeredBy: null, throttled: [], degraded: false,
      robots: "not_fetched", throttleSource: null,
    },
  };
}

// ---- the authenticated run ---------------------------------------------------

export type ChangeDirection = "resolved" | "improved" | "regressed" | "unchanged";

export interface AssertionDelta {
  label: string;
  before: AssertionStatus | null;
  after: AssertionStatus;
  /** How the row moved. `resolved` is the one the install argument promised. */
  change: ChangeDirection;
}

export interface AuthenticatedTestResult extends ProductTestResult {
  authenticated: true;
  contractVersion: string;
  engineVersion: string;
  /** Row-level movement vs the run we are continuing from (the public one, first). */
  deltas: AssertionDelta[];
  /** Rows that were `requires_store_access` publicly and are now adjudicated. */
  resolvedCount: number;
  surfacesAdded: string[];
}

/** Rank used only to describe MOVEMENT between two states, never to score a store. */
const RANK: Record<AssertionStatus, number> = {
  requires_store_access: 0, not_proven: 1, pass_no_blocking: 2, pass_evidenced: 3,
};

export function diffAssertions(before: Assertion[], after: Assertion[]): AssertionDelta[] {
  const prior = new Map(before.map((a) => [a.label, a.status]));
  return after.map((a) => {
    const b = prior.get(a.label) ?? null;
    let change: ChangeDirection = "unchanged";
    if (b === null) change = "unchanged";
    else if (b === "requires_store_access" && a.status !== "requires_store_access") change = "resolved";
    else if (RANK[a.status] > RANK[b]) change = "improved";
    else if (RANK[a.status] < RANK[b]) change = "regressed";
    return { label: a.label, before: b, after: a.status, change };
  });
}

/**
 * Run a PINNED contract against authenticated data. When no contract is supplied
 * (a fresh test from the product picker) one is generated the same way the public
 * path generates it, so both entry points produce the identical artifact.
 */
export function runAuthenticatedTest(args: {
  product: NormalizedProduct;
  ctx?: AuthenticatedContext;
  /** The pinned requirements. Omit to generate a fresh contract. */
  requirements?: Requirement[];
  summary?: string;
  /** The run we are continuing from, for the before/after column. */
  previous?: Assertion[];
  productUrl?: string;
}): AuthenticatedTestResult {
  const snapshot = snapshotFromCatalog(args.product, args.ctx);
  const generated = buildBuyerTask(snapshot);
  const requirements = args.requirements?.length ? args.requirements : generated.requirements;
  const summary = args.summary ?? generated.summary;

  // ⚠️ PER-ROW CONTAINMENT (v3.1 CP1). This was a bare `.map(evaluate)`, and a pinned
  // contract carrying one unrecognised claim key threw a TypeError straight through
  // it — so a single bad row took down every other row's verdict on a merchant's
  // re-run. `evaluate` is now total for that case, which is the real fix; this is the
  // belt to its braces, because a pinned contract is DATA and the set of things it
  // can contain grows without this file changing. One row failing must cost one row.
  const assertions = requirements.map((r) => {
    try {
      return evaluate(snapshot, r);
    } catch (e) {
      console.error(`[buyer-test] row FAILED, contained: id=${r.id} kind=${r.kind} label=${JSON.stringify(r.label)} — ${(e as Error)?.message}`);
      return {
        label: r.label,
        status: "requires_store_access" as AssertionStatus,
        surfacesChecked: [],
        detail: "We couldn't re-run this check automatically. That's a limitation on our side, not a finding about your store — this row is reported as unchecked rather than as a result.",
      };
    }
  });
  const count = (s: AssertionStatus) => assertions.filter((a) => a.status === s).length;

  const suggestedCorrections = assertions
    .filter((a) => a.status === "not_proven")
    .map((a) => `Confirm whether this product meets "${a.label}". If it does, state it in a product field an AI buyer can read.`);

  const surfaces = [...new Set(snapshot.evidence.map((e) => SURFACE_LABEL[e.surface]))];
  const deltas = args.previous ? diffAssertions(args.previous, assertions) : [];

  const result: AuthenticatedTestResult = {
    ok: true,
    authenticated: true,
    productUrl: args.productUrl ?? args.product.onlineUrl ?? "",
    storeName: args.product.vendor,
    productName: args.product.title,
    task: summary,
    assertions,
    evidencedCount: count("pass_evidenced"),
    noBlockingCount: count("pass_no_blocking"),
    notProvenCount: count("not_proven"),
    requiresAccessCount: count("requires_store_access"),
    total: assertions.length,
    surfacesChecked: surfaces,
    // With a store connection there is no "not inspectable" list — that phrase
    // exists only to describe the PUBLIC path's honest blind spots.
    notInspectable: [],
    suggestedCorrections,
    suggestedCorrection: suggestedCorrections[0] ?? null,
    deferred: [],
    contractVersion: contractVersion(requirements),
    engineVersion: ENGINE_VERSION,
    deltas,
    resolvedCount: deltas.filter((d) => d.change === "resolved").length,
    surfacesAdded: surfaces.filter((s) => s === SURFACE_LABEL.product_metafield || s === SURFACE_LABEL.seo_description || s === SURFACE_LABEL.shipping_policy),
  };

  // The SAME blocking honesty gate as the public path. Authentication buys more
  // evidence; it does not buy permission to make a claim we couldn't make for free.
  const lint = lintStrings([
    summary, ...suggestedCorrections,
    ...assertions.flatMap((a) => [a.label, a.detail, a.evidenceQuote]),
  ]);
  if (!lint.ok) {
    console.error(`[buyer-test] authenticated result BLOCKED by claim linter: ${lint.violations.map((v) => `${v.rule}: "${v.excerpt}"`).join(" | ")}`);
    return {
      ...result, ok: false, assertions: [], deltas: [], total: 0,
      error: "We couldn't produce a result that meets our reporting standard for this product.",
    };
  }
  return result;
}

/** Rows a merchant could still close by stating something. Drives the confirm step. */
export function unprovenClaimRows(assertions: Assertion[], requirements: Requirement[]): Array<{ requirement: Requirement; assertion: Assertion }> {
  const byLabel = new Map(requirements.map((r) => [r.label, r]));
  return assertions
    .filter((a) => a.status === "not_proven")
    .map((a) => ({ assertion: a, requirement: byLabel.get(a.label)! }))
    .filter((x) => x.requirement?.kind === "claim");
}

export { PASSING };
