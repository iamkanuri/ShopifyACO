// v3.9 — mutation proof for suite 2.0's guards. Each mutation must turn the suite RED;
// the unmutated baseline must be GREEN. Both directions, or the proof is vacuous.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const P = "standards/acceptance/subject-tense/suite2.json";
const T = "standards/__tests__/acceptance.test.ts";
const base = readFileSync(P, "utf8");

function run() {
  try {
    const out = execFileSync("node", ["--import", "tsx", "--test", T], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return parse(out);
  } catch (e) { return parse(`${e.stdout ?? ""}${e.stderr ?? ""}`); }
}
const parse = (o) => ({
  pass: Number((o.match(/^# pass (\d+)/m) ?? [])[1] ?? -1),
  fail: Number((o.match(/^# fail (\d+)/m) ?? [])[1] ?? -1),
});

const baseline = run();
console.log(`BASELINE: pass=${baseline.pass} fail=${baseline.fail}`);
if (baseline.fail !== 0 || baseline.pass < 21) {
  console.error("REFUSING: baseline is not green, so no mutation below proves anything.");
  process.exit(2);
}

const MUTATIONS = [
  ["a carried term the engine does not have", (s) => {
    s.terms_by_claim_key.organic.support.push("biodynamic-certified");
    return s;
  }],
  ["an engine term the suite drops", (s) => {
    s.terms_by_claim_key.organic.support = s.terms_by_claim_key.organic.support.filter((t) => t !== "usda organic");
    return s;
  }],
  ["a case with no claim_key", (s) => { delete s.cases[0].claim_key; return s; }],
  ["a case with no provenance host", (s) => { delete s.cases[0].provenance.host; return s; }],
  ["a descope citation removed", (s) => { delete s.descoped.tense_modality; return s; }],
  ["a descope with no precedent", (s) => { s.descoped.letter_not_spirit.precedent = "n/a"; return s; }],
  ["the recorded baseline no longer matches", (s) => { s.baseline_at_creation.must_not_regress_met = "16/17"; return s; }],
  ["the baseline names no commit", (s) => { s.baseline_at_creation.measured_at_commit = null; return s; }],
  ["a carrier axis removed, so collateral coverage is incomplete", (s) => {
    for (const c of s.cases) if (c.provenance?.carrier_axes) {
      c.provenance.carrier_axes = c.provenance.carrier_axes.filter((a) => a !== "tense_modality");
    }
    return s;
  }],
];

const rows = [];
for (const [name, mutate] of MUTATIONS) {
  const s = mutate(JSON.parse(base));
  writeFileSync(P, `${JSON.stringify(s, null, 2)}\n`);
  const r = run();
  rows.push({ name, pass: r.pass, fail: r.fail, kills: r.fail > 0 });
}
writeFileSync(P, base);

const after = run();
console.table(rows);
const survivors = rows.filter((r) => !r.kills);
console.log(`restored baseline: pass=${after.pass} fail=${after.fail}`);
console.log("mutations the suite FAILED to kill:", survivors.map((r) => r.name));
const state = after.fail !== 0 ? "INCOMPLETE — restore failed"
  : survivors.length ? "DEFECTS_FOUND" : "VERIFIED_CLEAN";
console.log("completion:", state);
if (state !== "VERIFIED_CLEAN") process.exit(1);
