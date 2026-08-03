// §4 — MOBILE (AND DESKTOP) VERIFICATION, RENDERED.
//
//   node experiments/v4-3/responsive.mjs          (needs the dev server on :8787)
//
// ⚠️ WHY NOT THE BROWSER PANE. Its viewport would not go below ~423px or above it either
// in this session — every resize returned the same width — so the ≥720px and ≥960px
// layouts could not be rendered there at all. The CSSOM says the media rules are present
// with the right selectors, which is a real check and a weak one: a rule that exists can
// still lay out wrong. This drives the SYSTEM CHROMIUM over CDP instead, reusing the
// zero-dependency client v4.2 built for the print measurement, and measures geometry at
// four widths.
//
// WHAT IT ASSERTS AT EVERY WIDTH
//   • no horizontal overflow of the document, and no element wider than the viewport
//   • every pointer target ≥24px effective height (WCAG 2.5.8), excluding links that are
//     genuinely inline in a sentence, which the success criterion exempts
//   • the headline wraps rather than clipping
//   • the multi-column constructs are single-column below 720 and multi-column above
//
// ANTI-VACUITY. React must be mounted and the anchor count above a floor, or the run is
// INCOMPLETE — a probe that queried `.v43 a` against an unmounted page returned "0 targets
// under 24px" earlier in this session, which is a statement about the selector.

import { Browser } from "../v4-2/cdp.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:8787";
const WIDTHS = [320, 375, 768, 1280];

const MEASURE = `(() => {
  const anchors = document.querySelectorAll('.v43 a, .v43 button, .v43 summary');
  if (!document.querySelector('.v43') || anchors.length < 20) {
    return { INCOMPLETE: true, hasV43: !!document.querySelector('.v43'), anchors: anchors.length };
  }
  const eff = el => {
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el, '::after');
    if (cs.content === 'none' || cs.content === 'normal') return b.height;
    return b.height + Math.abs(parseFloat(cs.top)||0) + Math.abs(parseFloat(cs.bottom)||0);
  };
  const small = [];
  anchors.forEach(el => {
    const b = el.getBoundingClientRect(); if (!b.height) return;
    const p = el.parentElement;
    const inline = p ? (p.textContent||'').trim().length > (el.textContent||'').trim().length + 8 : false;
    if (eff(el) < 24 && !inline) small.push((el.textContent||'').trim().slice(0,32) + ' h=' + Math.round(eff(el)));
  });
  // ⚠️ clientWidth, NOT innerWidth. \`innerWidth\` counts the classic vertical scrollbar and
  // \`clientWidth\` does not, so an overflow of exactly the scrollbar width — which is what a
  // 100vw full-bleed band produces — is INVISIBLE to a comparison against innerWidth. This
  // probe reported VERIFIED_CLEAN at four widths over a live 8px sideways scroll, and only
  // a rendered screenshot caught it. See experiments/v4-3/scrollbar.mjs.
  const REF = document.documentElement.clientWidth;
  const wide = [];
  document.querySelectorAll('body *').forEach(el => {
    const b = el.getBoundingClientRect();
    if (b.width > REF + 1 && !el.classList.contains('v43-band')) {
      wide.push((el.className||el.tagName).toString().slice(0,44) + ' w=' + Math.round(b.width));
    }
  });
  const cols = {};
  for (const s of ['.v43-hero','.v43-deliver','.v43-rail','.v43-surfaces','.v43-ba','.v43-compare','.v43-artifact-meta'])
    cols[s] = document.querySelector(s) ? getComputedStyle(document.querySelector(s)).gridTemplateColumns.split(' ').length : 0;
  const h1e = document.querySelector('.v43-hero h1');
  const h1 = h1e.getBoundingClientRect();
  const clipped = h1e.scrollWidth > Math.ceil(h1.width) + 1;
  return {
    anchors: anchors.length,
    // ⚠️ THE WIDTH THE PAGE ACTUALLY GOT, not the one requested. The first run of this
    // harness asked for 320 and 375 and BOTH reported a 423px scrollWidth — the emulation
    // had not taken, so two of the four rows were the same measurement wearing two labels,
    // and both said PASS. A harness that cannot show it reached the condition it claims to
    // test is reporting on itself.
    innerWidth,
    clientW: REF,
    scrollW: document.documentElement.scrollWidth,
    // ⚠️ THE GATE IS "DOES IT SCROLL", NOT "IS ANYTHING WIDE". The full-bleed band is
    // DELIBERATELY wider than clientWidth — it extends under the scrollbar gutter, which
    // is what full-bleed means — and \`html, body { overflow-x: clip }\` stops that
    // becoming a scroll. A width comparison flags the intended design as a defect; asking
    // the page to scroll and watching whether it moved does not. Kept alongside, because
    // an element wider than the viewport that is NOT the band is still worth seeing.
    hOverflow: (() => {
      const d = document.documentElement;
      const before = d.scrollLeft || document.body.scrollLeft || 0;
      window.scrollTo(9999, 0);
      const after = d.scrollLeft || document.body.scrollLeft || 0;
      window.scrollTo(before, 0);
      return after > before + 1;
    })(),
    widerThanViewport: [...new Set(wide)].slice(0, 6),
    under24: small,
    cols,
    h1: { w: Math.round(h1.width), h: Math.round(h1.height), fs: getComputedStyle(h1e).fontSize, clipped },
    bodyBg: getComputedStyle(document.body).backgroundColor,
    displayFont: getComputedStyle(h1e).fontFamily.split(',')[0],
    pageH: document.documentElement.scrollHeight,
  };
})()`;

const results = [];
let browser;
try {
  browser = await Browser.launch();
  const page = await browser.newPage();
  for (const w of WIDTHS) {
    // `mobile: true` makes Chromium apply its own viewport-meta handling and the layout
    // viewport stopped tracking the requested width — measured, that is what pinned 320
    // and 375 both to 423. `mobile: false` gives an exact CSS viewport, which is what a
    // media-query measurement needs.
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: w, height: 900, deviceScaleFactor: 1, mobile: false,
    });
    await page.goto(`${BASE}/?w=${w}`, { waitMs: 700 });
    const m = await page.eval(MEASURE);
    results.push({ w, ...m });
  }
} catch (e) {
  console.log(`INCOMPLETE: ${e.message}`);
  process.exit(1);
} finally {
  if (browser) await browser.close().catch(() => {});
}

let bad = 0, notRun = 0;
console.log("=".repeat(84));
for (const r of results) {
  if (r.INCOMPLETE) {
    notRun++;
    console.log(`\n${r.w}px  INCOMPLETE — React not mounted (hasV43=${r.hasV43}, anchors=${r.anchors})`);
    continue;
  }
  const wideMode = r.w >= 720;
  const colsOk = wideMode
    ? r.cols[".v43-compare"] === 3 && r.cols[".v43-ba"] === 3 && r.cols[".v43-rail"] === 5
    : Object.values(r.cols).every((n) => n === 1);
  // The requested width must be the width the page got, or nothing below is about `r.w`.
  const widthTaken = Math.abs(r.innerWidth - r.w) <= 1;
  if (!widthTaken) { notRun++; console.log(`\n${r.w}px  INCOMPLETE — emulation did not take (page saw ${r.innerWidth}px)`); continue; }
  const ok = !r.hOverflow && r.widerThanViewport.length === 0 && r.under24.length === 0 && !r.h1.clipped && colsOk;
  if (!ok) bad++;
  console.log(`\n${r.w}px  ${ok ? "PASS" : "FAIL"}   (viewport ${r.innerWidth}px, ${r.anchors} targets scanned, page ${r.pageH}px tall)`);
  console.log(`   horizontal overflow : ${r.hOverflow}  (scrollWidth ${r.scrollW})`);
  console.log(`   wider than viewport : ${r.widerThanViewport.length ? r.widerThanViewport.join(" | ") : "none"}`);
  console.log(`   targets under 24px  : ${r.under24.length ? r.under24.join(" | ") : "none"}`);
  console.log(`   headline            : ${r.h1.w}x${r.h1.h} @${r.h1.fs}${r.h1.clipped ? "  ⚠️ CLIPPED" : "  (wraps)"}`);
  console.log(`   columns             : ${Object.entries(r.cols).map(([k, v]) => `${k.replace(".v43-", "")}=${v}`).join(" ")}  ${colsOk ? "OK" : "⚠️ WRONG FOR THIS WIDTH"}`);
  console.log(`   theme               : bg ${r.bodyBg}, display ${r.displayFont}`);
}
console.log("\n" + "=".repeat(84));
const state = notRun ? "INCOMPLETE" : bad ? "DEFECTS_FOUND" : "VERIFIED_CLEAN";
console.log(`widths measured: ${results.length - notRun}/${WIDTHS.length}   failures: ${notRun ? "null (INCOMPLETE)" : bad}`);
console.log(`completion: ${state}`);
process.exit(state === "VERIFIED_CLEAN" ? 0 : 1);
