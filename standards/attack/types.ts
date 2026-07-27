// ===========================================================================
// THE ATTACK TEMPLATIZER — types.
//
// WHY THIS EXISTS. `VOCABULARY_REVIEW.md` §2 defines the obligatory attack
// classes a vocabulary must survive. Applying them is currently a research
// project with four agents; every defect this project has ever found is an
// instance of one of them. Generation of the hostile sentences is mechanical
// work and should be a script, so that the scarce human attention goes to the
// part that is not mechanical: judging whether a sentence is genuinely
// misleading.
//
// ⚠️ WHAT THIS MODULE DELIBERATELY DOES NOT DO. It does not evaluate, score,
// adjudicate or decide anything. It imports nothing from `src/` except the
// surface type. Generation and adjudication are kept apart on purpose: a
// generator that also judges its own output is the self-attack failure the
// review gate exists to forbid, mechanised and given a version number.
//
// ⚠️ AND WHAT MECHANISATION DOES NOT BUY. A generated attack set is still the
// AUTHOR'S set. The generator lowers the cost of COVERAGE; it does nothing
// whatever for INDEPENDENCE, and the gate's separation of author, attacker and
// refuter stands unchanged. See `README.md` §5.
//
// Pure: no network, no database, no clock, no model calls, no randomness.
// ===========================================================================

import type { QuotableSurface } from "../../src/server/testEvidence.js";

// ---- the classes ------------------------------------------------------------

/**
 * The attack classes.
 *
 * The first six are `VOCABULARY_REVIEW.md` §2, in its order and with its names.
 * The last two were forced by evidence rather than chosen:
 *
 *  • `tense_modality` — the S3 brief added it, because the decaf review closed
 *    ZERO of `"Until 2024 we used X"`, `"we hope to use X"`, `"we are
 *    evaluating X"`, `"we asked about X"`, and none of those is a subject
 *    problem. Nothing in the engine reads tense or modality.
 *
 *  • `denial` — found by classifying the KNOWN corpus against the six (see
 *    `corpus/decaf-review.json` and the proof in `__tests__/attack.test.ts`).
 *    §2's class 6 covers the denial shape for VIOLATING terms only: "the
 *    sentence in which a compliant store trips a violating term". The mirror —
 *    a store DENYING a supporting term, `"We do not offer a Swiss Water Process
 *    decaf in this range."`, `"Methylene chloride: never."` — has no class in
 *    §2, and it is one of only two classes the decaf review measured as
 *    genuinely closed (5/5). A class that produced measured closures and had no
 *    name is a hole in the gate, not a curiosity.
 */
export type AttackClass =
  | "letter_not_spirit"
  | "adjacent_vocabulary"
  | "wrong_subject"
  | "merchant_controlled_string"
  | "orthography"
  | "violation"
  | "tense_modality"
  | "denial";

export const ATTACK_CLASSES: readonly AttackClass[] = [
  "letter_not_spirit",
  "adjacent_vocabulary",
  "wrong_subject",
  "merchant_controlled_string",
  "orthography",
  "violation",
  "tense_modality",
  "denial",
] as const;

/** One line per class, rendered into the review record so a reader of the
 *  artifact does not need this file. */
export const CLASS_PURPOSE: Record<AttackClass, string> = {
  letter_not_spirit:
    "the term matches and the sentence still leaves a shopper with a false impression (VOCABULARY_REVIEW §2.1)",
  adjacent_vocabulary:
    "a DIFFERENT domain using the same words about the same product (§2.2). Only partly mechanisable — see README §4",
  wrong_subject:
    "the term is predicated of something that is not this product: packaging, shipment, a bundled item, a competitor, a review quote, a sibling product (§2.3)",
  merchant_controlled_string:
    "the term on a surface the merchant names rather than states — title, variant option — and on the surfaces nobody probed until the refuting pass (§2.4)",
  orthography:
    "the term as a CAREFUL store would write it: ®, ™, hyphenated, pluralised, in a spec row, split by a period (§2.5). A term matching only the casual spelling fails exactly the sellers most likely to be honest",
  violation:
    "for every violating term, the sentence in which a COMPLIANT store trips it (§2.6). The unrecoverable error, and the class an author is least likely to attempt against their own list",
  tense_modality:
    "past, future, conditional, modal, on-request. The decaf review closed zero of these and none is a subject problem",
  denial:
    "the store DENYING a supporting term. §2's class 6 covers this for violating terms only; the supporting-term mirror had no class and is one of the two classes the decaf review measured as closed",
};

// ---- terms ------------------------------------------------------------------

export type TermRole = "supporting" | "violating";

/**
 * The grammatical shape of a term, which decides which frames are GRAMMATICAL
 * for it. `swiss water process` needs "uses the …"; `decaffeinated with
 * methylene chloride` needs "is …"; `swiss water decaf` names the product
 * itself and needs "is a …"; `swiss water processed` is a bare modifier.
 *
 * There were three of these until the generator was first executed against a
 * real vocabulary and produced `"Ask us about carbon dioxide decaffeination
 * decaf"`. Reading the table was not enough; running it was.
 *
 * This is a heuristic and it will misfire. It fails SAFE: a misfire produces an
 * awkward sentence, never a wrong verdict, because this module produces no
 * verdicts. An ungrammatical generated sentence is a GENERATOR defect for the
 * human to report, not evidence about the engine.
 */
export type TermShape = "predicate" | "process_name" | "nominal_product" | "attributive";

// ---- the generated sentence -------------------------------------------------

export interface AttackSentence {
  /** Stable across runs and across seeds. Derived from class, subclass and term. */
  id: string;
  attackClass: AttackClass;
  /** The specific hazard within the class — `sibling_product`, `past_tense`, … */
  subclass: string;
  /** The term this sentence targets. */
  term: string;
  termRole: TermRole;
  /** Where the sentence would sit. The claim branch matches over EVERY surface
   *  in the evidence index with no restriction, so this matters. */
  surface: QuotableSurface;
  /** Verbatim store copy. `VOCABULARY_REVIEW.md` §2 requires copy, not
   *  descriptions of copy. */
  text: string;
  /**
   * What the TEMPLATE is trying to do.
   *
   * Not a verdict. It does not say what the engine returns, and it does not
   * assert that this sentence is genuinely misleading — that judgement is
   * reserved to the human adjudicator, and it is the half of the review that
   * mechanisation does not touch.
   */
  intent: string;
  /**
   * A CONTROL: honest copy that must keep passing.
   *
   * Generated by default, and that default is argued rather than assumed. v2.6
   * built a full negation-scope rewrite, measured 16/16 denials on its own set,
   * and an independent pass then measured it as a NET REGRESSION — 7 false
   * passes v2.5 caught and it did not, plus 46 false fails. A set that only
   * attacks measures one direction, and one direction is how that shipped.
   */
  control: boolean;
}

// ---- the category context ---------------------------------------------------

/**
 * The per-category nouns the templates need, and the one thing the generator
 * genuinely cannot derive.
 *
 * Nothing category-specific belongs in the generator. Everything a coffee
 * sentence needs that a tyre sentence would need differently lives here.
 */
export interface CategoryContext {
  /** Stable id, recorded in the generated set so a review is reproducible. */
  id: string;
  /** How store copy names the product itself: "decaf", "tyre", "cable". */
  productNoun: string;
  /** The plural, for site-wide statements: "All of our decafs are …". */
  productPlural: string;
  /** How the category names an individual unit of stock: "lot", "batch", "SKU". */
  unitNoun: string;
  /** How a store introduces a DIFFERENT product it also sells: "Ethiopian". */
  siblingDescriptor: string;
  /**
   * A competitor's name.
   *
   * Defaults to an obviously fictional brand. Generated copy asserts things
   * about a named company ("X uses methylene chloride"); manufacturing that
   * about a real business, in a file that lives in a repository, is not
   * something a generator should do by default. Supply a real name in a context
   * file if a review needs one.
   */
  competitor: string;
  /** The container a multi-item listing is sold in: "gift set", "starter kit". */
  bundleNoun: string;
  /** The packaging noun: "pouch", "sleeve", "case". */
  packagingNoun: string;
  /** Where stock ships from: "roastery", "warehouse", "workshop". */
  facilityNoun: string;
  /** Spec-row labels the category writes: "Process", "Method", "Material". */
  specLabels: string[];
  /**
   * ADJACENT DOMAINS — the half of class 2 that is not mechanisable.
   *
   * `Process: Washed` names a post-harvest treatment, and a decaffeination
   * check keyed on `process` reads a drying method as a solvent disclosure.
   * No generator can derive that; it is domain knowledge. This field is a place
   * to PUT human work, not a way to generate it, and when it is empty the
   * coverage report says the class was not covered rather than passing quietly.
   */
  adjacentDomains: AdjacentDomain[];
}

export interface AdjacentDomain {
  /** The other domain's name, for the review record. */
  domain: string;
  /** Vocabulary terms this domain collides with. Exact term strings. */
  collidesWith: string[];
  /** Verbatim store copy in which the SAME string means the other thing. */
  sentences: string[];
  /** Why the collision is real, with whatever grounding the author has. */
  why: string;
}

// ---- coverage ---------------------------------------------------------------

/** Why a (term, class) cell produced nothing. Never left unexplained. */
export type OmissionReason =
  | "requires_category_context"
  | "not_applicable_to_role"
  | "no_grammatical_template"
  | "class_not_scheduled";

export interface CoverageCell {
  term: string;
  role: TermRole;
  attackClass: AttackClass;
  count: number;
  /** Present exactly when `count` is 0. */
  omission: { reason: OmissionReason; detail: string } | null;
}

export interface AttackSet {
  /** Which vocabulary this was generated from, and at what content hash. */
  source: {
    claimKey: string;
    standardId: string;
    standardVersion: string;
    vocabularyVersion: string | null;
    vocabularyHash: string | null;
  };
  contextId: string;
  seed: string;
  /** Which classes were scheduled. A restricted run is INCOMPLETE, not small. */
  scheduledClasses: AttackClass[];
  attacks: AttackSentence[];
  controls: AttackSentence[];
  coverage: {
    byClass: Record<string, number>;
    cells: CoverageCell[];
    /** Cells with zero attacks. A term with no attack in a class is an UNTESTED
     *  term, and the report says so rather than passing quietly. */
    untested: CoverageCell[];
    /**
     * Classes that were SCHEDULED and ran against nothing, because the
     * vocabulary has no terms of that class's role.
     *
     * `decaf-method.json` ships an empty violating list by a measured decision,
     * so `violation` attacks nothing there. The first run of this generator
     * printed `violation  0` under a FULL COVERAGE headline — a class that never
     * ran, rendered identically to a class that ran and found nothing. Named
     * here so a reader cannot infer the wrong one.
     */
    notExercised: AttackClass[];
    /**
     * Sentences a template produced that `perCellLimit` did NOT show.
     *
     * The cap is real and necessary — eight classes over forty terms with every
     * template is more than a human reads. But a cell reporting three attacks
     * while five subclasses went unshown reads as coverage it is not, and
     * CLAUDE.md's own rule is that a bounded sweep must log what it dropped.
     * Found by the corpus proof, which measured a subclass as unreachable when
     * it was merely un-picked at the default limit.
     */
    droppedByCap: Array<{ attackClass: AttackClass; term: string; subclass: string }>;
  };
  /**
   * `verified_clean` | `defects_found` | `incomplete`, computed by the REAL
   * `src/measure/completion.ts` rather than by a copy of its rule.
   *
   * `uncoveredCount` is `number | null` — null on incomplete, never 0 — so a
   * generation run that did not complete cannot be read as full coverage by a
   * caller that only looks at the number.
   */
  state: "verified_clean" | "defects_found" | "incomplete";
  uncoveredCount: number | null;
  decisive: boolean;
  summary: string;
}

export interface GenerateOptions {
  /** Deterministic selection key. Same seed ⇒ byte-identical set. */
  seed?: string;
  /** Cap per (term, class). Selection is seeded, so a re-review after a term
   *  change produces a COMPARABLE set rather than an unrelated one. */
  perCellLimit?: number;
  /** Restrict the run. Omitting a class forces `incomplete`. */
  classes?: AttackClass[];
  /** Controls default ON — see `AttackSentence.control`. */
  includeControls?: boolean;
  context?: CategoryContext;
}
