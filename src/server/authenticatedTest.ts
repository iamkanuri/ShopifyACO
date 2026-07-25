import type { NormalizedProduct } from "../catalog/normalize.js";
import { buildEvidence, SURFACE_LABEL, type EvidenceSentence } from "./testEvidence.js";
import { lintStrings } from "./claimLinter.js";
import {
  evaluate, buildBuyerTask, contractVersion, ENGINE_VERSION, PASSING,
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
    extracted: null,
    evidence,
    // The catalog carries no JSON-LD; availability comes from the (complete,
    // authenticated) variant list instead, which is strictly better.
    ldAvailability: null,
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

  const assertions = requirements.map((r) => evaluate(snapshot, r));
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
