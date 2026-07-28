// ===========================================================================
// VERIFY COFFEE STANDARD v1.3 — the transform does not certify itself.
//
// `issue_v1_3.ts` wrote the document; this reads it back cold and tries to break
// it. Six gates, and two of them exist only because of what v1.3 is:
//
//   A. THE THREE EARLIER VERSIONS ARE STILL THEIR OWN BYTES (hash + `git diff`).
//   B. v1.3 VALIDATES against standards/schema.json, and buying it cost no
//      predecessor its validity. Grammar stays 1.2 — a version bump that renamed
//      the grammar would silently switch off every 1.2 gate in the schema.
//   C. ALL 21 CROSS-FIELD RULES RUN, AND EVERY ONE IS SHOWN TO FIRE.
//      ⚠️ A checker that ran nothing looks exactly like a clean result. So this
//      gate does not merely run the rules over the document — it MUTATES a clone
//      once per rule and asserts that specific rule fires. Same discipline as
//      experiments/v2-4/mutate.mjs: a guard whose removal breaks nothing is not a
//      guard.
//   D. EXACTLY ONE ENTRY MOVED, and it moved in exactly the declared fields. The
//      other 41 are byte-identical to their v1.2 selves once `id` and `supersedes`
//      are removed — asserted mechanically, because "I read them" is not a check.
//   E. ⚠️ THE PROMISE DID NOT WIDEN. This is the gate this file exists for.
//      v1.3 tightens what PASSES. The failure mode it is one step away from is
//      tightening what passes and quietly widening what a pass MEANS — which is
//      the exact defect (a field promising more than the evidence supports) that
//      this reissue was written to correct. So `pass_means.does_not_establish`
//      is asserted to still contain v1.2's clause VERBATIM, `registry.resolvable`
//      to still be false, and the person-facing fields to be byte-identical.
//   F. IT COMPILES and its applicability sidecar covers exactly its executables.
//
// ⚠️ THIS GATE DOES NOT RETURN "CLEAN", AND THAT IS THE CORRECT RESULT. Two
// findings are PINNED with their reasons, both inherited unchanged from v1.2:
// `bias_exceeds_margin` fires on CERT-001 and CERT-002 because both are claim rows
// measured with the semantic tier disabled, an unquantified bias pointing at the
// band edge their intervals cleared. Neither entry is retired. The pinned set is
// asserted EXACTLY, in both directions.
//
// ⚠️ AND IDENT-001 MUST NOT JOIN THEM. Its new bias is `deflates_fail_rate`, and
// its interval clears the UPPER edge, so a deflating bias points AWAY from the
// cleared edge and cannot manufacture the verdict. If the finding set grows by an
// IDENT-001 entry, the new bias was declared in the flattering direction.
//
// Run: npx tsx standards/coffee/verify_v1_3.ts
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
const V12_HASH = "fe199a864d3d4d565986851f9bfae9e108d55e4c86af18b1f8027f3d23486b58";

type Json = Record<string, unknown>;
const v10 = rj<Json>("standards/coffee/v1.0/standard.json");
const v11 = rj<Json>("standards/coffee/v1.1/standard.json");
const v12 = rj<Json>("standards/coffee/v1.2/standard.json");
const v13 = rj<Json>("standards/coffee/v1.3/standard.json");
const schema = rj<Json>("standards/schema.json");
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const entriesOf = (d: Json): Json[] => d.entries as Json[];
const entryAt = (d: Json, suffix: string): Json => entriesOf(d).find((e) => String(e.id).endsWith(suffix))!;
const md = (d: Json, suffix: string): Json => entryAt(d, suffix).measured_discrimination as Json;

const failures: string[] = [];
const ok = (label: string): void => console.log(`  ok    ${label}`);
const bad = (label: string, why: string): void => { failures.push(`${label}: ${why}`); console.log(`  FAIL  ${label}\n          ${why}`); };
const eq = (label: string, a: unknown, b: unknown): void => (JSON.stringify(a) === JSON.stringify(b) ? ok(label) : bad(label, `${JSON.stringify(a)} !== ${JSON.stringify(b)}`));
const yes = (label: string, cond: boolean, why: string): void => (cond ? ok(label) : bad(label, why));

const IDENT = "IDENT-001";

// ===========================================================================
console.log("\nA. THE THREE EARLIER VERSIONS ARE FROZEN");
// ===========================================================================
eq("v1.0 hash is the literal every citation resolves through", standardHash(v10), V10_HASH);
eq("v1.1 hash is the literal every citation resolves through", standardHash(v11), V11_HASH);
eq("v1.2 hash is the literal every citation resolves through", standardHash(v12), V12_HASH);
for (const [name, doc] of [["v1.0", v10], ["v1.1", v11], ["v1.2", v12]] as const) {
  eq(`${name} stored hash agrees with its own bytes`, hashMatches(doc).ok, true);
}
for (const rel of ["standards/coffee/v1.0/standard.json", "standards/coffee/v1.1/standard.json", "standards/coffee/v1.2/standard.json"]) {
  try {
    execFileSync("git", ["diff", "--exit-code", "--", rel], { cwd: REPO, stdio: "pipe" });
    ok(`${rel} is byte-identical to its committed version`);
  } catch {
    bad(`${rel} is byte-identical to its committed version`, "git diff --exit-code reports a modification");
  }
}
{
  const h = hashMatches(v13);
  eq("v1.3 hash agrees three ways — stored", h.ok, true);
  eq("v1.3 hash agrees three ways — recomputed", h.computed, standardHash(v13));
  const distinct = h.computed !== V10_HASH && h.computed !== V11_HASH && h.computed !== V12_HASH;
  yes("v1.3 hash agrees three ways — distinct from v1.0, v1.1 and v1.2", distinct, "v1.3 hashes identically to an earlier version — then it is not a new version");
  console.log(`        v1.3 = ${h.computed}`);
}

// ===========================================================================
console.log("\nB. v1.3 VALIDATES, AND THE GRAMMAR DID NOT MOVE");
// ===========================================================================
{
  const r = validate(v13, schema);
  r.ok ? ok(`schema validation (${r.checksRun} subschema checks)`) : bad("schema validation", renderResult(r));
  r.checksRun > 500 ? ok(`the validator did real work (${r.checksRun} checks)`) : bad("the validator did real work", `only ${r.checksRun} checks ran`);
  for (const [name, doc] of [["v1.0", v10], ["v1.1", v11], ["v1.2", v12]] as const) {
    const rr = validate(doc, schema);
    rr.ok ? ok(`${name} still validates`) : bad(`${name} still validates`, renderResult(rr));
  }
}
// ⚠️ THE GRAMMAR STAYS 1.2 AND THAT IS LOAD-BEARING, not cosmetic. Every
// version-specific rule in standards/schema.json is gated on `grammar_version`
// being exactly "1.2" — the forbidden `predicted_discrimination`, the rich
// measurement shape, the `not_discriminating`-requires-a-measurement rule, the
// publication gate. A document declaring "1.3" would satisfy NONE of those `if`s
// and would validate against a schema that had stopped asking it anything.
eq("grammar_version is unchanged — a content change is not a grammar change", v13.grammar_version, "1.2");
eq("version", v13.version, "1.3");
eq("status is unchanged — no second party has touched it", v13.status, "applied_by_author");
eq("independently_applied is still false", (v13.posture as Json).independently_applied, false);
eq("`measured_fitness` is still absent at grammar 1.2", "measured_fitness" in v13, false);
eq("`category_fitness` is present", "category_fitness" in v13, true);
eq("the entry count did not move", entriesOf(v13).length, entriesOf(v12).length);
{
  const rel = (v13.changelog as Json[])[0] as Json & { changes: Json[] };
  eq("the 1.3 release is first in the changelog", rel.version, "1.3");
  eq("the 1.3 release logs exactly one change", rel.changes.length, 1);
  eq("that change is the amended entry", rel.changes[0]!.entry_id, `ALS-COFFEE-1.3-${IDENT}`);
  eq("`strengthened` — copy that passed can now fail, nothing that failed can now pass", rel.changes[0]!.change_type, "strengthened");
  eq("no weakening_attestation is invented for a change that needs none", "weakening_attestation" in (rel.changes[0] as Json), false);
  yes("the changelog states the pre-change rate, measured", /94\.7368%/.test(String(rel.changes[0]!.rationale)),
    "the rationale does not state the measured pre-change fail rate, so a reader cannot tell what the tightening was decided against");
}

// ===========================================================================
console.log("\nC. ALL 21 CROSS-FIELD RULES — RUN, AND EACH SHOWN TO FIRE");
// ===========================================================================
const runRules = (std: Json): RuleError[] => {
  const errs: RuleError[] = [];
  const entries = entriesOf(std) ?? [];
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

const baseline = runRules(v13);
const inputs = (runRules as unknown as { lastInputs: { entries: number; measured: number; categoryFitness: number } }).lastInputs;
console.log(`        checkMeasuredDiscrimination over ${inputs.entries} entries (${inputs.measured} carrying a measurement) · checkCategoryFitness over ${inputs.categoryFitness} block · checkRetirementAttested over the changelog`);
eq("ALL_RULES holds 21 rules", ALL_RULES.length, 21);
yes("10 measurements were actually handed to the rules", inputs.measured === 10, `${inputs.measured} found — a rule with no input cannot fail`);

/** ⚠️ THE PINNED FINDINGS. Not an allowlist of things we decided not to care
 *  about — a debt with a receipt, asserted exactly, failing in BOTH directions.
 *  Both are inherited unchanged from v1.2; v1.3 neither added nor removed one. */
const PINNED = [
  { rule: "bias_exceeds_margin", entry: "ALS-COFFEE-1.3-CERT-001", why: "claim row, semantic tier disabled for the run, unquantified bias toward the cleared 85% edge; margin is 0.0019pp" },
  { rule: "bias_exceeds_margin", entry: "ALS-COFFEE-1.3-CERT-002", why: "claim row, semantic tier disabled for the run, unquantified bias toward the cleared 85% edge; margin is 5.1629pp" },
];
{
  const entries = entriesOf(v13);
  const seen = baseline.map((e) => {
    const idx = Number(/^entries\/(\d+)/.exec(e.path)?.[1] ?? -1);
    return { rule: e.rule, entry: idx >= 0 ? String(entries[idx]!.id) : "<standard>" };
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
  for (const s of seen) {
    const e = entries.find((x) => x.id === s.entry);
    const notes = String((e?.measured_discrimination as Json | undefined)?.notes ?? "");
    /MAY NOT BE ACTED ON AS A RETIREMENT/.test(notes)
      ? ok(`${s.entry} states the reason for its own finding in the published document`)
      : bad(`${s.entry} states the reason for its own finding`, "the document is silent about a rule that fires on it");
  }
  // ⚠️ AND THE ONE THAT MUST NOT APPEAR. IDENT-001 gained a bias at v1.3. Declared
  // in the WRONG direction it would have manufactured a finding here, and a bias
  // declared in the direction that flatters the verdict is the failure this project
  // treats as the disguised form of every other one.
  yes(`no finding names ${IDENT} — its new bias points AWAY from the cleared edge, as a tightening must`,
    !seen.some((s) => s.entry.endsWith(IDENT)),
    `${IDENT} produced a cross-field finding. Its interval clears the UPPER band edge, so only an \`inflates_fail_rate\` bias can reach it — ` +
    `and a tightening of accepted evidence can only move rows from pass to FAIL, which deflates. A finding here means the direction was declared backwards.`);
}

// ---- the canaries: one mutation per rule, each must produce THAT rule ---------
type Mut = { rule: string; mutate: (d: Json) => void };
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
  { rule: "retirement_needs_bias_declaration", mutate: (d) => { delete md(d, IDENT).instrument_bias; } },
  {
    rule: "bias_exceeds_margin",
    mutate: (d) => {
      md(d, IDENT).instrument_bias = [{ source: "a quantified bias larger than the interval's margin to the band", direction: "inflates_fail_rate", magnitude_pp: 50 }];
    },
  },
  { rule: "fitness_sample_is_this_category", mutate: (d) => { ((d.category_fitness as Json).sample as Json).category_standard_id = "ALS-TEA"; } },
  { rule: "defects_within_rows", mutate: (d) => { (d.category_fitness as Json).confirmed_false_positives = 9999; } },
  { rule: "bounds_ordered", mutate: (d) => { ((d.category_fitness as Json).bounds as Json).naive_95_upper_pct = 0; } },
  { rule: "cluster_bound_is_wider", mutate: (d) => { ((d.category_fitness as Json).bounds as Json).cluster_adjusted_95_upper_pct = 0.1; } },
  { rule: "point_estimate_matches_counts", mutate: (d) => { ((d.category_fitness as Json).bounds as Json).point_estimate_pct = 99; } },
  { rule: "defects_enumerated", mutate: (d) => { (d.category_fitness as Json).defects = ((d.category_fitness as Json).defects as Json[]).slice(1); } },
  { rule: "retirement_is_a_demotion", mutate: (d) => { entryAt(d, IDENT).tier = "not_discriminating"; } },
];

const exercised = new Set<string>();
const dead: string[] = [];
for (const m of MUTATIONS) {
  const d = clone(v13);
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
console.log("\nD. EXACTLY ONE ENTRY MOVED, AND IN EXACTLY THE DECLARED FIELDS");
// ===========================================================================
const IDENT_DELTA_KEYS = ["accepted_evidence", "adversarial", "insufficient_evidence", "measured_discrimination", "pass_means"];
{
  const by12 = new Map(entriesOf(v13).map((e) => [String(e.supersedes), e]));
  const strip = (o: Json): string => {
    const c: Json = {};
    for (const [k, v] of Object.entries(o)) { if (k !== "id" && k !== "supersedes") c[k] = v; }
    return JSON.stringify(c);
  };
  const drift: string[] = [];
  let identSeen = 0;
  for (const old of entriesOf(v12)) {
    const next = by12.get(String(old.id));
    if (!next) { drift.push(`${String(old.id)} has no successor`); continue; }
    if (String(next.id) !== String(old.id).replace("-1.2-", "-1.3-")) drift.push(`${String(old.id)} -> ${String(next.id)}, which is not the 1.3 form of its id`);
    if (String(old.id).endsWith(IDENT)) {
      identSeen++;
      const moved = [...new Set([...Object.keys(old), ...Object.keys(next)])]
        .filter((k) => k !== "id" && k !== "supersedes")
        .filter((k) => JSON.stringify(old[k]) !== JSON.stringify(next[k]))
        .sort();
      eq(`${IDENT}'s changed key set is EXACTLY the declared delta`, moved, IDENT_DELTA_KEYS);
      continue;
    }
    if (strip(old) !== strip(next)) drift.push(String(old.id));
  }
  eq(`all ${entriesOf(v12).length - 1} other entries are byte-identical to v1.2 except id/supersedes`, drift, []);
  eq(`exactly one entry matched ${IDENT}`, identSeen, 1);
}
{
  // THE FULL CHAIN, not one hop. v1.3 supersedes v1.2 supersedes v1.1 supersedes v1.0.
  const withdrawn = new Map(((v13.withdrawn_entries as Array<{ entry_id: string; reason: string }>) ?? []).map((w) => [w.entry_id, w.reason]));
  const to13 = new Map(entriesOf(v13).map((e) => [String(e.supersedes), String(e.id)]));
  const to12 = new Map(entriesOf(v12).map((e) => [String(e.supersedes), String(e.id)]));
  const to11 = new Map(entriesOf(v11).map((e) => [String(e.supersedes), String(e.id)]));
  const orphans12 = entriesOf(v12).filter((e) => !to13.has(String(e.id)) && !withdrawn.has(String(e.id))).map((e) => String(e.id));
  const orphans11 = entriesOf(v11).filter((e) => {
    const at12 = to12.get(String(e.id));
    return !at12 || (!to13.has(at12) && !withdrawn.has(at12));
  }).map((e) => String(e.id));
  const orphans10 = entriesOf(v10).filter((e) => {
    const at11 = to11.get(String(e.id));
    const at12 = at11 ? to12.get(at11) : undefined;
    return !at12 || (!to13.has(at12) && !withdrawn.has(at12));
  }).map((e) => String(e.id));
  eq(`all ${entriesOf(v12).length} v1.2 ids resolve at v1.3`, orphans12, []);
  eq(`all ${entriesOf(v11).length} v1.1 ids resolve at v1.3 through v1.2`, orphans11, []);
  eq(`all ${entriesOf(v10).length} v1.0 ids resolve at v1.3 through v1.1 and v1.2`, orphans10, []);
  const dupes = [...to13.keys()].filter((k, i, a) => a.indexOf(k) !== i);
  eq("no two v1.3 entries supersede the same v1.2 entry", dupes, []);
  eq("nothing is withdrawn", [...withdrawn.keys()], []);
}

// ===========================================================================
console.log("\nE. THE PROMISE DID NOT WIDEN — the gate this file exists for");
// ===========================================================================
{
  const old = entryAt(v12, IDENT), next = entryAt(v13, IDENT);

  // 1. `does_not_establish` KEEPS EVERY CLAUSE, verbatim and first.
  const dneOld = String((old.pass_means as Json).does_not_establish);
  const dneNew = String((next.pass_means as Json).does_not_establish);
  yes("`pass_means.does_not_establish` still opens with v1.2's clause, verbatim", dneNew.startsWith(dneOld),
    `v1.2 said ${JSON.stringify(dneOld)} and v1.3 does not begin with it. Tightening what passes does not license a bigger promise, and a clause dropped here is a promise made.`);
  yes("`does_not_establish` got LONGER, not shorter", dneNew.length > dneOld.length,
    "the refusal list did not grow; if a clause was replaced rather than added, the promise moved");
  for (const clause of ["correct", "unique to this product", "allocated to this seller", "resolvable to any catalogue record anywhere"]) {
    yes(`  it still refuses: ${clause}`, dneNew.includes(clause), `the \`${clause}\` refusal is gone from v1.3`);
  }

  // 2. The register does not exist and nothing here invented one.
  eq("`registry.resolvable` is still false", (next.registry as Json).resolvable, false);
  eq("`registry` is byte-identical to v1.2", next.registry, old.registry);

  // 3. The person-facing half of the seam was already right. It must not move.
  for (const k of ["question", "consumer_note", "merchant_remediation", "assertion", "binding", "tier", "applicability", "conflict_rules", "evidence_surfaces", "public_inspectable", "grounding", "known_gaps", "notes", "discrimination_prediction"]) {
    eq(`${IDENT}.${k} is byte-identical — v1.3 SUPPORTS the question, it does not rewrite it`, next[k], old[k]);
  }

  // 4. `accepted_evidence` was NARROWED by appending a qualifier, never rewritten.
  const accOld = (old.accepted_evidence as Json[])[0]!, accNew = (next.accepted_evidence as Json[])[0]!;
  eq("accepted_evidence still has exactly one form", (next.accepted_evidence as Json[]).length, (old.accepted_evidence as Json[]).length);
  eq("its surface is unchanged", accNew.surface, accOld.surface);
  yes("the MPN branch was narrowed by APPENDING a qualifier — v1.2's text is still its prefix", String(accNew.form).startsWith(String(accOld.form)),
    "the accepted-evidence form was rewritten rather than qualified; a rewrite can widen without looking like it");
  yes("the appended qualifier is the internal-object-id one", /is not the seller's own internal object id for this product$/.test(String(accNew.form)),
    "the appended text is not the declared qualifier");

  // 5. `insufficient_evidence` gained exactly one clause, DIRECTLY AFTER the rule
  //    it generalises, and every prior clause is untouched.
  const insOld = old.insufficient_evidence as Json[], insNew = next.insufficient_evidence as Json[];
  eq("insufficient_evidence gained exactly one clause", insNew.length, insOld.length + 1);
  const at = insOld.findIndex((f) => f.form === "an internal SKU published in the GTIN field");
  yes("the SKU-in-GTIN clause it generalises is present in v1.2", at >= 0, "the clause the new rule quotes does not exist");
  eq("every v1.2 clause survives, in order, byte-identical", [...insNew.slice(0, at + 1), ...insNew.slice(at + 2)], insOld);
  const added = insNew[at + 1]!;
  yes("the new clause sits directly after the rule it generalises", /MPN field/.test(String(added.form)), "the inserted clause is not at the declared index");
  yes("the new clause quotes the neighbouring rule's reasoning verbatim",
    String(added.why_not).includes(String(insOld[at]!.why_not)),
    "the new clause claims to reuse the SKU-in-GTIN reasoning and does not contain it — a false attribution in a published document");

  // 6. `pass_means.establishes` states the added condition and keeps the old ones.
  const estNew = String((next.pass_means as Json).establishes);
  yes("`establishes` states the new condition", /is not the seller's own internal object id for this product/.test(estNew), "the tightened condition is not in `establishes`");
  yes("`establishes` keeps the placeholder condition", /is not a placeholder/.test(estNew), "the placeholder condition was dropped");
  yes("`establishes` keeps the GTIN check-digit condition", /for a GTIN, has a valid check digit/.test(estNew), "the check-digit condition was dropped");

  // 7. The v1.0 attack is KEPT, not replaced, and its own outcome is still named.
  const advOld = old.adversarial as Json, advNew = next.adversarial as Json;
  yes("the v1.0 attack text is carried verbatim inside the attack record", String(advNew.attack).includes(String(advOld.attack)),
    "the original attack was overwritten; its residual risk is still true and deleting it deletes the record that it is");
  yes("its `survived_unchanged` outcome is still named in the resolution", /survived_unchanged/.test(String(advNew.resolution)),
    "the entry now records one outcome value and does not say what the first attack's outcome was");
  yes("the v1.0 resolution is quoted verbatim where it is amended", String(advNew.resolution).includes(String(advOld.resolution)),
    "the amendment describes the old resolution without quoting it — a paraphrase of a text a reader cannot check");
  yes("the v1.0 residual risk is carried verbatim and added to", String(advNew.residual_risk).startsWith(String(advOld.residual_risk)),
    "the residual risk was rewritten; the duplicated-GTIN risk is still true");
  eq("the outcome now records the change that was actually made", advNew.outcome, "tightened_accepted_evidence");
  yes("the residual risk states that no engine change ships with v1.3", /NO ENGINE CHANGE SHIPS WITH v1\.3/.test(String(advNew.residual_risk)),
    "the document requires more than the engine checks and does not say so where a reader of the entry would see it");

  // 8. The measurement is CARRIED, RE-SCOPED, and not re-presented.
  const mOld = old.measured_discrimination as Json, mNew = next.measured_discrimination as Json;
  for (const k of ["verdict", "n_asked", "n_adjudicated", "fail_count", "fail_rate_pct", "interval_95", "target_band", "decision_rule", "measured_on", "sample"]) {
    eq(`  measurement.${k} is byte-identical to v1.2 — the counts did not change, only their scope`, mNew[k], mOld[k]);
  }
  const biasOld = mOld.instrument_bias as Json[], biasNew = mNew.instrument_bias as Json[];
  eq("the measurement declares exactly one more bias than v1.2", biasNew.length, biasOld.length + 1);
  eq("every v1.2 bias survives verbatim", biasNew.slice(0, biasOld.length), biasOld);
  const added2 = biasNew[biasOld.length]!;
  eq("the new bias DEFLATES — a tightening can only move rows pass -> fail", added2.direction, "deflates_fail_rate");
  eq("the new bias is UNQUANTIFIED, and says so by omitting the magnitude", "magnitude_pp" in added2, false);
  yes("the new bias says why it is not netted against the audit bias beside it", /double-count/.test(String(added2.source)),
    "two overlapping biases are declared with no statement that they overlap, which invites a reader to add them");
  yes("the notes say the measurement predates the tightening", /MEASURED AGAINST THE v1\.2 WORDING, NOT THIS ONE/.test(String(mNew.notes)),
    "a pre-change measurement is published with no statement of what it was measured against");
  yes("the notes say the rate is a FLOOR for the requirement as v1.3 states it", /is a FLOOR/.test(String(mNew.notes)),
    "the direction of the re-scoping is not stated, so a reader cannot tell which way it moves");
  yes("the notes say why `supersedes` is not used", /supersedes` records a measurement that a REPLACEMENT has displaced/.test(String(mNew.notes)),
    "the grammar's re-measurement path is unused and the document does not say why");
}
{
  // The fitness record must not go silent while the requirement it measures moves.
  const f13 = v13.category_fitness as Json, f12 = v12.category_fitness as Json;
  for (const k of ["pass_rows_audited", "confirmed_false_positives", "bounds", "audit", "completion_state", "measured_on", "sample"]) {
    eq(`category_fitness.${k} is unchanged — the bound does not move`, f13[k], f12[k]);
  }
  const l13 = f13.limits as string[], l12 = f12.limits as string[];
  eq("category_fitness gained exactly one limit", l13.length, l12.length + 1);
  eq("every v1.2 limit survives verbatim", l13.slice(0, l12.length), l12);
  yes("the new limit says the bound measures the ENGINE, which v1.3 did not change",
    /bounds the false-pass rate of the ENGINE/.test(l13.at(-1)!),
    "the fitness record is silent about the requirement having moved under it");
  const ids = new Set(entriesOf(v13).map((e) => String(e.id)));
  const dangling = (f13.defects as Json[]).filter((d) => !ids.has(String(d.entry_id))).map((d) => String(d.entry_id));
  eq("every defect names an entry that exists at v1.3", dangling, []);
  eq("the defect count still equals the confirmed count", (f13.defects as Json[]).length, f13.confirmed_false_positives);
}
{
  // The posture clause that would have gone false.
  const s = String((v13.posture as Json).statement);
  yes("the posture no longer claims all ten executable entries are unchanged here",
    !/unchanged in v1\.1 and unchanged here/.test(s),
    "the posture still says the ten executable entries are unchanged in this version, and one of them is not — the defect v1.1 was issued to fix");
  yes("the posture names the v1.3 change", /ONE ENTRY CHANGED AT v1\.3/.test(s), "a version whose posture does not mention its own change is understating again");
  yes("the posture says the promise did not widen", /keeps every clause it had/.test(s), "the posture does not record that pass_means was not widened");
  yes("the posture says the engine did not change with it", /THE ENGINE HAS NOT CHANGED WITH IT/.test(s), "the standard requires more than the engine checks and the posture is silent");
  yes("the posture still names the second-party bar", /no second party has applied this document/.test(s), "the promotion bar was dropped from the posture");
  for (const [name, doc, want] of [["v1.0", v10, "draft"], ["v1.1", v11, "applied_by_author"], ["v1.2", v12, "applied_by_author"]] as const) {
    eq(`${name}'s status is untouched — that is what freezing means`, doc.status, want);
  }
}

// ===========================================================================
console.log("\nF. IT COMPILES, AND THE SIDECAR COVERS EXACTLY WHAT RUNS");
// ===========================================================================
{
  const report = compileStandard(v13 as never);
  eq("compiles with no errors", report.errors.map(String), []);
  eq("every executable entry produced a requirement", report.requirements.length, report.expectedExecutable);
  yes("10 requirements compiled", report.requirements.length === 10, `got ${report.requirements.length}`);
  const sidecar = rj<Sidecar>("standards/coffee/v1.3/applicability.json");
  eq("the sidecar declares version 1.3", sidecar.version, "1.3");
  const cov = assertSidecarCoversStandard(sidecar, report.requirements.map((r) => r.id));
  eq("no executable entry lacks an applicability rule", cov.missing, []);
  eq("no applicability rule points at an entry that does not exist", cov.stale, []);
  const unboundSkips = report.skipped.filter((s) => s.tier === "unbound");
  eq("every unbound entry is skipped, and there are five", unboundSkips.length, 5);
  eq("no `unbound` skip is described with the `blocked` wording", unboundSkips.filter((s) => /blocked/.test(s.reason)).map((s) => s.id), []);

  // ⚠️ THE BINDING DID NOT CHANGE, AND THAT IS THE HONEST STATE, NOT AN OVERSIGHT.
  // The compiled requirement is derived from `binding.req_kind`, and no engine change
  // ships with v1.3 — so the row the engine runs is byte-identical to the one it ran
  // at v1.2, while the document now requires more. Asserting it here means the day
  // someone implements the tightening, this line fails and forces the standard's
  // measurement scope to be revisited with it.
  const identReq = report.requirements.find((r) => String(r.id).endsWith(IDENT));
  yes(`${IDENT} still compiles to the same requirement kind — no engine change ships with v1.3`,
    identReq !== undefined && String((identReq as { kind?: unknown }).kind) === "identifiers",
    `${IDENT} compiles to ${String((identReq as { kind?: unknown } | undefined)?.kind)}, not \`identifiers\` — if the engine changed, this version's measurement scope must be revisited`);
}
{
  // ⚠️ THE PUBLISHING TRIPWIRE. `src/server/standardsSite.ts` serves a HARDCODED
  // list of versions, so v1.3 is not on the site today and nothing renders it. The
  // day it is added, the same defect this repo has hit three times applies: a
  // renderer reading a field that does not exist produces NOTHING, and nothing looks
  // exactly like a section that legitimately has nothing to show.
  const site = fs.readFileSync(path.join(REPO, "src/server/standardsSite.ts"), "utf8");
  const published = /standards\/coffee\/v1\.3/.test(site);
  if (!published) {
    ok("v1.3 is not yet on the published site — nothing can render it half-empty (handoff, not a defect)");
    const supersededMarked = /publicVersion: "1\.2"[^}]*supersededBy: "1\.3"/.test(site);
    supersededMarked
      ? bad("v1.2 is marked superseded by a version the site does not serve", "the site would link 1.2 -> 1.3 and 404")
      : ok("v1.2 is not yet marked superseded, so no supersession notice can dangle");
  } else {
    const taught = /category_fitness/.test(site) && /n_adjudicated/.test(site);
    taught
      ? ok("v1.3 is published AND the site's fitnessOf/measuredOf know the 1.2 field names")
      : bad("the site was taught the 1.2 shapes before publishing v1.3",
        "src/server/standardsSite.ts serves standards/coffee/v1.3 but still reads `measured_fitness` and `asked` — every fitness figure would render as ABSENT");
  }
}

// ===========================================================================
const state = failures.length === 0 ? (PINNED.length === 0 ? "VERIFIED_CLEAN" : "PINNED_FINDINGS") : "DEFECTS_FOUND";
console.log(`\n${"=".repeat(78)}`);
console.log(`GATE: ${state}`);
if (state === "PINNED_FINDINGS") {
  console.log(`\n⚠️ THIS IS NOT A CLEAN RESULT AND MUST NOT BE REPORTED AS ONE.`);
  console.log(`${PINNED.length} governance findings stand, both inherited unchanged from v1.2, both of rule \`bias_exceeds_margin\`:`);
  for (const p of PINNED) console.log(`  • ${p.entry} — ${p.why}`);
  console.log(`\nThe rule fires on a \`not_discriminating\` VERDICT, not on the tier, and neither entry is`);
  console.log(`retired — both stay \`executable\`. So the rule is doing its job: it is refusing to let a`);
  console.log(`verdict be acted on while an unquantified bias points at the band edge it cleared. Dropping`);
  console.log(`the bias would make this gate green and the document false.`);
  console.log(`\n${IDENT} did NOT join them, and that was checked rather than assumed: its new bias is`);
  console.log(`\`deflates_fail_rate\`, which points away from the edge its interval cleared.`);
}
if (failures.length) {
  console.log(`\n${failures.length} gate failure(s):`);
  for (const f of failures) console.log(`  • ${f}`);
  process.exit(1);
}
console.log(`${"=".repeat(78)}\n`);
