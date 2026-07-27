import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import type { ReportPreview } from "./reportPreview.js";
import type { IndexOgModel } from "./indexSsr.js";

// ===========================================================================
// Dynamic 1200×630 OG/social share cards (hand-built SVG → PNG via resvg, with a
// BUNDLED Inter font — a slim container renders no text without one). One shared
// visual frame, several card bodies:
//   • report   — a merchant's report. DOCTRINE: public artifacts are winner- or
//     field-headlined, never loser-headlined. The card names the brand + category
//     and frames the finding at CATEGORY level; the merchant's score/losing rate
//     lives on the page, NOT on the poster that travels through feeds.
//   • index    — a category leaderboard. Obeys the SAME dominance gate as the page
//     (rankView): a crown renders ONLY when the page crowns; otherwise the card
//     says "no single favorite / no runaway leader". An image that crowns someone
//     the page doesn't would be a lie that travels further than the page.
//   • demo     — the sample report (fictional brand) — rich, and labeled a sample.
//   • default  — brand card for the landing/utility pages (replaces og-image.svg,
//     which LinkedIn/Facebook/Slack refuse to render — SVG isn't a valid og:image).
// No PII anywhere: all content derives from public brands and public AI answers.
// ===========================================================================

// The bundled Inter font path, resolved relative to THIS file (works regardless of cwd).
const FONT_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "fonts", "Inter.ttf");
// Fail fast at boot if the font is missing (otherwise cards would render blank text).
readFileSync(FONT_PATH);

const W = 1200;
const H = 630;
// SAFE AREA: og:images are 1.91:1, but LinkedIn's Featured tiles (and some other
// surfaces) render ~1.6:1 and CENTER-CROP, eating ~80-100px off each side. All content
// lives inside these margins so a platform crop can never cut it off.
const MX = 140;        // left content margin
const RX = W - MX;     // right-aligned numbers anchor (1060)
const CW = W - 2 * MX; // max content width for fitted text (920)
// The shared palette (see viewer/src/theme.css). NOTE WHAT IS ABSENT: this card
// family carries NO crimson and NO tan. Those two colours are reserved for a
// not-proven and a requires-store-access requirement result, and a share card
// renders no requirement results — it frames a category question. A poster that
// borrowed the failure colour for decoration would spend the one signal this
// product cannot afford to dilute. test/palette.test.ts enforces it.
const INK = "#CBD8E4";      // ice
const MUTED = "#8598B2";    // ice, muted
const ACCENT = "#7B9BC7";   // slate-light — the highlight of the card family
const SLATE = "#4F6890";    // slate — structure (the un-gated frame rule)
const BG = "#1B2131";       // navy

const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

// resvg doesn't wrap <text>, so the wrapping is ours. ~0.53em average glyph width for
// Inter — measured against resvg's own shaping at ≈0.486em for real sentence copy, so
// this OVER-estimates, which is the safe direction for a width budget.
const EM = 0.53;
/** How many characters of `text` fit in `maxPx` at `size`. */
const capChars = (maxPx: number, size: number) => Math.max(1, Math.floor(maxPx / (size * EM)));

/**
 * Greedy word wrap at a character budget.
 *
 * ⚠️ THIS REPLACES `splitTwo`, WHICH CAPPED ONLY THE SECOND LINE.
 *
 * The old wrapper split once at the midpoint by character count and then truncated
 * line 2 to the width budget — line 1 was emitted verbatim, never measured against
 * any width. On the live default card that put line 1 at ~134 characters ≈1349px
 * inside a 920px content box on a 1200px canvas: measured with resvg's own text
 * shaping (`Resvg.getBBox()`), the rendered card's right edge was 1378.6. So
 * lens.thirdocular.com/og/default.png — the share image for the landing page and
 * every utility page — has been clipping its own description mid-word ("…written as
 * exe") in every unfurl. The tests could not see it: they assert `svg.includes(…)`
 * on the SVG source, and a <text> element that runs to x=1489 contains exactly the
 * same characters as one that fits.
 */
function greedyWrap(text: string, cap: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= cap || !cur) { cur = next; continue; }
    lines.push(cur);
    cur = w;
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Fit text into `maxPx` wide and at most `maxLines` lines, shrinking from `max` to
 * `min` until it fits. EVERY line is inside the width budget, not just the last.
 *
 * `maxLines` defaults to 2 so existing callers keep their exact vertical layout; the
 * default card opts into more, because its tagline is 273 characters and two lines at
 * the minimum size cannot hold it without deleting words.
 */
function fittedLines(
  text: string, maxPx: number, max: number, min: number, maxLines = 2,
): { lines: string[]; size: number } {
  // FEWEST LINES FIRST, then the largest size that achieves that count. This is the
  // preference the old code had — it only went to two lines when one line at `min`
  // would overflow — and preserving it matters: searching size-first instead flips
  // short headlines from one big line to two smaller ones and silently re-lays out
  // every existing card, which is a change nobody asked for while fixing a clipping bug.
  for (let want = 1; want <= maxLines; want++) {
    for (let size = max; size >= min; size--) {
      const lines = greedyWrap(text, capChars(maxPx, size));
      if (lines.length <= want) return { lines, size };
    }
  }
  // Even at `min` the text needs more lines than the layout has room for. Keep the
  // first `maxLines` and mark the cut, rather than silently rendering past the canvas.
  const cap = capChars(maxPx, min);
  const all = greedyWrap(text, cap);
  const kept = all.slice(0, maxLines);
  const last = kept[maxLines - 1] ?? "";
  kept[maxLines - 1] = `${last.slice(0, Math.max(1, cap - 1)).trimEnd()}…`;
  return { lines: kept, size: min };
}

const textEl = (x: number, y: number, size: number, fill: string, content: string, opts: { weight?: number; spacing?: string; anchor?: string } = {}) =>
  `<text x="${x}" y="${y}" font-family="Inter" font-size="${size}"${opts.weight ? ` font-weight="${opts.weight}"` : ""}${opts.spacing ? ` letter-spacing="${opts.spacing}"` : ""}${opts.anchor ? ` text-anchor="${opts.anchor}"` : ""} fill="${fill}">${content}</text>`;

/** Shared card chrome: background, accent bar, brand header, kicker label. */
//
// MERGE NOTE (v2.1): v2 CP4 renamed the "AI VISIBILITY SCORE" label inside the old
// single-card `buildOgSvg`. main replaced that whole card family and deliberately renders
// NO score on the share card at all ("the poster frames the category question; the
// merchant's numbers live on the page they lead to"). There is no score label left to
// rename, so v2's edit is superseded rather than dropped — the retired category name is
// gone from the share image either way, which was v2's actual goal.
function frame(accent: string, brandName: string, headerLabel: string, inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <rect x="0" y="0" width="${W}" height="8" fill="${accent}"/>
  ${textEl(MX, 92, 30, INK, xml(brandName), { weight: 700, spacing: "0.5" })}
  ${textEl(MX, 126, 20, MUTED, xml(headerLabel), { weight: 700, spacing: "2" })}
  ${inner}
</svg>`;
}

/**
 * The footer on the AI-visibility card family — the report card and the two Index
 * cards. Those surfaces really do measure across those three assistants, so naming
 * them there is accurate.
 *
 * ⚠️ IT IS NOT ACCURATE ON THE DEFAULT CARD, and it was there. `/og/default.png` is
 * the share image for the landing page and every utility page — the one that travels
 * when anyone posts a link to this site — and it carried "ChatGPT · Gemini ·
 * Perplexity" under a header reading "PUBLISHED BUYING STANDARDS" and a line reading
 * "The questions a competent buyer asks, run as tests." The image contradicted itself,
 * and it advertised the product this one replaced. v3.2 checked this site for retired
 * vocabulary and passed: every one of those checks reads SOURCE STRINGS, and no
 * absence sweep over source can see a phrase rendered into a PNG.
 */
const engineFooter = (extra?: string) =>
  textEl(MX, 578, 22, MUTED, xml(`ChatGPT · Gemini · Perplexity${extra ? ` ${extra}` : ""}`));

/** The default card's footer: what this product actually is. */
const standardFooter = () =>
  textEl(MX, 578, 22, MUTED, xml("Published standards · Executable buyer tests · Evidence, and a measured error bound"));

/** The ONE font configuration. Exported through `cardRightEdge` so a measurement can
 *  never be taken with a different one — see the warning there. */
const fontOpts = () => ({ fontFiles: [FONT_PATH], defaultFontFamily: "Inter", loadSystemFonts: false });

function rasterize(svg: string): Buffer {
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: W }, font: fontOpts() });
  return resvg.render().asPng();
}

/**
 * The rendered right edge of a card, measured by resvg's OWN text shaping.
 *
 * ⚠️ IT MUST BE MEASURED WITH THE CARD'S FONT, AND THE FIRST VERSION OF THIS CHECK WAS
 * NOT. Constructing `new Resvg(svg, { font: { loadSystemFonts: false } })` with no
 * `fontFiles` loads NO font at all, so every <text> shapes to zero width and the bbox
 * collapses to the background rect — exactly 1200. A width check written that way
 * reports "nothing overflows" for every card ever built, including one whose text runs
 * to x=1489. A two-sided canary in the test caught it; without one it would have read
 * as a clean pass over the live defect.
 *
 * Lives here rather than in the test so the measurement and the render can never drift
 * onto different fonts.
 */
export function cardRightEdge(svg: string): number | null {
  const bbox = new Resvg(svg, { font: fontOpts() }).getBBox();
  return bbox ? bbox.x + bbox.width : null;
}

export const CARD_WIDTH = W;

// ---- report card (doctrine: category-framed, never loser-headlined) --------

function reportInner(p: ReportPreview): string {
  const brand = p.brand || "This store";
  const cat = p.category || "its category";
  const title = fittedLines(brand, CW, 64, 40);
  const frameLine = fittedLines(
    `Which brands AI assistants recommend in ${cat}`,
    CW, 34, 22,
  );
  const nLine = `measured across ChatGPT, Gemini & Perplexity${p.basedOnResponses > 0 ? ` — ${p.basedOnResponses} AI answers` : ""}`;
  let y = 250;
  const parts: string[] = [];
  for (const l of title.lines) {
    parts.push(textEl(MX, y, title.size, INK, xml(l), { weight: 700 }));
    y += title.size + 12;
  }
  parts.push(textEl(MX, y + 8, 28, MUTED, xml(`AI Visibility Report · ${cat}`)));
  y += 100;
  for (const l of frameLine.lines) {
    parts.push(textEl(MX, y, frameLine.size, INK, xml(l)));
    y += frameLine.size + 12;
  }
  parts.push(textEl(MX, y + 4, 26, MUTED, xml(nLine)));
  parts.push(textEl(MX, 520, 26, ACCENT, xml("See the full breakdown →"), { weight: 700 }));
  parts.push(engineFooter());
  return parts.join("\n  ");
}

/** The /report/:id share card. NO score, NO losing rate — the poster frames the
 *  category question; the merchant's numbers live on the page they lead to. */
export function buildReportCardSvg(p: ReportPreview, brandName: string): string {
  return frame(ACCENT, brandName, "AI VISIBILITY REPORT", reportInner(p));
}

// v3.3 CP-A — `DemoCardModel` and `buildDemoCardSvg` are GONE with the fixture that
// fed them. The card rendered a "SAMPLE · FICTIONAL BRAND" badge over a rival
// leaderboard headlined "AI recommends Sennen in just 2 of 36 answers about skincare"
// — the retired instrument, travelling in an image, every time anyone shared /demo.
// The Example test is a real result now and takes the brand default card.

// ---- index cards (dominance-gated — same gate as the page) -----------------

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** The /index/:slug share card. `model` comes from indexOgModel(), which runs the SAME
 *  rankView dominance gate as the SSR page — crown here ⇔ crown on the page. */
export function buildIndexSlugCardSvg(model: IndexOgModel, brandName: string): string {
  const parts: string[] = [];
  const label = fittedLines(model.label, CW, 54, 34);
  let y = 210;
  for (const l of label.lines) {
    parts.push(textEl(MX, y, label.size, INK, xml(l), { weight: 700 }));
    y += label.size + 10;
  }
  // Honesty-gated headline: gold + ★ ONLY when the dominance gate passed.
  const head = fittedLines(model.headline, CW, 30, 20);
  y += 24;
  for (const [i, l] of head.lines.entries()) {
    parts.push(textEl(MX, y, head.size, model.gated ? ACCENT : INK, xml(i === 0 && model.gated ? `★ ${l}` : l), { weight: 700 }));
    y += head.size + 10;
  }

  // Top rows with raw counts so closeness is self-evident (tie-aware ranks).
  const rows = model.rows.slice(0, 4);
  let ry = Math.max(y + 34, 386);
  for (const [i, r] of rows.entries()) {
    const isCrown = model.gated && i === 0;
    const countLabel = r.count != null && model.n ? `${r.count} of ${model.n}` : `${Math.round(r.recommendation * 100)}%`;
    parts.push(textEl(MX, ry, 30, isCrown ? ACCENT : INK, xml(`${r.rank}. ${r.brand}${isCrown ? "  ★" : ""}`), { weight: isCrown ? 700 : 400 }));
    parts.push(textEl(RX, ry, 30, isCrown ? ACCENT : MUTED, xml(countLabel), { anchor: "end" }));
    ry += 44;
  }

  const metaBits = [
    model.updatedAt ? `· scanned ${fmtDate(model.updatedAt)}` : "",
    `· ${model.brandsRanked} brands ranked`,
    model.n ? `· n=${model.n} answers` : "",
  ].filter(Boolean).join(" ");
  parts.push(engineFooter(metaBits));
  return frame(model.gated ? ACCENT : SLATE, brandName, "AI VISIBILITY INDEX", parts.join("\n  "));
}

/** The /index (category list) share card. */
export function buildIndexListCardSvg(categories: Array<{ label: string; brands: number }>, brandName: string): string {
  const parts: string[] = [];
  parts.push(textEl(MX, 230, 56, INK, xml("The AI Visibility Index"), { weight: 700 }));
  const sub = fittedLines("Which brands ChatGPT, Gemini & Perplexity actually recommend when shoppers ask what to buy", CW, 28, 20);
  let y = 286;
  for (const l of sub.lines) {
    parts.push(textEl(MX, y, sub.size, MUTED, xml(l)));
    y += sub.size + 10;
  }
  let ry = Math.max(y + 30, 370);
  for (const c of categories.slice(0, 4)) {
    parts.push(textEl(MX, ry, 30, INK, xml(c.label), { weight: 700 }));
    parts.push(textEl(RX, ry, 26, MUTED, xml(`${c.brands} brands ranked`), { anchor: "end" }));
    ry += 46;
  }
  if (categories.length > 4) parts.push(textEl(MX, ry, 24, MUTED, xml(`+ ${categories.length - 4} more categories`)));
  parts.push(engineFooter("· measured by scan, not vibes"));
  return frame(ACCENT, brandName, "AI VISIBILITY INDEX", parts.join("\n  "));
}

// ---- default brand card (landing + utility pages) ---------------------------

export function buildDefaultCardSvg(brandName: string, tagline: string): string {
  const parts: string[] = [];
  parts.push(textEl(MX, 280, 72, INK, xml(brandName), { weight: 700 }));
  parts.push(textEl(MX, 336, 30, ACCENT, xml("The questions a competent buyer asks, run as tests."), { weight: 700 }));
  // Four lines, not two: the tagline is 273 characters and is kept byte-identical to
  // viewer/src/copy.ts, so the card has to wrap it rather than shorten it. y=410 with
  // four lines at ≤26px ends well above the footer baseline at 578.
  const tag = fittedLines(tagline, CW, 26, 17, 4);
  let y = 410;
  for (const l of tag.lines) {
    parts.push(textEl(MX, y, tag.size, MUTED, xml(l)));
    y += tag.size + 10;
  }
  parts.push(standardFooter());
  return frame(ACCENT, brandName, "PUBLISHED BUYING STANDARDS", parts.join("\n  "));
}

// ---- rasterization -----------------------------------------------------------

/** Rasterize any card SVG to a 1200×630 PNG buffer. */
export function renderCardPng(svg: string): Buffer {
  return rasterize(svg);
}

/** The /report/:id card (kept as the entry point the report route uses). */
export function renderOgPng(p: ReportPreview, brandName: string): Buffer {
  return rasterize(buildReportCardSvg(p, brandName));
}
