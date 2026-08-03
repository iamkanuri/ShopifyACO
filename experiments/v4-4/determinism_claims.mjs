// v4.4 §1.5 — EVERY PLACE THIS PRODUCT CLAIMS DETERMINISM OR REPEATABILITY.
//
// The list matters because it is the COLLATERAL. While the semantic tier ran on the
// public path, each of these sentences was false about the main surface — a sampled
// model call decided some claim rows, and two runs of the same page could disagree
// (measured: two boots, 5 proven vs 6 proven, on a frozen capture).
//
// ⚠️ AN ABSENCE SWEEP CANNOT SEE THIS AND A PRESENCE SWEEP BARELY CAN. There is no
// banned word: "deterministic" is a word we WANT on the page, and the defect was that it
// was untrue, not that it was present. So this does not pass or fail — it ENUMERATES,
// verbatim with locations, so a human can check each one against the configuration that
// actually ships. Its only mechanical assertion is that it found something: a claims
// sweep that returns zero claims has almost certainly stopped matching.
//
// ⚠️ Walks the tree itself. Ripgrep respects .gitignore and this must not.
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const repo = path.resolve(here, "..", "..");

// Where a reader could meet such a claim. Deliberately narrow: source of truth for
// site copy, the server-rendered pages, and the machine-reader file.
const ROOTS = [
  "viewer/src", "src/server", "standards", "public",
];
const SKIP = new Set(["node_modules", ".git", "dist", "__tests__", "shots"]);

// Phrasings that assert an identical answer on re-execution, in any voice.
const PATTERNS = [
  /\bdeterministic(?:ally)?\b/i,
  /\brepeatabl[ey]\b/i,
  /\brepeat(?:s|ed)? exactly\b/i,
  /\bidentical test\b/i,
  /\bsame (?:test|question|answer|verdict|result)\b/i,
  /\bcannot have moved\b/i,
  /\bnever inferred\b/i,
  /\bsame every time\b/i,
  /\breproducib\w+/i,
];

const files = [];
for (const r of ROOTS) {
  const root = path.join(repo, r);
  if (!fs.existsSync(root)) continue;
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|json|txt|md|html)$/.test(e.name)) files.push(p);
    }
  })(root);
}

const hits = [];
for (const f of files) {
  const rel = path.relative(repo, f).replace(/\\/g, "/");
  const lines = fs.readFileSync(f, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    // Comments state engineering intent, not a claim to a reader. Only shipped strings
    // count — a promise a visitor can read is the thing under audit.
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
    for (const re of PATTERNS) {
      if (re.test(line)) { hits.push({ rel, line: i + 1, text: trimmed.slice(0, 400), pattern: String(re) }); return; }
    }
  });
}

const byFile = new Map();
for (const h of hits) { if (!byFile.has(h.rel)) byFile.set(h.rel, []); byFile.get(h.rel).push(h); }

console.log(`DETERMINISM / REPEATABILITY CLAIMS IN SHIPPED COPY\n${"=".repeat(78)}`);
for (const [rel, rows] of [...byFile].sort()) {
  console.log(`\n${rel}`);
  for (const r of rows) console.log(`  :${String(r.line).padEnd(5)} ${r.text}`);
}

console.log(`\n${"=".repeat(78)}`);
console.log(`files scanned: ${files.length}   claim sites: ${hits.length}   files: ${byFile.size}`);
// Two-sided canary: a sweep returning zero is indistinguishable from a broken matcher.
const reasons = [];
if (!files.length) reasons.push("walker found no files — ROOTS are wrong");
if (!hits.length) reasons.push("ZERO claims matched — the patterns have almost certainly stopped matching, not the copy stopped claiming");
console.log(`completion: ${reasons.length ? "INCOMPLETE" : "VERIFIED_CLEAN"}`);
for (const r of reasons) console.log(`  reason: ${r}`);
