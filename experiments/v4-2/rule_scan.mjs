// Which CSS rule actually makes a collapsed <details> print its content?
//
// SCORED, NOT GUESSED. `details[open]`, `display: revert`, `content-visibility` and
// `::details-content` are all folklore-plausible and Chromium changed the underlying
// mechanism (the content moved behind a `::details-content` pseudo-element with
// `content-visibility: hidden`). This repo's rule from v3.5 applies: score the candidate
// rules before building one.
//
// Two-sided per candidate: the collapsed body must become visible AND a control element
// that print legitimately hides must STAY hidden — a rule that reveals everything by
// disabling the print block is not a fix.
import { Browser } from "./cdp.mjs";

const CANDIDATES = {
  "none (baseline)": ``,
  "details[open] attr only": `@media print { details { display: block } }`,
  "children display revert": `@media print { details > *:not(summary) { display: revert !important } }`,
  "content-visibility on details": `@media print { details { content-visibility: visible !important } }`,
  "::details-content visible": `@media print { details::details-content { content-visibility: visible !important } }`,
  "combined (children + pseudo)": `@media print {
      details > *:not(summary) { display: revert !important }
      details::details-content { content-visibility: visible !important } }`,
};

const page_html = (extra) => `<!doctype html><html><head><style>
  body { font: 16px sans-serif }
  @media print { .no-print { display: none !important } }
  ${extra}
</style></head><body>
  <h1>ANCHORALPHA</h1>
  <p class="no-print">CONTROLHIDDEN</p>
  <details><summary>SUMMARYBETA</summary><ul><li>SECRETGAMMA</li><li>SECRETDELTA</li></ul></details>
</body></html>`;

const b = await Browser.launch();
const out = [];
try {
  for (const [name, css] of Object.entries(CANDIDATES)) {
    const page = await b.newPage();
    await page.setContent(page_html(css));
    await page.emulatePrint(true);
    const t = await page.eval(`document.body.innerText`);
    const mediaOk = await page.eval(`matchMedia('print').matches`);
    out.push({
      rule: name,
      media_engaged: mediaOk,                       // canary: must be true or the row means nothing
      anchor_visible: t.includes("ANCHORALPHA"),    // canary: must be true
      control_stays_hidden: !t.includes("CONTROLHIDDEN"), // must stay true — no blanket reveal
      collapsed_body_prints: t.includes("SECRETGAMMA") && t.includes("SECRETDELTA"),
    });
    await page.close();
  }
} finally { await b.close(); }

const live = out.every((r) => r.media_engaged && r.anchor_visible);
console.log(JSON.stringify({
  completion: live ? "VERIFIED_CLEAN" : "INCOMPLETE",
  blocked_on: live ? "" : "a canary failed — print media or the anchor did not hold in some row",
  chromium_reveals_by_default: out[0].collapsed_body_prints,
  results: out,
  winners: out.filter((r) => r.collapsed_body_prints && r.control_stays_hidden).map((r) => r.rule),
}, null, 2));
if (!live) process.exitCode = 1;
