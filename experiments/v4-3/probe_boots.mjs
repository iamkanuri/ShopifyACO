// Across-BOOT determinism of runDemo(). The dev server caches the run, so a per-request
// probe cannot see this; each iteration below is a fresh node process.
//
// This matters beyond the landing page: /demo serves the same run, and if it varies then
// the site's own proof surface has been telling different stories to different visitors.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const SCRIPT = "experiments/v4-3/_one_boot.ts";
writeFileSync(SCRIPT, `import { runDemo } from "../../src/server/buyerTestDemo.js";
const d = await runDemo();
console.log(JSON.stringify({ c: d.counts, r: d.rows.map((x) => [x.entryId, x.status]) }));
`);

const N = Number(process.env.N ?? 5);
const sigs = new Map();
let notRun = 0;
for (let i = 0; i < N; i++) {
  let out = "";
  try {
    // ⚠️ `shell: true` IS LOAD-BEARING ON WINDOWS. `npx` is `npx.cmd`, and execFileSync
    // without a shell cannot resolve it — every boot returned empty and the harness
    // reported DEFECTS_FOUND across 5 boots, which is a broken instrument wearing the
    // costume of a finding. The `NO OUTPUT` branch below now resolves INCOMPLETE instead,
    // because a probe that did not run must never be summed as a result.
    out = execFileSync("npx", ["tsx", SCRIPT], {
      encoding: "utf8", timeout: 300_000, stdio: ["ignore", "pipe", "pipe"], shell: true,
    });
  } catch (e) { out = String(e.stdout ?? ""); }
  const line = out.trim().split("\n").filter((l) => l.startsWith("{")).pop();
  if (!line) { console.log(`boot ${i}: NO OUTPUT`); notRun++; continue; }
  const j = JSON.parse(line);
  const key = `${j.c.pass}/${j.c.notProven}/${j.c.requiresAccess}`;
  console.log(`boot ${i}: ${key}`);
  const sig = j.r.map(([id, s]) => `${id}=${s}`).join("\n  ");
  sigs.set(sig, (sigs.get(sig) ?? 0) + 1);
}

console.log("\n" + "=".repeat(72));
console.log(`distinct row signatures across ${N} boots: ${sigs.size}`);
if (sigs.size > 1) {
  const all = [...sigs.keys()].map((s) => s.split("\n  "));
  for (let i = 0; i < all[0].length; i++) {
    const vals = new Set(all.map((a) => a[i]));
    if (vals.size > 1) console.log(`  ⚠️ VARIES: ${[...vals].join("   vs   ")}`);
  }
}
// A boot that did not run is INCOMPLETE, never a lower variation count. Zero is the most
// dangerous number a broken instrument returns, because it is also what a healthy one
// returns — this harness printed exactly that on its first run.
const state = notRun ? "INCOMPLETE" : sigs.size === 1 ? "VERIFIED_CLEAN" : "DEFECTS_FOUND";
console.log(`boots that ran: ${N - notRun}/${N}`);
console.log(`completion: ${state}`);
process.exit(state === "VERIFIED_CLEAN" ? 0 : 1);
