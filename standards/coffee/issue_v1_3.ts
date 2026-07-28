// ===========================================================================
// ISSUE COFFEE STANDARD v1.3 — a MECHANICAL TRANSFORM of v1.2, not a retyping.
//
// WHY A NEW VERSION AND NOT AN EDIT. v1.2 is byte-frozen: its `standard_hash` is
// what a citation resolves through. Everything below produces a NEW directory and
// leaves v1.0, v1.1 and v1.2 untouched.
//
// WHY 1.3 AND WHY THE GRAMMAR STAYS 1.2. Nothing in the grammar changes. What
// changes is ONE entry's evidence rule, which is a STANDARD version bump, not a
// grammar one. `grammar_version` therefore stays "1.2" — retitling the grammar for
// a content change would make every 1.2 gate in `standards/schema.json` stop
// applying to this document, silently, which is the "not being asked reads as
// passing" failure with a version number on it.
//
// WHAT v1.3 CHANGES, AND IT IS EXACTLY ONE ENTRY.
//
//   IDENT-001 had a seam running down the middle of it, and every field on one
//   side of the seam said the opposite of every field on the other.
//
//     • The fields that DECIDE said the row is about PUBLICATION. `assertion` is
//       `product_identifier_published` / `is_present`; `binding.label` is "A product
//       identifier is published in structured data"; `accepted_evidence` states a
//       validity test for the GTIN branch and, for MPN, exactly one qualifier —
//       "an MPN that is not a placeholder"; `pass_means.does_not_establish`
//       pre-emptively refuses resolvability.
//     • The fields addressed to a PERSON said the row is about IDENTITY. `question`
//       is "Can a shopping assistant match this exact bag to a catalogue entry?";
//       `consumer_note` says it is "the field that lets an assistant tell your bag
//       apart from a similarly-named one"; `merchant_remediation` asks for "a REAL
//       manufacturer part number".
//
//   A merchant saw a green row under a question the pass did not answer. That is
//   the "site disagrees with its own JSON" defect one level up, and it is not fixed
//   by choosing the decider fields — that would mean rewriting the question down to
//   "a string is present", a row barely worth running.
//
//   And ONE CLAUSE WAS ALREADY INCONSISTENT WITH ITSELF. `insufficient_evidence`
//   rejects "an internal SKU published in the GTIN field" because "a seller-private
//   stock code is not a global identifier and cannot match this product to any
//   external catalogue entry". That reason is FIELD-AGNOSTIC — it is about the
//   value, not about which key carries it — and the rule as written was scoped to
//   the GTIN field only. The standard already contained the rule; it just did not
//   apply it where the defect lives.
//
//   v1.3 applies it there. `experiments/v3-5/CP1_DECISION.md`.
//
// WHAT v1.3 DOES NOT DO, AND THE RESTRAINT IS THE POINT.
//   • `pass_means.does_not_establish` KEEPS EVERY CLAUSE IT HAD. The row still does
//     not establish that the identifier is correct, unique, allocated to this seller
//     or resolvable anywhere, and `registry.resolvable` is still `false`. TIGHTENING
//     WHAT PASSES DOES NOT LICENSE A BIGGER PROMISE — widening the promise is the
//     exact error this reissue exists to correct, one field over.
//   • No engine change ships with v1.3. The standard defines the requirement; the
//     engine implements it; that order. So this version knowingly requires more than
//     the engine checks, and says so in the entry's measurement notes, in the
//     entry's `adversarial.residual_risk`, and in the changelog.
//   • The 94.7% fail rate this document publishes for IDENT-001 was measured against
//     the v1.2 wording. It is carried WITH that scope stated and declared as an
//     instrument bias — never silently re-presented as a measurement of v1.3.
//
// EVERY NUMBER IN THE OUTPUT IS RECOMPUTED FROM AN ARTIFACT INSIDE THIS TRANSFORM.
// Nothing is retyped from a brief. Where two artifacts record the same quantity,
// both are read and disagreement ABORTS.
//
// Run: npx tsx standards/coffee/issue_v1_3.ts
// ===========================================================================
import fs from "node:fs";
import path from "node:path";
import { standardHash, hashMatches } from "../hash.js";
import { wilson95, verdictFor } from "../discrimination.js";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const REPO = path.resolve(here, "..", "..");
const SRC = path.join(here, "v1.2");
const OUT = path.join(here, "v1.3");

/** ⚠️ LITERALS, ON PURPOSE. These are the texts every existing citation resolves
 *  to. Recomputing them from the files would make this gate agree with whatever the
 *  files happen to say today, which is the check that is worth nothing. */
const V10_HASH = "334389c4eb6145112deec621e667f11142fb204c66bedd314fc12662d09acec5";
const V11_HASH = "f8ec2780f60c38931913e5b6cd37506500c8462709209de7180ba6691d6137e7";
const V12_HASH = "fe199a864d3d4d565986851f9bfae9e108d55e4c86af18b1f8027f3d23486b58";

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
const r4 = (x: number): number => Number(x.toFixed(4));

type Json = Record<string, unknown>;
interface Entry extends Json { id: string; tier: string }
interface Doc extends Json { grammar_version: string; version: string; status: string; title: string; standard_id: string; entries: Entry[]; changelog: Json[] }

/** A gated substring replacement. The whole reason this exists rather than a bare
 *  `.replace()`: `String.replace` on a missing needle returns the ORIGINAL STRING
 *  and throws nothing, so a drifted anchor produces a document that looks edited
 *  and is not. Every amendment below goes through here. */
const swap = (where: string, haystack: string, needle: string, replacement: string): string => {
  const n = haystack.split(needle).length - 1;
  if (n !== 1) die(`${where}: the anchor ${JSON.stringify(needle.slice(0, 60))}… occurs ${n} times in the v1.2 text, not once. The text drifted; do not guess where it went.`);
  const out = haystack.replace(needle, replacement);
  if (out === haystack) die(`${where}: the replacement produced an identical string — the edit did not take`);
  return out;
};

// ===========================================================================
// GATE 0 — the three frozen texts, BEFORE anything else is read.
// ===========================================================================
const v12 = rj<Doc>("standards/coffee/v1.2/standard.json");
const v11 = rj<Doc>("standards/coffee/v1.1/standard.json");
const v10 = rj<Doc>("standards/coffee/v1.0/standard.json");
{
  for (const [name, doc, want] of [["v1.2", v12, V12_HASH], ["v1.1", v11, V11_HASH], ["v1.0", v10, V10_HASH]] as const) {
    const c = hashMatches(doc);
    if (!c.ok || c.computed !== want) {
      die(`${name} is not the frozen text.\n  expected ${want}\n  computed ${c.computed}\n  stored   ${String(c.stored)}\n` +
        `  Every citation made against ${name} now resolves to a different text. If the change is intended it is a NEW VERSION, not an edit.`);
    }
  }
  // The chain, not one hop: v1.3 supersedes v1.2 supersedes v1.1 supersedes v1.0.
  const v11ids = new Set(v11.entries.map((e) => e.id));
  const v10ids = new Set(v10.entries.map((e) => e.id));
  const orphans12 = v12.entries.filter((e) => !e.supersedes || !v11ids.has(String(e.supersedes))).map((e) => e.id);
  if (orphans12.length) die(`v1.2 entries that do not name a real v1.1 predecessor: ${orphans12.join(", ")}`);
  const orphans11 = v11.entries.filter((e) => !e.supersedes || !v10ids.has(String(e.supersedes))).map((e) => e.id);
  if (orphans11.length) die(`v1.1 entries that do not name a real v1.0 predecessor: ${orphans11.join(", ")}`);
  if (v12.grammar_version !== "1.2") die(`v1.2 declares grammar ${v12.grammar_version}; this transform's grammar reasoning was written against 1.2`);
}
console.log(`gate: v1.0 ${V10_HASH.slice(0, 12)}… · v1.1 ${V11_HASH.slice(0, 12)}… · v1.2 ${V12_HASH.slice(0, 12)}… all frozen · chain intact (${v12.entries.length} entries)`);

// ===========================================================================
// 1 — RECOUNT RUN 3. The measurements are CARRIED from v1.2, so this recount is
// not producing them — it is the gate that proves they were carried intact, and
// it is the artifact every number quoted in the posture and the changelog below
// comes from. The join is the RUN'S OWN requirement list (entry id beside its
// rendered label), never the ORDER of the executable entries.
// ===========================================================================
const RUN_REL = "experiments/v3-2/standard_run3.jsonl";
const runRows = rd(RUN_REL).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Json);

const labelToEntry = new Map<string, string>();
for (const r of runRows) {
  for (const q of ((r.applicability as Json | undefined)?.requirements as Array<Json> | undefined) ?? []) {
    const id = String(q.id), label = String(q.label);
    const prev = labelToEntry.get(label);
    if (prev && prev !== id) die(`label ${JSON.stringify(label)} maps to both ${prev} and ${id}`);
    labelToEntry.set(label, id);
  }
}
const evaluated = runRows.filter((r) => (r.result as Json | undefined)?.ok === true);
const applied = runRows.filter((r) => (r.applicability as Json | undefined)?.state === "APPLIED");
if (applied.length !== evaluated.length) die(`${applied.length} APPLIED records but ${evaluated.length} evaluated — the sample is not what it appears to be`);
const replayMisses = runRows.reduce((n, r) => n + (((r.replayMisses as unknown[] | undefined) ?? []).length), 0);
if (replayMisses !== 0) die(`${replayMisses} replay misses in the run — the bytes evaluated are not the bytes captured`);

interface Counts { asked: number; pass: number; fail: number; access: number }
const counts = new Map<string, Counts>();
for (const r of evaluated) {
  const res = r.result as Json;
  for (const a of [...((res.assertions as Array<Json> | undefined) ?? []), ...((res.deferred as Array<Json> | undefined) ?? [])]) {
    const id = labelToEntry.get(String(a.label));
    if (!id) die(`assertion label ${JSON.stringify(a.label)} is in no record's requirement list`);
    if (!counts.has(id)) counts.set(id, { asked: 0, pass: 0, fail: 0, access: 0 });
    const c = counts.get(id)!;
    c.asked++;
    if (a.status === "pass_evidenced") c.pass++;
    else if (a.status === "requires_store_access") c.access++;
    else c.fail++;
  }
}

// ---- cross-check: the independently-written derivation of the same run --------
const derived = rj<Array<{ id: string; asked: number; pass: number; fail: number; access: number }>>("experiments/v3-2/discrimination.json");
if (derived.length !== counts.size) die(`discrimination.json has ${derived.length} entries; this recount produced ${counts.size}`);
for (const d of derived) {
  const c = counts.get(d.id);
  if (!c) die(`discrimination.json names ${d.id}, which this recount never saw`);
  if (c.asked !== d.asked || c.pass !== d.pass || c.fail !== d.fail || c.access !== d.access) {
    die(`${d.id}: recount ${c.asked}/${c.pass}/${c.fail}/${c.access}, discrimination.json says ${d.asked}/${d.pass}/${d.fail}/${d.access}`);
  }
}

// ---- cross-check: the sidecar the site publishes ------------------------------
interface Fitness { measured_at: string; samples: Array<Json & { name: string }>; entry_discrimination: { entries: Array<{ id: string; asked: number; fail_pct: number }> } }
const fitness = rj<Fitness>("standards/coffee/v1.0/fitness.json");
for (const e of fitness.entry_discrimination.entries) {
  const c = counts.get(e.id);
  if (!c) die(`fitness.json names ${e.id}, which the run never asked`);
  if (c.asked !== e.asked) die(`${e.id}: fitness.json records asked=${e.asked}, the run says ${c.asked}`);
}

// ---- cross-check: EVERY carried measurement still matches its own counts -------
const suffixOf = (id: string): string => id.replace(/^ALS-COFFEE-1\.[0-9]-/, "");
const countsBySuffix = new Map([...counts].map(([id, c]) => [suffixOf(id), c]));
{
  let checked = 0;
  for (const e of v12.entries) {
    const m = e.measured_discrimination as Json | undefined;
    if (!m) continue;
    const c = countsBySuffix.get(suffixOf(e.id));
    if (!c) die(`${e.id} carries a measurement and the run never asked it`);
    const nAdj = c.asked - c.access;
    const v = verdictFor(c.fail, nAdj);
    const iv = wilson95(c.fail, nAdj);
    const pairs: Array<[string, unknown, unknown]> = [
      ["n_asked", m.n_asked, c.asked],
      ["n_adjudicated", m.n_adjudicated, nAdj],
      ["fail_count", m.fail_count, c.fail],
      ["fail_rate_pct", m.fail_rate_pct, r4(v.failRatePct!)],
      ["verdict", m.verdict, v.verdict],
      ["interval_95.lower_pct", (m.interval_95 as Json).lower_pct, r4(iv.lowerPct)],
      ["interval_95.upper_pct", (m.interval_95 as Json).upper_pct, r4(iv.upperPct)],
    ];
    for (const [what, published, recomputed] of pairs) {
      if (published !== recomputed) die(`${e.id}.${what}: v1.2 publishes ${JSON.stringify(published)}, the run gives ${JSON.stringify(recomputed)} — v1.3 may not carry a measurement it cannot reproduce`);
    }
    checked++;
  }
  if (checked !== fitness.entry_discrimination.entries.length) die(`${checked} carried measurements re-derived, ${fitness.entry_discrimination.entries.length} expected — a partial verification is not a verification`);
  console.log(`gate: all ${checked} carried measurements recompute from ${RUN_REL} through the shipped verdictFor · cross-checked against discrimination.json and fitness.json`);
}

// ---- the audit, per entry ------------------------------------------------------
const verdicts = rj<{ rows: Array<{ host: string; label: string; verdict: string; why: string }> }>("experiments/v3-2/verdicts.json");
const fpBySuffix = new Map<string, number>();
for (const row of verdicts.rows) {
  if (row.verdict !== "false_positive") continue;
  const id = labelToEntry.get(row.label);
  if (!id) die(`verdicts.json names label ${JSON.stringify(row.label)}, which is in no requirement list`);
  const s = suffixOf(id);
  fpBySuffix.set(s, (fpBySuffix.get(s) ?? 0) + 1);
}

// ===========================================================================
// 2 — THE ENTRY, AND THE EXACT TEXTS THIS TRANSFORM AMENDS.
//
// Every anchor is asserted present, exactly once, BEFORE anything is written. A
// `.replace()` whose needle has drifted returns the original string and throws
// nothing — a document that looks edited and is not.
// ===========================================================================
const IDENT = "IDENT-001";
const ident12 = v12.entries.find((e) => suffixOf(e.id) === IDENT);
if (!ident12) die(`v1.2 has no ${IDENT} entry`);
if (ident12.tier !== "executable") die(`${IDENT} is \`${ident12.tier}\`; this transform amends an executable entry's evidence rules`);

const identCounts = countsBySuffix.get(IDENT);
if (!identCounts) die(`the run never asked ${IDENT}`);
const IDENT_N_ADJ = identCounts.asked - identCounts.access;
const IDENT_VERDICT = verdictFor(identCounts.fail, IDENT_N_ADJ);
const IDENT_RATE = r4(IDENT_VERDICT.failRatePct!);
const IDENT_PASSES = identCounts.pass;
const IDENT_FP = fpBySuffix.get(IDENT) ?? 0;
if (IDENT_FP === 0) die(`the audit confirms no false pass for ${IDENT}; the whole basis for this reissue is that it does`);
if (IDENT_FP > IDENT_PASSES) die(`${IDENT}: ${IDENT_FP} confirmed false passes over ${IDENT_PASSES} pass rows`);

// ---- the amended strings, each gated -------------------------------------------
const ACC_ANCHOR = "or an MPN that is not a placeholder";
const ACC_NEW_TAIL = "or an MPN that is not a placeholder and is not the seller's own internal object id for this product";

const SKU_IN_GTIN_FORM = "an internal SKU published in the GTIN field";
const SKU_IN_GTIN_WHY = "A seller-private stock code is not a global identifier and cannot match this product to any external catalogue entry.";

const NEW_INSUFFICIENT = {
  form:
    "an identifier that is the seller's own internal object id for this product — the value the storefront also uses as its own product or variant key — published in the MPN field",
  why_not:
    "This is the same rule as the internal-SKU-in-the-GTIN-field clause in this same list, applied to the field where the defect actually occurs. " +
    SKU_IN_GTIN_WHY +
    " That reason is field-agnostic: it is a statement about the VALUE, not about which key carries it. Scoping it to the GTIN field left the MPN branch " +
    "accepting any non-placeholder string, including the integer a storefront mints to key its own product record and then republishes as `mpn` — a value " +
    "that resolves to nothing outside the one store that minted it, which is the precise thing this row's question promises it can do.",
};

const PM_EST_ANCHOR = "that is not a placeholder and, for a GTIN,";
const PM_EST_NEW = "that is not a placeholder, is not the seller's own internal object id for this product, and, for a GTIN,";

const PM_DNE_ADDITION =
  " Nor that the disqualification added at v1.3 was DECIDABLE on this page: the rule is a property of the value — that it is the seller's own key — and it " +
  "can only be read where the storefront itself publishes that key somewhere legible. A seller-private code that appears nowhere else on the page is " +
  "indistinguishable from a real manufacturer part number and is not disqualified. A pass is therefore the absence of a disqualification we could decide, " +
  "never evidence of one we could not.";

const ADV_RES_ANCHOR = "No change was made, because the assertion is deliberately about publication rather than uniqueness and its pass_means already refuses the identity conclusion.";

// ===========================================================================
// 3 — THE TRANSFORM.
// ===========================================================================
const idOf = (id: string): string => id.replace("-1.2-", "-1.3-");
const changedFields: Array<{ field: string; before: unknown; after: unknown }> = [];

const amendIdent = (e: Entry): Json => {
  const next: Json = {};
  for (const [k, val] of Object.entries(e)) {
    if (k === "id") { next.id = idOf(e.id); next.supersedes = e.id; continue; }
    if (k === "supersedes") continue; // rewritten above, in place, so key order is stable

    if (k === "accepted_evidence") {
      const arr = (val as Array<Json>).map((f) => ({ ...f }));
      const branch = arr.filter((f) => String(f.form).includes(ACC_ANCHOR));
      if (branch.length !== 1) die(`accepted_evidence: ${branch.length} forms mention the MPN branch, expected exactly 1`);
      const before = String(branch[0]!.form);
      branch[0]!.form = swap("accepted_evidence[].form", before, ACC_ANCHOR, ACC_NEW_TAIL);
      changedFields.push({ field: "accepted_evidence[0].form", before, after: branch[0]!.form });
      next.accepted_evidence = arr;
      continue;
    }

    if (k === "insufficient_evidence") {
      const arr = (val as Array<Json>).map((f) => ({ ...f }));
      const at = arr.findIndex((f) => f.form === SKU_IN_GTIN_FORM);
      if (at < 0) die(`insufficient_evidence carries no ${JSON.stringify(SKU_IN_GTIN_FORM)} clause — the new clause claims to generalise a rule that is not there`);
      if (String(arr[at]!.why_not) !== SKU_IN_GTIN_WHY) {
        die(`the SKU-in-GTIN clause's why_not has drifted:\n  expected ${JSON.stringify(SKU_IN_GTIN_WHY)}\n  found    ${JSON.stringify(arr[at]!.why_not)}\n` +
          `  The new clause QUOTES that reasoning; quoting a sentence that is no longer there would publish a false attribution.`);
      }
      if (arr.some((f) => String(f.form).includes("MPN field"))) die(`insufficient_evidence already carries an MPN-field clause — this transform would duplicate it`);
      const before = arr.map((f) => f.form);
      arr.splice(at + 1, 0, NEW_INSUFFICIENT);
      changedFields.push({ field: `insufficient_evidence[${at + 1}] (inserted)`, before: `${before.length} clauses`, after: NEW_INSUFFICIENT });
      next.insufficient_evidence = arr;
      continue;
    }

    if (k === "pass_means") {
      const pm = { ...(val as Json) };
      const estBefore = String(pm.establishes), dneBefore = String(pm.does_not_establish);
      pm.establishes = swap("pass_means.establishes", estBefore, PM_EST_ANCHOR, PM_EST_NEW);
      // ⚠️ EVERY EXISTING CLAUSE IS KEPT, VERBATIM AND FIRST. The addition can only
      // narrow. A reissue that tightens what passes and quietly widens what a pass
      // MEANS has made the error it exists to correct, one field over.
      pm.does_not_establish = dneBefore + PM_DNE_ADDITION;
      if (!String(pm.does_not_establish).startsWith(dneBefore)) die(`pass_means.does_not_establish no longer opens with v1.2's clause verbatim`);
      changedFields.push({ field: "pass_means.establishes", before: estBefore, after: pm.establishes });
      changedFields.push({ field: "pass_means.does_not_establish", before: dneBefore, after: pm.does_not_establish });
      next.pass_means = pm;
      continue;
    }

    if (k === "adversarial") {
      const adv = { ...(val as Json) };
      const attackBefore = String(adv.attack), resBefore = String(adv.resolution), riskBefore = String(adv.residual_risk), outcomeBefore = String(adv.outcome);
      if (outcomeBefore !== "survived_unchanged") die(`the recorded attack's outcome is \`${outcomeBefore}\`; the amendment below describes it as \`survived_unchanged\``);
      if (resBefore !== ADV_RES_ANCHOR) die(`the recorded resolution has drifted; the amendment quotes it verbatim and would publish a false quotation`);

      // ⚠️ THE GRAMMAR ALLOWS ONE `adversarial` OBJECT PER ENTRY, NOT A LIST.
      // `$defs/adversarial` is an object with `additionalProperties: false` and a
      // single enumerated `outcome`, so a second attack cannot be a second element —
      // it would be a GRAMMAR change, and this reissue changes no grammar. Both
      // attacks are therefore recorded in the one `attack` field, each labelled with
      // the version that recorded it and its own outcome, and NOTHING IS DELETED:
      // attack 1's text is carried verbatim and its outcome is named in `resolution`.
      adv.attack =
        `ATTACK 1, recorded at v1.0, outcome \`survived_unchanged\` and still standing at v1.3: ${attackBefore} ` +
        `ATTACK 2, recorded at v1.3, outcome \`tightened_accepted_evidence\`: A seller publishes the integer their own storefront uses to key this product ` +
        `record — the same value the page emits as \`product.id\`, \`source_product_id\` or \`rid\` — in the MPN field. It is not a placeholder, so the row ` +
        `passes and reports that a product identifier is published, while the value resolves to nothing outside the one store that minted it.`;
      adv.outcome = "tightened_accepted_evidence";
      adv.resolution =
        `⚠️ TWO ATTACKS, ONE \`outcome\` FIELD. The grammar records a single enumerated outcome per entry, so the value above is ATTACK 2's; ` +
        `ATTACK 1's outcome remains \`survived_unchanged\` and is unchanged by this version. ` +
        `ATTACK 1, at v1.0: "${resBefore}" THAT SENTENCE IS NOW ONLY HALF TRUE, and the half that failed is the half that was doing the work. ` +
        `The first clause still holds: v1.3 does not make this row about uniqueness, and a valid GTIN duplicated across every variant still passes. ` +
        `The second clause — that \`pass_means\` already refused the identity conclusion — was being read as licence for \`accepted_evidence\` to accept ` +
        `any non-placeholder string, and ATTACK 2 is not an attack on uniqueness at all: the value identifies nothing, anywhere, for anyone. Refusing a ` +
        `conclusion in \`pass_means\` does not make the evidence rule above it sound. ` +
        `ATTACK 2, at v1.3: \`accepted_evidence\`'s MPN branch was tightened and \`insufficient_evidence\` gained the matching clause, which is the same rule ` +
        `the standard already applied to an internal stock code published in the GTIN field. \`pass_means.does_not_establish\` KEPT EVERY CLAUSE IT HAD — the ` +
        `row proves less than the question asks, and tightening what passes does not license a bigger promise.`;
      adv.residual_risk =
        `${riskBefore} ` +
        `ATTACK 2 IS NARROWED, NOT CLOSED, and in three separate ways. (1) The disqualification is decidable only where the storefront publishes its own ` +
        `key somewhere legible; a seller-private code that appears nowhere else on the page is indistinguishable from a real manufacturer part number and ` +
        `still passes. The rule FAILS OPEN by construction, because one that fired on "unknown" would fail merchants publishing real part numbers, and that ` +
        `direction is not recoverable. (2) It disqualifies a value for being the seller's own object id, not for being seller-private in general: a stock ` +
        `code that is neither a placeholder nor the storefront's key is outside this clause. (3) NO ENGINE CHANGE SHIPS WITH v1.3. The engine this entry is ` +
        `bound to still accepts any non-placeholder MPN, so at this version the document requires more than the engine checks. That gap is stated in this ` +
        `entry's measurement notes and in the 1.3 changelog rather than left for a reader to find.`;
      changedFields.push({ field: "adversarial.attack", before: attackBefore, after: adv.attack });
      changedFields.push({ field: "adversarial.outcome", before: outcomeBefore, after: adv.outcome });
      changedFields.push({ field: "adversarial.resolution", before: resBefore, after: adv.resolution });
      changedFields.push({ field: "adversarial.residual_risk", before: riskBefore, after: adv.residual_risk });
      next.adversarial = adv;
      continue;
    }

    if (k === "measured_discrimination") {
      const m = { ...(val as Json) };
      const biasBefore = JSON.parse(JSON.stringify(m.instrument_bias ?? [])) as Json[];
      const notesBefore = String(m.notes ?? "");
      if (!Array.isArray(m.instrument_bias)) die(`${IDENT}'s measurement declares no instrument_bias array; the new declaration below assumes one`);

      // ⚠️ DIRECTION MATTERS AND IS NOT A STYLE CHOICE. Tightening accepted evidence
      // can only move rows from pass to FAIL, so the measured rate is at or below the
      // rate the v1.3 requirement would produce — `deflates_fail_rate`. Declaring it
      // as inflating would be both false and self-serving: an inflating bias toward
      // the cleared edge is what `bias_exceeds_margin` blocks a retirement on.
      const newBias: Json = {
        source:
          `THE REQUIREMENT THIS RATE WAS MEASURED AGAINST IS NOT THE REQUIREMENT THIS VERSION STATES. The measurement was taken against the v1.2 wording, ` +
          `whose \`accepted_evidence\` qualified an MPN only as "not a placeholder"; v1.3 additionally disqualifies an MPN that is the seller's own internal ` +
          `object id. Tightening what counts as accepted evidence can only move rows from pass to fail and never the reverse, so the measured fail rate is at ` +
          `or below the rate the v1.3 requirement would produce on the same sample. UNQUANTIFIED, and deliberately NOT netted against the audit bias declared ` +
          `beside it: the two overlap — all ${IDENT_FP} of this entry's confirmed false passes are of this same class — so summing them would double-count, ` +
          `and no artifact in this repo adjudicates each pass row against the v1.3 wording, because that needs an engine that implements it and an adversarial ` +
          `pass, neither of which ships with v1.3.`,
        direction: "deflates_fail_rate",
      };
      m.instrument_bias = [...(m.instrument_bias as Json[]), newBias];

      m.notes =
        `⚠️ MEASURED AGAINST THE v1.2 WORDING, NOT THIS ONE, AND CARRIED RATHER THAN RESTATED. ` +
        `This rate was produced on ${fitness.measured_at} by an engine reading the v1.2 evidence rule, and the verdict \`${String(m.verdict)}\` was reached on ` +
        `that looser reading. Against the requirement as v1.3 states it, ${IDENT_RATE}% is a FLOOR. It is carried rather than deleted because deleting a ` +
        `measurement to avoid having to state its scope is how a document ends up with no measurement at all; it is declared as an instrument bias above. ` +
        `THE GRAMMAR'S RE-MEASUREMENT PATH IS DELIBERATELY NOT USED: \`supersedes\` records a measurement that a REPLACEMENT has displaced, and there is no ` +
        `replacement — no run has been made against the v1.3 wording, and no engine change ships with it. Filing this one as superseded with nothing in its ` +
        `place would delete the only measurement this entry has. ` +
        swap("measured_discrimination.notes", notesBefore, "standards/coffee/issue_v1_2.ts", "standards/coffee/issue_v1_3.ts") +
        ` Every count, rate, interval and verdict above is byte-identical to the record v1.2 published, which this transform re-derives from ${RUN_REL} and ` +
        `asserts rather than assumes.`;

      changedFields.push({ field: "measured_discrimination.instrument_bias", before: `${biasBefore.length} declared`, after: `${(m.instrument_bias as Json[]).length} declared (+1 unquantified, deflates_fail_rate)` });
      changedFields.push({ field: "measured_discrimination.notes", before: notesBefore, after: m.notes });
      next.measured_discrimination = m;
      continue;
    }

    next[k] = val;
  }
  return next;
};

const entries: Json[] = v12.entries.map((e) => {
  if (suffixOf(e.id) === IDENT) return amendIdent(e);
  const next: Json = {};
  for (const [k, val] of Object.entries(e)) {
    if (k === "id") { next.id = idOf(e.id); next.supersedes = e.id; continue; }
    if (k === "supersedes") continue;
    next[k] = val;
  }
  return next;
});

// ===========================================================================
// 4 — THE MECHANICAL PROOF THAT ONLY ONE ENTRY MOVED.
//
// Asserted, never eyeballed. 41 entries must be byte-identical to their v1.2
// selves once `id` and `supersedes` are removed, and IDENT-001's changed key set
// must be EXACTLY the declared one — a key that changed and is not declared is
// indistinguishable from one that was meant to.
// ===========================================================================
const IDENT_DELTA_KEYS = ["accepted_evidence", "adversarial", "insufficient_evidence", "measured_discrimination", "pass_means"];
{
  const strip = (o: Json): string => {
    const c: Json = {};
    for (const [k, v] of Object.entries(o)) { if (k !== "id" && k !== "supersedes") c[k] = v; }
    return JSON.stringify(c);
  };
  const drifted: string[] = [];
  let identSeen = 0;
  for (const [i, old] of v12.entries.entries()) {
    const next = entries[i]!;
    if (String(next.supersedes) !== old.id) die(`entry ${i} supersedes ${String(next.supersedes)}, expected ${old.id}`);
    if (next.id !== idOf(old.id)) die(`entry ${i} is ${String(next.id)}, expected ${idOf(old.id)}`);
    if (suffixOf(old.id) === IDENT) {
      identSeen++;
      const moved = [...new Set([...Object.keys(old), ...Object.keys(next)])]
        .filter((k) => k !== "id" && k !== "supersedes")
        .filter((k) => JSON.stringify(old[k]) !== JSON.stringify(next[k]))
        .sort();
      if (JSON.stringify(moved) !== JSON.stringify(IDENT_DELTA_KEYS)) {
        die(`${IDENT}'s changed key set is [${moved.join(", ")}], declared [${IDENT_DELTA_KEYS.join(", ")}]`);
      }
      // The fields addressed to a PERSON are the half of the seam that was already
      // right. They must not move — widening them is the error this reissue corrects.
      for (const k of ["question", "consumer_note", "merchant_remediation", "assertion", "binding", "registry", "tier", "applicability", "conflict_rules"]) {
        if (JSON.stringify(old[k]) !== JSON.stringify(next[k])) die(`${IDENT}.${k} changed and must not — v1.3 supports the question, it does not rewrite it`);
      }
      if (JSON.stringify((next.registry as Json).resolvable) !== "false") die(`${IDENT}.registry.resolvable is not false — no free register exists and nothing here created one`);
      continue;
    }
    if (strip(old) !== strip(next)) drifted.push(old.id);
  }
  if (identSeen !== 1) die(`${identSeen} entries matched ${IDENT}`);
  if (drifted.length) die(`${drifted.length} entries changed that were declared byte-identical: ${drifted.join(", ")}`);
  console.log(`gate: ${v12.entries.length - 1} entries byte-identical to v1.2 except id/supersedes · ${IDENT} changed in exactly [${IDENT_DELTA_KEYS.join(", ")}]`);
}

// ===========================================================================
// 5 — `category_fitness`: the defect ids are remapped and ONE limit is added.
//
// The bound itself does not move — those rows were already counted as defects. The
// limit exists because a fitness record that goes silent while the requirement it
// measures moves is a record a reader will apply to the wrong requirement.
// ===========================================================================
const catFitness = JSON.parse(JSON.stringify(v12.category_fitness)) as Json;
const IDENT_DEFECTS = (catFitness.defects as Array<Json>).filter((d) => suffixOf(String(d.entry_id)) === IDENT).length;
{
  const defects = catFitness.defects as Array<Json>;
  for (const d of defects) {
    const before = String(d.entry_id);
    d.entry_id = idOf(before);
    if (d.entry_id === before) die(`defect entry_id ${before} did not remap to 1.3`);
  }
  const ids = new Set(entries.map((e) => String(e.id)));
  const dangling = defects.filter((d) => !ids.has(String(d.entry_id))).map((d) => String(d.entry_id));
  if (dangling.length) die(`defects name entries that do not exist at v1.3: ${dangling.join(", ")}`);
  if (IDENT_DEFECTS !== IDENT_FP) die(`the document enumerates ${IDENT_DEFECTS} ${IDENT} defects; the audit confirms ${IDENT_FP}`);

  const total = Number(catFitness.confirmed_false_positives);
  (catFitness.limits as string[]).push(
    `THIS BOUND MEASURES THE ENGINE, AND AT v1.3 THE ENGINE AND THE REQUIREMENT NO LONGER AGREE. ${IDENT_DEFECTS} of these ${total} confirmed false passes ` +
    `are ${IDENT}, and the auditors recorded them as WRONG while the v1.2 document still accepted them: at that version \`accepted_evidence\` qualified an MPN ` +
    `only as "not a placeholder", and a store-local product id or stock code published as \`mpn\` satisfied it. The audit was applying the rule the question ` +
    `implied rather than the rule the evidence block stated, and v1.3 makes the document agree with the audit that produced this bound. The NUMBER does not ` +
    `move — those rows were already counted as defects — but its subject is now narrower than it reads: it bounds the false-pass rate of the ENGINE, which ` +
    `is unchanged at v1.3 and still accepts these values, not conformance to the requirement as v1.3 states it.`,
  );
}

// ===========================================================================
// 6 — POSTURE. Two gated amendments and nothing else. A posture clause that has
// gone false is the defect v1.1 was issued to fix; leaving one standing here
// because "only one entry changed" would be the same mistake with a smaller
// denominator.
// ===========================================================================
const POSTURE = (() => {
  let s = String((v12.posture as Json).statement);
  const TOTAL_FP = Number(catFitness.confirmed_false_positives);
  const MEASURED_COUNT = fitness.entry_discrimination.entries.length;

  // (a) the clause that went false the moment IDENT-001's evidence rule moved.
  s = swap(
    "posture[unchanged-here]", s,
    "the same ten executable entries, unchanged in v1.1 and unchanged here",
    "the same ten executable entries, unchanged in v1.1 and v1.2 and unchanged here in nine of the ten",
  );

  // (b) the new clause, placed before the standing summary rather than appended
  // after it, so the document does not end on a sentence written for an older version.
  s = swap(
    "posture[v1.3-clause]", s,
    "What remains true is the part that matters:",
    `ONE ENTRY CHANGED AT v1.3, AND THE CHANGE IS A NARROWING. ${IDENT} asks whether a shopping assistant can match this exact bag to a catalogue entry, and ` +
    `every field that DECIDED that row permitted a value which identifies the product nowhere outside the store that minted it — its accepted evidence ` +
    `qualified an MPN only as "not a placeholder" — while the question, the consumer note and the remediation advice all promised catalogue matching. ` +
    `${IDENT_DEFECTS} of the ${TOTAL_FP} confirmed false passes in this document are that class, and the audit had already judged them wrong under a rule the ` +
    `document did not yet state. v1.3 states it, in the same words this standard already used to reject an internal stock code published in the GTIN field, ` +
    `and it takes back nothing: \`pass_means.does_not_establish\` keeps every clause it had, the identifier is still not shown to be correct, unique, ` +
    `allocated to this seller or resolvable to any catalogue record anywhere, and \`registry.resolvable\` is still false. THE ENGINE HAS NOT CHANGED WITH IT. ` +
    `The ${IDENT_RATE}% fail rate published for that entry, and the false-pass bound published for all ${MEASURED_COUNT} measured entries, were measured ` +
    `against the v1.2 wording by an engine that still accepts these values; against the requirement as it now reads they are floors, which is stated where ` +
    `each of them is published rather than only here. ` +
    `What remains true is the part that matters:`,
  );
  return s;
})();

// ===========================================================================
// 7 — CHANGELOG. `strengthened`: copy that passed before can now fail, and nothing
// that failed before can now pass — so no `weakening_attestation` is required and
// none is invented.
// ===========================================================================
const RELEASE_DATE = (() => {
  const d = String((v12.changelog[0] as Json).date);
  if (d !== fitness.measured_at) die(`v1.2's release date ${d} and the measurement date ${fitness.measured_at} disagree; v1.3's date would be a guess between them`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) die(`release date ${d} is not a date`);
  return d;
})();

const CHANGE_RATIONALE =
  `Narrowed the accepted evidence for the MPN branch. \`accepted_evidence\` now requires an MPN that is not a placeholder AND is not the seller's own ` +
  `internal object id for this product; \`insufficient_evidence\` gains the matching clause, which reuses the reasoning already in this entry's ` +
  `internal-SKU-in-the-GTIN-field rule — that reason is field-agnostic, and scoping it to one field left the other accepting any non-placeholder string. ` +
  `\`pass_means.establishes\` states the added condition; \`pass_means.does_not_establish\` KEEPS EVERY CLAUSE IT HAD and gains one more, because tightening ` +
  `what passes does not license a bigger promise — this row still does not establish that the identifier is correct, unique, allocated to this seller or ` +
  `resolvable anywhere, and \`registry.resolvable\` is still false. The \`adversarial\` record gains the store-local-id attack with outcome ` +
  `\`tightened_accepted_evidence\`; the v1.0 attack is kept verbatim, its own \`survived_unchanged\` outcome is named, and its residual risk — a valid GTIN ` +
  `duplicated across variants — is still true. \`question\`, \`consumer_note\`, \`merchant_remediation\`, \`assertion\`, \`binding\`, \`applicability\`, ` +
  `\`conflict_rules\` and \`registry\` are byte-identical to v1.2: this version supports the question that was already published rather than rewriting it. ` +
  `THE PRE-CHANGE RATE WAS MEASURED AND IT WAS ${IDENT_RATE}% — ${identCounts.fail} of ${IDENT_N_ADJ} adjudicated rows (${identCounts.asked} asked, ` +
  `Wilson 95% [${r4(wilson95(identCounts.fail, IDENT_N_ADJ).lowerPct)}, ${r4(wilson95(identCounts.fail, IDENT_N_ADJ).upperPct)}], verdict ` +
  `\`${String(IDENT_VERDICT.verdict)}\`), measured on ${fitness.measured_at} over ${RUN_REL}; of the ${IDENT_PASSES} rows that passed, the row-by-row audit ` +
  `confirmed ${IDENT_FP} wrong, every one of them this class. That measurement is CARRIED AND RE-SCOPED, not re-presented: it was taken against the v1.2 ` +
  `wording, tightening can only move rows from pass to fail, and it is therefore a floor for the requirement as v1.3 states it — declared in the entry as an ` +
  `unquantified \`deflates_fail_rate\` instrument bias and stated in its notes. \`supersedes\` is not used because there is no replacement measurement to ` +
  `supersede it with. NO ENGINE CHANGE SHIPS WITH v1.3, by design: the standard defines the requirement and the engine implements it, in that order, so this ` +
  `version knowingly requires more than the engine checks and says so in three places rather than none. \`strengthened\` and not \`weakened\`: copy that ` +
  `passed before can now fail, and nothing that failed before can now pass, so no \`weakening_attestation\` is required.`;

const SUMMARY =
  `A ONE-ENTRY REISSUE. ${v12.entries.length - 1} of the ${v12.entries.length} entries are carried byte-for-byte except \`id\` and \`supersedes\`, which this ` +
  `transform asserts mechanically rather than by inspection; ${IDENT} is the only entry whose text changes, and every prior id resolves here. The grammar ` +
  `stays 1.2 — nothing in the grammar changes, and renaming it for a content change would silently switch off every 1.2 gate in standards/schema.json. ` +
  `WHAT WAS WRONG: ${IDENT} had a seam through the middle of it. The fields that DECIDE — the assertion \`product_identifier_published\`/\`is_present\`, the ` +
  `binding label "A product identifier is published in structured data", and an \`accepted_evidence\` rule that stated a check-digit test for GTIN and exactly ` +
  `one qualifier for MPN, "not a placeholder" — were about PUBLICATION. The fields addressed to a PERSON were about IDENTITY: the question asks whether an ` +
  `assistant can match this bag to a catalogue entry, and the remediation asks for a REAL manufacturer part number. A merchant saw a green row under a ` +
  `question the pass did not answer. Choosing the decider fields would have meant rewriting the question down to "a string is present", so v1.3 resolves it ` +
  `the other way — and the standard already contained the rule: its own \`insufficient_evidence\` rejects an internal SKU published in the GTIN field for a ` +
  `reason that is about the value and not about the field, and that rule is now applied where the defect actually occurs. THE COST IS MEASURED: ${IDENT_FP} ` +
  `of this document's ${Number(catFitness.confirmed_false_positives)} confirmed false passes are this class, and the entry's own pre-change fail rate was ` +
  `${IDENT_RATE}% over ${IDENT_N_ADJ} adjudicated rows. WHAT DID NOT CHANGE, AND DELIBERATELY: \`pass_means.does_not_establish\` keeps every clause, ` +
  `\`registry.resolvable\` is still false, and no engine change ships with this version.`;

// ===========================================================================
// 8 — ASSEMBLE, REHASH, WRITE.
// ===========================================================================
const v13: Json = {
  ...v12,
  grammar_version: "1.2", // unchanged, and stated rather than inherited so it is visible
  version: "1.3",
  status: v12.status, // still `applied_by_author`; no second party has touched it
  title: swap("title", String(v12.title), "v1.2", "v1.3"),
  posture: { independently_applied: false, statement: POSTURE },
  category_fitness: catFitness,
  withdrawn_entries: [],
  entries,
  changelog: [
    { version: "1.3", date: RELEASE_DATE, summary: SUMMARY, changes: [{ entry_id: idOf(ident12.id), change_type: "strengthened", rationale: CHANGE_RATIONALE }] },
    ...(v12.changelog as Json[]),
  ],
};
if (v13.status !== "applied_by_author") die(`status is \`${String(v13.status)}\`; nothing about the second-party bar has changed`);
if ((v13.posture as Json).independently_applied !== false) die(`independently_applied is not false and no second party has run this document`);
if ("measured_fitness" in v13) die(`\`measured_fitness\` is forbidden at grammar 1.2`);

delete (v13 as { standard_hash?: unknown }).standard_hash; // a hash cannot cover itself
const V13_HASH = standardHash(v13);
(v13 as { standard_hash: unknown }).standard_hash = { algorithm: "sha256", canonicalisation: "json-sorted-keys-no-hash-field", value: V13_HASH };
for (const [name, h] of [["v1.0", V10_HASH], ["v1.1", V11_HASH], ["v1.2", V12_HASH]] as const) {
  if (V13_HASH === h) die(`v1.3 hashes identically to ${name} — then it is not a new version`);
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "standard.json"), `${JSON.stringify(v13, null, 2)}\n`);

// ---- the applicability sidecar, remapped ------------------------------------
const sidecar = rj<{ version: string; rules: Array<{ entry: string }> }>("standards/coffee/v1.2/applicability.json");
sidecar.version = "1.3";
sidecar.rules = sidecar.rules.map((r) => ({ ...r, entry: idOf(r.entry) }));
{
  const execIds = new Set(entries.filter((e) => e.tier === "executable").map((e) => String(e.id)));
  const stale = sidecar.rules.filter((r) => !execIds.has(r.entry)).map((r) => r.entry);
  const missing = [...execIds].filter((id) => !sidecar.rules.some((r) => r.entry === id));
  if (stale.length || missing.length) die(`applicability sidecar drifted — stale: ${stale.join(",") || "none"} · missing: ${missing.join(",") || "none"}`);
}
fs.writeFileSync(path.join(OUT, "applicability.json"), `${JSON.stringify(sidecar, null, 2)}\n`);

// ---- vocabulary, copied verbatim ---------------------------------------------
const vocabSrc = path.join(SRC, "vocabulary"), vocabOut = path.join(OUT, "vocabulary");
fs.mkdirSync(vocabOut, { recursive: true });
for (const f of fs.readdirSync(vocabSrc)) fs.copyFileSync(path.join(vocabSrc, f), path.join(vocabOut, f));
for (const f of fs.readdirSync(vocabSrc)) {
  if (fs.readFileSync(path.join(vocabSrc, f), "utf8") !== fs.readFileSync(path.join(vocabOut, f), "utf8")) die(`vocabulary file ${f} did not copy byte-for-byte`);
}

// ===========================================================================
// 9 — REPORT. Every changed field, verbatim, before and after.
// ===========================================================================
const line = (k: string, v: string | number): void => console.log(`${k.padEnd(28)}: ${v}`);
console.log("");
line("v1.0 hash (unchanged)", V10_HASH);
line("v1.1 hash (unchanged)", V11_HASH);
line("v1.2 hash (unchanged)", V12_HASH);
line("v1.3 hash", V13_HASH);
line("grammar", `${v12.grammar_version} -> ${String(v13.grammar_version)} (unchanged, on purpose)`);
line("version", `${v12.version} -> ${String(v13.version)}`);
line("status", String(v13.status));
line("entries", `${entries.length} — 1 amended, ${entries.length - 1} carried, 0 withdrawn`);
line(`${IDENT} pre-change rate`, `${identCounts.fail}/${IDENT_N_ADJ} adjudicated = ${IDENT_RATE}% (${identCounts.asked} asked), verdict ${String(IDENT_VERDICT.verdict)}`);
line(`${IDENT} audited passes`, `${IDENT_PASSES} pass rows, ${IDENT_FP} confirmed wrong`);
line("changelog", `1.3 release with ${((v13.changelog as Json[])[0] as Json & { changes: unknown[] }).changes.length} change (strengthened, no weakening_attestation)`);

console.log(`\n${"=".repeat(78)}\nEVERY FIELD THAT CHANGED — VERBATIM, BEFORE AND AFTER\n${"=".repeat(78)}`);
for (const c of changedFields) {
  console.log(`\n--- ${c.field} ---`);
  console.log(`BEFORE: ${typeof c.before === "string" ? c.before : JSON.stringify(c.before, null, 2)}`);
  console.log(`AFTER : ${typeof c.after === "string" ? c.after : JSON.stringify(c.after, null, 2)}`);
}
console.log(`\n--- posture.statement (2 gated amendments) ---`);
console.log(`BEFORE: ${String((v12.posture as Json).statement)}`);
console.log(`AFTER : ${POSTURE}`);
console.log(`\n--- category_fitness.limits (+1) ---`);
console.log(`AFTER : ${(catFitness.limits as string[]).at(-1)}`);
console.log(`\n--- title ---`);
console.log(`BEFORE: ${v12.title}`);
console.log(`AFTER : ${String(v13.title)}`);

console.log(`\nwrote: standards/coffee/v1.3/{standard.json,applicability.json,vocabulary/} (${fs.readdirSync(vocabOut).length} vocabulary files)`);
console.log(`\nNEXT: npx tsx standards/coffee/verify_v1_3.ts — the transform does not certify itself.`);
