// ===========================================================================
// VERIFY COFFEE STANDARD v1.2 — the transform does not certify itself.
//
// `issue_v1_2.ts` wrote the document; this reads it back cold and tries to break
// it. Five gates, and the third one is the reason this file exists at all:
//
//   A. THE TWO EARLIER VERSIONS ARE STILL THEIR OWN BYTES (hash + `git diff`).
//   B. v1.2 VALIDATES against standards/schema.json.
//   C. ALL 21 CROSS-FIELD RULES RUN, AND EVERY ONE IS SHOWN TO FIRE.
//      ⚠️ A checker that ran nothing looks exactly like a clean result. So this
//      gate does not merely run the rules over the document — it MUTATES a clone
//      once per rule and asserts that specific rule fires. A rule with no working
//      canary is a rule that could have been silently unwired, and its silence
//      over the real document would mean nothing. Same discipline as
//      experiments/v2-4/mutate.mjs: a guard whose removal breaks nothing is not a
//      guard.
//   D. EVERY ENTRY CARRIED ACROSS BYTE-FOR-BYTE except where a declared delta
//      applies, and every v1.0 AND v1.1 id resolves — the full chain, not one hop.
//   E. THE DOCUMENT COMPILES and its applicability sidecar covers exactly its
//      executable entries.
//
// ⚠️ THIS GATE DOES NOT RETURN "CLEAN", AND THAT IS THE CORRECT RESULT.
// Two findings are PINNED below with their reasons: `bias_exceeds_margin` fires on
// CERT-001 and CERT-002 because both are claim rows measured with the semantic tier
// disabled, which is an unquantified bias pointing at the band edge their intervals
// cleared. Neither entry is retired — they stay `executable` — so the rule is doing
// exactly its job: it is refusing to let a `not_discriminating` verdict be ACTED on.
// The pinned set is asserted EXACTLY, in both directions: a new finding fails this
// gate, and so does one of these two disappearing.
//
// Run: npx tsx standards/coffee/verify_v1_2.ts
// ===========================================================================
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { standardHash, hashMatches } from "../hash.js";
import { validate, renderResult } from "../validate.js";
import { compileStandard } from "../compile.js";
import { assertSidecarCoversStandard, type Sidecar } from "../applicability.js";
import { ALL_RULES, checkMeasuredDiscrimination, checkCategoryFitness, checkRetirementAttested, type RuleError } from "../discrimination.js";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const REPO = path.resolve(here, "..", "..");
const rj = <T>(rel: string): T => JSON.parse(fs.readFileSync(path.join(REPO, rel), "utf8")) as T;

const V10_HASH = "334389c4eb6145112deec621e667f11142fb204c66bedd314fc12662d09acec5";
const V11_HASH = "f8ec2780f60c38931913e5b6cd37506500c8462709209de7180ba6691d6137e7";

type Json = Record<string, unknown>;
const v10 = rj<Json>("standards/coffee/v1.0/standard.json");
const v11 = rj<Json>("standards/coffee/v1.1/standard.json");
const v12 = rj<Json>("standards/coffee/v1.2/standard.json");
const schema = rj<Json>("standards/schema.json");
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

const failures: string[] = [];
const ok = (label: string): void => console.log(`  ok    ${label}`);
const bad = (label: string, why: string): void => { failures.push(`${label}: ${why}`); console.log(`  FAIL  ${label}\n          ${why}`); };
const eq = (label: string, a: unknown, b: unknown): void => (JSON.stringify(a) === JSON.stringify(b) ? ok(label) : bad(label, `${JSON.stringify(a)} !== ${JSON.stringify(b)}`));

// ===========================================================================
console.log("\nA. THE EARLIER VERSIONS ARE FROZEN");
// ===========================================================================
eq("v1.0 hash is the literal every citation resolves through", standardHash(v10), V10_HASH);
eq("v1.1 hash is the literal every citation resolves through", standardHash(v11), V11_HASH);
eq("v1.0 stored hash agrees with its own bytes", hashMatches(v10).ok, true);
eq("v1.1 stored hash agrees with its own bytes", hashMatches(v11).ok, true);
for (const rel of ["standards/coffee/v1.0/standard.json", "standards/coffee/v1.1/standard.json"]) {
  try {
    execFileSync("git", ["diff", "--exit-code", "--", rel], { cwd: REPO, stdio: "pipe" });
    ok(`${rel} is byte-identical to its committed version`);
  } catch {
    bad(`${rel} is byte-identical to its committed version`, "git diff --exit-code reports a modification");
  }
}
{
  const h = hashMatches(v12);
  eq("v1.2 hash agrees three ways — stored", h.ok, true);
  eq("v1.2 hash agrees three ways — recomputed", h.computed, standardHash(v12));
  h.computed !== V11_HASH && h.computed !== V10_HASH
    ? ok("v1.2 hash agrees three ways — distinct from v1.0 and v1.1")
    : bad("v1.2 hash agrees three ways — distinct", "v1.2 hashes identically to an earlier version");
  console.log(`        v1.2 = ${h.computed}`);
}

// ===========================================================================
console.log("\nB. v1.2 VALIDATES AGAINST THE GRAMMAR");
// ===========================================================================
{
  const r = validate(v12, schema);
  r.ok ? ok(`schema validation (${r.checksRun} subschema checks)`) : bad("schema validation", renderResult(r));
  r.checksRun > 500 ? ok(`the validator did real work (${r.checksRun} checks)`) : bad("the validator did real work", `only ${r.checksRun} checks ran`);
  // And the two frozen documents STILL validate against the reconciled grammar —
  // a hard invariant: 1.2 may not be bought by making 1.0 or 1.1 invalid.
  for (const [name, doc] of [["v1.0", v10], ["v1.1", v11]] as const) {
    const rr = validate(doc, schema);
    rr.ok ? ok(`${name} still validates against the reconciled grammar`) : bad(`${name} still validates`, renderResult(rr));
  }
}
eq("grammar_version", v12.grammar_version, "1.2");
eq("status is unchanged — no second party has touched it", v12.status, "applied_by_author");
eq("`measured_fitness` is migrated, not aliased", "measured_fitness" in v12, false);
eq("`category_fitness` is present", "category_fitness" in v12, true);

// ===========================================================================
console.log("\nC. ALL 21 CROSS-FIELD RULES — RUN, AND EACH SHOWN TO FIRE");
// ===========================================================================
const runRules = (std: Json): RuleError[] => {
  const errs: RuleError[] = [];
  const entries = (std.entries as Json[]) ?? [];
  let measuredSeen = 0;
  for (const [i, e] of entries.entries()) {
    if (e.measured_discrimination) measuredSeen++;
    errs.push(...checkMeasuredDiscrimination(e, `entries/${i}`));
  }
  errs.push(...checkCategoryFitness(std));
  errs.push(...checkRetirementAttested(std));
  (runRules as { lastInputs?: Json }).lastInputs = { entries: entries.length, measured: measuredSeen, categoryFitness: std.category_fitness ? 1 : 0 };
  return errs;
};

const baseline = runRules(v12);
const inputs = (runRules as unknown as { lastInputs: { entries: number; measured: number; categoryFitness: number } }).lastInputs;
console.log(`        checkMeasuredDiscrimination over ${inputs.entries} entries (${inputs.measured} carrying a measurement) · checkCategoryFitness over ${inputs.categoryFitness} block · checkRetirementAttested over the changelog`);
eq("ALL_RULES holds 21 rules", ALL_RULES.length, 21);
inputs.measured === 10 ? ok("10 measurements were actually handed to the rules") : bad("10 measurements handed to the rules", `${inputs.measured} found — a rule with no input cannot fail`);

/** ⚠️ THE PINNED FINDINGS. Not an allowlist of things we decided not to care
 *  about — a debt with a receipt, asserted exactly, failing in BOTH directions. */
const PINNED = [
  { rule: "bias_exceeds_margin", entry: "ALS-COFFEE-1.2-CERT-001", why: "claim row, semantic tier disabled for the run, unquantified bias toward the cleared 85% edge; margin is 0.0019pp" },
  { rule: "bias_exceeds_margin", entry: "ALS-COFFEE-1.2-CERT-002", why: "claim row, semantic tier disabled for the run, unquantified bias toward the cleared 85% edge; margin is 5.1629pp" },
];
{
  const entries = v12.entries as Json[];
  const seen = baseline.map((e) => {
    const idx = Number(/^entries\/(\d+)/.exec(e.path)?.[1] ?? -1);
    return { rule: e.rule, entry: idx >= 0 ? String(entries[idx]!.id) : "<standard>", message: e.message };
  });
  const key = (x: { rule: string; entry: string }): string => `${x.rule}@${x.entry}`;
  const got = seen.map(key).sort(), want = PINNED.map(key).sort();
  if (JSON.stringify(got) === JSON.stringify(want)) {
    ok(`the finding set is EXACTLY the ${PINNED.length} pinned findings, no more and no fewer`);
  } else {
    bad("the finding set is exactly the pinned findings",
      `got [${got.join(", ")}]\n          want [${want.join(", ")}]\n          ` +
      `A NEW finding is a defect in the document. A MISSING one means the rule stopped firing, which is worse: the reason it was pinned has not gone away.`);
  }
  for (const s of seen) console.log(`        finding: ${s.rule} @ ${s.entry}`);
  // Every finding must also be one the entry itself explains, in the document.
  for (const s of seen) {
    const e = entries.find((x) => x.id === s.entry);
    const notes = String((e?.measured_discrimination as Json | undefined)?.notes ?? "");
    /MAY NOT BE ACTED ON AS A RETIREMENT/.test(notes)
      ? ok(`${s.entry} states the reason for its own finding in the published document`)
      : bad(`${s.entry} states the reason for its own finding`, "the document is silent about a rule that fires on it");
  }
}

// ---- the canaries: one mutation per rule, each must produce THAT rule ---------
type Mut = { rule: string; mutate: (d: Json) => void };
const entryAt = (d: Json, suffix: string): Json => (d.entries as Json[]).find((e) => String(e.id).endsWith(suffix))!;
const md = (d: Json, suffix: string): Json => entryAt(d, suffix).measured_discrimination as Json;

const MUTATIONS: Mut[] = [
  { rule: "counts_present", mutate: (d) => { md(d, "FORMAT-001").n_adjudicated = "ninety-nine"; } },
  { rule: "counts_coherent", mutate: (d) => { md(d, "FORMAT-001").fail_count = 500; } },
  { rule: "asked_ge_adjudicated", mutate: (d) => { md(d, "FORMAT-001").n_asked = 5; } },
  { rule: "one_row_per_store", mutate: (d) => { (md(d, "FORMAT-001").sample as Json).stores = 3; } },
  { rule: "minimum_n", mutate: (d) => { const m = md(d, "FORMAT-001"); m.n_adjudicated = 21; m.n_asked = 21; m.fail_count = 10; (m.sample as Json).stores = 21; } },
  { rule: "rate_matches_counts", mutate: (d) => { md(d, "FORMAT-001").fail_rate_pct = 50; } },
  { rule: "interval_present", mutate: (d) => { md(d, "FORMAT-001").interval_95 = {}; } },
  { rule: "interval_recomputes", mutate: (d) => { md(d, "FORMAT-001").interval_95 = { lower_pct: 1, upper_pct: 2 }; } },
  { rule: "verdict_follows_interval", mutate: (d) => { md(d, "FORMAT-001").verdict = "not_discriminating"; } },
  {
    rule: "supersedes_is_older",
    mutate: (d) => {
      md(d, "FORMAT-001").supersedes = [{ verdict: "indeterminate", n_adjudicated: 43, fail_rate_pct: 50, measured_on: "2099-01-01", superseded_because: "prior_sample_invalid" }];
    },
  },
  {
    rule: "larger_sample_is_larger",
    mutate: (d) => {
      md(d, "FORMAT-001").supersedes = [{ verdict: "indeterminate", n_adjudicated: 990, fail_rate_pct: 73, measured_on: "2026-07-01", superseded_because: "larger_sample", interval_95: { lower_pct: 64, upper_pct: 81 } }];
    },
  },
  {
    rule: "disjoint_intervals_need_a_named_defect",
    mutate: (d) => {
      md(d, "FORMAT-001").supersedes = [{ verdict: "indeterminate", n_adjudicated: 43, fail_rate_pct: 5, measured_on: "2026-07-01", superseded_because: "larger_sample", interval_95: { lower_pct: 1, upper_pct: 12 } }];
    },
  },
  { rule: "retirement_needs_bias_declaration", mutate: (d) => { delete md(d, "IDENT-001").instrument_bias; } },
  {
    rule: "bias_exceeds_margin",
    mutate: (d) => {
      md(d, "IDENT-001").instrument_bias = [{ source: "a quantified bias larger than the interval's margin to the band", direction: "inflates_fail_rate", magnitude_pp: 50 }];
    },
  },
  { rule: "fitness_sample_is_this_category", mutate: (d) => { ((d.category_fitness as Json).sample as Json).category_standard_id = "ALS-TEA"; } },
  { rule: "defects_within_rows", mutate: (d) => { (d.category_fitness as Json).confirmed_false_positives = 9999; } },
  { rule: "bounds_ordered", mutate: (d) => { ((d.category_fitness as Json).bounds as Json).naive_95_upper_pct = 0; } },
  { rule: "cluster_bound_is_wider", mutate: (d) => { ((d.category_fitness as Json).bounds as Json).cluster_adjusted_95_upper_pct = 0.1; } },
  { rule: "point_estimate_matches_counts", mutate: (d) => { ((d.category_fitness as Json).bounds as Json).point_estimate_pct = 99; } },
  { rule: "defects_enumerated", mutate: (d) => { (d.category_fitness as Json).defects = ((d.category_fitness as Json).defects as Json[]).slice(1); } },
  { rule: "retirement_is_a_demotion", mutate: (d) => { entryAt(d, "IDENT-001").tier = "not_discriminating"; } },
];

const exercised = new Set<string>();
const dead: string[] = [];
for (const m of MUTATIONS) {
  const d = clone(v12);
  m.mutate(d);
  const errs = runRules(d);
  const fired = errs.some((e) => e.rule === m.rule);
  if (fired) exercised.add(m.rule);
  else dead.push(`${m.rule} — its canary produced [${errs.map((e) => e.rule).join(", ") || "nothing"}]`);
}
console.log(`\n        RULES EXERCISED: ${exercised.size} of ${ALL_RULES.length}`);
console.log(`        (${[...exercised].sort().join(", ")})`);
const uncovered = ALL_RULES.filter((r) => !exercised.has(r));
uncovered.length === 0
  ? ok(`every one of the ${ALL_RULES.length} rules was shown to fire on this document's own shape`)
  : bad("every rule was shown to fire", `${uncovered.length} rule(s) never fired: ${uncovered.join(", ")}\n          ${dead.join("\n          ")}`);
eq("the canary set covers every rule name in ALL_RULES", MUTATIONS.length, ALL_RULES.length);

// ===========================================================================
console.log("\nD. NOTHING MOVED THAT WAS NOT DECLARED, AND NOTHING DISAPPEARED");
// ===========================================================================
const DELTA_KEYS = new Set(["id", "supersedes", "predicted_discrimination", "discrimination_prediction", "measured_discrimination", "tier", "unbound_reason"]);
const UNBOUND_SUFFIXES = ["PRICE-001", "STOCK-001", "TERMS-001", "DECAF-004", "DIET-001"];
{
  const by11 = new Map((v12.entries as Json[]).map((e) => [String(e.supersedes), e]));
  const drift: string[] = [];
  const tierDrift: string[] = [];
  const reasoningDrift: string[] = [];
  for (const old of v11.entries as Json[]) {
    const next = by11.get(String(old.id));
    if (!next) { drift.push(`${String(old.id)} has no successor`); continue; }
    for (const k of new Set([...Object.keys(old), ...Object.keys(next)])) {
      if (DELTA_KEYS.has(k)) continue;
      if (JSON.stringify(old[k]) !== JSON.stringify(next[k])) drift.push(`${String(old.id)}.${k}`);
    }
    const suffix = String(old.id).replace(/^ALS-COFFEE-1\.1-/, "");
    const expectTier = UNBOUND_SUFFIXES.includes(suffix) ? "unbound" : old.tier;
    if (next.tier !== expectTier) tierDrift.push(`${String(old.id)}: ${String(old.tier)} -> ${String(next.tier)}, expected ${String(expectTier)}`);
    const oldReason = (old.predicted_discrimination as Json).reasoning;
    const newReason = (next.discrimination_prediction as Json | undefined)?.reasoning;
    if (oldReason !== newReason) reasoningDrift.push(String(old.id));
  }
  eq("every non-delta field is byte-identical to v1.1", drift, []);
  eq("only the five declared entries changed tier", tierDrift, []);
  eq("all 42 prediction `reasoning` texts are preserved verbatim", reasoningDrift, []);
}
{
  // The band is DROPPED, not carried anywhere — checked against the actual band
  // strings v1.1 published rather than a pattern that might match prose.
  const bands = new Set((v11.entries as Json[]).map((e) => String((e.predicted_discrimination as Json).predicted_fail_rate_band)));
  const serialized = JSON.stringify(v12.entries);
  const survivors = [...bands].filter((b) => serialized.includes(b));
  eq(`none of the ${bands.size} distinct authored bands survives into v1.2`, survivors, []);
  eq("no entry carries `predicted_discrimination`", (v12.entries as Json[]).filter((e) => e.predicted_discrimination).length, 0);
  eq("every entry carries `discrimination_prediction`", (v12.entries as Json[]).filter((e) => e.discrimination_prediction).length, (v12.entries as Json[]).length);
  const dirs = new Set((v12.entries as Json[]).map((e) => String((e.discrimination_prediction as Json).direction)));
  eq("every direction is `no_prediction` — a band is not translated into one", [...dirs], ["no_prediction"]);
}
{
  // THE FULL CHAIN, not one hop. v1.2 supersedes v1.1 supersedes v1.0.
  const withdrawn = new Map(((v12.withdrawn_entries as Array<{ entry_id: string; reason: string }>) ?? []).map((w) => [w.entry_id, w.reason]));
  const to12 = new Map((v12.entries as Json[]).map((e) => [String(e.supersedes), String(e.id)]));
  const to11 = new Map((v11.entries as Json[]).map((e) => [String(e.supersedes), String(e.id)]));
  const orphans11 = (v11.entries as Json[]).filter((e) => !to12.has(String(e.id)) && !withdrawn.has(String(e.id))).map((e) => String(e.id));
  const orphans10 = (v10.entries as Json[]).filter((e) => {
    const at11 = to11.get(String(e.id));
    return !at11 || (!to12.has(at11) && !withdrawn.has(at11));
  }).map((e) => String(e.id));
  eq(`all ${(v11.entries as Json[]).length} v1.1 ids resolve at v1.2`, orphans11, []);
  eq(`all ${(v10.entries as Json[]).length} v1.0 ids resolve at v1.2 through v1.1`, orphans10, []);
  const dupes = [...to12.keys()].filter((k, i, a) => a.indexOf(k) !== i);
  eq("no two v1.2 entries supersede the same v1.1 entry", dupes, []);
}
{
  const unbound = (v12.entries as Json[]).filter((e) => e.tier === "unbound");
  eq("five entries are `unbound`", unbound.length, 5);
  const noReason = unbound.filter((e) => String(e.unbound_reason ?? "").length < 40).map((e) => String(e.id));
  eq("every `unbound` entry names why", noReason, []);
  const withBinding = unbound.filter((e) => e.binding || e.measured_discrimination).map((e) => String(e.id));
  eq("no `unbound` entry carries a binding or a measurement", withBinding, []);
  const stray = (v12.entries as Json[]).filter((e) => e.unbound_reason && e.tier !== "unbound").map((e) => String(e.id));
  eq("`unbound_reason` appears on no other tier", stray, []);
  eq("no entry is `not_discriminating` any more", (v12.entries as Json[]).filter((e) => e.tier === "not_discriminating").length, 0);
  // Every re-tiering is in the changelog, and none of them is a weakening.
  const changed = new Set(unbound.map((e) => String(e.id)));
  const release = (v12.changelog as Json[])[0] as Json;
  const logged = new Set(((release.changes as Json[]) ?? []).map((c) => String(c.entry_id)));
  eq("every re-tiered entry is in the 1.2 changelog", [...changed].filter((id) => !logged.has(id)), []);
  const weakenings = ((release.changes as Json[]) ?? []).filter((c) => c.change_type === "weakened" || c.change_type === "demoted");
  eq("the 1.2 release contains no weakening or demotion", weakenings.length, 0);
}

// ===========================================================================
console.log("\nE. IT COMPILES, AND THE SIDECAR COVERS EXACTLY WHAT RUNS");
// ===========================================================================
{
  const report = compileStandard(v12 as never);
  eq("compiles with no errors", report.errors.map(String), []);
  eq("every executable entry produced a requirement", report.requirements.length, report.expectedExecutable);
  report.requirements.length === 10 ? ok("10 requirements compiled") : bad("10 requirements compiled", `got ${report.requirements.length}`);
  const sidecar = rj<Sidecar>("standards/coffee/v1.2/applicability.json");
  const cov = assertSidecarCoversStandard(sidecar, report.requirements.map((r) => r.id));
  eq("no executable entry lacks an applicability rule", cov.missing, []);
  eq("no applicability rule points at an entry that does not exist", cov.stale, []);
  // ✅ FIXED (v3.4). This was reported here as an open finding while `compile.ts` was
  // owned by a concurrent session: it had no branch for the 1.2 tier, so an `unbound`
  // entry fell through to the `blocked` wording and told a reader the ENGINE cannot run
  // these five — the exact opposite of what `unbound` means. `compile.ts` now switches
  // exhaustively over the tier, so the next new tier is a type error rather than a
  // false sentence.
  //
  // The assertion stays and is now the RIGHT WAY ROUND. It was written to fail the day
  // the bug was fixed, which is correct for a pinned finding and wrong the moment it
  // stops being one — a note reading "reported, not patched" beside a count of zero is
  // a document disagreeing with its own measurement.
  const unboundSkips = report.skipped.filter((s) => s.tier === "unbound");
  eq("every unbound entry is skipped, and there are five", unboundSkips.length, 5);
  const mislabelled = unboundSkips.filter((s) => /blocked/.test(s.reason));
  eq("no `unbound` skip is described with the `blocked` wording", mislabelled.map((s) => s.id), []);
  const saysEngineCan = unboundSkips.filter((s) => /unbound —/.test(s.reason));
  eq("every `unbound` skip names its own tier in its reason", saysEngineCan.length, unboundSkips.length);
}
{
  // ⚠️ THE PUBLISHING TRIPWIRE, and it is the defect this repo has now hit three
  // times: a renderer reads a field that does not exist, produces NOTHING, and
  // nothing looks exactly like a section that legitimately has nothing to show.
  //
  // `src/server/standardsSite.ts` serves a HARDCODED list of versions, so v1.2 is
  // not on the site today and nothing is broken. But `fitnessOf()` reads
  // `measured_fitness` — FORBIDDEN at 1.2 — and `measuredOf()` reads `asked` and a
  // two-valued `verdict`, which at 1.2 are `n_asked`/`n_adjudicated` and a
  // three-valued one. Adding v1.2 to that list without teaching those two functions
  // would publish a page announcing that this version has no measured error rate,
  // on the version whose entire point is that it does.
  const site = fs.readFileSync(path.join(REPO, "src/server/standardsSite.ts"), "utf8");
  const published = /standards\/coffee\/v1\.2/.test(site);
  if (!published) {
    ok("v1.2 is not yet on the published site — nothing can render it half-empty (handoff, not a defect)");
  } else {
    const taught = /category_fitness/.test(site) && /n_adjudicated/.test(site);
    taught
      ? ok("v1.2 is published AND the site's fitnessOf/measuredOf know the 1.2 field names")
      : bad("the site was taught the 1.2 shapes before publishing v1.2",
        "src/server/standardsSite.ts serves standards/coffee/v1.2 but still reads `measured_fitness` and `asked`. " +
        "At grammar 1.2 those fields do not exist, so every fitness figure and every per-entry rate renders as ABSENT — " +
        "which is indistinguishable from a section that has nothing to show.");
  }
}

// ===========================================================================
const state = failures.length === 0 ? (PINNED.length === 0 ? "VERIFIED_CLEAN" : "PINNED_FINDINGS") : "DEFECTS_FOUND";
console.log(`\n${"=".repeat(78)}`);
console.log(`GATE: ${state}`);
if (state === "PINNED_FINDINGS") {
  console.log(`\n⚠️ THIS IS NOT A CLEAN RESULT AND MUST NOT BE REPORTED AS ONE.`);
  console.log(`${PINNED.length} governance findings stand, both of rule \`bias_exceeds_margin\`:`);
  for (const p of PINNED) console.log(`  • ${p.entry} — ${p.why}`);
  console.log(`\nThe rule fires on a \`not_discriminating\` VERDICT, not on the tier, and neither entry is`);
  console.log(`retired — both stay \`executable\`. So the rule is doing its job: it is refusing to let a`);
  console.log(`verdict be acted on while an unquantified bias points at the band edge it cleared. Dropping`);
  console.log(`the bias would make this gate green and the document false.`);
}
if (failures.length) {
  console.log(`\n${failures.length} gate failure(s):`);
  for (const f of failures) console.log(`  • ${f}`);
  process.exit(1);
}
console.log(`${"=".repeat(78)}\n`);
