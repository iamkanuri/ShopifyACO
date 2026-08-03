// v4.4 §1.3 — WHICH HARNESSES DECIDE THE TIER IS OFF, AND WHICH ARE MERELY INERT?
//
// A harness that sets `PRODUCT_TEST_SEMANTIC=0` has made a DECISION and is safe on any
// machine. A harness that never sets it is off only by accident — because CI has no
// OpenAI key — and a developer machine WITH a key silently reverses that, turning a
// deterministic $0 replay into a sampled run that spends money. Those two states look
// identical in a green log, which is why they have to be separated mechanically.
//
// ⚠️ Ripgrep respects .gitignore and `experiments/` is ignored here, so this walks the
// tree itself (the v2-4 rule). A sweep that must be exhaustive cannot use the grep tools.
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const repo = path.resolve(here, "..", "..");

const SKIP = new Set(["node_modules", ".git", "dist", "shots", ".next", "coverage"]);
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|mts|mjs|js)$/.test(e.name)) files.push(p);
  }
})(repo);

// An ENTRYPOINT is a file that drives the engine itself. Library modules under src/ and
// standards/ are excluded: they are called BY an entrypoint and must not pin the variable.
const ENGINE_CALL = /\b(runProductTest|runStandardTest|runDemo)\s*\(/;
const SETS_OFF = /process\.env\.PRODUCT_TEST_SEMANTIC\s*=\s*["']0["']/;
const PINS_DEPS = /semantic\s*:\s*\{\s*disabled\s*:\s*true/;

const decided = [], inert = [], production = [];
for (const f of files) {
  const rel = path.relative(repo, f).replace(/\\/g, "/");
  const src = fs.readFileSync(f, "utf8");
  if (!ENGINE_CALL.test(src)) continue;
  const row = { rel, setsOff: SETS_OFF.test(src), pinsDeps: PINS_DEPS.test(src) };
  if (rel.startsWith("src/") || rel.startsWith("viewer/")) production.push(row);
  else if (row.setsOff || row.pinsDeps) decided.push(row);
  else inert.push(row);
}

const show = (title, rows) => {
  console.log(`\n${title}  (${rows.length})`);
  for (const r of rows.sort((a, b) => a.rel.localeCompare(b.rel))) {
    const how = r.setsOff ? "env=0" : r.pinsDeps ? "deps.disabled" : "—";
    console.log(`  ${how.padEnd(14)} ${r.rel}`);
  }
};
show("DECIDED — pins the tier off explicitly, safe with a key present", decided);
show("INERT — off ONLY because this machine has no key; a key reverses it silently", inert);
show("PRODUCTION / library — must NOT pin; the deployed value is the answer", production);

// Two-sided canary: the classifier is worthless unless it is shown to separate. If
// either bucket is empty the pattern may simply not be matching anything.
console.log(`\ncanary: decided=${decided.length} inert=${inert.length} — both non-empty required for the split to mean anything`);
const reasons = [];
if (!decided.length) reasons.push("no harness matched as DECIDED — the SETS_OFF pattern may be wrong");
if (!files.length) reasons.push("walker found no files");
console.log(`\ncompletion: ${reasons.length ? "INCOMPLETE" : (inert.length ? "DEFECTS_FOUND" : "VERIFIED_CLEAN")}`);
for (const r of reasons) console.log(`  reason: ${r}`);
console.log(`files walked: ${files.length}`);
