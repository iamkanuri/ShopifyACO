// ===========================================================================
// G-10 — APPLICABILITY GATING. Deciding which entries a product should be asked.
//
// THE PROBLEM THIS CLOSES, measured rather than argued. `applicability` in a
// standard is three prose fields (`applies_when`, `does_not_apply_when`,
// `signal`) that nothing executes, so a compiled requirement list fires every
// entry on every product. The first Coffee Standard run measured the cost: the
// capture took each store's FIRST product handle, roasters lead with merchandise,
// and 11 of 25 captured "coffee" products were a t-shirt, a mug, a cocktail shaker
// or an espresso machine. Every entry ran on all of them. Six of ten entries were
// then reported as carrying ~no information, on a sample that was partly measuring
// whether a tote bag states an organic certification.
//
// TWO HONESTY REQUIREMENTS, both from G-10's own risk note, and both non-optional:
//
//   1. THE RESULT MUST REPORT WHAT IT EXCLUDED AND WHY. A conformance list that
//      quietly drops entries is worse than one that runs them all, because the
//      reader cannot distinguish "passed" from "was never asked". `SURFACE_PRIORITY`
//      already contains the cautionary instance: `attr:warranty` sat in the list for
//      three sessions after its requirement stopped existing, because a priority
//      entry matching no candidate is a silent no-op.
//   2. A PREDICATE THAT EXCLUDES EVERYTHING IS A LOUD ERROR, never an empty pass.
//      `src/measure/completion.ts` is the model: INCOMPLETE, and `includedCount`
//      is null rather than 0, so a caller that only looks at the number cannot read
//      "nothing was asked" as "nothing failed".
//
// WHY THE RULES LIVE IN A SIDECAR AND NOT IN standard.json. `standard_hash` covers
// standard.json's canonical bytes, and a published citation ("your PDPs fail
// ALS-COFFEE-1.0-CERT-001") resolves through that hash. Adding machine-readable
// predicates to the document would change v1.0's identity and invalidate every
// citation already made against it, to add something that is not part of what the
// standard ASSERTS — it is the executable reading of what the standard already says
// in prose. So it sits beside the document as `applicability.json`, versioned with
// it, and `assertSidecarCoversStandard` requires one rule per executable entry so a
// new entry cannot silently default to "always applies".
//
// The sidecar is subordinate: where it and the prose disagree, the prose is the
// standard and the sidecar is a bug.
//
// Pure: no network, no filesystem, no clock.
// ===========================================================================

import type { Requirement } from "../src/server/productTest.js";

// ---- what we classify against ------------------------------------------------
//
// A structural subset of the engine's `PublicProduct`. Declared locally and
// narrowly ON PURPOSE: this module must be able to classify a product from a
// capture, a fixture or a live snapshot without depending on the full shape, and
// listing exactly the fields it may read is what makes "never tags" checkable by
// reading the type rather than by trusting the code.
export interface ClassifiableProduct {
  productType?: string | null;
  title?: string | null;
  /** JSON-LD `Product.category`, when the page publishes one. */
  ldCategory?: string | null;
  /** The second-to-last BreadcrumbList crumb, when the page publishes one. */
  breadcrumb?: string | null;
  /** Structured-data presence, for entries gated on readable page markup. */
  hasProductSchema?: boolean;
  /** Purchasable option values, for format detection that titles miss. */
  optionValues?: string[];
}

export type CategorySignal = "product_type" | "ld_category" | "breadcrumb" | "title" | "none";

export interface Classification {
  /** Which signal decided it — authoritative signals before the title fallback. */
  signal: CategorySignal;
  /** The text the decision was read from. */
  text: string;
  verdict: "in_category" | "out_of_category" | "unknown";
}

/**
 * The signal ORDER is the one the engine already uses and G-10 requires:
 * `product_type` authoritative, `title` fallback, **never tags**.
 *
 * Tags are excluded structurally rather than by convention — `ClassifiableProduct`
 * has no tags field, so this module cannot read them even by accident. The reason
 * is recorded in the engine at the `CATEGORY_CLAIMS` comment and in the standard's
 * own `category_signals.never`: a coffee-SCENTED soap must never read as a coffee
 * product, and tags are exactly where that mistake gets made.
 */
const AUTHORITATIVE: Array<[CategorySignal, (p: ClassifiableProduct) => string | null | undefined]> = [
  ["product_type", (p) => p.productType],
  ["ld_category", (p) => p.ldCategory],
  ["breadcrumb", (p) => p.breadcrumb],
];

export interface CategoryRule {
  /** Matches text that puts the product IN the standard's category. */
  inCategory: RegExp;
  /** Matches text that puts it OUT, checked FIRST — the envelope's `excludes`.
   *  Equipment and coffee-flavoured non-coffee live here, and they must beat the
   *  positive match: "Coffee Grinder" contains "coffee". */
  outOfCategory: RegExp;
}

/**
 * Classify a product against one standard's category envelope.
 *
 * FAILS TO `unknown`, NOT TO `in_category`. A product with no product_type and an
 * undecisive title is not the same as one that clearly does not match, and the two
 * must not render the same — the first means we could not ask, the second means the
 * question does not arise. Neither means "passed".
 */
export function classify(p: ClassifiableProduct, rule: CategoryRule): Classification {
  for (const [signal, read] of AUTHORITATIVE) {
    const text = (read(p) ?? "").trim();
    if (!text) continue;
    if (rule.outOfCategory.test(text)) return { signal, text, verdict: "out_of_category" };
    if (rule.inCategory.test(text)) return { signal, text, verdict: "in_category" };
    // An authoritative signal that is PRESENT and matches neither is decisive
    // against: the merchant has categorised this product and did not categorise it
    // here. Falling through to the title would let a product typed "Apparel" be
    // rescued by the word "coffee" in "Coffee Lovers Tee", which is the exact
    // failure the first standard run measured.
    return { signal, text, verdict: "out_of_category" };
  }
  const title = (p.title ?? "").trim();
  if (title) {
    if (rule.outOfCategory.test(title)) return { signal: "title", text: title, verdict: "out_of_category" };
    if (rule.inCategory.test(title)) return { signal: "title", text: title, verdict: "in_category" };
    // The title is a FALLBACK, so its silence is not decisive — a coffee bag titled
    // "Kirinyaga AA" says nothing either way. `unknown`, and the caller must say so.
    return { signal: "title", text: title, verdict: "unknown" };
  }
  return { signal: "none", text: "", verdict: "unknown" };
}

// ---- the sidecar -------------------------------------------------------------

/** The machine-readable conditions an entry can require. Deliberately a CLOSED set:
 *  a sidecar naming a condition this file does not implement is an error, not a
 *  silently-true predicate. That is the `attr:warranty` silent-no-op failure, and
 *  it is the one thing an applicability layer must not reproduce. */
export type Condition =
  /** The product is in the standard's category at all. */
  | "in_category"
  /** Not a pod, capsule or pre-dosed sachet — the envelope's format exclusion. */
  | "not_preportioned"
  /** The page publishes readable Product structured data. */
  | "product_schema_present"
  /** A physical good shipped to the buyer. True for everything in scope here; kept
   *  explicit so DELIV-001's stated condition is represented rather than assumed. */
  | "physical_good"
  /** The standard itself says applicability cannot be decided from public data —
   *  typically because it depends on the entry's own answer (is this decaf?). Never
   *  satisfiable, and reported with that reason rather than as a failed product. */
  | "undecidable_from_public_data";

export interface SidecarRule {
  entry: string;
  requires: Condition[];
  /** Quotes the prose this rule is the executable reading of, so a reviewer can
   *  check the two against each other without opening both files. */
  from: string;
}

export interface Sidecar {
  standard_id: string;
  version: string;
  category: { in_category: string; out_of_category: string };
  rules: SidecarRule[];
}

const PREPORTIONED = /\b(pods?|capsules?|k-?cups?|nespresso|sachets?|single[- ]serve|instant sticks?)\b/i;

function conditionHolds(c: Condition, p: ClassifiableProduct, cls: Classification): boolean | "unknown" {
  switch (c) {
    case "in_category":
      return cls.verdict === "in_category" ? true : cls.verdict === "out_of_category" ? false : "unknown";
    case "not_preportioned": {
      const hay = [p.productType, p.title, ...(p.optionValues ?? [])].filter(Boolean).join(" ");
      return !PREPORTIONED.test(hay);
    }
    case "product_schema_present":
      return p.hasProductSchema === true ? true : p.hasProductSchema === false ? false : "unknown";
    case "physical_good":
      return true;
    case "undecidable_from_public_data":
      return "unknown";
  }
}

export type ExclusionReason =
  | "out_of_category" | "unknown_category" | "preportioned_format"
  | "no_product_schema" | "undecidable_applicability" | "no_sidecar_rule";

export interface EntryDecision {
  entry: string;
  asked: boolean;
  reason?: ExclusionReason;
  /** Human sentence for the report. */
  detail?: string;
}

export interface ApplicabilityReport {
  /** VERIFIED_CLEAN is deliberately NOT one of these: this measures coverage, not
   *  conformance. `INCOMPLETE` means the run must not be read as a result. */
  state: "APPLIED" | "INCOMPLETE";
  classification: Classification;
  /** null on INCOMPLETE — never 0. A caller that only reads the number must not be
   *  able to mistake "nothing was asked" for "nothing failed". */
  includedCount: number | null;
  decisions: EntryDecision[];
  requirements: Requirement[];
  /** Why the run is INCOMPLETE, when it is. */
  blockedBy?: string;
}

const DETAIL: Record<ExclusionReason, string> = {
  out_of_category: "this product is not in the standard's category, so the entry does not arise",
  unknown_category: "this product could not be classified from product_type, structured data, breadcrumb or title",
  preportioned_format: "a pod, capsule or pre-dosed sachet, where the standard's envelope excludes the entry",
  no_product_schema: "the page publishes no readable Product structured data, which this entry requires",
  undecidable_applicability: "the standard states that applicability here is undecidable from public data",
  no_sidecar_rule: "no applicability rule is registered for this entry — a gap in the sidecar, not a finding about the product",
};

/**
 * Decide which compiled requirements to ask of one product.
 *
 * `requirements` must already be compiled from the standard (`compileStandard`), and
 * every one is matched to its entry by `Requirement.id`, which `bindingToRequirement`
 * sets to the entry id.
 */
export function applyApplicability(
  requirements: Requirement[],
  sidecar: Sidecar,
  product: ClassifiableProduct,
): ApplicabilityReport {
  const rule: CategoryRule = {
    inCategory: new RegExp(sidecar.category.in_category, "i"),
    outOfCategory: new RegExp(sidecar.category.out_of_category, "i"),
  };
  const cls = classify(product, rule);
  const byEntry = new Map(sidecar.rules.map((r) => [r.entry, r]));

  const decisions: EntryDecision[] = [];
  const included: Requirement[] = [];
  for (const req of requirements) {
    const sr = byEntry.get(req.id);
    if (!sr) {
      decisions.push({ entry: req.id, asked: false, reason: "no_sidecar_rule", detail: DETAIL.no_sidecar_rule });
      continue;
    }
    let excluded: ExclusionReason | null = null;
    for (const c of sr.requires) {
      const held = conditionHolds(c, product, cls);
      if (held === true) continue;
      excluded =
        c === "in_category" ? (held === "unknown" ? "unknown_category" : "out_of_category")
        : c === "not_preportioned" ? "preportioned_format"
        : c === "product_schema_present" ? "no_product_schema"
        : c === "undecidable_from_public_data" ? "undecidable_applicability"
        : "out_of_category";
      break;
    }
    if (excluded) decisions.push({ entry: req.id, asked: false, reason: excluded, detail: DETAIL[excluded] });
    else { decisions.push({ entry: req.id, asked: true }); included.push(req); }
  }

  // The loud error. Note it fires on an empty INPUT too: compiling zero requirements
  // and then "applying" them is not a product that passed, it is a run that never
  // happened, and the two must not render the same.
  if (included.length === 0) {
    return {
      state: "INCOMPLETE", classification: cls, includedCount: null, decisions, requirements: [],
      blockedBy: requirements.length === 0
        ? "no requirements were compiled from the standard, so nothing was asked"
        : `the applicability predicate excluded all ${requirements.length} compiled entr${requirements.length === 1 ? "y" : "ies"} ` +
          `(classification: ${cls.verdict} via ${cls.signal}${cls.text ? ` = ${JSON.stringify(cls.text)}` : ""}). ` +
          `"the standard did not apply to this product" and "this product passed" must never render the same.`,
    };
  }
  return { state: "APPLIED", classification: cls, includedCount: included.length, decisions, requirements: included };
}

/** Every executable entry needs a rule, or a new entry silently defaults to
 *  "always applies" — which is the state this whole module exists to end. */
export function assertSidecarCoversStandard(
  sidecar: Sidecar,
  executableEntryIds: string[],
): { ok: boolean; missing: string[]; stale: string[] } {
  const have = new Set(sidecar.rules.map((r) => r.entry));
  const want = new Set(executableEntryIds);
  const missing = executableEntryIds.filter((id) => !have.has(id));
  const stale = [...have].filter((id) => !want.has(id));
  return { ok: missing.length === 0 && stale.length === 0, missing, stale };
}

/** One-line-per-entry rendering for a run record. */
export function renderApplicability(r: ApplicabilityReport): string {
  const head =
    `applicability: ${r.state}  classified ${r.classification.verdict} via ${r.classification.signal}` +
    (r.classification.text ? ` = ${JSON.stringify(r.classification.text)}` : "") +
    `  asked ${r.includedCount ?? "null (INCOMPLETE)"} of ${r.decisions.length}`;
  const lines = r.decisions.map((d) => `  ${d.asked ? "ASK " : "SKIP"}  ${d.entry}${d.asked ? "" : `  — ${d.reason}: ${d.detail}`}`);
  return [head, ...lines, ...(r.blockedBy ? [`  BLOCKED: ${r.blockedBy}`] : [])].join("\n");
}
