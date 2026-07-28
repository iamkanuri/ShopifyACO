// v3.9 — rider (a): wrong_subject reversals flow into v4.0's target set.
//
// ⚠️ THEY DO NOT FLOW INTO SUITE 2.0's CASES, AND THE REASON IS THE SUITE'S IDENTITY.
// 2.0's stated contract is "every case is a sentence a real merchant wrote", asserted by a
// test that requires a host, a URL and an adjudication unit on every case. The 17 reinstated
// groups are GENERATED attack sentences from the templatizer. Adding them would make that
// assertion false and turn 2.0 into what 1.0 already is.
//
// So they are recorded as a NAMED TARGET SET beside the suite: a v4.0 guard must close them,
// and the instrument that measures whether it did is the G-14 standing gate, whose
// `wrong_subject` cell now reads 441/914. Two targets, two instruments, neither pretending
// to be the other.
import fs from "node:fs";

const rx = JSON.parse(fs.readFileSync("experiments/v3-9/out/v38_reexam.json", "utf8"));
const corr = JSON.parse(fs.readFileSync("experiments/v3-9/out/v38_correct.json", "utf8"));

const ws = rx.realRows.filter((r) => r.reinstated && r.attackClass === "wrong_subject");
const trailOf = new Map(corr.trail.map((t) => [t.groupId, t]));

const groups = ws.map((r) => {
  const t = trailOf.get(r.groupId);
  return {
    groupId: r.groupId,
    subclass: r.groupId.split("|")[1],
    claimKey: r.claimKey,
    sentences: t?.sentences ?? null,
    false_passes_reinstated: t?.delta ?? null,
    confidence: r.confidence,
  };
}).sort((a, b) => (b.false_passes_reinstated ?? 0) - (a.false_passes_reinstated ?? 0));

const bySubclass = groups.reduce((o, g) => ((o[g.subclass] = (o[g.subclass] || 0) + 1), o), {});

const P = "standards/acceptance/subject-tense/suite2.json";
const suite = JSON.parse(fs.readFileSync(P, "utf8"));
suite.v4_capability_target = {
  what:
    "GENERATED attack groups a v4.0 referent guard must close, recovered by re-examining " +
    "v3.8's refutations under P-21. These are NOT suite cases and are deliberately not added " +
    "as such: every case in this suite is a sentence a real merchant wrote, asserted by a " +
    "test, and these are templatizer output. They are a second target with a second " +
    "instrument.",
  instrument:
    "the G-14 standing gate (`standards/__tests__/g14.table.test.ts`). Its `wrong_subject` " +
    "adjudicated cell reads 441/914 after this correction, up from 368/914; a guard that " +
    "closes these moves that cell and the gate reports it by name.",
  provenance:
    "blind re-examination of all 55 of v3.8's refutedAway groups, 6 gold cases seeded one " +
    "per batch, gold accuracy 6/6, 42 of 55 overturned. Per-group trail in " +
    "experiments/v3-9/out/v38_correct.json.",
  groups_reinstated: groups.length,
  false_passes_reinstated: groups.reduce((n, g) => n + (g.false_passes_reinstated ?? 0), 0),
  by_subclass: bySubclass,
  groups,
};
fs.writeFileSync(P, `${JSON.stringify(suite, null, 2)}\n`);

console.log(JSON.stringify({
  wrong_subject_groups_reinstated: groups.length,
  false_passes_reinstated: suite.v4_capability_target.false_passes_reinstated,
  by_subclass: bySubclass,
  suite_cases_unchanged: suite.cases.length,
}, null, 2));
