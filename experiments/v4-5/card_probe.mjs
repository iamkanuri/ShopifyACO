// v4.5 A3 — DID THE CARD DIFFERENTIATION ACTUALLY RENDER?
//
//   node experiments/v4-5/card_probe.mjs        (needs the dev server on :8787)
//
// `experiments/v4-3/responsive.mjs` passes 4/4 widths, and it CANNOT see this change:
// it asserts overflow, tap targets, headline wrap and column counts. A hero card showing
// the wrong number of rows, or a count label disagreeing with the list beside it, passes
// every one of those checks. This repo's rule: the replacement for an absence sweep is a
// PRESENCE CHECK over the thing you actually changed.
//
// ⚠️ TWO-SIDED CANARY, AND IT IS THE WHOLE POINT HERE. The claim is that the card renders
// DIFFERENTLY at two widths. If both widths return the same answer, the media query is not
// applying and a "3 rows at 375px" reading would be meaningless — so the probe fails when
// the two widths AGREE, not only when a number is wrong.
//
// Reuses v4.2's zero-dependency CDP client over the system Chromium. Not re-derived.
import { Browser } from "../v4-2/cdp.mjs";

const URL_ = "http://localhost:8787/";
const WIDTHS = [{ w: 375, h: 812, expect: 3 }, { w: 1280, h: 900, expect: 5 }];

const READ = `(() => {
  const card = document.querySelector('.v43-artifact');
  if (!card) return { error: 'no .v43-artifact on the page' };
  const vis = (el) => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden'; };
  const rows = [...card.querySelectorAll('.v43-rows > li')];
  const labels = [...card.querySelectorAll('.v43-artifact-count span')].filter(vis).map((e) => e.textContent.trim());
  return {
    rowsInMarkup: rows.length,
    rowsVisible: rows.filter(vis).length,
    labelsVisible: labels,
    heroHasCta: Boolean(card.querySelector('.v43-artifact-foot')),
    exampleJob: (document.querySelector('.v43-example-job') || {}).textContent || null,
    exampleRows: document.querySelectorAll('#example .v43-rows > li').length,
  };
})()`;

const out = { completion: "INCOMPLETE", reasons: [], readings: {} };
const b = await Browser.launch();
try {
  const page = await b.newPage();
  for (const { w, h, expect } of WIDTHS) {
    // `mobile: false` gives an exact CSS viewport. With `mobile: true` Chromium applies
    // its own viewport-meta handling and 320/375 both pin to 423 — measured in v4.3, and
    // it would silently defeat a media-query measurement.
    await page.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await page.goto(`${URL_}?w=${w}`, { waitMs: 700 });
    const r = await page.eval(READ);
    out.readings[`${w}px`] = { ...r, expected_visible_rows: expect };
  }
} finally {
  await b.close();
}

const a = out.readings["375px"], d = out.readings["1280px"];
const problems = [];
if (!a || a.error) problems.push(`375px: ${a?.error ?? "no reading"}`);
if (!d || d.error) problems.push(`1280px: ${d?.error ?? "no reading"}`);
if (a && d) {
  // THE CANARY: the two widths must disagree, or nothing was measured.
  if (a.rowsVisible === d.rowsVisible) {
    problems.push(`CANARY COLLAPSED: both widths show ${a.rowsVisible} hero rows, so the media query is not applying and neither reading means anything.`);
  }
  if (a.rowsVisible !== 3) problems.push(`375px shows ${a.rowsVisible} hero rows, expected 3`);
  if (d.rowsVisible !== 5) problems.push(`1280px shows ${d.rowsVisible} hero rows, expected 5`);
  // The label must agree with the list beside it, at BOTH widths. A label that disagrees
  // is worse than no label — it is a specific false statement about the excerpt.
  for (const [w, r] of [["375px", a], ["1280px", d]]) {
    if (r.labelsVisible.length !== 1) { problems.push(`${w}: ${r.labelsVisible.length} count labels visible, expected exactly 1`); continue; }
    const m = /Showing (\d+) of (\d+)/.exec(r.labelsVisible[0]);
    if (!m) { problems.push(`${w}: count label does not state a count: ${JSON.stringify(r.labelsVisible[0])}`); continue; }
    if (Number(m[1]) !== r.rowsVisible) problems.push(`${w}: label says ${m[1]} rows, list shows ${r.rowsVisible}`);
    if (Number(m[2]) !== r.exampleRows) problems.push(`${w}: label totals ${m[2]} but the complete §example card renders ${r.exampleRows}`);
  }
  if (a.heroHasCta || d.heroHasCta) problems.push("the hero card still carries its own CTA");
  if (!a.exampleJob || !d.exampleJob) problems.push("the §example card has no one-line job description");
}

out.reasons = problems;
out.completion = problems.length ? "DEFECTS_FOUND" : "VERIFIED_CLEAN";
console.log(JSON.stringify(out, null, 2));
process.exit(problems.length ? 1 : 0);
