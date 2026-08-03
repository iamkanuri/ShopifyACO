// ⚠️ THE HERO ARTIFACT'S COUNTS MOVED BETWEEN TWO PAGE LOADS: 5 proven / 5 not proven on
// one boot, 6 proven / 4 not proven on the next, from the same commit and the same frozen
// capture. A landing page whose headline result varies per boot is worse than no landing
// page, so this measures it rather than reasoning about it.
//
//   node experiments/v4-3/probe_determinism.mjs
//
// Fetches / N times from the running dev server, in-process boots excluded — the SSR
// snapshot is rendered per request, so a within-boot variation would show here too.
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:8787";
const N = Number(process.env.N ?? 6);

const seen = new Map();
const rowsSeen = new Map();
for (let i = 0; i < N; i++) {
  const html = await fetch(BASE + "/").then((r) => r.text());
  const m = /<script type="application\/json" id="al-hero-artifact">([\s\S]*?)<\/script>/.exec(html);
  if (!m) { console.log(`run ${i}: NO ARTIFACT BLOCK`); continue; }
  const a = JSON.parse(m[1].replace(/\\u003c/g, "<").replace(/\\u003e/g, ">"));
  const key = `${a.counts.pass}/${a.counts.notProven}/${a.counts.requiresAccess}`;
  seen.set(key, (seen.get(key) ?? 0) + 1);
  const sig = a.rows.map((r) => `${r.entryId}=${r.status}`).join(",");
  rowsSeen.set(sig, (rowsSeen.get(sig) ?? 0) + 1);
  console.log(`run ${i}: ${key}`);
}

console.log("\n" + "=".repeat(72));
console.log("distinct count signatures:");
for (const [k, n] of seen) console.log(`  ${k}  ×${n}`);
console.log("distinct row signatures:", rowsSeen.size);
if (rowsSeen.size > 1) {
  const sigs = [...rowsSeen.keys()].map((s) => s.split(","));
  const base = sigs[0];
  for (let i = 0; i < base.length; i++) {
    const vals = new Set(sigs.map((s) => s[i]));
    if (vals.size > 1) console.log(`  ⚠️ ROW VARIES: ${[...vals].join("  vs  ")}`);
  }
}
const stable = seen.size === 1 && rowsSeen.size === 1;
console.log(`\ncompletion: ${stable ? "VERIFIED_CLEAN (stable across " + N + " requests)" : "DEFECTS_FOUND"}`);
process.exit(stable ? 0 : 1);
