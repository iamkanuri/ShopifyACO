// ===========================================================================
// v3.8 — MECHANICAL A/B ATTRIBUTION.
//
//   node experiments/v3-8/ab_diff.mjs <before.jsonl> <after.jsonl> [--expect-hosts a,b,c]
//
// Compares two probe outputs row by row on (host, label), and reports every
// change in STATUS, DETAIL and QUOTE separately. v3.5 measured two regressions
// that were invisible to a status diff — same `pass_evidenced` on both sides,
// a different rendered sentence — so all three are first-class here.
//
// ⚠️ TWO-SIDED, COMPUTED FROM THE DATA. It fails if the two sides have different
// row sets (a probe that silently ran on fewer stores would otherwise look like
// "no differences"), and it fails if NOTHING changed when a change was expected.
// `--expect-hosts` names the calibration cases a fix MUST flip; if any of them
// did not move, the fix did not do what it claims regardless of how clean the
// rest looks.
// ===========================================================================

import { readFileSync } from "node:fs";

const [beforePath, afterPath, ...rest] = process.argv.slice(2);
if (!beforePath || !afterPath) { console.error("usage: ab_diff.mjs <before.jsonl> <after.jsonl> [--expect-hosts a,b]"); process.exit(2); }
const expectArg = rest.find((a) => a.startsWith("--expect-hosts="));
const expectHosts = expectArg ? expectArg.split("=")[1].split(",").map((s) => s.trim()).filter(Boolean) : [];

/**
 * ⚠️ THE KEY CANNOT BE THE LABEL, and finding that out is why the row-set check
 * exists.
 *
 * A price row's label EMBEDS the cap — `Price under $1005` — and the cap is
 * `niceCap(minPriceUsd)`, so any fix that corrects a price necessarily rewrites
 * the label. Keyed on the raw label, the corrected row looks like a row that
 * VANISHED plus an unrelated row that APPEARED, and the diff reports "0 status
 * changes, 0 detail changes, 0 quote changes" — a perfect score, produced by a
 * fix that worked. The first run of this differ did exactly that on all six
 * calibration hosts.
 *
 * So the key normalises money out of the label, and a label change becomes a
 * FIRST-CLASS change type rather than a row-set mismatch. The row-set check stays,
 * because it still catches a probe that genuinely ran on a different corpus.
 */
const keyOf = (r) => `${r.host}|${String(r.label).replace(/\$\s*[\d,]+(?:\.\d+)?/g, "$<n>")}`;

const load = (p) => {
  const m = new Map();
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    const k = keyOf(r);
    // Duplicate keys would silently overwrite. Key uniquely instead.
    let key = k, n = 1;
    while (m.has(key)) key = `${k}#${n++}`;
    m.set(key, r);
  }
  return m;
};

const A = load(beforePath);
const B = load(afterPath);

const problems = [];
const onlyA = [...A.keys()].filter((k) => !B.has(k));
const onlyB = [...B.keys()].filter((k) => !A.has(k));
if (onlyA.length || onlyB.length) {
  problems.push(`row sets differ: ${onlyA.length} only in BEFORE, ${onlyB.length} only in AFTER. ` +
    `A probe that ran on a different set cannot be diffed — "no differences" would be an artefact.`);
}

const statusChanges = [], detailChanges = [], quoteChanges = [], labelChanges = [];
for (const [k, a] of A) {
  const b = B.get(k);
  if (!b) continue;
  if (a.label !== b.label) labelChanges.push({ k, host: a.host, from: a.label, to: b.label });
  if (a.status !== b.status) statusChanges.push({ k, from: a.status, to: b.status, label: a.label, host: a.host, detailFrom: a.detail, detailTo: b.detail });
  else if (a.detail !== b.detail) detailChanges.push({ k, host: a.host, label: a.label, from: a.detail, to: b.detail });
  if (a.quote !== b.quote) quoteChanges.push({ k, host: a.host, label: a.label, from: a.quote, to: b.quote });
}

// The calibration check: named hosts MUST have moved.
const movedHosts = new Set([...statusChanges, ...detailChanges, ...quoteChanges, ...labelChanges].map((c) => c.host));
const notMoved = expectHosts.filter((h) => !movedHosts.has(h));
if (expectHosts.length && notMoved.length) {
  problems.push(`CALIBRATION FAILURE: ${notMoved.join(", ")} did NOT change. ` +
    `A fix that leaves its own calibration cases untouched has not been demonstrated to do anything, ` +
    `however clean the rest of the diff is.`);
}

const total = statusChanges.length + detailChanges.length + quoteChanges.length + labelChanges.length;
const L = [];
L.push("v3.8 — MECHANICAL A/B");
L.push(`  before : ${beforePath}   (${A.size} rows)`);
L.push(`  after  : ${afterPath}   (${B.size} rows)`);
L.push("");
L.push(`  status changes : ${statusChanges.length}`);
L.push(`  detail changes : ${detailChanges.length}   (status unchanged)`);
L.push(`  quote changes  : ${quoteChanges.length}`);
L.push(`  label changes  : ${labelChanges.length}   (the QUESTION the merchant was asked)`);
L.push("");
if (labelChanges.length) {
  L.push("LABEL CHANGES — the question itself moved");
  for (const c of labelChanges.slice(0, 60)) L.push(`  ${c.host.padEnd(30)} ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}`);
  if (labelChanges.length > 60) L.push(`  ... and ${labelChanges.length - 60} more`);
  L.push("");
}
if (statusChanges.length) {
  L.push("STATUS CHANGES");
  for (const c of statusChanges.slice(0, 80)) {
    L.push(`  ${c.host.padEnd(30)} ${String(c.label).slice(0, 34).padEnd(36)} ${c.from} -> ${c.to}`);
    L.push(`      was: ${JSON.stringify(String(c.detailFrom).slice(0, 110))}`);
    L.push(`      now: ${JSON.stringify(String(c.detailTo).slice(0, 110))}`);
  }
  if (statusChanges.length > 80) L.push(`  ... and ${statusChanges.length - 80} more`);
  L.push("");
}
if (detailChanges.length) {
  L.push("DETAIL CHANGES (status unchanged — invisible to a status diff)");
  for (const c of detailChanges.slice(0, 80)) {
    L.push(`  ${c.host.padEnd(30)} ${String(c.label).slice(0, 34).padEnd(36)}`);
    L.push(`      was: ${JSON.stringify(String(c.from).slice(0, 110))}`);
    L.push(`      now: ${JSON.stringify(String(c.to).slice(0, 110))}`);
  }
  if (detailChanges.length > 80) L.push(`  ... and ${detailChanges.length - 80} more`);
  L.push("");
}
if (quoteChanges.length) {
  L.push("QUOTE CHANGES");
  for (const c of quoteChanges.slice(0, 40)) {
    L.push(`  ${c.host.padEnd(30)} ${String(c.label).slice(0, 34).padEnd(36)}`);
    L.push(`      was: ${JSON.stringify(String(c.from).slice(0, 100))}`);
    L.push(`      now: ${JSON.stringify(String(c.to).slice(0, 100))}`);
  }
  L.push("");
}
L.push("=".repeat(70));
if (problems.length) {
  for (const p of problems) L.push(`PROBLEM: ${p}`);
  L.push("completion: INCOMPLETE");
  console.log(L.join("\n"));
  process.exit(2);
}
L.push(`completion: ${total ? "DEFECTS_FOUND (i.e. changes observed)" : "VERIFIED_CLEAN (no change of any kind)"}`);
L.push(`total changed rows: ${total}`);
if (expectHosts.length) L.push(`calibration hosts all moved: ${expectHosts.join(", ")}`);
console.log(L.join("\n"));
