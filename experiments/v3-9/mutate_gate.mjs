// v3.9 CP-2 — MUTATION PROOF for the G-14 standing gate.
//
// A gate that cannot fail is not a gate. Each mutation below must turn the suite RED;
// the unmutated baseline must be GREEN. Both directions, or the proof is vacuous —
// v3.4's `[publish]` group had six mutations all "passing" because the BASELINE was
// already failing for an unrelated reason, so no mutation proved anything.
//
// Script file, not shell quoting: every layer of `node -e` / PowerShell quoting eats a
// backslash, and this repo has a 0x08-backspace incident on record from exactly that.
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const SRC = "standards/__tests__/g14.table.test.ts";
const TMP = "standards/__tests__/g14.mutant.test.ts";
const base = readFileSync(SRC, "utf8");

const MUTATIONS = [
  ["one cell moved by one (15 -> 14)",
    "organic: { letter_not_spirit: [15, 15]", "organic: { letter_not_spirit: [14, 15]"],
  ["a class total moved (181 -> 180)",
    "adjacent_vocabulary: [181, 332],", "adjacent_vocabulary: [180, 332],"],
  ["the adjudicated denominator desynced from the raw one",
    "  tense_modality: [439, 621],", "  tense_modality: [439, 620],"],
  ["a not-applicable cell claimed as attacked",
    "orthography: [22, 25], violation: null", "orthography: [22, 25], violation: [0, 8]"],
  ["the hostile total moved",
    "const EXPECTED_HOSTILE_TOTAL = 3732;", "const EXPECTED_HOSTILE_TOTAL = 3731;"],
  ["the control total moved",
    "const EXPECTED_CONTROL_TOTAL = 181;", "const EXPECTED_CONTROL_TOTAL = 180;"],
  // ⚠️ ANCHOR UPDATED at v3.9's re-examination (1137 -> 1282). The drift was caught by this
  // harness's own "did not APPLY" check rather than by reading — a mutation whose anchor no
  // longer matches proves nothing and must never be counted as killed.
  ["the confirmed-false-pass sum moved",
    "]) => n + fp, 0), 1282,", "]) => n + fp, 0), 1281,"],
];

function run(file) {
  try {
    const out = execFileSync("node", ["--import", "tsx", "--test", file],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return parse(out);
  } catch (e) {
    return parse(`${e.stdout ?? ""}${e.stderr ?? ""}`);
  }
}
function parse(out) {
  const pass = Number((out.match(/^# pass (\d+)/m) ?? [])[1] ?? -1);
  const fail = Number((out.match(/^# fail (\d+)/m) ?? [])[1] ?? -1);
  return { pass, fail, decisive: pass >= 0 && fail >= 0 };
}

// ---- anti-vacuity anchor FIRST: the unmutated file must be green ----
const baseline = run(SRC);
console.log(`BASELINE (unmutated): pass=${baseline.pass} fail=${baseline.fail}`);
if (!baseline.decisive) { console.error("INCOMPLETE — could not parse the baseline run"); process.exit(2); }
if (baseline.fail !== 0 || baseline.pass < 7) {
  console.error("REFUSING: the baseline is not green, so no mutation below would prove anything.");
  process.exit(2);
}

const rows = [];
for (const [name, from, to] of MUTATIONS) {
  if (!base.includes(from)) { rows.push({ name, applied: false, pass: null, fail: null, kills: false }); continue; }
  writeFileSync(TMP, base.replace(from, to));
  const r = run(TMP);
  rows.push({ name, applied: true, pass: r.pass, fail: r.fail, kills: r.decisive && r.fail > 0 });
}
if (existsSync(TMP)) unlinkSync(TMP);

console.table(rows);
const notApplied = rows.filter((r) => !r.applied);
const survivors = rows.filter((r) => r.applied && !r.kills);
const state = notApplied.length ? "INCOMPLETE" : survivors.length ? "DEFECTS_FOUND" : "VERIFIED_CLEAN";
console.log("mutations that did not APPLY (anchor drifted):", notApplied.map((r) => r.name));
console.log("mutations the gate FAILED to kill:", survivors.map((r) => r.name));
console.log("completion:", state);
writeFileSync("experiments/v3-9/out/mutate_gate.json",
  JSON.stringify({ baseline, rows, state }, null, 2));
if (state !== "VERIFIED_CLEAN") process.exit(1);
