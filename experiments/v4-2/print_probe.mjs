// ===========================================================================
// CP-2 — THE PRINT PROOF, TWO-SIDED.
//
// The brief says: "render a PDF and assert the evidence sentences of a deliberately-
// collapsed section are present in the rendered output — a green print run must
// demonstrate the fix, not the printer."
//
// So this measures THREE things and requires them to agree:
//   1. `innerText` under real print-media emulation (layout-derived, not a CSS read)
//   2. the text inside the PDF Chrome actually produced (the artifact that gets sent)
//   3. the DOM's own list of <details> bodies, so the assertion names real sentences
//      rather than a string someone typed into a test
//
// THE TWO SIDES, both required before any number here is believed:
//   • MEDIA canary — `matchMedia('print').matches` must be FALSE on screen and TRUE
//     after emulation. If it does not flip, we measured screen twice.
//   • EXTRACTOR canary — a string known to be rendered must be found in the PDF and a
//     string known NOT to be rendered must be absent. An extractor returning "" reads
//     exactly like a page with no text.
//
// `--css <file>` REPLACES every stylesheet on the loaded page with that file's text.
// This is how the BEFORE/AFTER pair is taken without a file swap and without rebuilding:
// the SAME served HTML at the SAME origin is measured twice, with only the stylesheet
// differing (`git show HEAD:viewer/src/theme.css` vs the working copy). A rebuild-based
// A/B would compare two different bundles and could not attribute the delta; a file swap
// that silently fails to apply is indistinguishable from "no differences", which is the
// failure mode this repo records from v3.1.
//
// Usage: node experiments/v4-2/print_probe.mjs <url> [--pdf out.pdf] [--css theme.css]
import { Browser } from "./cdp.mjs";
import { extractText, pdfHas, selfTest } from "./pdftext.mjs";
import { writeFileSync, readFileSync } from "node:fs";

const url = process.argv[2];
if (!url) { console.error("usage: print_probe.mjs <url> [--pdf out.pdf] [--css file]"); process.exit(2); }
const pdfArgIdx = process.argv.indexOf("--pdf");
const pdfOut = pdfArgIdx > -1 ? process.argv[pdfArgIdx + 1] : null;
const cssArgIdx = process.argv.indexOf("--css");
const cssOverride = cssArgIdx > -1 ? readFileSync(process.argv[cssArgIdx + 1], "utf8") : null;

// ⚠️ LEAF ITEMS, NOT THE CONCATENATED BLOB. A <details> body is a <ul>; the PDF puts
// each <li> on its own line with a bullet glyph between them, so matching the joined
// textContent tests the renderer's list layout rather than whether the content printed.
// Each leaf is asserted separately, and the verdict comes from the BEFORE/AFTER diff of
// those leaves — never from their raw presence, because several of these option values
// also occur elsewhere on the page (an evidence quote, the product title) and would
// report "present" on a page where the section printed nothing at all.
const DETAILS_JS = `
(() => Array.from(document.querySelectorAll('details')).map((d, i) => {
  const sum = d.querySelector('summary');
  const bodyEls = Array.from(d.children).filter(c => c.tagName !== 'SUMMARY');
  const leaves = [];
  for (const el of bodyEls) {
    const kids = el.querySelectorAll('li, p, dd, td');
    if (kids.length) for (const k of kids) leaves.push(k.textContent || '');
    else leaves.push(el.textContent || '');
  }
  return {
    i, open: d.open,
    summary: (sum?.textContent || '').replace(/\\s+/g,' ').trim(),
    items: leaves.map(t => t.replace(/\\s+/g,' ').trim()).filter(Boolean),
  };
}))()`;

const b = await Browser.launch();
const out = { url, completion: "INCOMPLETE" };
try {
  const page = await b.newPage();
  await page.goto(url);

  if (cssOverride !== null) {
    // Swap the stylesheet in place. Canaried: the page must actually HAVE had a
    // stylesheet to remove, or we are measuring an unstyled document and every
    // "content is visible" answer would be trivially true.
    const removed = await page.eval(`(() => {
      const links = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'));
      links.forEach(n => n.remove());
      const s = document.createElement('style');
      s.textContent = ${JSON.stringify(cssOverride)};
      document.head.appendChild(s);
      return links.length;
    })()`);
    if (!removed) {
      out.blocked_on = "--css override found no stylesheet to replace; the page was unstyled";
      console.log(JSON.stringify(out, null, 2));
      process.exit(1);
    }
    out.css_override_replaced = removed;
    await page.eval(`document.fonts ? document.fonts.ready.then(() => true) : true`, true);
  }

  const detailsList = await page.eval(DETAILS_JS);
  const screenMedia = await page.eval(`matchMedia('print').matches`);
  const screenText = await page.eval(`document.body.innerText`);
  const h1 = await page.eval(`(document.querySelector('h1')?.textContent || '').replace(/\\s+/g,' ').trim()`);

  await page.emulatePrint(true);
  const printMedia = await page.eval(`matchMedia('print').matches`);
  const printText = await page.eval(`document.body.innerText`);

  const pdf = await page.pdf();
  if (pdfOut) writeFileSync(pdfOut, pdf);
  let pdfText = extractText(pdf);

  // ⚠️ PAGINATION CHROME IS NOT CONTENT, AND IT LANDS IN THE MIDDLE OF A SENTENCE.
  // Chromium repeats a table's <thead> on every printed page, so a cell that spans a page
  // break comes back as "…the analytics track call is | ENTRY STORE AND MATCHED EVIDENCE
  // WHY IT IS WRONG SCOPE | {"currency":"AUD"}…". A contiguous-containment test then reports
  // the sentence absent from a PDF that plainly contains it — an instrument artifact that
  // would read as a content defect. The header text is DERIVED from the DOM rather than
  // guessed, and removed before matching.
  const heads = await page.eval(`(() => Array.from(document.querySelectorAll('thead'))
    .map(h => (h.textContent || '').replace(/\\s+/g,' ').trim()).filter(t => t.length > 8))()`);
  // ONE space for both sides. Squashing the haystack and then stripping a squashed header
  // from it keeps the comparison in the same representation pdfHas already uses; mixing the
  // two (a whitespace-free pattern applied to spaced text) silently strips nothing.
  const squash = (s) => s
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-")
    .replace(/\s+/g, "").toLowerCase();
  let hay = squash(pdfText);
  let stripped = 0;
  for (const h of heads) {
    const sq = squash(h);
    if (sq.length < 8) continue;
    const before = hay.length;
    hay = hay.split(sq).join("");
    if (hay.length !== before) stripped++;
  }
  out.pagination_headers_found = heads.length;
  out.pagination_headers_stripped = stripped;

  /**
   * Containment, tolerating EXACTLY ONE page-break interruption — and counting them.
   *
   * Stripping the DOM-derived <thead> is not sufficient, because the repeated header is
   * itself CLIPPED in the printed output: the last column prints as "SCOP", not "SCOPE",
   * so an exact removal leaves a fragment wedged inside the sentence. Rather than chase
   * fragments, a needle also counts as present if it splits into a prefix and a suffix
   * that both appear, in order, with the suffix starting after the prefix ends.
   *
   * ⚠️ THE GAP MUST BE BOUNDED, AND THE UNBOUNDED VERSION WAS WRONG IN THE FLATTERING
   * DIRECTION. A first cut allowed the suffix to appear anywhere after the prefix, and the
   * BEFORE run — where the sections are collapsed and the text genuinely is NOT printed —
   * started reporting items present by stitching two short fragments from opposite ends of
   * the document. The DOM/PDF agreement canary caught it. The physical model is a bounded
   * interruption (one repeated table header, ~50 squashed characters plus clipped
   * fragments), so the seam is capped at MAX_SEAM and both sides must be substantial.
   *
   * This is a real loosening and it is REPORTED, never folded into the pass count: `out`
   * carries `items_matched_across_page_break` so a reader can see how much of the result
   * rests on it. One split only — allowing many would let an arbitrary subsequence match.
   */
  const MAX_SEAM = 250;
  let splitMatches = 0;
  const inPdf = (needle) => {
    const n = squash(needle);
    if (!n) return false;
    if (hay.includes(n)) return true;
    if (n.length < 60) return false;   // too short for a page break to be the explanation
    for (let k = Math.floor(n.length * 0.85); k >= Math.max(25, Math.floor(n.length * 0.15)); k--) {
      const i = hay.indexOf(n.slice(0, k));
      if (i === -1) continue;
      const j = hay.indexOf(n.slice(k), i + k);
      if (j !== -1 && j - (i + k) <= MAX_SEAM) { splitMatches++; return true; }
    }
    return false;
  };

  // ---- canaries -----------------------------------------------------------
  const mediaCanary = screenMedia === false && printMedia === true;
  // The negative control is a string that is genuinely not on the page. Derived, not
  // typed: a nonce cannot accidentally be present.
  const nonce = "v42-negative-control-" + h1.length + "-zzq";
  const extractor = selfTest(pdfText, h1.slice(0, 40), nonce);

  // ---- the measurement ----------------------------------------------------
  // ONE normaliser for both instruments. Comparing DOM text with `\s+`-collapse while
  // comparing PDF text with whitespace REMOVED made the two legs disagree about the
  // same string and reported a summary as absent that is plainly in the PDF.
  const domHas = (hay, needle) => pdfHas(hay, needle);

  const rows = detailsList.map((d) => ({
    i: d.i,
    open: d.open,
    summary: d.summary.slice(0, 70),
    item_count: d.items.length,
    summary_in_print_dom: d.summary ? domHas(printText, d.summary) : null,
    summary_in_pdf: d.summary ? inPdf(d.summary) : null,
    items: d.items.map((t) => ({
      text: t.slice(0, 60),
      in_screen_dom: domHas(screenText, t),
      in_print_dom: domHas(printText, t),
      in_pdf: inPdf(t),
    })),
  }));

  const allItems = rows.flatMap((r) => r.items);
  const collapsed = rows.filter((r) => !r.open);
  const collapsedItems = collapsed.flatMap((r) => r.items);
  // The two instruments must agree. A disagreement means one of them is lying and the
  // run is not decisive, whichever direction it points.
  const agree = allItems.every((it) => it.in_pdf === it.in_print_dom)
    && rows.every((r) => r.summary_in_pdf === null || r.summary_in_pdf === r.summary_in_print_dom);

  Object.assign(out, {
    media_canary_ok: mediaCanary,
    extractor_canary: extractor,
    instruments_agree: agree,
    h1,
    details_total: rows.length,
    details_collapsed: collapsed.length,
    collapsed_items_total: collapsedItems.length,
    collapsed_items_in_pdf: collapsedItems.filter((i) => i.in_pdf).length,
    collapsed_items_MISSING_from_pdf: collapsedItems.filter((i) => !i.in_pdf).length,
    rows,
    items_matched_across_page_break: splitMatches,
    pdf_bytes: pdf.length,
    pdf_chars_extracted: extractor.chars_extracted,
  });

  if (!mediaCanary || !extractor.extractor_live || !agree) {
    out.completion = "INCOMPLETE";
    out.blocked_on = !mediaCanary ? "print media never engaged — measured screen twice"
      : !extractor.extractor_live ? "PDF text extractor failed its own controls"
      : "the DOM and the PDF disagree about the same string";
  } else if (collapsed.length === 0) {
    out.completion = "INCOMPLETE";
    out.blocked_on = "no collapsed <details> on this page — nothing to prove either way";
  } else {
    // NOTE: this verdict is about THIS page only. The fix is proved by the BEFORE/AFTER
    // diff (print_diff.mjs), not by this count — some of these strings occur elsewhere
    // on the page and would read as "present" even when the section printed nothing.
    out.completion = out.collapsed_items_MISSING_from_pdf > 0 ? "DEFECTS_FOUND" : "VERIFIED_CLEAN";
  }
  console.log(JSON.stringify(out, null, 2));
  if (out.completion === "INCOMPLETE") process.exitCode = 1;
} catch (e) {
  out.blocked_on = String(e.message ?? e);
  console.log(JSON.stringify(out, null, 2));
  process.exitCode = 1;
} finally {
  await b.close();
}
