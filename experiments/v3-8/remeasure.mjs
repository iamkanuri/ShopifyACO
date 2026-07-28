// ===========================================================================
// v3.8 — RE-MEASURE the general sample at the FIXED SHA.
//
//   node experiments/v3-8/remeasure.mjs
//
// Pause 1's binding rule: a matcher fix and the re-measurement of every published
// figure it moves ship in the SAME push, so Pause 2 presents one self-consistent
// unit. And the re-measurement is a NEW block pinned to the fixed SHA — v3.7's
// 7.53% stays frozen beside it, never edited, the same rule as v1.0's fitness.
//
// ⚠️ COFFEE DOES NOT MOVE, and that was verified rather than assumed. Coffee's
// PRICE-001 is `unbound` at v1.2 and v1.3 and NO v1.3 entry binds
// `req_kind: price_under` — the ten bindings are claim x3, variant_option x4,
// delivery, identifiers, attribute. The coffee sample contains zero price rows,
// so neither fix can touch a coffee figure. This script therefore measures the
// GENERAL sample only, and says so rather than implying it covered both.
//
// METHOD. The pass rows are recomputed from the A/B probe output that already
// exists — `ab_before.jsonl` (the shipped engine) and `ab_after_3b.jsonl` (both
// fixes) — restricted to the 172 general-sample hosts. v3.7's 18 adjudicated
// defects are then re-applied ROW BY ROW: a defect survives only if its row is
// still a pass row after the fixes. Nothing is re-adjudicated by arithmetic.
// ===========================================================================

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const OUT = join(HERE, "out");

// The general sample, by PRODUCT URL, from its own snapshot directory.
//
// ⚠️ NOT BY HOST. `deathwishcoffee.com` appears in the general sample AND in a
// coffee set with a different product (P-16 records it, captured at apex and at
// www.). Keyed on host, this recovered 491 general pass rows where v3.7 published
// 488 — three rows of another sample, silently pooled. The only reason it was
// caught is that a published number existed to disagree with, which is the second
// time in this session that a cross-check against a prior figure found a defect
// in a new instrument.
const GEN_DIR = join(REPO, "experiments", "v2-9", "snaps");
const generalUrls = new Set(
  readdirSync(GEN_DIR).filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(GEN_DIR, f), "utf8")).url),
);

const load = (p) => readFileSync(join(OUT, p), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const rawBefore = load("ab_before.jsonl");
if (!rawBefore.some((r) => r.url)) {
  console.error("REFUSING: the probe output carries no `url`. Re-run ab_probe_tpl.ts — filtering by host pools samples.");
  process.exit(2);
}
const before = rawBefore.filter((r) => generalUrls.has(r.url));
const after = load("ab_after_3b.jsonl").filter((r) => generalUrls.has(r.url));
const generalHosts = new Set(before.map((r) => r.host));

const PASSING = new Set(["pass_evidenced"]);
const passBefore = before.filter((r) => PASSING.has(r.status));
const passAfter = after.filter((r) => PASSING.has(r.status));

const v37 = JSON.parse(readFileSync(join(REPO, "experiments", "v3-7", "out", "verified_defects.json"), "utf8"));
// ⚠️ `confirmed` is a COUNT (18), not the list; `results` is the list. Read the
// wrong one and `for…of` throws — which is the good outcome. Written as
// `v37.confirmed ?? []` it would have iterated nothing and reported every defect
// closed, which is the flattering direction and would have looked like a triumph.
const defects = v37.results;
if (!Array.isArray(defects) || defects.length !== v37.confirmed) {
  console.error(`REFUSING: v3.7's defect list is ${Array.isArray(defects) ? defects.length : typeof defects} entries but its own count says ${v37.confirmed}.`);
  process.exit(2);
}

// A defect's row identity: (host, label-with-money-normalised). The label carries
// the cap for price rows and the fixes rewrite it, which is exactly why the raw
// label cannot be the key — the same lesson ab_diff.mjs learned the hard way.
const norm = (label) => String(label).replace(/\$\s*[\d,]+(?:\.\d+)?/g, "$<n>");
const keyOf = (url, label) => `${url}|${norm(label)}`;
const afterByKey = new Map();
for (const r of after) {
  const k = keyOf(r.url, r.label);
  if (!afterByKey.has(k)) afterByKey.set(k, []);
  afterByKey.get(k).push(r);
}

// ⚠️ "STILL A PASS ROW" IS NOT "STILL A FALSE PASS", and conflating them
// OVERSTATED the surviving defects on the first run. `levainbakery.com` and
// `richer-poorer.com` were adjudicated as defects because the rendered price was
// 100x wrong; 3a corrects the number and the row correctly stays a pass. Counting
// them as survivors reported two closed defects as open.
//
// So there are THREE outcomes, not two, and the third is not decided mechanically:
//   closed    — the row is no longer a pass row at all
//   changed   — still a pass, but the RENDERED DETAIL the adjudicator judged has
//               changed, so the evidence is not the evidence they saw. Listed for
//               explicit re-adjudication rather than assumed either way.
//   survived  — still a pass, and the detail is byte-identical
const survived = [], closed = [], changed = [], unmatched = [];
for (const d of defects) {
  const rows = afterByKey.get(keyOf(d.url, d.label));
  if (!rows || !rows.length) { unmatched.push(d); continue; }
  const passRow = rows.find((r) => PASSING.has(r.status));
  if (!passRow) { closed.push({ ...d, nowStatus: rows[0].status, nowDetail: rows[0].detail }); continue; }
  if (passRow.detail !== d.detail) changed.push({ ...d, nowStatus: passRow.status, nowDetail: passRow.detail });
  else survived.push({ ...d, nowStatus: passRow.status, nowDetail: passRow.detail });
}

const problems = [];
if (unmatched.length) {
  problems.push(`${unmatched.length} of v3.7's 18 adjudicated defects could not be matched to a row after the fixes ` +
    `(${unmatched.map((d) => `${d.host}/${d.label}`).join("; ")}). A defect that cannot be located is NOT a defect that was closed.`);
}
// Two-sided canary: the fixes MUST have closed something and MUST have left
// something. A run reporting "all closed" or "none closed" is more likely a
// broken match than a real result.
if (!closed.length && !changed.length) problems.push("0 defects closed — the matcher is almost certainly not matching, given 3a+3b demonstrably changed 44 rows.");
if (!survived.length) problems.push("0 defects survived — implausible: 11 of the 18 are zero-price, availability and aggregation defects that neither fix addresses.");

const state = problems.length ? "INCOMPLETE" : "VERIFIED_CLEAN";
const n = state === "INCOMPLETE" ? null : passAfter.length;
const x = state === "INCOMPLETE" ? null : survived.length;

const out = {
  sample: "general DTC",
  scope_note: "GENERAL ONLY. Coffee's PRICE-001 is `unbound` and no v1.3 entry binds price_under, so the coffee sample holds zero price rows and cannot move.",
  hosts: generalHosts.size,
  stores_with_pass_rows_before: new Set(passBefore.map((r) => r.url)).size,
  stores_with_pass_rows_after: new Set(passAfter.map((r) => r.url)).size,
  pass_rows_before: passBefore.length,
  pass_rows_after: n,
  confirmed_before: defects.length,
  confirmed_after: x,
  closed: closed.map((d) => ({ host: d.host, label: d.label, kind: d.kind, nowStatus: d.nowStatus, nowDetail: d.nowDetail })),
  survived: survived.map((d) => ({ host: d.host, label: d.label, kind: d.kind })),
  unmatched,
  state, problems,
};
writeFileSync(join(OUT, "remeasure.json"), `${JSON.stringify(out, null, 2)}\n`);

const L = [];
L.push("v3.8 — GENERAL SAMPLE RE-MEASURED AT THE FIXED SHA");
L.push(`  hosts                      : ${generalHosts.size}`);
L.push(`  pass rows BEFORE           : ${passBefore.length}   [v3.7 published 488]`);
L.push(`  pass rows AFTER            : ${passAfter.length}`);
L.push(`  confirmed defects BEFORE   : ${defects.length}`);
L.push(`  closed by 3a+3b            : ${closed.length}`);
L.push(`  surviving                  : ${survived.length}`);
L.push(`  unmatched                  : ${unmatched.length}`);
L.push("");
L.push("CLOSED:");
for (const d of closed) L.push(`  ${d.host.padEnd(26)} ${String(d.label).slice(0, 26).padEnd(28)} ${d.kind.padEnd(12)} -> ${d.nowStatus}`);
L.push("");
L.push("STILL A PASS ROW, BUT THE RENDERED EVIDENCE CHANGED — re-adjudicate explicitly:");
for (const d of changed) {
  L.push(`  ${d.host.padEnd(26)} ${String(d.label).slice(0, 26).padEnd(28)} ${d.kind}`);
  L.push(`      v3.7 saw : ${JSON.stringify(String(d.detail).slice(0, 90))}`);
  L.push(`      now      : ${JSON.stringify(String(d.nowDetail).slice(0, 90))}`);
  L.push(`      v3.7 why : ${String(d.why).slice(0, 150)}`);
}
L.push("");
L.push("SURVIVING:");
for (const d of survived) L.push(`  ${d.host.padEnd(26)} ${String(d.label).slice(0, 26).padEnd(28)} ${d.kind}`);
L.push("");
if (problems.length) { L.push("PROBLEMS:"); for (const p of problems) L.push(`  ${p}`); }
L.push(`completion: ${state}`);
L.push(`  n = ${n === null ? "null (INCOMPLETE)" : n},  x = ${x === null ? "null (INCOMPLETE)" : x}`);
L.push("");
L.push("⚠️ The BOUND is deliberately NOT computed here. It comes from");
L.push("   experiments/v3-2/bound.mjs — the instrument every published bound in this");
L.push("   repo actually came out of — run on these counts, so the method is the");
L.push("   published one and only the counts moved.");
console.log(L.join("\n"));
process.exitCode = state === "INCOMPLETE" ? 2 : 0;



