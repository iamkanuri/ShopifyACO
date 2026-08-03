// adv2 — WHAT THE PUBLISHED GENERAL-SAMPLE FIGURE BECOMES ONCE THIS COMMIT'S CLOSURES ARE
// APPLIED, and whether the standards site's ratio refusal still fires.
//
// ⚠️ ANCHOR FIRST. The formula below must reproduce the two figures already published in
// standards/coffee/v1.3/fitness.json to 0.01pp. If it does not, nothing under it is
// readable — this is arithmetic about a number the site publishes, so it does not get to
// be approximately right.
const wilson = (x, n, z = 1.96) => {
  const d = n + z * z;
  const c = (x + (z * z) / 2) / d;
  const m = (z / d) * Math.sqrt((x * (n - x)) / n + (z * z) / 4);
  return { lower_pct: (c - m) * 100, upper_pct: (c + m) * 100, point_pct: (x / n) * 100 };
};
const r2 = (v) => Number(v.toFixed(2));
const show = (t, x, n) => { const w = wilson(x, n); console.log(`${t.padEnd(34)} x=${String(x).padEnd(3)} n=${String(n).padEnd(4)} point=${r2(w.point_pct)}%  95% [${r2(w.lower_pct)}, ${r2(w.upper_pct)}]`); return w; };

console.log("--- ANCHOR: reproduce the PUBLISHED figures ---");
const pubGen = show("general (published 11/483)", 11, 483);
const pubCof = show("coffee  (published  7/160)", 7, 160);
const okGen = r2(pubGen.point_pct) === 2.28 && r2(pubGen.lower_pct) === 1.28 && r2(pubGen.upper_pct) === 4.03;
const okCof = r2(pubCof.point_pct) === 4.38 && r2(pubCof.lower_pct) === 2.14 && r2(pubCof.upper_pct) === 8.75;
console.log(`ANCHOR general matches fitness.json {2.28, 1.28, 4.03}: ${okGen}`);
console.log(`ANCHOR coffee  matches fitness.json {4.38, 2.14, 8.75}: ${okCof}`);
if (!okGen || !okCof) { console.log("INCOMPLETE — the formula does not reproduce the published values; stop here."); process.exit(0); }

console.log("\n--- AFTER v4.5 A2: 6 of the 11 confirmed general defects are closed, and those 6 pass rows no longer exist ---");
const newGen = show("general (5/477)", 5, 477);
console.log("\nintervals:");
console.log(`  coffee  [${r2(pubCof.lower_pct)}, ${r2(pubCof.upper_pct)}]`);
console.log(`  general [${r2(newGen.lower_pct)}, ${r2(newGen.upper_pct)}]`);
const overlap = newGen.upper_pct >= pubCof.lower_pct && pubCof.upper_pct >= newGen.lower_pct;
console.log(`  intervals still OVERLAP (so renderComparison still refuses a ratio): ${overlap}` +
  (overlap ? `  — margin ${r2(newGen.upper_pct - pubCof.lower_pct)}pp` : "  — THE RATIO REFUSAL WOULD STOP FIRING"));
console.log("\n  two-sided check on the overlap test itself:");
const a = wilson(0, 500), b = wilson(50, 100);
console.log(`   disjoint pair 0/500 vs 50/100 reports overlap = ${a.upper_pct >= b.lower_pct && b.upper_pct >= a.lower_pct} (want false)`);
console.log(`   identical pair 7/160 vs 7/160 reports overlap = ${pubCof.upper_pct >= pubCof.lower_pct} (want true)`);
