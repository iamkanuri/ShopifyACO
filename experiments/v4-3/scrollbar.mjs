// ⚠️ THE OVERFLOW PROBE WAS MEASURING AGAINST THE WRONG REFERENCE.
//
// `responsive.mjs` compared `document.documentElement.scrollWidth` to `innerWidth` and
// reported four clean widths. A CDP SCREENSHOT of the same page at 1280px shows a
// horizontal scrollbar. Both cannot be right.
//
// `innerWidth` INCLUDES the classic vertical scrollbar; `clientWidth` does not. So a page
// that overflows by exactly the scrollbar width — which is what `margin-inline: calc(50%
// - 50vw)` full-bleed does, because `100vw` also includes the scrollbar — is invisible to
// a comparison against `innerWidth` and visible to one against `clientWidth`.
//
// This measures both, at every width, so the diagnosis is a number rather than a story.
import { Browser } from "../v4-2/cdp.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:8787";
const WIDTHS = [320, 375, 768, 1280];

const M = `(() => {
  const d = document.documentElement;
  const band = document.querySelector('.v43-band');
  const bb = band ? band.getBoundingClientRect() : null;
  return {
    innerWidth, clientWidth: d.clientWidth, scrollWidth: d.scrollWidth,
    scrollbarPx: innerWidth - d.clientWidth,
    overflowVsInner: d.scrollWidth > innerWidth + 1,
    overflowVsClient: d.scrollWidth > d.clientWidth + 1,
    bandLeft: bb ? Math.round(bb.left) : null,
    bandWidth: bb ? Math.round(bb.width) : null,
    bodyOverflowX: getComputedStyle(document.body).overflowX,
    htmlOverflowX: getComputedStyle(d).overflowX,
    // ⚠️ THE QUESTION IS WHETHER IT SCROLLS, NOT WHETHER scrollWidth IS LARGE.
    // "overflow-x: clip" on body PROPAGATES to the viewport, so the content extent — and
    // therefore scrollWidth — is unchanged while the viewport refuses to scroll.
    // Comparing scrollWidth to clientWidth after the fix measures the wrong thing a
    // second time. This asks the page to scroll and reports whether it moved.
    canScrollX: (() => { const before = d.scrollLeft || document.body.scrollLeft || 0;
      window.scrollTo(9999, 0);
      const after = d.scrollLeft || document.body.scrollLeft || 0;
      window.scrollTo(before, 0); return after > before + 1; })(),
  };
})()`;

let browser; const rows = [];
try {
  browser = await Browser.launch();
  const page = await browser.newPage();
  for (const w of WIDTHS) {
    await page.send("Emulation.setDeviceMetricsOverride", { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.goto(`${BASE}/?w=${w}`, { waitMs: 700 });
    rows.push({ w, ...(await page.eval(M)) });
  }
} catch (e) { console.log(`INCOMPLETE: ${e.message}`); process.exit(1); }
finally { if (browser) await browser.close().catch(() => {}); }

console.log("=".repeat(104));
console.log("width | inner | client | scroll | sbar | ovf vs inner | ovf vs CLIENT | CAN SCROLL X | band left/width");
console.log("=".repeat(104));
let bad = 0;
for (const r of rows) {
  if (r.canScrollX) bad++;
  console.log(
    `${String(r.w).padEnd(6)}| ${String(r.innerWidth).padEnd(6)}| ${String(r.clientWidth).padEnd(7)}| ` +
    `${String(r.scrollWidth).padEnd(7)}| ${String(r.scrollbarPx).padEnd(5)}| ` +
    `${String(r.overflowVsInner).padEnd(13)}| ${String(r.overflowVsClient).padEnd(14)}| ` +
    `${String(r.canScrollX).padEnd(13)}| ${r.bandLeft}/${r.bandWidth}`,
  );
}
console.log(`\nhtml overflow-x: ${rows[0].htmlOverflowX}   body overflow-x: ${rows[0].bodyOverflowX}`);
console.log(
  "THE VERDICT COLUMN IS `CAN SCROLL X`, and the two before it are kept to show why.\n" +
  "  · `ovf vs inner` was the ORIGINAL probe's test and reads false at every width over a live defect,\n" +
  "    because innerWidth counts the scrollbar and the overflow is exactly one scrollbar wide.\n" +
  "  · `ovf vs CLIENT` finds the defect — and still reads true AFTER the fix, because\n" +
  "    `overflow-x: clip` propagates to the viewport and clips without changing the content extent.\n" +
  "  · Only asking the page to scroll and watching whether it moved answers the question a\n" +
  "    reader actually has.",
);
console.log(bad
  ? `\n⚠️ ${bad}/${rows.length} widths SCROLL SIDEWAYS.`
  : `\nno width scrolls sideways`);
console.log(`completion: ${bad ? "DEFECTS_FOUND" : "VERIFIED_CLEAN"}`);
process.exit(bad ? 1 : 0);
