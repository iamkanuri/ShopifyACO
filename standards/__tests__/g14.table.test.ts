import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { evaluate, type Requirement, type PublicProduct } from "../../src/server/productTest.js";
import { buildEvidence, type QuotableSurface } from "../../src/server/testEvidence.js";
import { ENGINE_CLAIM_KEYS } from "../compile.js";
import { generateAttacks } from "../attack/generate.js";
import { parseContext } from "../attack/context.js";
import { ATTACK_CLASSES } from "../attack/types.js";

// ===========================================================================
// G-14 — THE STANDING GATE. The key × class table, asserted exactly, every run.
//
// WHY THIS EXISTS, AND WHY IT IS NOT `EXPECTED_OPEN_GAPS`.
//
// G-14 measured 3,913 hostile sentences against the claim matcher and confirmed 274
// defect groups. Two ways of recording that were both wrong:
//   • pin all 274 into `EXPECTED_OPEN_GAPS` — the register stops meaning "a debt with
//     a receipt" and becomes a bulk dump nobody reads;
//   • pin only the frequent ones — most of the measurement stays outside code, which is
//     how a measurement quietly becomes a memory.
// The fetch harness established the third pattern and this file follows it: the whole
// table lives in code as PER-CELL CONSTANTS, and the suite fails visibly when any cell
// moves. `EXPECTED_OPEN_GAPS` moves by **+0** for G-14 — see [gaps] below.
//
// CONSEQUENCES, stated so a later reader does not have to infer them:
//   1. Every confirmed defect is recorded in code, permanently, with its direction.
//   2. `EXPECTED_OPEN_GAPS` does not move for G-14. Arithmetic: +0.
//   3. Any future matcher change that moves ANY cell fails this suite by name — which
//      is exactly the before/after instrument a v4.0 guard session needs, and which no
//      amount of adversarial authoring provides on its own.
//   4. A cell that cannot run resolves INCOMPLETE and FAILS. It is never read as its
//      expected value, and never as zero.
//
// ⚠️ TWO TABLES, AND THEY ARE NOT THE SAME QUANTITY. Conflating them is the
// "a paraphrase of a rule is not the rule" failure, and it caught the author of this
// file for twenty minutes:
//   RAW         `pass_evidenced` / hostile — what the ENGINE answers. Deterministic,
//               reproducible here in well under a second, and the thing a matcher
//               change moves. THIS is what the gate asserts.
//   ADJUDICATED confirmed false passes / hostile — what a READER confirmed. Requires
//               humans, is not recomputable, and is recorded below as frozen provenance.
// An engine answer is not a verdict. A gate that asserted the adjudicated numbers would
// be asserting a memory.
//
// RUNTIME POSTURE: the full 3,913-sentence run is ~0.5s wall clock including process
// start, so there is NO env-flag gating and NO fast subset — every cell runs on every
// `npm test`. If that ever stops being true, gate the full run and say which cells the
// subset covers; do not silently shrink the table.
//
// Pure: no database, no network, no server, no model calls.
// ===========================================================================

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

// ---------------------------------------------------------------------------
// The dictionaries, lifted from the engine's own source bytes.
//
// `CLAIM_TERMS` has no `export`. A regex would also match the copy in
// `vocabulary.engine.test.ts` and could not tell them apart, so the lift is anchored on
// the typed declaration and brace-balanced. A silently-empty dictionary would report a
// perfect score, so every failure here throws rather than degrading.
// ---------------------------------------------------------------------------
interface ClaimTermsView { support: string[]; violating: string[] }

function liftClaimTerms(): Record<string, ClaimTermsView> {
  const src = readFileSync(join(REPO, "src", "server", "productTest.ts"), "utf8");
  const anchor = "const CLAIM_TERMS: Record<string, ClaimTerms> = {";
  const start = src.indexOf(anchor);
  assert.ok(
    start >= 0,
    "CLAIM_TERMS' typed declaration is no longer in productTest.ts — this gate must be repaired, " +
      "not run: a silently empty dictionary reports a perfect hostile sweep.",
  );
  const open = start + anchor.length - 1;
  let depth = 0, end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.ok(end > 0, "CLAIM_TERMS is not brace-balanced — refusing to guess");
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  return new Function(`return ${src.slice(open, end)};`)() as Record<string, ClaimTermsView>;
}

/**
 * The contrary-evidence detail sentence.
 *
 * ⚠️ THE ENGINE HAS NO `contradicted` STATUS FOR A CLAIM. `evaluate`'s claim branch
 * returns `not_proven` for contrary evidence and distinguishes it ONLY by this string
 * (productTest.ts). The mapping keys on it, so it is asserted against the source below
 * rather than trusted — if it is reworded, every violation silently reads as a plain
 * miss, which is the flattering direction.
 */
const CONTRA_DETAIL = "Your public copy states the opposite of this requirement.";

function productWith(text: string, surface: QuotableSurface): PublicProduct {
  return {
    origin: "https://store.example", handle: "p", title: "Thing", vendor: "Acme",
    productType: "Thing", tags: [],
    descriptionText: surface === "product_description" ? text : "",
    variants: [{ title: "Default", priceUsd: 12, available: true, options: ["Default"] }],
    minPriceUsd: 12, optionNames: [], optionValues: [], extracted: null,
    evidence: buildEvidence([{ surface, text }]),
    ldAvailability: null, storefrontObjectId: null, policyStatus: "not_fetched",
    fetched: { json: true, page: false, js: false, policy: false },
    diagnostics: { attempted: [], answeredBy: "json", throttled: [], degraded: false, robots: "ok", throttleSource: null },
  } as unknown as PublicProduct;
}

/** ⚠️ ARGUMENT ORDER IS (product, requirement). Written the other way round `evaluate`
 *  returns `undefined` RATHER THAN THROWING, and every row reads as a silent
 *  `not_proven` — a broken instrument scoring a perfect hostile sweep. */
function realEvaluate(claimKey: string, text: string, surface: QuotableSurface) {
  const req: Requirement = { id: "claim0", kind: "claim", claim: claimKey, label: claimKey } as Requirement;
  return evaluate(productWith(text, surface), req);
}

const asVocabulary = (key: string, t: ClaimTermsView) => ({
  claim_key: key, standard_id: "ENGINE-BUILTIN", standard_version: "n/a", version: null,
  supporting_terms: t.support.map((term) => ({ term })),
  violating_terms: t.violating.map((term) => ({ term })),
});

// The generation parameters are FIXED. Changing any of them changes the table, so they
// belong here beside the constants rather than in an env var.
const SEED = "v3-8-g14-step1";
const PER_CELL = 999; // uncapped: at the default of 6, 1,056 sentences are dropped and
                      // cells would have to be marked INCOMPLETE. Full coverage or none.

// ---------------------------------------------------------------------------
// THE EXPECTED TABLE — RAW `pass_evidenced` / hostile, per key × class.
//
// Measured 2026-07-28 at `3dbef7c` (v3.9 CP-2), with
// `standards/attack/contexts/generic-collisions.json` supplying the 36 authored domain
// collisions. `null` means the class does not attack that key's term roles — nothing is
// owed, and it is NOT the same as `[0, n]`, which means attacked and never passed.
// ---------------------------------------------------------------------------
// ⚠️ v4.0 CP-3 — THE SECOND MOVEMENT, AND IT IS THE GATE DOING THE JOB IT WAS BUILT FOR.
// G-15-R (`src/server/referent.ts`) vetoes a claim match whose governing noun phrase
// denotes a supply-chain party, a landholding or a cultivation practice. Exactly THIRTEEN
// cells move — one per claim key, ALL in `wrong_subject`, ALL DOWNWARD (fewer hostile
// sentences pass, which is the direction a working guard produces). Per-cell arithmetic:
//   aluminum_free 77->70 (-7) · baking_soda_free 55->50 (-5) · cruelty_free 44->40 (-4)
//   vegan 22->20 (-2) · fragrance_free 55->50 (-5) · paraben_free 44->40 (-4)
//   sulfate_free 44->40 (-4) · single_origin 55->50 (-5) · organic 33->30 (-3)
//   fair_trade 33->30 (-3) · gluten_free 33->30 (-3) · third_party_tested 55->50 (-5)
//   bpa_free 44->40 (-4)                                        sum -54, 594 -> 540
// SEVEN class totals are delta 0, INCLUDING `tense_modality` and `denial` — movement in
// either would be a DEFECT (the guard reaching out of its charter), not a bonus. No
// denominator moves, so `ADJUDICATED_V38` is untouched: the corpus is the same corpus and
// the frozen human adjudication still describes it.
type Cell = [pass: number, total: number] | null;
const EXPECTED: Record<string, Record<string, Cell>> = {
  aluminum_free: { letter_not_spirit: [35, 35], adjacent_vocabulary: [10, 43], wrong_subject: [70, 128], merchant_controlled_string: [35, 60], orthography: [32, 86], violation: [4, 24], tense_modality: [56, 90], denial: [35, 59] },
  baking_soda_free: { letter_not_spirit: [25, 25], adjacent_vocabulary: [12, 22], wrong_subject: [50, 80], merchant_controlled_string: [25, 36], orthography: [22, 60], violation: [1, 8], tense_modality: [40, 54], denial: [25, 41] },
  cruelty_free: { letter_not_spirit: [20, 20], adjacent_vocabulary: [17, 27], wrong_subject: [40, 66], merchant_controlled_string: [20, 30], orthography: [18, 47], violation: [0, 8], tense_modality: [32, 45], denial: [20, 33] },
  // ⚠️ v4.0 CP-1a — THE ONLY ROW THAT MOVED, and it moved because the DICTIONARY moved.
  // `plant-based` and `plant based` were removed from `vegan`'s supporting terms (a false
  // equivalence: plant-based is a dietary-predominance term in food and a carbon-FEEDSTOCK
  // term in materials chemistry; vegan is an animal-exclusion rule). The templatizer emits
  // one sentence per (template, term), so vegan's hostile corpus halves from 4 supporting
  // terms to 2. Per-cell arithmetic, every cell exactly halved on the supporting side:
  //   letter_not_spirit          20/20 -> 10/10   (-10 sentences)
  //   adjacent_vocabulary        27/39 -> 13/23   (-16)
  //   wrong_subject              44/76 -> 22/48   (-28)
  //   merchant_controlled_string 20/36 -> 10/24   (-12)
  //   orthography                23/45 -> 13/30   (-15)
  //   violation                   3/16 ->  3/16   (0 — violating terms are unchanged)
  //   tense_modality             32/54 -> 16/36   (-18)
  //   denial                     20/34 -> 10/18   (-16)
  // 115 hostile sentences and 6 controls leave the corpus. No other key's cell moves, which
  // is the gate doing its job: a dictionary change is visible per cell and confined to
  // its key.
  vegan: { letter_not_spirit: [10, 10], adjacent_vocabulary: [13, 23], wrong_subject: [20, 48], merchant_controlled_string: [10, 24], orthography: [13, 30], violation: [3, 16], tense_modality: [16, 36], denial: [10, 18] },
  fragrance_free: { letter_not_spirit: [25, 25], adjacent_vocabulary: [19, 30], wrong_subject: [50, 80], merchant_controlled_string: [25, 36], orthography: [22, 51], violation: [1, 8], tense_modality: [40, 54], denial: [25, 41] },
  paraben_free: { letter_not_spirit: [20, 20], adjacent_vocabulary: [0, 12], wrong_subject: [40, 66], merchant_controlled_string: [20, 30], orthography: [18, 45], violation: [0, 8], tense_modality: [32, 45], denial: [20, 33] },
  sulfate_free: { letter_not_spirit: [20, 20], adjacent_vocabulary: [3, 17], wrong_subject: [40, 66], merchant_controlled_string: [20, 30], orthography: [18, 45], violation: [0, 8], tense_modality: [32, 45], denial: [20, 33] },
  single_origin: { letter_not_spirit: [25, 25], adjacent_vocabulary: [22, 28], wrong_subject: [50, 70], merchant_controlled_string: [25, 30], orthography: [24, 40], violation: null, tense_modality: [40, 45], denial: [25, 40] },
  organic: { letter_not_spirit: [15, 15], adjacent_vocabulary: [29, 31], wrong_subject: [30, 42], merchant_controlled_string: [15, 18], orthography: [22, 25], violation: null, tense_modality: [24, 27], denial: [15, 24] },
  fair_trade: { letter_not_spirit: [15, 15], adjacent_vocabulary: [14, 16], wrong_subject: [30, 42], merchant_controlled_string: [15, 18], orthography: [14, 20], violation: null, tense_modality: [24, 27], denial: [15, 24] },
  gluten_free: { letter_not_spirit: [15, 15], adjacent_vocabulary: [0, 18], wrong_subject: [30, 62], merchant_controlled_string: [15, 30], orthography: [14, 45], violation: [1, 16], tense_modality: [24, 45], denial: [15, 26] },
  third_party_tested: { letter_not_spirit: [25, 25], adjacent_vocabulary: [22, 32], wrong_subject: [50, 70], merchant_controlled_string: [25, 30], orthography: [21, 52], violation: null, tense_modality: [40, 45], denial: [25, 40] },
  bpa_free: { letter_not_spirit: [20, 20], adjacent_vocabulary: [6, 17], wrong_subject: [40, 66], merchant_controlled_string: [20, 30], orthography: [18, 45], violation: [1, 8], tense_modality: [32, 45], denial: [20, 33] },
};

/** Class totals, asserted separately so a compensating pair of per-cell errors cannot
 *  cancel out and leave the table looking unchanged. */
const EXPECTED_CLASS_TOTALS: Record<string, [number, number]> = {
  letter_not_spirit: [270, 270],          // v4.0 CP-1a: 280/280 - 10/10
  adjacent_vocabulary: [167, 316],        //             181/332 - 14/16
  wrong_subject: [540, 886],              // CP-1a 616/914 - 22/28; CP-3 594 -> 540, the guard
  merchant_controlled_string: [270, 402], //             280/414 - 10/12
  orthography: [256, 591],                //             266/606 - 10/15
  violation: [11, 104],                   //             unchanged
  tense_modality: [432, 603],             //             448/621 - 16/18
  denial: [270, 445],                     //             280/461 - 10/16
};

// v4.0 CP-1a: 3732 - 115 = 3617 hostile, 181 - 6 = 175 controls. Both deltas are vegan's
// alone, and both are the arithmetic consequence of two supporting terms leaving.
const EXPECTED_HOSTILE_TOTAL = 3617;
const EXPECTED_CONTROL_TOTAL = 175;

/**
 * The ADJUDICATED counts. FROZEN PROVENANCE, NOT A GATE.
 *
 * Source: `experiments/v3-8/out/g14_merged.json` (779 groups, 274 confirmed, exactly-once
 * verified) rolled up by `g14_table.mjs`'s own logic. Recorded here because the number a
 * reader quotes for "how often does this attack succeed" is this one, not the raw column,
 * and because leaving it only in a gitignored experiments blob is how a measurement
 * becomes a memory.
 *
 * ⚠️ `adjacent_vocabulary: [0, 100]` is the "attacked and found nothing" ILLUSION. Its
 * domain-collision half was never executed, because `DEFAULT_CONTEXT.adjacentDomains` was
 * empty and the 36 authored collisions sat in a subagent return value no consumer read.
 * v3.9 CP-1B executed them: the raw column above is now 181/332, of which 178 are
 * collision passes, and 116 of those are adjudicated false passes. Do not quote the 0.
 *
 * ⚠️ THESE NUMBERS WERE CORRECTED IN v3.9, AND THE CORRECTION IS THE POINT.
 * The counts are `confirmed − refuted`, and the refutation step was instructed to "default
 * to refuted when uncertain" — an instruction nothing ever verified. **P-21** is the finding
 * that a confirmation is re-executed against the bytes while a refutation is checked by
 * nothing, so the unverified side is the one that silently DELETES real defects.
 *
 * All 55 of v3.8's refutedAway groups were blind-re-examined under P-21's protocol (its
 * first use): 6 blind GOLD cases seeded one per batch and engine-verified beforehand, per-
 * re-examiner rates emitted. **Gold accuracy 6/6, so no batch's verdicts are discounted.**
 * **42 of 55 kills were overturned (76.4%)**, 0 missing, 0 indeterminate.
 *
 * This is a CORRECTION, not a displaced second measurement — it completes the verification
 * of one measurement whose refutation half was never checked, the way `488 → 483` did. The
 * per-group trail is `experiments/v3-9/out/v38_correct.json`; the class deltas reconcile
 * against it exactly (145 = 73 + 65 + 7).
 *
 *   wrong_subject   368/914 → 441/914   (+73)
 *   denial           69/461 → 134/461   (+65)
 *   violation         1/104 →   8/104   (+7)
 *   confirmed groups    274 → 316
 *
 * ⚠️ `letter_not_spirit` and `tense_modality` DID NOT MOVE — zero of the 55 kills were in
 * either class. So the v3.9 descope verdicts for those two axes are untouched by this, and
 * they rest on real-copy consequence rather than on these capability counts in any case.
 * ⚠️ `orthography` did not move either: 0 of its 10 kills were overturned. The original
 * refuter was entirely right there, which is the two-sided evidence that the re-examiners
 * were discriminating rather than reinstating on reflex.
 */
const ADJUDICATED_V38: Record<string, [number, number]> = {
  letter_not_spirit: [252, 270],
  adjacent_vocabulary: [0, 98],
  wrong_subject: [425, 886],
  merchant_controlled_string: [0, 402],
  orthography: [0, 591],
  violation: [8, 104],
  tense_modality: [425, 603],
  denial: [130, 445],
};

// ---------------------------------------------------------------------------
// ⚠️ v4.0 CP-1a — HOW THIS FROZEN TABLE MOVED WITHOUT ANY HUMAN VERDICT BEING EDITED.
//
// The Phase-A adjudication's strongest objection was that removing a supporting term is
// BLOCKED by this file: the denominator assertion below requires the adjudicated
// denominator to equal the raw one, and the adjudicated NUMERATOR is a human read of 779
// groups whose ids are `class|subclass|key` — "so the per-term delta is not derivable, and
// the only exits are to destroy the record, re-run the campaign, or not remove the term."
//
// **That premise is falsifiable, and it is false.** `experiments/v3-8/g14_table.mjs`'s
// roll-up is SENTENCE-level and `g14_sentences.json` records `term` on every row; group
// verdicts are applied per sentence with per-term `exceptions` overriding them, which is
// exactly why the schema demanded exceptions. Dropping the sentences generated from a
// removed term is therefore an exact operation on the recorded trail.
// `experiments/v4-0/rederive_adjudicated.mjs` does it, and refuses to answer unless BOTH
// anchors reproduce first:
//   ANCHOR 1  the roll-up over the untouched trail reproduces v3.8's table exactly
//             (260/280 · 368/914 · 1/104 · 439/621 · 69/461, sum 1137) ✅
//   ANCHOR 2  applying v3.9's 42 overturns reproduces the corrected table exactly
//             (441/914 · 8/104 · 134/461, sum 1282) ✅
// Anchor 2 earned its keep twice: two plausible formulations of "reinstate" gave 1,310 and
// 1,281, and only "the re-examination overturns the REFUTATION, leaving per-term exceptions
// intact" reproduces 1,282. Either wrong number would have looked like a measurement.
//
// CROSS-CHECK, from a completely independent instrument: the LIVE generation
// (`experiments/v4-0/emit_g14.ts`) and the frozen v3.8 sentence trail agree on all seven
// comparable denominators after the change — 270 · 886 · 402 · 591 · 104 · 603 · 445.
//
//   numerator delta  -8 · 0 · -16 · 0 · 0 · 0 · -14 · -4   =  -42
//   sum              1282 - 42 = 1240
//
// No group changed its verdict. The corpus lost 115 hostile sentences; the adjudication
// still describes every sentence that remains.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

interface Built {
  cells: Map<string, { pass: number; total: number }>;
  hostile: number;
  controls: number;
  controlsMeetingExpectation: number;
  problems: string[];
}

function build(): Built {
  const CLAIM_TERMS = liftClaimTerms();
  const keys = Object.keys(CLAIM_TERMS);
  const raw = JSON.parse(
    readFileSync(join(REPO, "standards", "attack", "contexts", "generic-collisions.json"), "utf8"),
  );
  const parsed = parseContext(raw);
  const problems = [...parsed.problems];

  const cells = new Map<string, { pass: number; total: number }>();
  let hostile = 0, controls = 0, controlsOk = 0;

  for (const key of keys) {
    const set = generateAttacks(asVocabulary(key, CLAIM_TERMS[key]!) as never, {
      seed: SEED, perCellLimit: PER_CELL, context: parsed.context, includeControls: true,
    });
    if (set.state === "incomplete") problems.push(`generation INCOMPLETE for ${key}: ${set.summary}`);
    if (set.coverage.droppedByCap.length) {
      problems.push(`${key}: ${set.coverage.droppedByCap.length} sentence(s) dropped by the cap — cells would be INCOMPLETE`);
    }

    for (const s of [...set.attacks, ...set.controls]) {
      const r = realEvaluate(key, s.text, s.surface);
      if (s.control) {
        controls++;
        // A control's expected outcome depends on the term's ROLE: a violating-term
        // control expects CONTRADICTED, not pass. Checking every control for
        // `pass_evidenced` reports all 13 as broken while the engine answers correctly.
        const isPass = r.status === "pass_evidenced";
        const isContra = r.status === "not_proven" && r.detail === CONTRA_DETAIL;
        if (s.termRole === "violating" ? isContra : isPass) controlsOk++;
        continue;
      }
      hostile++;
      const k = `${key}|${s.attackClass}`;
      if (!cells.has(k)) cells.set(k, { pass: 0, total: 0 });
      const c = cells.get(k)!;
      c.total++;
      if (r.status === "pass_evidenced") c.pass++;
    }
  }
  return { cells, hostile, controls, controlsMeetingExpectation: controlsOk, problems };
}

// A single build shared by every assertion below — 13 keys × ~300 sentences, ~0.5s.
const BUILT = build();

test("[g14] the harness is LIVE — refuse to assert a table an empty instrument produced", () => {
  // Anti-vacuity anchor. Every number below is a count, and a count of zero is what both
  // a clean engine and a dead harness return.
  assert.equal(BUILT.problems.length, 0, `generation problems:\n${BUILT.problems.join("\n")}`);
  assert.ok(BUILT.hostile > 3000, `only ${BUILT.hostile} hostile sentences generated — the harness is not live`);
  assert.ok(BUILT.cells.size > 90, `only ${BUILT.cells.size} cells populated`);

  // Two-sided liveness through the REAL evaluate(): a plain supporting sentence must
  // pass, and an unrelated sentence must not. If these collapse, every cell is noise.
  const pos = realEvaluate("organic", "This product is organic.", "product_description");
  const neg = realEvaluate("organic", "This product ships on Tuesday.", "product_description");
  assert.equal(pos.status, "pass_evidenced", "the positive canary did not pass — evaluate() is not answering");
  assert.notEqual(neg.status, "pass_evidenced", "the negative canary passed — evaluate() answers everything");

  // The contrary-evidence detail string the outcome mapping keys on must still exist.
  const src = readFileSync(join(REPO, "src", "server", "productTest.ts"), "utf8");
  assert.ok(
    src.includes(CONTRA_DETAIL),
    "the contrary-evidence detail sentence is no longer in productTest.ts — the control " +
      "expectations in this gate are stale and every violation would read as a plain miss",
  );
});

test("[g14] the key set is the engine's, and the class set is the templatizer's", () => {
  const keys = Object.keys(liftClaimTerms()).sort();
  assert.deepEqual(keys, [...ENGINE_CLAIM_KEYS].sort(),
    "the lifted dictionary keys and ENGINE_CLAIM_KEYS have diverged");
  assert.deepEqual(Object.keys(EXPECTED).sort(), keys, "EXPECTED's keys are not the engine's claim keys");
  for (const k of Object.keys(EXPECTED)) {
    assert.deepEqual(Object.keys(EXPECTED[k]!).sort(), [...ATTACK_CLASSES].sort(),
      `EXPECTED.${k} does not cover exactly the templatizer's attack classes`);
  }
});

test("[g14] every cell matches its expected constant EXACTLY", () => {
  const mismatches: string[] = [];
  const unexpected: string[] = [];

  for (const [key, byClass] of Object.entries(EXPECTED)) {
    for (const [cls, expected] of Object.entries(byClass)) {
      const got = BUILT.cells.get(`${key}|${cls}`);
      if (expected === null) {
        // `null` means the class does not attack this key's term roles. A cell that
        // suddenly HAS sentences is a change in what is being attacked, not a pass.
        if (got) unexpected.push(`${key}|${cls}: expected not-applicable, got ${got.pass}/${got.total}`);
        continue;
      }
      if (!got) {
        // ⚠️ INCOMPLETE. A cell that did not run is NOT its expected value and NOT zero.
        mismatches.push(`${key}|${cls}: INCOMPLETE — the cell did not run; expected ${expected[0]}/${expected[1]}`);
        continue;
      }
      if (got.pass !== expected[0] || got.total !== expected[1]) {
        mismatches.push(`${key}|${cls}: expected ${expected[0]}/${expected[1]}, got ${got.pass}/${got.total}`);
      }
    }
  }
  // A cell the engine produced that EXPECTED does not describe is the mirror hole:
  // a new key or class nobody added to the table, silently unasserted.
  for (const k of BUILT.cells.keys()) {
    const [key, cls] = k.split("|");
    if (!EXPECTED[key!] || EXPECTED[key!]![cls!] === undefined) unexpected.push(`${k}: produced but absent from EXPECTED`);
  }

  assert.deepEqual(
    { mismatches, unexpected }, { mismatches: [], unexpected: [] },
    "the G-14 table MOVED. This is the before/after instrument: a matcher change that\n" +
      "alters what the engine answers on chosen input shows up here, by cell. If the\n" +
      "change was intended, re-measure and update EXPECTED in the same commit, with the\n" +
      "delta stated. Do not adjust a constant to make a suite green.",
  );
});

test("[g14] class totals agree, so compensating per-cell errors cannot cancel", () => {
  const totals: Record<string, [number, number]> = {};
  for (const [k, c] of BUILT.cells) {
    const cls = k.split("|")[1]!;
    totals[cls] ??= [0, 0];
    totals[cls]![0] += c.pass;
    totals[cls]![1] += c.total;
  }
  assert.deepEqual(totals, EXPECTED_CLASS_TOTALS);
  assert.equal(BUILT.hostile, EXPECTED_HOSTILE_TOTAL);
});

test("[g14] the must-not-regress direction: every control still meets its expectation", () => {
  assert.equal(BUILT.controls, EXPECTED_CONTROL_TOTAL);
  assert.equal(
    BUILT.controlsMeetingExpectation, EXPECTED_CONTROL_TOTAL,
    `${EXPECTED_CONTROL_TOTAL - BUILT.controlsMeetingExpectation} control(s) no longer meet their ` +
      "expected outcome — a guard has started suppressing honest copy",
  );
});

test("[g14] the adjudicated record is present and is not mistaken for the raw table", () => {
  // Provenance, not a gate. The only thing asserted is that the two tables are DIFFERENT
  // quantities and that nobody has quietly made them the same — because if they ever
  // agree cell-for-cell, someone has copied one into the other.
  assert.deepEqual(Object.keys(ADJUDICATED_V38).sort(), [...ATTACK_CLASSES].sort());
  const identical = Object.keys(ADJUDICATED_V38).every(
    (c) => ADJUDICATED_V38[c]![0] === EXPECTED_CLASS_TOTALS[c]![0],
  );
  assert.ok(!identical,
    "the adjudicated and raw tables now agree on every class — one has been copied into " +
      "the other. An engine answer is not a verdict.");
  // The denominators, however, MUST agree wherever the adjudicated run covered the class,
  // or the two tables are describing different corpora and cannot be compared at all.
  for (const cls of Object.keys(ADJUDICATED_V38)) {
    if (cls === "adjacent_vocabulary") continue; // v3.9 CP-1B grew this one, by design
    assert.equal(
      ADJUDICATED_V38[cls]![1], EXPECTED_CLASS_TOTALS[cls]![1],
      `${cls}: the adjudicated denominator and the raw denominator disagree — the frozen ` +
        "adjudication no longer describes this corpus",
    );
  }
});

test("[gaps] G-14 moves EXPECTED_OPEN_GAPS by +0, and this is the reason", () => {
  // Arithmetic, stated rather than implied: 274 confirmed groups are recorded HERE, in
  // per-cell constants, with a suite that fails when any of them moves. None is pinned
  // into the adversarial corpus's register, so `EXPECTED_OPEN_GAPS` is unchanged: +0.
  //
  // The register means "a debt with a receipt, individually pinned". This gate means
  // "a measured table that cannot drift". Both are load-bearing; neither substitutes for
  // the other, and merging them would destroy the register's meaning.
  const cellsWithADefectDirection = Object.values(ADJUDICATED_V38).filter(([fp]) => fp > 0).length;
  assert.ok(cellsWithADefectDirection >= 4,
    "the adjudicated record no longer carries a defect direction for any class — it has been zeroed");
  // 1137 before v3.9's re-examination; 1282 after, +145 = 73 (wrong_subject) + 65 (denial)
  // + 7 (violation), reconciled against the per-group trail in
  // `experiments/v3-9/out/v38_correct.json`.
  // v4.0 CP-1a: 1282 - 42 = 1240, the sentences generated from `plant-based`/`plant based`
  // leaving the corpus. Re-derived, not edited — see the block above ADJUDICATED_V38.
  assert.equal(
    Object.values(ADJUDICATED_V38).reduce((n, [fp]) => n + fp, 0), 1240,
    "the total confirmed-false-pass count across classes changed; re-derive it from the " +
      "merge artifacts rather than editing this number",
  );
});
