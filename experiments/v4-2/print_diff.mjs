// CP-2 — THE TWO-SIDED PRINT PROOF: BEFORE vs AFTER, over the SAME items.
//
// "A green print run must demonstrate the fix, not the printer." A raw count of evidence
// items present in the AFTER PDF cannot do that: on /demo, 25 of the 45 items inside
// collapsed sections ALSO occur elsewhere on the page (they are quoted in the evidence
// sentences), so they print with or without the fix. Only the items that FLIP are the
// fix's signature.
//
// The two sides:
//   • the fix must flip a non-zero number of items from absent to present, and
//   • it must flip NOTHING the other way, and no control may move.
// A run where nothing flips in either direction is INCOMPLETE, not clean — that is the
// shape of a fix that was never applied, which is indistinguishable from a fix that was
// applied to a page with nothing to reveal.
import { readFileSync } from "node:fs";

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  console.error("usage: print_diff.mjs before.json after.json");
  process.exit(2);
}

const load = (p) => JSON.parse(readFileSync(p, "utf8"));
const before = load(beforePath), after = load(afterPath);

const fail = (why) => {
  console.log(JSON.stringify({ completion: "INCOMPLETE", blocked_on: why }, null, 2));
  process.exit(1);
};

for (const [name, r] of [["before", before], ["after", after]]) {
  if (!r.media_canary_ok) fail(`${name}: print media never engaged`);
  if (!r.extractor_canary?.extractor_live) fail(`${name}: PDF extractor failed its controls`);
  if (!r.instruments_agree) fail(`${name}: DOM and PDF disagree`);
}
if (before.url !== after.url) fail(`different URLs: ${before.url} vs ${after.url}`);

const index = (r) => {
  const m = new Map();
  for (const row of r.rows) for (const it of row.items) m.set(`${row.i}::${it.text}`, it);
  return m;
};
const B = index(before), A = index(after);

const common = [...B.keys()].filter((k) => A.has(k));
if (!common.length) fail("no items in common — the two runs did not measure the same page");

const gained = common.filter((k) => !B.get(k).in_pdf && A.get(k).in_pdf);
const lost = common.filter((k) => B.get(k).in_pdf && !A.get(k).in_pdf);
const onlyInOne = [...B.keys()].filter((k) => !A.has(k)).concat([...A.keys()].filter((k) => !B.has(k)));

const out = {
  url: before.url,
  items_compared: common.length,
  items_gained_in_print: gained.length,
  items_LOST_in_print: lost.length,
  items_not_in_both_runs: onlyInOne.length,
  summaries_still_present: after.rows.every((r) => r.summary_in_pdf !== false),
  gained_sample: gained.slice(0, 8).map((k) => k.split("::")[1]),
  lost_sample: lost.slice(0, 8).map((k) => k.split("::")[1]),
  pdf_bytes_before: before.pdf_bytes,
  pdf_bytes_after: after.pdf_bytes,
};

if (lost.length) {
  out.completion = "DEFECTS_FOUND";
  out.blocked_on = "the change REMOVED content from the printed artifact";
} else if (!gained.length) {
  out.completion = "INCOMPLETE";
  out.blocked_on =
    "nothing flipped. Either the fix did not apply (stale CSS build? wrong server?) or the " +
    "page had nothing collapsed. A no-op is not a pass.";
} else if (!out.summaries_still_present) {
  out.completion = "DEFECTS_FOUND";
  out.blocked_on = "a <details> summary stopped printing";
} else {
  out.completion = "VERIFIED_CLEAN";
}

console.log(JSON.stringify(out, null, 2));
if (out.completion !== "VERIFIED_CLEAN") process.exitCode = 1;
