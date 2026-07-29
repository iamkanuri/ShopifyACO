// ===========================================================================
// VOCABULARY VALIDATION — structural rules, EXECUTED.
//
// A vocabulary is the term list behind one claim key, published WITH a versioned
// standard and reviewed AS a standard (ENGINE_GAPS.md G-06, option (b)).
//
// ⚠️ THE THING THIS FILE EXISTS TO PREVENT. Every hand-written term list in the
// engine was carefully reviewed, and three of them shipped defects that told a
// compliant store its own copy said the opposite:
//   • gluten_free  — a violating term overlapping a supporting one in the same
//                    SENTENCE (not, as it is usually retold, term-inside-term);
//   • organic      — matched inside `inorganic` before `wholeWord` was set;
//   • fragrance_free — `added fragrance` suffix-aligned inside `no added
//                    fragrance`, rescued only because `no` happens to be in a
//                    closed negator list.
// A format that merely DOCUMENTS these hazards repeats them. So the rules below
// are executed against the vocabulary's own terms, and a vocabulary that cannot
// demonstrate its insufficient set failing is INVALID, not under-documented.
//
// ENGINE-REAL vs MIRRORED — stated precisely, because this project has thrice
// confused "I simulated it" with "I measured it":
//   • MATCHING IS ENGINE-REAL. `findSupport`, `findViolation`, `buildEvidence`,
//     `normalize`, `isNegated`, `termMatches` and `lintStrings` are imported from
//     `src/`. Nothing about term matching, negation, aboutness or quoting is
//     reimplemented here.
//   • DISPATCH IS MIRRORED. `evaluateWithVocabulary` re-states the seven lines of
//     `evaluate`'s `claim` branch, because that branch reads the non-exported
//     `CLAIM_TERMS` and therefore cannot be handed a vocabulary at all — which is
//     the gap this whole session is specifying. The mirror is PROVEN equivalent
//     to the real `evaluate` in `standards/__tests__/vocabulary.engine.test.ts`,
//     which runs both over every built-in claim key.
//
// Pure: no network, no database, no clock, no model calls.
// ===========================================================================

import {
  buildEvidence, findSupport, findViolation, isNegated, normalize, termMatches,
  type EvidenceSentence, type QuotableSurface,
} from "../src/server/testEvidence.js";
import { lintStrings } from "../src/server/claimLinter.js";
import { ENGINE_CLAIM_KEYS } from "./compile.js";
import { canonicalise } from "./hash.js";
import { validate, type ValidationError } from "./validate.js";
import { createHash } from "node:crypto";

// ---- the artifact shape (mirrors schema.json $defs/vocabulary) ---------------

export interface VocabularyCitation { source: string; url?: string; kind: string; establishes: string }
export interface SupportingTerm {
  term: string;
  orthography?: string;
  grounding: VocabularyCitation[];
  positive_examples: string[];
  notes?: string;
}
export interface ViolatingTerm {
  term: string;
  grounding: VocabularyCitation[];
  contradicting_examples: string[];
  /** Sentences where a COMPLIANT store mentions this substance and must NOT be
   *  reported as contradicting. The violation attack, made a required field. */
  must_not_contradict_examples: string[];
  notes?: string;
}
export interface InsufficientProbe {
  form: string;
  example: string;
  hazard_class: string;
  why_not: string;
  /** The EXACT required outcome. Absent ⇒ `not_proven`. */
  expected_outcome?: "not_proven" | "contradicted" | "passes_known_gap";
  gap_note?: string;
}
export interface Vocabulary {
  vocabulary_grammar_version: string;
  standard_id: string;
  standard_version: string;
  claim_key: string;
  version?: string;
  title: string;
  status: "draft" | "published" | "withdrawn";
  scope: { establishes: string; does_not_establish: string };
  serves: Array<{ entry_id: string; effect: string; note: string; still_blocked_by?: string[] }>;
  accepted_surfaces: QuotableSurface[];
  matching: { whole_word: true; case_sensitive: false; engine_call_site: string };
  supporting_terms: SupportingTerm[];
  violating_terms: ViolatingTerm[];
  violating_terms_empty_rationale?: string;
  insufficient_evidence: InsufficientProbe[];
  limits: Array<{ limit: string; direction: string; cause: string; example?: string }>;
  review: {
    state: "verified_clean" | "defects_found_and_resolved" | "incomplete";
    attacker: string;
    refuter: string;
    adversarial_findings: Array<{ attack: string; outcome: string; resolution: string; residual_risk?: string }>;
  };
  changelog: Array<{
    version: string; date: string; summary: string;
    changes: Array<{
      change_type: string; detail: string; rationale: string;
      weakening_attestation?: {
        prior_failures_exist: boolean; remediation: string;
        affected_result_count?: number | null; attested_by: string; attested_date: string; notes?: string;
      };
    }>;
  }>;
  vocabulary_hash: { algorithm: string; canonicalisation: string; value: string };
  notes?: string;
}

// ---- hashing ----------------------------------------------------------------
// Deliberately NOT a change to hash.ts. `canonicalise` is already exported and is
// the whole of the canonicalisation; only the omitted field name differs, and
// widening a helper the published coffee standard's hash depends on to serve a new
// artifact is a needless risk to a shipped number.

export function canonicalVocabularyForm(v: unknown): string {
  const clone = JSON.parse(JSON.stringify(v)) as Record<string, unknown>;
  delete clone.vocabulary_hash;
  return JSON.stringify(canonicalise(clone));
}
export function vocabularyHash(v: unknown): string {
  return createHash("sha256").update(canonicalVocabularyForm(v), "utf8").digest("hex");
}
export function vocabularyHashMatches(v: unknown): { ok: boolean; stored: string | null; computed: string } {
  const stored = (v as Vocabulary)?.vocabulary_hash?.value ?? null;
  const computed = vocabularyHash(v);
  return { ok: stored === computed, stored, computed };
}

// ---- the dispatch MIRROR ----------------------------------------------------

export type ClaimOutcome = "pass" | "contradicted" | "not_proven";
export interface ClaimResult {
  outcome: ClaimOutcome;
  /** The term that decided it — the matched supporting or violating term. */
  term: string | null;
  surface: QuotableSurface | null;
  quote: string | null;
}

export interface ClaimTermsView { support: string[]; violating: string[] }

/** The vocabulary as the engine's `CLAIM_TERMS[key]` would see it. */
export function toClaimTerms(v: Vocabulary): ClaimTermsView {
  return {
    support: v.supporting_terms.map((t) => t.term),
    violating: v.violating_terms.map((t) => t.term),
  };
}

/**
 * MIRROR of `evaluate`'s `claim` branch (src/server/productTest.ts:1086-1130).
 *
 * The three orderings restated here are the whole behaviour, and each is
 * load-bearing: the linter pre-filter drops evidence BEFORE matching; violation is
 * checked FIRST and wins outright; support runs with `wholeWord: true` while
 * `findViolation` reaches the same value through its own default.
 */
export function evaluateWithVocabulary(evidence: EvidenceSentence[], terms: ClaimTermsView): ClaimResult {
  const quotable = evidence.filter((e) => lintStrings([e.text]).ok);
  const contra = terms.violating.length ? findViolation(quotable, terms.violating, terms.support) : null;
  if (contra) return { outcome: "contradicted", term: contra.term, surface: contra.surface, quote: contra.quote };
  // ⚠️ `referentGuard` MUST match `evaluate`'s claim branch, and it must move in the SAME
  // commit. Both acceptance suites and the vocabulary validator run through this mirror,
  // so without the flag here suite 2.0 would measure the guard-OFF path and report a pass
  // for a change it never exercised. `vocabulary.engine.test.ts` proves the mirror equals
  // `evaluate` and would catch the divergence — but a gate that has to catch you is not a
  // substitute for setting it.
  const hit = findSupport(quotable, terms.support, { wholeWord: true, referentGuard: true });
  if (hit) return { outcome: "pass", term: hit.term, surface: hit.surface, quote: hit.quote };
  return { outcome: "not_proven", term: null, surface: null, quote: null };
}

/** One sentence on one surface, as the engine would index it. */
export const asEvidence = (text: string, surface: QuotableSurface = "product_description"): EvidenceSentence[] =>
  buildEvidence([{ surface, text }]);

// ---- findings ---------------------------------------------------------------

export interface VocabularyFinding {
  rule: string;
  severity: "error" | "note";
  message: string;
}

export interface VocabularyValidation {
  /** VERIFIED_CLEAN | DEFECTS_FOUND | INCOMPLETE. Never a bare boolean. */
  state: "VERIFIED_CLEAN" | "DEFECTS_FOUND" | "INCOMPLETE";
  schemaErrors: ValidationError[];
  findings: VocabularyFinding[];
  /** How many behavioural probes were executed. Zero means nothing was proven. */
  probesRun: number;
  /**
   * Defect count. `null` on INCOMPLETE — never `0` — so an incomplete validation
   * cannot be summed into a total or read as a pass by a caller that only looks at
   * the number. src/measure/completion.ts, and the four times that bug shipped.
   */
  defectCount: number | null;
  /** Informational metrics, reported whatever the state. */
  metrics: {
    supportingTerms: number;
    violatingTerms: number;
    insufficientProbes: number;
    nearProbes: number;
    distantProbes: number;
    /** Probes pinned `passes_known_gap` — a debt count, and it must be non-zero-aware:
     *  a vocabulary claiming zero uncloseable near-misses is claiming immunity. */
    knownGapProbes: number;
    /** Violating terms bare enough for the free-from advisory sweep to be meaningful. */
    freeFromSwept: number;
    /** Insufficient examples that WOULD pass if placed on a merchant-controlled
     *  surface. Measures the unenforced-surface gap rather than asserting on it. */
    passOnUnacceptedSurface: number;
  };
}

const err = (rule: string, message: string): VocabularyFinding => ({ rule, severity: "error", message });
const note = (rule: string, message: string): VocabularyFinding => ({ rule, severity: "note", message });

/** Tokens of length >= 4, used only for the straw-man heuristic. */
const tokens = (s: string): string[] => normalize(s).split(/[^a-z0-9]+/).filter((t) => t.length >= 4);

const WEAKENING_CHANGES = new Set([
  "supporting_term_added", "violating_term_removed", "insufficient_probe_removed",
]);
const MANDATORY_HAZARDS = ["misleading_synonym", "wrong_subject", "merchant_controlled_string"];

/** A violating term that already carries a verb frame or a method head-noun. The
 *  free-from advisory sweep is meaningless for these — see V13. */
const ALREADY_FRAMED = /\b(decaffeinated|processed|extracted|treated|made|uses?|using|with|via|method)\b|\bprocess$/i;

/**
 * Validate a vocabulary: schema shape, then the structural rules, then the
 * behavioural proof. Returns a completion state — `requireDecisive` is the caller's
 * gate for anything that ships.
 */
export function validateVocabulary(vocab: unknown, schema: unknown): VocabularyValidation {
  const findings: VocabularyFinding[] = [];
  let probesRun = 0;
  const metrics = {
    supportingTerms: 0, violatingTerms: 0, insufficientProbes: 0,
    nearProbes: 0, distantProbes: 0, knownGapProbes: 0, freeFromSwept: 0, passOnUnacceptedSurface: 0,
  };

  // ---- schema shape. A vocabulary that is not even the right shape cannot be
  // probed, and probing it anyway would produce confident nonsense.
  //
  // The grammar is resolved BEFORE validating, because a `$defs/vocabulary` that is
  // absent — or is `true`, the JSON Schema that accepts everything — would otherwise
  // certify anything while running one check on the wrapper and reporting no errors.
  // "The schema checked nothing" and "the schema found nothing wrong" must never
  // render the same (src/measure/completion.ts).
  const defs = (schema as { $defs?: Record<string, unknown> })?.$defs;
  const def = defs?.vocabulary;
  if (!def || typeof def !== "object" || Array.isArray(def)) {
    return {
      state: "INCOMPLETE", schemaErrors: [], probesRun: 0, defectCount: null, metrics,
      findings: [err("__internal__", "the grammar has no `$defs/vocabulary` object to validate against — nothing was checked, which is not a pass")],
    };
  }
  const schemaResult = validate(vocab, { $defs: defs, $ref: "#/$defs/vocabulary" });
  if (schemaResult.checksRun <= 1) {
    return {
      state: "INCOMPLETE", schemaErrors: schemaResult.errors, probesRun: 0, defectCount: null, metrics,
      findings: [err("__internal__", "the schema validator ran zero checks — this is not a pass")],
    };
  }
  if (!schemaResult.ok) {
    return {
      state: "DEFECTS_FOUND", schemaErrors: schemaResult.errors, probesRun: 0,
      defectCount: schemaResult.errors.length, metrics,
      findings: [err("schema", `${schemaResult.errors.length} schema error(s); structural rules not run`)],
    };
  }

  const v = vocab as Vocabulary;
  const terms = toClaimTerms(v);
  metrics.supportingTerms = terms.support.length;
  metrics.violatingTerms = terms.violating.length;
  metrics.insufficientProbes = v.insufficient_evidence.length;

  // ---- V6 — term hygiene. A term that normalises to something else can never
  // match, and would be a silent no-op rather than a failure.
  for (const t of [...terms.support, ...terms.violating]) {
    if (normalize(t) !== t) {
      findings.push(err("V6", `term ${JSON.stringify(t)} is not in engine-normalised form — the engine would search for ${JSON.stringify(normalize(t))}, so this term can never match as written`));
    }
    if (/\.\s/.test(t)) {
      findings.push(err("V6", `term ${JSON.stringify(t)} contains ". " — splitSentences breaks the text there (testEvidence.ts:71), so this term is structurally unmatchable in prose`));
    }
  }

  // ---- V7 — duplicates, within a list and across the two.
  const dupes = (list: string[], which: string): void => {
    const seen = new Set<string>();
    for (const t of list) {
      if (seen.has(t)) findings.push(err("V7", `duplicate ${which} term ${JSON.stringify(t)}`));
      seen.add(t);
    }
  };
  dupes(terms.support, "supporting");
  dupes(terms.violating, "violating");
  for (const t of terms.support) {
    if (terms.violating.includes(t)) {
      findings.push(err("V7", `term ${JSON.stringify(t)} is in BOTH lists — violation is checked first, so the supporting entry could never be reached`));
    }
  }

  // ---- V1 — the substring geometry. A LEXICAL pre-check that names the exact
  // pair, ahead of the behavioural proof below which is the authority. The same
  // division as compile.ts's mirrored key list: this exists to produce a readable
  // error early, never to be the thing relied on.
  for (const s of terms.support) {
    for (const vio of terms.violating) {
      if (s === vio) continue;
      if (!s.includes(vio)) {
        if (vio.includes(s)) {
          findings.push(note("V1", `supporting ${JSON.stringify(s)} is inside violating ${JSON.stringify(vio)} — permitted (this is the shipped vegan/non-vegan shape) because violation is checked first`));
        }
        continue;
      }
      // `vio` is inside `s`.
      if (s.endsWith(vio)) {
        // SUFFIX-ALIGNED. `findViolation`'s overlap rule requires the supporting
        // match to end strictly BEYOND the violating one, which is false here, so
        // the only rescue is the negation guard — and that fires only for a CLOSED
        // list of negators which does not include `free of`, `free from`, `sans`
        // or `non`. Executed rather than reasoned about.
        const probe = `This product is ${s}.`;
        if (!isNegated(probe, vio)) {
          findings.push(err(
            "V1",
            `violating ${JSON.stringify(vio)} is suffix-aligned inside supporting ${JSON.stringify(s)}, and the prefix ` +
            `${JSON.stringify(s.slice(0, s.length - vio.length))} is not a negator the engine recognises. ` +
            `findViolation's overlap rule cannot discard it (it requires the support match to end beyond the violation), ` +
            `so a store writing ${JSON.stringify(probe)} would be told its copy states the OPPOSITE, quoting that sentence. ` +
            `This is the gluten_free damage class.`,
          ));
        } else {
          findings.push(note("V1", `violating ${JSON.stringify(vio)} is suffix-aligned inside supporting ${JSON.stringify(s)}; rescued ONLY by the negation guard firing on ${JSON.stringify(s.slice(0, s.length - vio.length))}`));
        }
      } else {
        findings.push(note("V1", `violating ${JSON.stringify(vio)} is inside supporting ${JSON.stringify(s)} with the support extending beyond it — discarded by findViolation's overlap rule (testEvidence.ts:354)`));
      }
    }
  }

  // ---- V8 — a vocabulary may not shadow a reviewed built-in list.
  if ((ENGINE_CLAIM_KEYS as readonly string[]).includes(v.claim_key)) {
    findings.push(err("V8", `claim_key ${JSON.stringify(v.claim_key)} collides with a built-in CLAIM_TERMS key — a registry that can shadow a reviewed built-in list reintroduces the runtime-override hazard G-06 rejects`));
  }

  // ---- V10 — an empty violating list must be a decision on the record.
  if (terms.violating.length === 0 && !v.violating_terms_empty_rationale) {
    findings.push(err("V10", "violating_terms is empty and violating_terms_empty_rationale is absent — emptiness must be a stated decision, not an omission"));
  }

  // ---- V9 — hazard-class coverage.
  const hazards = new Set(v.insufficient_evidence.map((p) => p.hazard_class));
  for (const h of MANDATORY_HAZARDS) {
    if (!hazards.has(h)) findings.push(err("V9", `insufficient_evidence covers no \`${h}\` case — that class is mandatory for any matcher`));
  }

  // ---- V11 — never-weaken, extended to terms. The cross-field dependency JSON
  // Schema cannot express cleanly, same as SCHEMA.md section 5.
  for (const rel of v.changelog) {
    for (const ch of rel.changes) {
      if (!WEAKENING_CHANGES.has(ch.change_type)) continue;
      const at = ch.weakening_attestation;
      if (!at) { findings.push(err("V11", `${rel.version} ${ch.change_type} (${ch.detail}) has no weakening_attestation`)); continue; }
      if (at.prior_failures_exist && at.remediation === "not_applicable_no_failures") {
        findings.push(err("V11", `${rel.version} ${ch.change_type} (${ch.detail}) attests prior failures exist AND remediation not_applicable_no_failures — a contradiction. A weakening that leaves standing failures under the old terms is the event the rule forbids.`));
      }
      if (!at.prior_failures_exist && at.remediation !== "not_applicable_no_failures") {
        findings.push(err("V11", `${rel.version} ${ch.change_type} (${ch.detail}) attests no prior failures but claims remediation ${JSON.stringify(at.remediation)}`));
      }
    }
  }

  // ---- V12 — the hash covers the content.
  const h = vocabularyHashMatches(v);
  if (!h.ok) findings.push(err("V12", `vocabulary_hash is ${h.stored ?? "absent"} but the content hashes to ${h.computed}`));

  // ---- review gate
  if (v.status === "published" && v.review.state === "incomplete") {
    findings.push(err("review", "status is `published` while review.state is `incomplete` — an incomplete review BLOCKS publication rather than reading as clean"));
  }
  if (v.review.state !== "incomplete" && v.review.adversarial_findings.length === 0) {
    findings.push(err("review", "review is not incomplete yet records zero adversarial findings — a vocabulary whose attacker found nothing had an attacker who was not trying"));
  }

  // =========================================================================
  // THE BEHAVIOURAL PROOF. Everything above is a readable early error; this is
  // the authority, and it runs the REAL engine matcher.
  // =========================================================================

  // ---- V5a — every supporting term is INDIVIDUALLY satisfiable by its own
  // examples. Catches a self-negating term, a term with a typo, a term whose
  // orthography no example reaches, and a term made dead by ". ".
  for (const st of v.supporting_terms) {
    let reached = false;
    for (const ex of st.positive_examples) {
      probesRun++;
      if (findSupport(asEvidence(ex), [st.term], { wholeWord: true })) { reached = true; break; }
    }
    if (!reached) {
      findings.push(err("V5a", `supporting term ${JSON.stringify(st.term)} matches NONE of its own positive examples — it is a term that cannot fire, which reads identically to a term that never had to`));
    }
  }

  // ---- V5b — every positive example passes the WHOLE vocabulary. This is where
  // a violating term that eats its own supporting term is caught behaviourally.
  for (const st of v.supporting_terms) {
    for (const ex of st.positive_examples) {
      probesRun++;
      const r = evaluateWithVocabulary(asEvidence(ex), terms);
      if (r.outcome !== "pass") {
        findings.push(err("V5b", `positive example for ${JSON.stringify(st.term)} does not pass: ${JSON.stringify(ex)} -> ${r.outcome}${r.term ? ` (decided by ${JSON.stringify(r.term)})` : ""}`));
      }
    }
  }

  // ---- V3 — SELF-CONSISTENCY IN A NEUTRAL FRAME, independent of the author's
  // chosen examples.
  //
  // ⚠️ THE FIRST VERSION OF THIS RULE WAS DECORATIVE AND IT TOOK EXECUTION TO SEE IT.
  // It read `if (isNegated(frame, term))` over `This product is {term}.` — which can
  // never be true, because `clauseBefore` only inspects text BEFORE the term, and a
  // negator carried INSIDE a term (`no added fragrance`) is invisible to it. The
  // rule was written to catch the `no added fragrance` shape and could not have
  // caught it. A guard whose removal breaks nothing is not a guard.
  //
  // The real class it must catch is a SILENT LOSS: `findSupport` fails closed across
  // terms (testEvidence.ts:308), so if a shorter supporting term also matches inside
  // a longer negator-carrying one and reads as negated there, the whole sentence is
  // discarded and the row returns not_proven with no explanation. Supporting
  // ["no gluten", "gluten"] does exactly this to "Contains no gluten."
  //
  // Two frames, pass in EITHER. A defect internal to the term fails both; requiring
  // both would instead punish terms that are merely ungrammatical in one frame.
  for (const st of v.supporting_terms) {
    const frames = [`This product is ${st.term}.`, `We use ${st.term} for this product.`];
    let ok = false;
    for (const frame of frames) {
      probesRun++;
      if (evaluateWithVocabulary(asEvidence(frame), terms).outcome === "pass") { ok = true; break; }
    }
    if (!ok) {
      const detail = frames.map((f) => `${JSON.stringify(f)} -> ${evaluateWithVocabulary(asEvidence(f), terms).outcome}`).join("; ");
      findings.push(err("V3", `supporting term ${JSON.stringify(st.term)} does not pass this vocabulary in ANY neutral frame — it is defeated by its own list. ${detail}`));
    }
  }

  // ---- V5c — every violating term does contradict.
  for (const vt of v.violating_terms) {
    for (const ex of vt.contradicting_examples) {
      probesRun++;
      const r = evaluateWithVocabulary(asEvidence(ex), terms);
      if (r.outcome !== "contradicted") {
        findings.push(err("V5c", `contradicting example for ${JSON.stringify(vt.term)} is not reported as contrary: ${JSON.stringify(ex)} -> ${r.outcome}`));
      }
    }
  }

  // ---- V13 — THE VIOLATION ATTACK, EXECUTED. A compliant store that mentions the
  // substance must never be told it stated the opposite.
  //
  // The engine learned this for attributes and never carried it to claims: the
  // `materials` spec uses COMPOSITION FRAMES because the bare noun `aluminum` would
  // match `aluminum-free` (productTest.ts:248-253). A bare violating term has the
  // same defect and a worse consequence.
  for (const vt of v.violating_terms) {
    for (const ex of vt.must_not_contradict_examples) {
      probesRun++;
      const r = evaluateWithVocabulary(asEvidence(ex), terms);
      if (r.outcome === "contradicted") {
        findings.push(err(
          "V13",
          `violating term ${JSON.stringify(vt.term)} flags a COMPLIANT sentence as stating the opposite: ${JSON.stringify(ex)} -> contradicted on ${JSON.stringify(r.term)}, quoting ${JSON.stringify(r.quote)}. ` +
          `FRAME the violating term (e.g. "decaffeinated with ${vt.term}") rather than shipping the bare substance — the engine's own \`materials\` attribute uses composition frames for exactly this reason.`,
        ));
      }
    }
    // Advisory sweep over the standard free-from constructions the author may not
    // have thought of. A NOTE, not an error: failing a vocabulary on a construction
    // no seller would write is the invented-copy narrowing the origin removal rejected.
    //
    // ⚠️ SCOPED TO BARE SUBSTANCE TERMS, and the first version was not. Generating
    // `X free decaf` from an already-framed term produced `decaffeinated with
    // methylene chloride free decaf` — gibberish, flagged on all four terms of a
    // correctly-authored vocabulary. A note that cries wolf trains authors to ignore
    // notes, which is worse than having none.
    if (!ALREADY_FRAMED.test(vt.term) && vt.term.split(" ").length <= 3) {
      metrics.freeFromSwept++;
      const generated = [
        `${vt.term} free decaf, roasted to order.`,
        `Our decaf is free of ${vt.term}.`,
        `Decaffeinated without ${vt.term}.`,
        `We use no ${vt.term} at any stage.`,
        `Contains no ${vt.term}.`,
      ];
      const misread = generated.filter((s) => {
        probesRun++;
        return evaluateWithVocabulary(asEvidence(s), terms).outcome === "contradicted";
      });
      if (misread.length) {
        findings.push(note("V13", `bare violating term ${JSON.stringify(vt.term)} would also misread ${misread.length} auto-generated free-from construction(s), e.g. ${JSON.stringify(misread[0])}. If any store writes that, add it to must_not_contradict_examples and FRAME the term.`));
      }
    }
  }

  // ---- V4 — THE NEGATIVE SUITE. Every insufficient example must produce EXACTLY
  // its declared outcome.
  //
  // ⚠️ EXACT, not merely "does not pass", and the difference is a measured defect.
  // The first version of this rule asked only that the example not pass — which
  // silently permits `contradicted`, i.e. the engine printing "Your public copy
  // states the opposite of this requirement" beside the merchant's own sentence.
  // That is STRICTLY WORSE than a missed pass, and it is what a naive
  // solvent-disclosure vocabulary does to a store writing "Methylene chloride free
  // decaf." — the violating term matches, no supporting term rescues it, and
  // `free` is not a negator the engine knows. Found while authoring the second
  // vocabulary, which is exactly what the second vocabulary was for.
  const supportTokens = new Set(terms.support.flatMap(tokens));
  for (const probe of v.insufficient_evidence) {
    probesRun++;
    const r = evaluateWithVocabulary(asEvidence(probe.example), terms);
    const expected = probe.expected_outcome ?? "not_proven";
    if (expected === "passes_known_gap") {
      metrics.knownGapProbes++;
      if (r.outcome !== "pass") {
        findings.push(err("V4", `insufficient_evidence example is pinned \`passes_known_gap\` but no longer passes (${r.outcome}): ${JSON.stringify(probe.example)}. If the engine closed this gap, DELETE the pin and record the fix — a stale pin hides a real improvement and, worse, reads as a known defect that is no longer known.`));
      }
    } else if (r.outcome !== expected) {
      const extra = r.outcome === "contradicted"
        ? ` This is worse than a missed pass: the engine renders "Your public copy states the opposite of this requirement" and quotes ${JSON.stringify(r.quote)} as the proof. If the page really does state the contrary, declare expected_outcome "contradicted"; otherwise the violating term ${JSON.stringify(r.term)} is wrong.`
        : ` matched ${JSON.stringify(r.term)}`;
      findings.push(err("V4", `insufficient_evidence example [${probe.hazard_class}] produced ${r.outcome}, expected ${expected}: ${JSON.stringify(probe.example)}.${extra}`));
    }
    // straw-man heuristic, reported always and enforced at a low bar below
    const near = tokens(probe.example).some((t) => supportTokens.has(t));
    if (near) metrics.nearProbes++; else metrics.distantProbes++;
    // the unenforced-surface measurement (G-06): would it pass on a title?
    probesRun++;
    if (evaluateWithVocabulary(asEvidence(probe.example, "product_title"), terms).outcome === "pass") {
      metrics.passOnUnacceptedSurface++;
    }
  }
  if (metrics.nearProbes < 3) {
    findings.push(err("V4n", `only ${metrics.nearProbes} insufficient example(s) share a token with any supporting term. A negative suite of distant straw men proves nothing about the terms actually shipped; the near-miss classes are the ones that fire.`));
  }
  // A pinned gap without a declared limit is a defect recorded where no reader of
  // the published artifact will look.
  if (metrics.knownGapProbes > 0 && !v.limits.some((l) => l.direction === "false_pass")) {
    findings.push(err("V4g", `${metrics.knownGapProbes} probe(s) are pinned \`passes_known_gap\` but \`limits\` declares no false_pass channel — the debt is in the test and not in the published document`));
  }

  // ---- completion state
  const errors = findings.filter((f) => f.severity === "error");
  // AN UNATTACKED VOCABULARY IS NOT A CLEAN ONE. The terms can validate perfectly
  // while nobody has yet tried to break them, and reporting that as VERIFIED_CLEAN
  // is the instrument-fails-flatteringly failure with a new coat of paint. It is
  // INCOMPLETE — which is not zero defects, it is an unknown number of them.
  if (v.review.state === "incomplete") {
    return {
      state: "INCOMPLETE", schemaErrors: [], probesRun, defectCount: null, metrics,
      findings: [...findings, err("review", `review.state is \`incomplete\`: ${errors.length} structural defect(s) found, and the adversarial pass that would find the rest has not been run`)],
    };
  }
  if (probesRun === 0) {
    return {
      state: "INCOMPLETE", schemaErrors: [], findings: [...findings, err("__internal__", "zero behavioural probes executed — nothing was proven")],
      probesRun, defectCount: null, metrics,
    };
  }
  return {
    state: errors.length ? "DEFECTS_FOUND" : "VERIFIED_CLEAN",
    schemaErrors: [], findings, probesRun,
    defectCount: errors.length, metrics,
  };
}

/** Throw unless the validation reached a decision. The gate for anything that ships. */
export function requireDecisive(r: VocabularyValidation, what: string): void {
  if (r.state === "INCOMPLETE") {
    throw new Error(`${what}: vocabulary validation is INCOMPLETE (${r.probesRun} probes) — an incomplete measurement is not a passing one`);
  }
}

export function renderVocabularyValidation(r: VocabularyValidation): string {
  const head =
    r.state === "VERIFIED_CLEAN"
      ? `VERIFIED_CLEAN — ${r.probesRun} probes executed against the real engine matcher, 0 defects`
      : r.state === "INCOMPLETE"
        ? `INCOMPLETE — ${r.probesRun} probes; defectCount is null, NOT zero`
        : `DEFECTS_FOUND — ${r.defectCount} defect(s) over ${r.probesRun} probes`;
  const lines = [
    head,
    `  terms: ${r.metrics.supportingTerms} supporting, ${r.metrics.violatingTerms} violating`,
    `  insufficient: ${r.metrics.insufficientProbes} (${r.metrics.nearProbes} near, ${r.metrics.distantProbes} distant, ${r.metrics.knownGapProbes} pinned known-gap)`,
    `  would pass on an unaccepted merchant-controlled surface: ${r.metrics.passOnUnacceptedSurface}`,
  ];
  for (const e of r.schemaErrors) lines.push(`  SCHEMA ${e.path || "<root>"} [${e.keyword}] ${e.message}`);
  for (const f of r.findings) lines.push(`  ${f.severity === "error" ? "ERROR" : "note "} [${f.rule}] ${f.message}`);
  return lines.join("\n");
}

/** Exported for the engine-fidelity test, which needs to drive both paths. */
export { termMatches, normalize, isNegated };
