// ===========================================================================
// ISSUE COFFEE STANDARD v1.2 — a MECHANICAL TRANSFORM of v1.1, not a retyping.
//
// WHY A NEW VERSION AND NOT AN EDIT. v1.1 is byte-frozen: its `standard_hash` is
// what a citation resolves through, and it is served at a stable URL. Everything
// below therefore produces a NEW directory and leaves v1.0 and v1.1 untouched.
//
// WHY 1.2 AND NOT A SECOND 1.1. Two concurrent sessions each authored a revision
// of the grammar and both called it 1.1, and one of them SHIPPED —
// `standards/coffee/v1.1/standard.json` declares `grammar_version: "1.1"`.
// Redefining 1.1 to mean the other grammar would make a published, hash-frozen
// document invalid against the version string it names, silently: the document
// does not change, the answer to "is it valid" does. A grammar version resolves
// through the same contract as a standard hash. So the reconciliation is 1.2.
//
// WHAT 1.2 CHANGES HERE, AND WHY EACH ONE IS FORCED BY A NUMBER:
//
//   1. THE BAND GOES. `predicted_discrimination` (a numeric fail-rate band) becomes
//      `discrimination_prediction` (a direction, a confidence, no number), with the
//      REASONING PRESERVED VERBATIM and `direction: "no_prediction"`. Authored bands
//      held 1 of 10 on this sample and every miss was HIGH. SCHEMA.md §9.3 step 3
//      forbids translating a band into a direction: a direction derived from the
//      band inherits the error that condemned the band.
//
//   2. A DISCRIMINATION VERDICT IS A MEASUREMENT. The ten measured entries are
//      re-derived from `experiments/v3-2/standard_run3.jsonl` — the ORIGINAL run,
//      no re-run, no network, no spend — through the SHIPPED `verdictFor`, which is
//      the same function the cross-field rules recompute against. Nothing here
//      reimplements the statistics; this project has a standing rule against a
//      second engine that drifts from the first.
//
//   3. FIVE ENTRIES BECOME `unbound`. v1.1 filed PRICE-001, STOCK-001, TERMS-001,
//      DECAF-004 and DIET-001 as `not_discriminating` on the strength of a PREDICTED
//      band. None carries a measurement and none carries a binding, so at 1.2 they
//      cannot keep that tier (§9.3 step 2) and cannot become `executable` either.
//      `unbound` is the honest name for where they actually are.
//
//   4. `measured_fitness` BECOMES `category_fitness` — a migration, not an alias.
//
// EVERY NUMBER IN THE OUTPUT IS COMPUTED FROM AN ARTIFACT INSIDE THIS TRANSFORM.
// Nothing is retyped from a brief, a table or a previous document. Where two
// artifacts record the same quantity, both are read and disagreement ABORTS.
//
// Run: npx tsx standards/coffee/issue_v1_2.ts
// ===========================================================================
import fs from "node:fs";
import path from "node:path";
import { standardHash, hashMatches } from "../hash.js";
import { wilson95, verdictFor, familyWiseFloor, MIN_ADJUDICATED_N, TARGET_BAND } from "../discrimination.js";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const REPO = path.resolve(here, "..", "..");
const SRC = path.join(here, "v1.1");
const V10DIR = path.join(here, "v1.0");
const OUT = path.join(here, "v1.2");

/** ⚠️ LITERALS, ON PURPOSE. These are the texts every existing citation resolves
 *  to. Recomputing them from the files would make this gate agree with whatever
 *  the files happen to say today, which is the check that is worth nothing. */
const V10_HASH = "334389c4eb6145112deec621e667f11142fb204c66bedd314fc12662d09acec5";
const V11_HASH = "f8ec2780f60c38931913e5b6cd37506500c8462709209de7180ba6691d6137e7";

/** ⚠️ THE TYPE ANNOTATION IS LOAD-BEARING, not decoration. TypeScript only narrows
 *  after a never-returning call when the callee is declared with an explicit
 *  annotation — without it every `if (!x) die(...)` below leaves `x` possibly
 *  undefined and the checks read as if they had not run. */
const die: (msg: string) => never = (msg) => {
  console.error(`\nABORT — ${msg}\n`);
  process.exit(2);
};
const rd = (rel: string): string => fs.readFileSync(path.join(REPO, rel), "utf8");
const rj = <T>(rel: string): T => JSON.parse(rd(rel)) as T;
/** 4 decimal places. The tightest decision margin in this document is 0.0019pp
 *  (CERT-001's interval against the 85% edge), so two decimals would round a
 *  knife-edge into a tie and `INTERVAL_TOLERANCE_PP` is 0.05. */
const r4 = (x: number): number => Number(x.toFixed(4));

type Json = Record<string, unknown>;
interface Entry extends Json { id: string; tier: string; predicted_discrimination: { reasoning: string; [k: string]: unknown } }
interface Doc extends Json { grammar_version: string; version: string; status: string; title: string; entries: Entry[]; changelog: Json[] }

// ===========================================================================
// GATE 0 — the two frozen texts, before anything else is read.
// ===========================================================================
const v11 = rj<Doc>("standards/coffee/v1.1/standard.json");
const v10 = rj<Doc>("standards/coffee/v1.0/standard.json");
{
  const c11 = hashMatches(v11);
  if (!c11.ok || c11.computed !== V11_HASH) {
    die(`v1.1 is not the frozen text.\n  expected ${V11_HASH}\n  computed ${c11.computed}\n  stored   ${c11.stored}\n` +
      `  Every citation made against v1.1 now resolves to a different text. If the change is intended it is a NEW VERSION, not an edit.`);
  }
  const c10 = hashMatches(v10);
  if (!c10.ok || c10.computed !== V10_HASH) {
    die(`v1.0 is not the frozen text.\n  expected ${V10_HASH}\n  computed ${c10.computed}`);
  }
  // The chain, not one hop: v1.2 supersedes v1.1 supersedes v1.0.
  const v10ids = new Set(v10.entries.map((e) => e.id));
  const orphans = v11.entries.filter((e) => !e.supersedes || !v10ids.has(String(e.supersedes))).map((e) => e.id);
  if (orphans.length) die(`v1.1 entries that do not name a real v1.0 predecessor: ${orphans.join(", ")}`);
}
console.log(`gate: v1.0 ${V10_HASH.slice(0, 12)}… frozen · v1.1 ${V11_HASH.slice(0, 12)}… frozen · chain intact (${v11.entries.length} entries)`);

// ===========================================================================
// 1 — RECOUNT RUN 3. The join is the RUN'S OWN requirement list (entry id beside
// its rendered label), never the ORDER of the executable entries: an order join
// silently renumbers everything if one entry moves.
// ===========================================================================
const RUN_REL = "experiments/v3-2/standard_run3.jsonl";
const runRows = rd(RUN_REL).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Json);

const labelToEntry = new Map<string, string>();
const kindOf = new Map<string, string>();
for (const r of runRows) {
  for (const q of ((r.applicability as Json | undefined)?.requirements as Array<Json> | undefined) ?? []) {
    const id = String(q.id), label = String(q.label);
    const prev = labelToEntry.get(label);
    if (prev && prev !== id) die(`label ${JSON.stringify(label)} maps to both ${prev} and ${id}`);
    labelToEntry.set(label, id);
    kindOf.set(id, String(q.kind));
  }
}

const applied = runRows.filter((r) => (r.applicability as Json | undefined)?.state === "APPLIED");
const evaluated = runRows.filter((r) => (r.result as Json | undefined)?.ok === true);
if (applied.length !== evaluated.length) die(`${applied.length} APPLIED records but ${evaluated.length} evaluated — the sample is not what it appears to be`);
const RUN_STORES = new Set(evaluated.map((r) => String(r.host))).size;
const RUN_PRODUCTS = evaluated.length;
if (RUN_STORES !== RUN_PRODUCTS) {
  die(`${RUN_PRODUCTS} products over ${RUN_STORES} distinct hosts — the discrimination sample is no longer one product per store, and \`one_row_per_store\` depends on it`);
}
const capturedDates = [...new Set(runRows.map((r) => String(r.capturedAt).slice(0, 10)))];
if (capturedDates.length !== 1) die(`the run spans ${capturedDates.length} capture dates (${capturedDates.join(", ")}); \`captured_on\` is a single date`);
const CAPTURED_ON = capturedDates[0]!;
const replayMisses = runRows.reduce((n, r) => n + (((r.replayMisses as unknown[] | undefined) ?? []).length), 0);
if (replayMisses !== 0) die(`${replayMisses} replay misses in the run — the bytes evaluated are not the bytes captured`);

// Exclusions, with their reasons. A list that drops entries silently is worse
// than one that runs them all: the reader cannot tell passing from not being asked.
const excluded = runRows.filter((r) => (r.applicability as Json | undefined)?.state !== "APPLIED");
const exclusionReason = (r: Json): string => {
  const decisions = ((r.applicability as Json).decisions as Array<Json> | undefined) ?? [];
  return String(decisions[0]?.reason ?? "unrecorded");
};
const OUT_OF_CATEGORY = excluded.filter((r) => exclusionReason(r) === "out_of_category").length;
const UNCLASSIFIABLE = excluded.filter((r) => exclusionReason(r) === "unknown_category").length;
if (OUT_OF_CATEGORY + UNCLASSIFIABLE !== excluded.length) {
  die(`${excluded.length} excluded records but only ${OUT_OF_CATEGORY + UNCLASSIFIABLE} carry a reason this transform understands`);
}

interface Counts { asked: number; pass: number; fail: number; access: number }
const counts = new Map<string, Counts>();
for (const r of evaluated) {
  const res = r.result as Json;
  for (const a of [...((res.assertions as Array<Json> | undefined) ?? []), ...((res.deferred as Array<Json> | undefined) ?? [])]) {
    const id = labelToEntry.get(String(a.label));
    if (!id) die(`assertion label ${JSON.stringify(a.label)} is in no record's requirement list`);
    if (!counts.has(id!)) counts.set(id!, { asked: 0, pass: 0, fail: 0, access: 0 });
    const c = counts.get(id!)!;
    c.asked++;
    if (a.status === "pass_evidenced") c.pass++;
    else if (a.status === "requires_store_access") c.access++;
    else c.fail++;
  }
}

// ---- cross-check 1: the independently-written derivation of the same run ------
const derived = rj<Array<{ id: string; asked: number; pass: number; fail: number; access: number; failPct: number }>>("experiments/v3-2/discrimination.json");
if (derived.length !== counts.size) die(`discrimination.json has ${derived.length} entries; this recount produced ${counts.size}`);
for (const d of derived) {
  const c = counts.get(d.id);
  if (!c) die(`discrimination.json names ${d.id}, which this recount never saw`);
  if (c.asked !== d.asked || c.pass !== d.pass || c.fail !== d.fail || c.access !== d.access) {
    die(`${d.id}: recount asked/pass/fail/access = ${c.asked}/${c.pass}/${c.fail}/${c.access}, ` +
      `discrimination.json says ${d.asked}/${d.pass}/${d.fail}/${d.access}. Two independent counts of one run must agree.`);
  }
}
console.log(`cross-check: ${derived.length}/${derived.length} entries agree with experiments/v3-2/discrimination.json on asked/pass/fail/access`);

// ---- cross-check 2: the audit read EVERY pass row -----------------------------
const verdicts = rj<{ rows: Array<{ host: string; label: string; verdict: string; why: string }> }>("experiments/v3-2/verdicts.json");
{
  const auditedPerLabel = new Map<string, number>();
  for (const row of verdicts.rows) auditedPerLabel.set(row.label, (auditedPerLabel.get(row.label) ?? 0) + 1);
  for (const [label, id] of labelToEntry) {
    const audited = auditedPerLabel.get(label) ?? 0;
    const passes = counts.get(id)?.pass ?? 0;
    if (audited !== passes) {
      die(`${id}: the run produced ${passes} pass rows but the audit adjudicated ${audited}. ` +
        `A fitness bound over a partially adjudicated set is a floor of unknown depth, not a bound.`);
    }
  }
  console.log(`cross-check: all ${verdicts.rows.length} audited rows account for all ${[...counts.values()].reduce((n, c) => n + c.pass, 0)} pass rows, label by label`);
}

// ---- cross-check 3: the sidecar the site publishes ----------------------------
interface Fitness {
  measured_at: string; engine_version: string;
  samples: Array<Json & { name: string }>;
  entry_discrimination: { n_products: number; bands_held: number; entries: Array<{ id: string; asked: number; fail_pct: number }> };
}
const fitness = rj<Fitness>("standards/coffee/v1.0/fitness.json");
for (const e of fitness.entry_discrimination.entries) {
  const c = counts.get(e.id);
  if (!c) die(`fitness.json names ${e.id}, which the run never asked`);
  if (c.asked !== e.asked) die(`${e.id}: fitness.json records asked=${e.asked}, the run says ${c.asked}`);
  const pct = (c.fail! / c.asked) * 100;
  if (Math.abs(pct - e.fail_pct) > 0.05) die(`${e.id}: fitness.json records ${e.fail_pct}% over ASKED, recount gives ${pct.toFixed(4)}%`);
}
console.log(`cross-check: ${fitness.entry_discrimination.entries.length}/${fitness.entry_discrimination.entries.length} entries agree with standards/coffee/v1.0/fitness.json`);

// ===========================================================================
// 2 — THE MEASUREMENTS, through the SHIPPED decision rule.
//
// ⚠️ THE DENOMINATOR IS `n_adjudicated`, NOT `n_asked`, AND ON THIS RUN THEY
// DIFFER. `requires_store_access` is neither a pass nor a fail — it is the engine
// reporting it could not decide — and DELIV-001 has 26 of them. Counting them in
// the denominator is the "count them as passes" reading, which is what v1.1
// published (45.0%) without saying which reading it took. Dropped, the same rows
// give 60.8%, which is also what run 2 measured (59.4% over 32 adjudicated). The
// grammar is explicit: `n_adjudicated` is "rows the engine actually decided", and
// the rate and the interval are computed over it.
// ===========================================================================
const SELECTION = "first_applicable_product";
{ // the selection is verified against the capture script, not asserted from memory
  // ⚠️ The claim is in a JSDoc block, so the phrase is broken across lines by
  // `\n * `. A naive `\s+` between the words does not match that, and the abort
  // it produced looked exactly like the selection having changed.
  const capture = rd("experiments/v3-2/capture.ts").replace(/\s*\r?\n\s*\*?\s*/g, " ");
  if (!/first\s+applicable\s+product/i.test(capture)) {
    die(`experiments/v3-2/capture.ts does not describe a first-applicable-product selection; \`selection: "${SELECTION}"\` would be unverified`);
  }
  const coffeeSample = fitness.samples.find((s) => s.name === "coffee")!;
  if (!/deduplicated on registrable domain/i.test(String(coffeeSample.description))) {
    die(`the coffee sample's own description does not record the brand deduplication; \`deduplicated_by_brand: true\` would be unverified`);
  }
}

const sampleProvenance = (): Json => ({
  sample_id: RUN_REL,
  category_scope: "this_category",
  category_standard_id: String(v11.standard_id),
  stores: RUN_STORES,
  products: RUN_PRODUCTS,
  selection: SELECTION,
  deduplicated_by_brand: true,
  applicability_gate_enforced: true,
  unclassifiable_refused: UNCLASSIFIABLE,
  excluded_out_of_category: OUT_OF_CATEGORY,
  captured_on: CAPTURED_ON,
  notes:
    `${runRows.length} coffee brands captured, deduplicated on registrable domain before capture, ${excluded.length} refused by the ` +
    `G-10 applicability predicate with a recorded reason (${OUT_OF_CATEGORY} out of category, ${UNCLASSIFIABLE} unclassifiable), ` +
    `${RUN_PRODUCTS} evaluated, ${replayMisses} replay misses. One product per storefront: ${RUN_PRODUCTS} products over ${RUN_STORES} distinct hosts, ` +
    `which is what makes the rows independent enough for the interval to mean anything. ` +
    `\`attrition_logged\` is deliberately NOT asserted: the capture-attrition index in this repo ` +
    `(experiments/v3-2/capture_index.jsonl) covers a later batch than the one this run's earliest snapshots came from, ` +
    `so no single artifact establishes a logged cause for every attempted target of THIS sample, and a flag that cannot be checked must not be set.`,
});

// The per-entry false-positive count from the audit — this is the ONLY bias in
// this record that can be quantified, and it is quantified per entry rather than
// from the sample-wide 6.17%, because the sample-wide number is not this row's.
const fpByEntry = new Map<string, Array<{ host: string; why: string }>>();
for (const row of verdicts.rows) {
  if (row.verdict !== "false_positive") continue;
  const id = labelToEntry.get(row.label);
  if (!id) die(`verdicts.json names label ${JSON.stringify(row.label)}, which is in no requirement list`);
  if (!fpByEntry.has(id!)) fpByEntry.set(id!, []);
  fpByEntry.get(id!)!.push({ host: row.host, why: row.why });
}

/** ⚠️ ESTABLISHED BY EXECUTION, NOT ASSUMED FROM A PREVIOUS RUN.
 *  `experiments/v3-2/run_standard.ts` sets `process.env.PRODUCT_TEST_SEMANTIC = "0"`,
 *  and `src/server/productTest.ts#applySemanticTier` restricts the tier to
 *  requirements of kind `claim`. So the tier-off bias is real for THIS run and
 *  applies to claim rows and to nothing else. */
const SEMANTIC_OFF = (() => {
  const harness = rd("experiments/v3-2/run_standard.ts");
  const off = /PRODUCT_TEST_SEMANTIC\s*=\s*["']0["']/.test(harness);
  const bridge = rd("src/server/productTest.ts");
  const claimOnly = /kind === "claim"/.test(bridge);
  if (!off) {
    die(`experiments/v3-2/run_standard.ts no longer disables the semantic tier. The instrument_bias declarations below were derived from the fact that it does; re-derive them before publishing.`);
  }
  if (!claimOnly) {
    die(`src/server/productTest.ts no longer restricts the semantic tier to \`claim\` requirements. The per-kind scoping of the tier-off bias is no longer established.`);
  }
  return { off, claimOnly };
})();

interface Measured { id: string; kind: string; nAsked: number; nAdj: number; fail: number; ratePct: number; lo: number; hi: number; verdict: string; biases: Json[] }
const measured: Measured[] = [];
for (const [id, c] of counts) {
  const nAdj = c.asked - c.access;
  const v = verdictFor(c.fail, nAdj);
  if (v.verdict === null) die(`${id}: ${v.reason}`);
  const iv = wilson95(c.fail, nAdj);
  const kind = kindOf.get(id);
  if (!kind) die(`${id} has no recorded engine kind, so the per-kind bias scoping below cannot be applied to it`);

  // ---- instrument_bias, declared truthfully -----------------------------------
  // The rule fires on the VERDICT, not the tier, so every `not_discriminating`
  // record needs a declaration even though NONE of these entries is being retired.
  // An empty list is a legal declaration; an UNDECLARED bias is not an absent one.
  const biases: Json[] = [];
  if (v.verdict === "not_discriminating") {
    const fps = fpByEntry.get(id) ?? [];
    const passes = c.pass;
    // DEFLATING, and quantified from this entry's own audited rows. A confirmed
    // false PASS is a row that should have failed, so correcting it RAISES the
    // fail rate: the measured rate understates the true one by exactly this much.
    biases.push({
      source:
        `Measured false-pass rate of this engine on this entry, from the row-by-row audit of the same run ` +
        `(experiments/v3-2/verdicts.json): ${fps.length} of this entry's ${passes} pass rows were confirmed wrong. ` +
        `Correcting them moves rows from pass to fail, so the measured fail rate is BELOW the true one.`,
      direction: "deflates_fail_rate",
      magnitude_pp: r4((fps.length / nAdj) * 100),
    });
    if (kind === "claim") {
      // ⚠️ THE DISABLED TIER HAS TWO PATHS AND THEY PULL IN OPPOSITE DIRECTIONS, so
      // it is declared as two biases rather than one. The convenient story — "the
      // tier off can only overstate a claim row's fail rate" — is what this repo's
      // own notes say, and it is only true of the GRANT path. The VETO path,
      // absent for the same reason, moves the rate the other way. Neither is
      // measured, so neither may be netted off against the other, and collapsing
      // them into one signed claim would be exactly the flattering simplification.
      biases.push({
        source:
          `The bounded semantic tier was DISABLED for this run: experiments/v3-2/run_standard.ts sets PRODUCT_TEST_SEMANTIC=0. ` +
          `It applies only to requirements of kind \`claim\` (src/server/productTest.ts#applySemanticTier). Its GRANT path promotes ` +
          `a claim the lexical term list missed; with the tier off, a page that states this claim in wording the vocabulary does ` +
          `not carry is recorded as a fail, so this path pushes the measured rate ABOVE the true one. UNQUANTIFIED: the audit read ` +
          `PASS rows only, and fail rows carry no false-negative information, so no artifact in this repo bounds it.`,
        direction: "inflates_fail_rate",
      });
      biases.push({
        source:
          `The same disabled tier, its OTHER path. A semantic VETO withdraws a lexical match whose sentence is about something ` +
          `else; with the tier off those matches stand as passes, so this path pushes the measured rate BELOW the true one. ` +
          `Declared separately and NOT netted against the grant path above: neither is measured, so nothing establishes which ` +
          `dominates, and a single signed claim about the tier would be a guess wearing a direction.`,
        direction: "deflates_fail_rate",
      });
    }
  }
  measured.push({ id, kind, nAsked: c.asked, nAdj, fail: c.fail, ratePct: r4(v.failRatePct!), lo: r4(iv.lowerPct), hi: r4(iv.upperPct), verdict: v.verdict, biases });
}

const tally = measured.reduce<Record<string, number>>((a, m) => { a[m.verdict] = (a[m.verdict] ?? 0) + 1; return a; }, {});
const FAMILY_FLOOR = familyWiseFloor(measured.length);
const smallestN = Math.min(...measured.map((m) => m.nAdj));

const measurementBlock = (m: Measured): Json => ({
  verdict: m.verdict,
  n_asked: m.nAsked,
  n_adjudicated: m.nAdj,
  fail_count: m.fail,
  fail_rate_pct: m.ratePct,
  interval_95: { lower_pct: m.lo, upper_pct: m.hi },
  target_band: { lower_pct: TARGET_BAND.lowerPct, upper_pct: TARGET_BAND.upperPct },
  decision_rule: "wilson95_vs_target_band",
  measured_on: fitness.measured_at,
  sample: sampleProvenance(),
  ...(m.biases.length ? { instrument_bias: m.biases } : {}),
  notes:
    (m.nAsked !== m.nAdj
      ? `${m.nAsked - m.nAdj} of the ${m.nAsked} rows this entry was asked returned \`requires_store_access\` — the engine could not decide them. ` +
        `They are excluded from the denominator, which is what \`n_adjudicated\` means. v1.1 published ${r4((m.fail / m.nAsked) * 100)}% for this entry, ` +
        `which is the same failures over the ASKED rows: that reading counts an undecided row as a pass. Both numbers are in this record so the reading is visible. `
      : "") +
    (m.verdict === "not_discriminating" && m.kind === "claim"
      ? `⚠️ THIS VERDICT MAY NOT BE ACTED ON AS A RETIREMENT, and the document says so rather than working around it. The rule ` +
        `\`bias_exceeds_margin\` blocks a retirement whose margin to the band edge is smaller than a declared bias pointing at that edge, ` +
        `and an unquantified bias blocks it outright. This is a claim row measured with the semantic tier off, which is exactly such a bias. ` +
        `The entry therefore stays \`executable\` and keeps running. A measured \`not_discriminating\` verdict is EVIDENCE for a retirement decision; it is not the decision. `
      : "") +
    (m.verdict === "indeterminate"
      ? `The measurement ran and decided nothing: the rate is outside the 15-85% band but the 95% interval is not. \`indeterminate\` is a first-class ` +
        `outcome and must never read as either decision — the entry stays \`executable\` and keeps accruing n. `
      : "") +
    `Recomputed by \`standards/coffee/issue_v1_2.ts\` from ${RUN_REL} through the shipped \`verdictFor\` in standards/discrimination.ts; ` +
    `no re-run, no network, no spend. Cross-checked against experiments/v3-2/discrimination.json and standards/coffee/v1.0/fitness.json.`,
});

// ===========================================================================
// 3 — THE FIVE `unbound` ENTRIES.
//
// Each names the engine ReqKind that fits, or says that none does. Both halves
// are load-bearing: naming the kind is what distinguishes `unbound` from
// `blocked`, and saying the adversarial pass has not happened is what stops the
// tier reading as executable-in-waiting. The kinds are checked against the
// engine's own union below rather than trusted from a brief.
// ===========================================================================
const NO_BINDING = "No binding and no adversarial pass have been authored for this entry in this standard, so it is not `executable`; the obstacle is unwritten work in this document, not the evidence and not the engine.";
const UNBOUND: Record<string, { kinds: string[]; reason: string }> = {
  "PRICE-001": {
    kinds: ["price_under"],
    reason:
      "No engine ReqKind fits as written. `price_under` exists but adjudicates a price against a cap the buyer supplies, and this entry asks only whether a price is published at all; the engine exports no `price_is_stated` kind. " +
      NO_BINDING + " Because no kind fits, this one needs an engine-gap proposal rather than a binding invented here.",
  },
  "STOCK-001": {
    kinds: ["in_stock"],
    reason: "`in_stock` is a live engine ReqKind and public product data adjudicates it, so this is neither `advisory` (the evidence exists) nor `blocked` (the engine exists). " + NO_BINDING,
  },
  "TERMS-001": {
    kinds: ["no_subscription"],
    reason:
      "`no_subscription` is a live engine ReqKind and public product data adjudicates it. It is absence-based, so a conformant result is `pass_no_blocking` and never `pass_evidenced` — a binding here would have to say so explicitly. " + NO_BINDING,
  },
  "DECAF-004": {
    kinds: [],
    reason:
      "No engine ReqKind fits: this entry adjudicates a statement about a DIFFERENT product from the one under test — whether a decaf counterpart exists elsewhere in the catalogue — and every kind the engine exports reads the product in front of it. " +
      NO_BINDING + " Because no kind fits, this one needs an engine-gap proposal rather than a binding invented here.",
  },
  "DIET-001": {
    kinds: ["claim"],
    reason: "`claim` is a live engine ReqKind and `vegan` and `gluten_free` are both live claim keys in the engine's own claim table, so public product copy adjudicates it. " + NO_BINDING,
  },
};
{ // the named kinds must exist in the engine's union AND in the grammar's enum
  const schema = rj<Json>("standards/schema.json");
  const reqKinds = new Set((((schema.$defs as Json).reqKind as Json).enum as string[]));
  const engine = rd("src/server/productTest.ts");
  for (const [suffix, u] of Object.entries(UNBOUND)) {
    for (const k of u.kinds) {
      if (!reqKinds.has(k)) die(`unbound_reason for ${suffix} names \`${k}\`, which is not in the grammar's reqKind enum`);
      if (!new RegExp(`"${k}"`).test(engine)) die(`unbound_reason for ${suffix} names \`${k}\`, which does not appear in src/server/productTest.ts`);
    }
  }
  for (const key of ["vegan", "gluten_free"]) {
    if (!new RegExp(`^\\s*${key}:`, "m").test(engine)) die(`DIET-001's unbound_reason claims \`${key}\` is a live claim key and it is not in src/server/productTest.ts`);
  }
}

// ===========================================================================
// 4 — THE PREDICTION, RESHAPED.
// ===========================================================================
const CONFIDENCE = (() => {
  const schema = rj<Json>("standards/schema.json");
  const def = (schema.$defs as Json).discriminationPrediction as Json;
  const enumv = ((def.properties as Json).confidence as Json).enum as string[];
  const dirs = ((def.properties as Json).direction as Json).enum as string[];
  if (!dirs.includes("no_prediction")) die(`the grammar's direction enum has no \`no_prediction\`: ${dirs.join(", ")}`);
  return enumv[0]!; // the lowest value the enum offers, read rather than guessed
})();

const PREDICTION_NOTE =
  `The numeric fail-rate band this reasoning was authored with is NOT carried at grammar 1.2 and is not reproduced here. ` +
  `Authored bands held ${fitness.entry_discrimination.bands_held} of ${fitness.entry_discrimination.entries.length} against this category's own sample and every miss was HIGH, ` +
  `so a direction derived from the band would inherit the error that condemned it (SCHEMA.md §9.3 step 3). ` +
  `The band survives in ALS-COFFEE v1.1 (standard_hash ${V11_HASH}), which is byte-frozen and still served.`;

// ===========================================================================
// 5 — THE TRANSFORM.
// ===========================================================================
const idOf = (v11id: string): string => v11id.replace("-1.1-", "-1.2-");
const suffixOf = (id: string): string => id.replace(/^ALS-COFFEE-1\.[0-9]-/, "");
const measuredBySuffix = new Map(measured.map((m) => [suffixOf(m.id), m]));

const entries = v11.entries.map((e) => {
  const suffix = suffixOf(e.id);
  const next: Json = {};
  for (const [k, val] of Object.entries(e)) {
    if (k === "id") { next.id = idOf(e.id); next.supersedes = e.id; continue; }
    if (k === "supersedes") continue; // rewritten above, in place, so key order is stable
    if (k === "predicted_discrimination") {
      // Delta 1 — the reasoning is preserved VERBATIM; the band, `in_target_band`
      // and `measured` are dropped and carried nowhere.
      next.discrimination_prediction = {
        direction: "no_prediction",
        confidence: CONFIDENCE,
        reasoning: e.predicted_discrimination.reasoning,
        notes: PREDICTION_NOTE,
      };
      continue;
    }
    if (k === "measured_discrimination") continue; // rebuilt in the 1.2 shape below
    if (k === "tier" && UNBOUND[suffix]) {
      next.tier = "unbound";
      next.unbound_reason = UNBOUND[suffix]!.reason;
      continue;
    }
    next[k] = val;
  }
  const m = measuredBySuffix.get(suffix);
  if (m) next.measured_discrimination = measurementBlock(m);
  return next;
});

{ // every entry that had a measurement still has one, and no new one appeared
  const before = v11.entries.filter((e) => e.measured_discrimination).map((e) => suffixOf(e.id)).sort();
  const after = entries.filter((e) => e.measured_discrimination).map((e) => suffixOf(String(e.id))).sort();
  if (JSON.stringify(before) !== JSON.stringify(after)) die(`the measured set changed: ${before.join(",")} -> ${after.join(",")}`);
  const unbound = entries.filter((e) => e.tier === "unbound").map((e) => suffixOf(String(e.id))).sort();
  if (JSON.stringify(unbound) !== JSON.stringify(Object.keys(UNBOUND).sort())) die(`unbound set is ${unbound.join(",")}, expected ${Object.keys(UNBOUND).sort().join(",")}`);
  if (entries.some((e) => e.tier === "not_discriminating")) die(`an entry is still \`not_discriminating\` with no measurement behind it`);
  if (entries.some((e) => e.predicted_discrimination)) die(`a \`predicted_discrimination\` survived into a 1.2 document`);
}

// ===========================================================================
// 6 — `category_fitness`. THE COFFEE SAMPLE ONLY.
//
// `fitness_sample_is_this_category` rejects `general_mixed_category`, and it is
// right to: the same engine on the same day measured 12.78% here and 7.80% on a
// general DTC sample. The general figure still belongs in the document — it is
// the comparison that makes this number mean anything — but it is a FLOOR from a
// single re-checked class, so it goes in `limits` where it cannot be read as a
// peer of this bound.
//
// ⚠️ AND IT GOES IN `limits` BECAUSE THERE IS NOWHERE ELSE. The root schema is
// `additionalProperties: false` over a closed property list, and `measured_fitness`
// is forbidden at 1.2 — so a grammar-1.2 document has NO legal sibling block for a
// second sample. Adding one would be a grammar change, not a reissue.
// ===========================================================================
const coffee = fitness.samples.find((s) => s.name === "coffee")!;
const general = fitness.samples.find((s) => s.name === "general")!;
const numOf = (s: Json, k: string): number => {
  const v = s[k];
  if (typeof v !== "number") die(`fitness.json sample \`${String(s.name)}\` has no numeric \`${k}\``);
  return v as number;
};

const PASS_ROWS = verdicts.rows.length;
const CONFIRMED_FP = verdicts.rows.filter((r) => r.verdict === "false_positive").length;
const BORDERLINE = verdicts.rows.filter((r) => r.verdict === "borderline").length;
const AUDIT_STORES = new Set(verdicts.rows.map((r) => r.host)).size;
{ // the sidecar and the audit file must agree; two sources agreeing is the point
  const pairs: Array<[string, number, number]> = [
    ["pass_rows_audited", PASS_ROWS, numOf(coffee, "pass_rows_audited")],
    ["confirmed_false_positives", CONFIRMED_FP, numOf(coffee, "confirmed_false_positives")],
    ["borderline", BORDERLINE, numOf(coffee, "borderline_counted_as_passes")],
    ["stores", AUDIT_STORES, numOf(coffee, "stores")],
    ["products_evaluated", RUN_PRODUCTS, numOf(coffee, "products_evaluated")],
  ];
  for (const [what, computed, published] of pairs) {
    if (computed !== published) die(`${what}: recomputed ${computed} from experiments/v3-2/verdicts.json, fitness.json publishes ${published}`);
  }
}

/** ICC, DERIVED rather than read off a key name. DEFF = 1 + (m − 1)·ICC, so
 *  ICC = (DEFF − 1)/(m − 1) from the two numbers the sidecar publishes. Checked
 *  against the value the sidecar's own method paragraph states in words. */
const ICC = (() => {
  const deff = numOf(coffee, "deff_icc02"), m = numOf(coffee, "rows_per_store");
  const derivedIcc = (deff - 1) / (m - 1);
  const stated = /ICC\s+([0-9.]+)/.exec(String(coffee.method));
  if (!stated) die(`the coffee sample's method paragraph does not state an ICC, so it cannot be checked against the derived ${derivedIcc}`);
  const statedIcc = Number(stated[1]);
  if (Math.abs(derivedIcc - statedIcc) > 0.005) {
    die(`ICC derived from DEFF ${deff} at ${m} rows/store is ${derivedIcc.toFixed(4)}, but the method paragraph states ${statedIcc}`);
  }
  return statedIcc;
})();

/** The four defect CLASSES, as v1.1 published them, used only to cross-check the
 *  per-defect counts this transform recomputes from the audit. The class list is
 *  an artifact; the counts are recomputed. */
const V11_CLASSES = ((v11.measured_fitness as Json).samples as Array<Json>)
  .find((s) => s.name === "coffee")!.defect_classes as Array<{ klass: string; count: number; addressed_by_a_guard?: boolean }>;

/** The longest quoted or parenthesised span in an adjudication, which is the text
 *  the engine actually matched. Mechanical, with the threshold stated: a span
 *  under 5 characters is not evidence, and every one of the ten must produce one. */
const spanOf = (why: string): string | null => {
  const spans: string[] = [];
  for (const re of [/"([^"]{2,})"/g, /'([^']{2,})'/g, /\(([^)]{2,})\)/g]) {
    for (const m of why.matchAll(re)) spans.push(m[1]!);
  }
  const best = spans.sort((a, b) => b.length - a.length)[0];
  return best && best.length >= 5 ? best : null;
};

const defects = verdicts.rows.filter((r) => r.verdict === "false_positive").map((r) => {
  const id = idOf(labelToEntry.get(r.label)!.replace("-1.0-", "-1.1-"));
  const span = spanOf(r.why);
  if (!span) die(`the adjudication for ${r.host} / ${r.label} yields no quotable span; \`evidence\` would be a paraphrase of \`why_wrong\``);
  return {
    entry_id: id,
    evidence: `${r.host} · ${r.label} · the engine matched: ${span}`,
    why_wrong: r.why,
    // ⚠️ NOT A JUDGEMENT MADE HERE. The store-local-identifier class is the one
    // the GENERAL sample also carries (18 of them, from a theme that publishes a
    // Shopify product id in `mpn`); the other three fire on vocabulary only a
    // coffee page writes. Both facts are recorded in standards/coffee/v1.0/fitness.json.
    category_specific: !/IDENT-/.test(id),
    status: "pinned_known_gap" as const,
  };
});
{
  const perEntry = defects.reduce<Record<string, number>>((a, d) => { a[suffixOf(d.entry_id)] = (a[suffixOf(d.entry_id)] ?? 0) + 1; return a; }, {});
  const expected = { "WEIGHT-001": 3, "CERT-001": 2, "IDENT-001": 3, "SOURCE-001": 2 };
  if (JSON.stringify(perEntry) !== JSON.stringify(expected)) {
    die(`defect counts per entry are ${JSON.stringify(perEntry)}, and the four classes v1.1 published are ${JSON.stringify(expected)}`);
  }
  const classTotal = V11_CLASSES.reduce((n, c) => n + c.count, 0);
  if (classTotal !== CONFIRMED_FP) die(`v1.1's defect classes account for ${classTotal} errors; the audit confirms ${CONFIRMED_FP}`);
  if (!V11_CLASSES.every((c) => c.addressed_by_a_guard === false)) {
    die(`at least one defect class is now addressed by a guard, so \`status: "pinned_known_gap"\` is no longer true of every defect`);
  }
  if (defects.length !== CONFIRMED_FP) die(`${CONFIRMED_FP} confirmed false positives but ${defects.length} enumerated`);
}

const generalFloorPct = numOf(general, "bound_95_cluster_icc02_pct");
const coffeeBoundPct = numOf(coffee, "bound_95_cluster_icc02_pct");
const category_fitness: Json = {
  sample: {
    sample_id: "experiments/v3-2/verdicts.json",
    category_scope: "this_category",
    category_standard_id: String(v11.standard_id),
    stores: AUDIT_STORES,
    products: RUN_PRODUCTS,
    selection: SELECTION,
    deduplicated_by_brand: true,
    applicability_gate_enforced: true,
    unclassifiable_refused: UNCLASSIFIABLE,
    excluded_out_of_category: OUT_OF_CATEGORY,
    captured_on: CAPTURED_ON,
    notes:
      `The ${PASS_ROWS} audited rows are the pass rows of the same ${RUN_PRODUCTS}-product run, and they come from ${AUDIT_STORES} of its ` +
      `${RUN_STORES} storefronts — the other ${RUN_STORES - AUDIT_STORES} produced no passing row at all, which is why this store count is ` +
      `lower than the discrimination sample's and must never be substituted for it.`,
  },
  pass_rows_audited: PASS_ROWS,
  audit: {
    row_by_row: true,
    untruncated_evidence: true,
    borderline_recorded: true,
    borderline_count: BORDERLINE,
  },
  confirmed_false_positives: CONFIRMED_FP,
  bounds: {
    point_estimate_pct: numOf(coffee, "point_estimate_pct"),
    naive_95_upper_pct: numOf(coffee, "bound_95_naive_pct"),
    cluster_adjusted_95_upper_pct: coffeeBoundPct,
    icc: ICC,
    per_store_pct: numOf(coffee, "per_store_pct"),
  },
  completion_state: "DEFECTS_FOUND",
  defects,
  measured_on: fitness.measured_at,
  limits: [
    `This bounds SAMPLING error and nothing else. It does not cover a bias in the engine doing the measuring, and this run has one: the bounded semantic tier was disabled. Both of its paths are therefore absent — the missing GRANT path pushes a claim row's fail rate up and the missing VETO path pushes it down — and nothing here measures which dominates, so the tier is declared as two biases per affected entry rather than netted into one.`,
    `One product per storefront. ${RUN_PRODUCTS} products over ${RUN_STORES} distinct hosts means within-store copy variation is entirely unmeasured: nothing here says a second product from the same roaster would fare the same.`,
    `The comparison with the general DTC sample is a FLOOR, not a bound, and the two are NOT audited to the same depth. The general figure — ${generalFloorPct}% cluster-adjusted over ${numOf(general, "pass_rows_audited")} pass rows from ${numOf(general, "stores")} stores — rests on ONE defect class re-checked mechanically, after an audit that read every rendered row and confirmed zero. So the ratio between ${generalFloorPct}% and ${coffeeBoundPct}% is not itself a measurement; the DIRECTION is what the category rule rests on.`,
    `${CONFIRMED_FP} confirmed false positives is a count of rows an auditor could recognise as wrong from the page text. A defect class that renders no quote is invisible to any audit that reads rendered evidence, however many rows it reads — which is how a previously published 0.83% general bound turned out to be 7.80%.`,
    `${BORDERLINE} rows were judgement calls counted as PASSES. Counting them as defects instead would raise every figure here; they are named in the audit record so the call can be disputed rather than merely trusted.`,
    `Fitness was measured on the ten entries that are executable. It says nothing about the ${entries.filter((e) => e.tier !== "executable").length} entries that are not run, including the ${Object.keys(UNBOUND).length} now marked \`unbound\`.`,
  ],
};

// ===========================================================================
// 7 — POSTURE. Every clause checked against reality, and only what changed changes.
// ===========================================================================
const POSTURE = [
  `This document has been applied to real stores by its author and by nobody else.`,
  `Coffee Standard v1.0 — the same ten executable entries, unchanged in v1.1 and unchanged here — was executed on ${fitness.measured_at} against ${RUN_PRODUCTS} real coffee products drawn one per storefront from ${RUN_STORES} distinct storefronts, and every one of the ${PASS_ROWS} requirements it reported as proven was audited individually against that store's full untruncated page text; ${CONFIRMED_FP} of those passes were wrong.`,
  `Two things this document used to say about itself have been corrected here rather than left standing. Its numeric prediction bands are gone: they held ${fitness.entry_discrimination.bands_held} of ${fitness.entry_discrimination.entries.length} against this sample with every miss high, and a field that is wrong nine times in ten in a known direction is worse than no field, because it looks like information. And ${Object.keys(UNBOUND).length} entries that v1.1 filed as \`not_discriminating\` had never been measured and had never been bound to the engine at all; they are now \`unbound\`, which is what was actually true of them.`,
  `Every failure rate in this version is MEASURED, from a recorded sample, with an interval and a stated decision rule, and ${tally.not_discriminating ?? 0} of the ${measured.length} measured entries returned a verdict that would license retiring them. NONE HAS BEEN RETIRED: a measured verdict is evidence for that decision and is not the decision, and on ${measured.filter((m) => m.biases.some((b) => b.direction === "inflates_fail_rate")).length} of them the decision is additionally blocked by an unquantified bias in this instrument pointing at the very band edge the interval cleared — a confidence interval bounds sampling error and nothing else.`,
  `What remains true is the part that matters: no second party has applied this document without us, \`independently_applied\` is therefore still false, and this is a rubric with a versioned changelog and a measured error rate rather than a settled standard.`,
  `The status may only become \`published\` once a second party has run this document without the authoring party's involvement — the same bar as \`independently_applied\` — and at grammar 1.2 that additionally requires the \`category_fitness\` record this version now carries. The document's own bar must survive its own promotion.`,
].join(" ");

// ===========================================================================
// 8 — CHANGELOG.
// ===========================================================================
const pct = (x: number): string => `${x}%`;
const changes: Json[] = [];
for (const suffix of Object.keys(UNBOUND)) {
  const e = v11.entries.find((x) => suffixOf(x.id) === suffix)!;
  changes.push({
    entry_id: idOf(e.id),
    // `strengthened` and NOT `weakened`/`demoted`: nothing that was being tested
    // stops being tested. This entry was never bound, never compiled and never run,
    // under v1.0 or v1.1 — no merchant has ever passed or failed it. What changes is
    // that the document stops asserting a measured-sounding verdict it never measured
    // and starts naming outstanding work, so no `weakening_attestation` is required.
    change_type: "strengthened",
    rationale:
      `Re-tiered \`not_discriminating\` -> \`unbound\`. At grammar 1.2 \`not_discriminating\` is a MEASURED verdict and the schema rejects the ` +
      `tier without a \`measured_discrimination\` behind it; this entry has none, and never had — v1.1 assigned the tier from a predicted band, ` +
      `which is the field that held ${fitness.entry_discrimination.bands_held} of ${fitness.entry_discrimination.entries.length}. It cannot become \`executable\` either, because it carries no binding, no adversarial ` +
      `pass and no pass_means. The question, the assertion, the accepted and insufficient evidence and the conflict rules are byte-identical to v1.1: ` +
      `nothing a merchant could pass or fail has moved, and the label now states something true.`,
  });
}
for (const m of measured) {
  const suffix = suffixOf(m.id);
  const e11 = v11.entries.find((x) => suffixOf(x.id) === suffix)!;
  const old = e11.measured_discrimination as { fail_rate_pct: number; asked: number; carries_information: boolean } | undefined;
  const denominatorNote = m.nAsked !== m.nAdj
    ? ` ⚠️ THE DENOMINATOR CHANGED AND THE FAILURES DID NOT. v1.1 published ${pct(old!.fail_rate_pct)} over ${old!.asked} rows ASKED; ` +
      `${m.nAsked - m.nAdj} of those returned \`requires_store_access\`, which is the engine reporting it could not decide, not a store passing. ` +
      `Over the ${m.nAdj} rows actually adjudicated the same ${m.fail} failures are ${pct(m.ratePct)}. Run 2 measured 59.4% over 32 adjudicated rows for this entry, so the two runs agree once the denominators do.`
    : "";
  const verdictNote = m.verdict === "indeterminate"
    ? ` ⚠️ MEANING CHANGED. v1.1 recorded \`carries_information: ${old!.carries_information}\` from a POINT ESTIMATE, which reads as a clean retirement; ` +
      `the interval [${m.lo}, ${m.hi}] crosses the ${TARGET_BAND.upperPct}% edge, so this measurement ran and decides nothing. That is what \`indeterminate\` is for.`
    : "";
  const biasNote = m.biases.some((b) => b.direction === "inflates_fail_rate")
    ? ` The verdict licenses a retirement on the arithmetic and is NOT acted on: an unquantified inflating bias (the semantic tier was off for this run, and this is a claim row) points at the band edge the interval cleared.`
    : "";
  changes.push({
    entry_id: idOf(e11.id),
    // `editorial`: the requirement, the assertion, the accepted and insufficient
    // evidence and the conflict rules are byte-identical. What changed is the
    // annotation of what happened when the entry was run. The bar did not move.
    change_type: "editorial",
    rationale:
      `Measurement re-derived in the grammar-1.2 shape from the same ${fitness.measured_at} run: ${m.fail} of ${m.nAdj} adjudicated rows fail ` +
      `(${pct(m.ratePct)}, Wilson 95% [${m.lo}, ${m.hi}] against a ${TARGET_BAND.lowerPct}-${TARGET_BAND.upperPct}% target band), verdict \`${m.verdict}\`. ` +
      `The counts are unchanged from v1.1; the decision rule is not — an interval, a derived minimum n of ${MIN_ADJUDICATED_N}, and a recorded sample.` +
      denominatorNote + verdictNote + biasNote,
  });
}

const v12ChangelogSummary =
  `Reissued at GRAMMAR 1.2, which exists because two concurrent sessions each authored a revision of the grammar and both called it 1.1 — and one of them ` +
  `shipped: this document's predecessor declares \`grammar_version: "1.1"\`, is byte-frozen, and is cited through its hash. Redefining 1.1 would have made a ` +
  `published document invalid against the version string it names, silently. Same ${v11.entries.length} entries, same questions, same assertions, same evidence rules; every v1.1 ` +
  `entry is carried forward and names its predecessor in \`supersedes\`, and nothing is withdrawn. FOUR THINGS CHANGED. (1) The numeric prediction band is gone from all ` +
  `${v11.entries.length} entries, replaced by a direction and a confidence with the reasoning preserved verbatim: the bands held ${fitness.entry_discrimination.bands_held} of ${fitness.entry_discrimination.entries.length} against this category's own sample and ` +
  `every miss was high. (2) ${Object.keys(UNBOUND).length} entries filed as \`not_discriminating\` on the strength of that band, with no measurement and no binding, are now \`unbound\` — the tier ` +
  `grammar 1.2 adds for a question the engine could run and this standard has not authored. (3) All ten measured entries were recomputed from the interval rather than the ` +
  `point estimate, which changes the headline from "carries information ${(v11.entries.filter((e) => (e.measured_discrimination as { carries_information?: boolean } | undefined)?.carries_information)).length} of ${fitness.entry_discrimination.entries.length}" to "discriminating ${tally.discriminating ?? 0} / indeterminate ${tally.indeterminate ?? 0} / not_discriminating ${tally.not_discriminating ?? 0}", and corrects one ` +
  `denominator: DELIV-001's rate was published over the rows it was ASKED, which counts a row the engine could not decide as a pass. (4) \`measured_fitness\` is migrated to ` +
  `\`category_fitness\`, which additionally records the sample provenance, the audit discipline, all five bounds, a completion state of DEFECTS_FOUND and stated limits. ` +
  `THREE VERSIONS IN ONE WEEK IS NOT INSTABILITY IF EACH CHANGELOG SAYS WHY: v1.1 corrected a posture that had gone false about the document, and v1.2 corrects the two ` +
  `fields that were making measured-sounding claims from an authoring guess.`;

// ===========================================================================
// 9 — ASSEMBLE, REHASH, WRITE.
// ===========================================================================
const v12: Json = {
  ...v11,
  grammar_version: "1.2",
  version: "1.2",
  status: v11.status, // still `applied_by_author`; no second party has touched it
  title: String(v11.title).replace("v1.1", "v1.2"),
  posture: { independently_applied: false, statement: POSTURE },
  category_fitness,
  withdrawn_entries: [],
  entries,
  changelog: [
    { version: "1.2", date: fitness.measured_at, summary: v12ChangelogSummary, changes },
    ...(v11.changelog as Json[]),
  ],
};
delete (v12 as { measured_fitness?: unknown }).measured_fitness; // migrated, not aliased
if (v12.status !== "applied_by_author") die(`status is \`${String(v12.status)}\`; nothing about the second-party bar has changed`);

delete (v12 as { standard_hash?: unknown }).standard_hash; // a hash cannot cover itself
const V12_HASH = standardHash(v12);
(v12 as { standard_hash: unknown }).standard_hash = { algorithm: "sha256", canonicalisation: "json-sorted-keys-no-hash-field", value: V12_HASH };
if (V12_HASH === V11_HASH || V12_HASH === V10_HASH) die(`v1.2 hashes identically to an earlier version — then it is not a new version`);

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "standard.json"), `${JSON.stringify(v12, null, 2)}\n`);

// ---- the applicability sidecar, remapped -----------------------------------
const sidecar = rj<{ version: string; rules: Array<{ entry: string }> }>("standards/coffee/v1.1/applicability.json");
sidecar.version = "1.2";
sidecar.rules = sidecar.rules.map((r) => ({ ...r, entry: idOf(r.entry) }));
{
  const execIds = new Set(entries.filter((e) => e.tier === "executable").map((e) => String(e.id)));
  const stale = sidecar.rules.filter((r) => !execIds.has(r.entry)).map((r) => r.entry);
  const missing = [...execIds].filter((id) => !sidecar.rules.some((r) => r.entry === id));
  if (stale.length || missing.length) die(`applicability sidecar drifted — stale: ${stale.join(",") || "none"} · missing: ${missing.join(",") || "none"}`);
}
fs.writeFileSync(path.join(OUT, "applicability.json"), `${JSON.stringify(sidecar, null, 2)}\n`);

// ---- vocabulary, copied verbatim -------------------------------------------
const vocabSrc = path.join(SRC, "vocabulary"), vocabOut = path.join(OUT, "vocabulary");
fs.mkdirSync(vocabOut, { recursive: true });
for (const f of fs.readdirSync(vocabSrc)) fs.copyFileSync(path.join(vocabSrc, f), path.join(vocabOut, f));
for (const f of fs.readdirSync(vocabSrc)) {
  if (rd(path.relative(REPO, path.join(vocabSrc, f))) !== rd(path.relative(REPO, path.join(vocabOut, f)))) die(`vocabulary file ${f} did not copy byte-for-byte`);
}

// ===========================================================================
// 10 — REPORT.
// ===========================================================================
const line = (k: string, v: string | number): void => console.log(`${k.padEnd(26)}: ${v}`);
console.log("");
line("v1.0 hash (unchanged)", V10_HASH);
line("v1.1 hash (unchanged)", V11_HASH);
line("v1.2 hash", V12_HASH);
line("grammar", `${v11.grammar_version} -> 1.2`);
line("status", String(v12.status));
line("entries", `${entries.length} (all carried forward, 0 withdrawn)`);
for (const t of ["executable", "unbound", "blocked", "advisory", "not_discriminating"]) {
  line(`  ${t}`, entries.filter((e) => e.tier === t).length);
}
line("sample", `${RUN_PRODUCTS} products / ${RUN_STORES} stores / ${excluded.length} G-10 exclusions / ${replayMisses} replay misses`);
line("audit", `${PASS_ROWS} pass rows over ${AUDIT_STORES} stores, ${CONFIRMED_FP} confirmed, ${BORDERLINE} borderline`);
line("minimum n (derived)", `${MIN_ADJUDICATED_N}   family-wise floor(${measured.length}) = ${FAMILY_FLOOR}, smallest n here = ${smallestN} (${smallestN >= FAMILY_FLOOR ? "supports a family-wise count" : "DOES NOT support a family-wise count"})`);
console.log("");
console.log(`${"entry".padEnd(12)} ${"kind".padEnd(15)} ${"x/n".padStart(8)} ${"asked".padStart(6)} ${"rate".padStart(9)} ${"interval 95%".padStart(20)}  verdict`);
for (const m of measured) {
  console.log(`${suffixOf(m.id).padEnd(12)} ${m.kind.padEnd(15)} ${`${m.fail}/${m.nAdj}`.padStart(8)} ${String(m.nAsked).padStart(6)} ${`${m.ratePct}%`.padStart(9)} ${`[${m.lo}, ${m.hi}]`.padStart(20)}  ${m.verdict}${m.biases.some((b) => b.direction === "inflates_fail_rate") ? "  (retirement blocked by an unquantified inflating bias)" : ""}`);
}
console.log(`\nverdicts: ${JSON.stringify(tally)}   (v1.1 published \`carries_information\` true for ${(v11.entries.filter((e) => (e.measured_discrimination as { carries_information?: boolean } | undefined)?.carries_information)).length} of ${measured.length})`);
console.log(`wrote: standards/coffee/v1.2/{standard.json,applicability.json,vocabulary/} (${fs.readdirSync(vocabOut).length} vocabulary files)`);
console.log(`\nNEXT: node --import tsx standards/coffee/verify_v1_2.ts — the transform does not certify itself.`);
