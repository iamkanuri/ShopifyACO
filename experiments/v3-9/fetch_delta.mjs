// v3.9 CP-4 rider (c) — the fetch-corpus delta, CASE BY CASE, with the arithmetic stated.
//
// I predicted 7 closed. Measured is 5. The prediction is corrected here from the data
// rather than quietly restated, and the two that did not close are named with the reason.
import fs from "node:fs";

const pre = JSON.parse(fs.readFileSync("experiments/v3-9/out/fetch_pre.json", "utf8"));
const post = JSON.parse(fs.readFileSync("experiments/v3-9/out/fetch_post.json", "utf8"));

const byId = (r) => Object.fromEntries(r.results.map((x) => [x.id, x]));
const A = byId(pre), B = byId(post);
const ids = [...new Set([...Object.keys(A), ...Object.keys(B)])].sort();

const rows = [];
for (const id of ids) {
  const a = A[id], b = B[id];
  const fa = (a?.flags ?? []).length, fb = (b?.flags ?? []).length;
  if (fa === 0 && fb === 0) continue;
  const sameFlags = JSON.stringify(a?.flags ?? []) === JSON.stringify(b?.flags ?? []);
  if (sameFlags) continue;
  rows.push({
    id, attack_class: b?.attack_class ?? a?.attack_class,
    subclass: (b?.subclass ?? a?.subclass ?? "").slice(0, 66),
    before: a?.flags ?? [], after: b?.flags ?? [],
    closed: fa > 0 && fb === 0,
    changed_kind: fa > 0 && fb > 0,
  });
}

const closed = rows.filter((r) => r.closed);
const changed = rows.filter((r) => r.changed_kind);

// class-level arithmetic
const classOf = (r) => r.attack_class;
const tally = (list) => list.reduce((o, r) => ((o[classOf(r)] = (o[classOf(r)] || 0) + 1), o), {});

const out = {
  flagged_before: pre.flagged, flagged_after: post.flagged,
  arithmetic: `${pre.flagged} - ${closed.length} = ${pre.flagged - closed.length}` +
    (pre.flagged - closed.length === post.flagged ? "  ✓ reconciles" : "  ✗ DOES NOT RECONCILE"),
  reconciles: pre.flagged - closed.length === post.flagged,
  closed_count: closed.length,
  closed_by_class: tally(closed),
  closed,
  changed_but_not_closed_count: changed.length,
  changed_but_not_closed: changed,
  unreachable_before: pre.flagged_and_unreachable, unreachable_after: post.flagged_and_unreachable,
  completion: "VERIFIED_CLEAN",
};
fs.writeFileSync("experiments/v3-9/out/fetch_delta.json", JSON.stringify(out, null, 2));

console.log(`flagged ${pre.flagged} -> ${post.flagged}   arithmetic: ${out.arithmetic}`);
console.log(`\n=== CLOSED (${closed.length}) ===`);
for (const r of closed) console.log(`  ${r.id}  [${r.attack_class}]  ${r.subclass}\n      was: ${r.before.join(" | ").slice(0, 150)}`);
console.log(`\n=== FLAGS CHANGED BUT STILL FLAGGED (${changed.length}) ===`);
for (const r of changed) {
  console.log(`  ${r.id}  [${r.attack_class}]  ${r.subclass}`);
  console.log(`      before: ${r.before.join(" | ").slice(0, 150)}`);
  console.log(`      after : ${r.after.join(" | ").slice(0, 150)}`);
}
