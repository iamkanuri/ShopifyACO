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
type Cell = [pass: number, total: number] | null;
const EXPECTED: Record<string, Record<string, Cell>> = {
  aluminum_free: { letter_not_spirit: [35, 35], adjacent_vocabulary: [10, 43], wrong_subject: [77, 128], merchant_controlled_string: [35, 60], orthography: [32, 86], violation: [4, 24], tense_modality: [56, 90], denial: [35, 59] },
  baking_soda_free: { letter_not_spirit: [25, 25], adjacent_vocabulary: [12, 22], wrong_subject: [55, 80], merchant_controlled_string: [25, 36], orthography: [22, 60], violation: [1, 8], tense_modality: [40, 54], denial: [25, 41] },
  cruelty_free: { letter_not_spirit: [20, 20], adjacent_vocabulary: [17, 27], wrong_subject: [44, 66], merchant_controlled_string: [20, 30], orthography: [18, 47], violation: [0, 8], tense_modality: [32, 45], denial: [20, 33] },
  vegan: { letter_not_spirit: [20, 20], adjacent_vocabulary: [27, 39], wrong_subject: [44, 76], merchant_controlled_string: [20, 36], orthography: [23, 45], violation: [3, 16], tense_modality: [32, 54], denial: [20, 34] },
  fragrance_free: { letter_not_spirit: [25, 25], adjacent_vocabulary: [19, 30], wrong_subject: [55, 80], merchant_controlled_string: [25, 36], orthography: [22, 51], violation: [1, 8], tense_modality: [40, 54], denial: [25, 41] },
  paraben_free: { letter_not_spirit: [20, 20], adjacent_vocabulary: [0, 12], wrong_subject: [44, 66], merchant_controlled_string: [20, 30], orthography: [18, 45], violation: [0, 8], tense_modality: [32, 45], denial: [20, 33] },
  sulfate_free: { letter_not_spirit: [20, 20], adjacent_vocabulary: [3, 17], wrong_subject: [44, 66], merchant_controlled_string: [20, 30], orthography: [18, 45], violation: [0, 8], tense_modality: [32, 45], denial: [20, 33] },
  single_origin: { letter_not_spirit: [25, 25], adjacent_vocabulary: [22, 28], wrong_subject: [55, 70], merchant_controlled_string: [25, 30], orthography: [24, 40], violation: null, tense_modality: [40, 45], denial: [25, 40] },
  organic: { letter_not_spirit: [15, 15], adjacent_vocabulary: [29, 31], wrong_subject: [33, 42], merchant_controlled_string: [15, 18], orthography: [22, 25], violation: null, tense_modality: [24, 27], denial: [15, 24] },
  fair_trade: { letter_not_spirit: [15, 15], adjacent_vocabulary: [14, 16], wrong_subject: [33, 42], merchant_controlled_string: [15, 18], orthography: [14, 20], violation: null, tense_modality: [24, 27], denial: [15, 24] },
  gluten_free: { letter_not_spirit: [15, 15], adjacent_vocabulary: [0, 18], wrong_subject: [33, 62], merchant_controlled_string: [15, 30], orthography: [14, 45], violation: [1, 16], tense_modality: [24, 45], denial: [15, 26] },
  third_party_tested: { letter_not_spirit: [25, 25], adjacent_vocabulary: [22, 32], wrong_subject: [55, 70], merchant_controlled_string: [25, 30], orthography: [21, 52], violation: null, tense_modality: [40, 45], denial: [25, 40] },
  bpa_free: { letter_not_spirit: [20, 20], adjacent_vocabulary: [6, 17], wrong_subject: [44, 66], merchant_controlled_string: [20, 30], orthography: [18, 45], violation: [1, 8], tense_modality: [32, 45], denial: [20, 33] },
};

/** Class totals, asserted separately so a compensating pair of per-cell errors cannot
 *  cancel out and leave the table looking unchanged. */
const EXPECTED_CLASS_TOTALS: Record<string, [number, number]> = {
  letter_not_spirit: [280, 280],
  adjacent_vocabulary: [181, 332],
  wrong_subject: [616, 914],
  merchant_controlled_string: [280, 414],
  orthography: [266, 606],
  violation: [11, 104],
  tense_modality: [448, 621],
  denial: [280, 461],
};

const EXPECTED_HOSTILE_TOTAL = 3732;
const EXPECTED_CONTROL_TOTAL = 181;

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
 * collision passes awaiting adjudication. Do not quote the 0 as a clean cell.
 */
const ADJUDICATED_V38: Record<string, [number, number]> = {
  letter_not_spirit: [260, 280],
  adjacent_vocabulary: [0, 100],
  wrong_subject: [368, 914],
  merchant_controlled_string: [0, 414],
  orthography: [0, 606],
  violation: [1, 104],
  tense_modality: [439, 621],
  denial: [69, 461],
};

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
  assert.equal(
    Object.values(ADJUDICATED_V38).reduce((n, [fp]) => n + fp, 0), 1137,
    "the total confirmed-false-pass count across classes changed; re-derive it from the " +
      "merge artifacts rather than editing this number",
  );
});
