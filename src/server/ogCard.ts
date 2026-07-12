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
const INK = "#ECEAE3";
const MUTED = "#8a8882";
const GOLD = "#cba35c";
const GREEN = "#6bbf9a";
const BG = "#14161f";

const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

// resvg doesn't wrap <text>: fit a single line by shrinking, and split long text onto
// two lines when even the minimum size would overflow. ~0.53em average glyph width.
const fitSize = (text: string, maxPx: number, max: number, min: number) =>
  Math.max(min, Math.min(max, Math.floor(maxPx / (Math.max(1, text.length) * 0.53))));

function splitTwo(text: string): [string, string] {
  const words = text.split(" ");
  let l1 = "";
  for (const w of words) {
    if (l1 && (l1 + " " + w).length > Math.ceil(text.length / 2)) break;
    l1 = l1 ? `${l1} ${w}` : w;
  }
  return [l1, text.slice(l1.length).trim()];
}

/** Fit text into maxPx wide; returns 1–2 lines + the font size to render them at. */
function fittedLines(text: string, maxPx: number, max: number, min: number): { lines: string[]; size: number } {
  if (text.length * 0.53 * min <= maxPx) {
    return { lines: [text], size: fitSize(text, maxPx, max, min) };
  }
  const [l1, l2] = splitTwo(text);
  const longest = Math.max(l1.length, l2.length);
  let size = fitSize("x".repeat(longest), maxPx, max, min);
  // Even two lines can overflow at min size for very long text → hard-truncate line 2.
  const capChars = Math.floor(maxPx / (size * 0.53));
  const lines = [l1, l2.length > capChars ? `${l2.slice(0, capChars - 1).trimEnd()}…` : l2];
  return { lines, size };
}

const textEl = (x: number, y: number, size: number, fill: string, content: string, opts: { weight?: number; spacing?: string; anchor?: string } = {}) =>
  `<text x="${x}" y="${y}" font-family="Inter" font-size="${size}"${opts.weight ? ` font-weight="${opts.weight}"` : ""}${opts.spacing ? ` letter-spacing="${opts.spacing}"` : ""}${opts.anchor ? ` text-anchor="${opts.anchor}"` : ""} fill="${fill}">${content}</text>`;

/** Shared card chrome: background, accent bar, brand header, kicker label. */
function frame(accent: string, brandName: string, headerLabel: string, inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <rect x="0" y="0" width="${W}" height="8" fill="${accent}"/>
  ${textEl(80, 92, 30, INK, xml(brandName), { weight: 700, spacing: "0.5" })}
  ${textEl(80, 126, 20, MUTED, xml(headerLabel), { weight: 700, spacing: "2" })}
  ${inner}
</svg>`;
}

const engineFooter = (extra?: string) =>
  textEl(80, 578, 22, MUTED, xml(`ChatGPT · Gemini · Perplexity${extra ? ` ${extra}` : ""}`));

function rasterize(svg: string): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: W },
    font: { fontFiles: [FONT_PATH], defaultFontFamily: "Inter", loadSystemFonts: false },
  });
  return resvg.render().asPng();
}

// ---- report card (doctrine: category-framed, never loser-headlined) --------

function reportInner(p: ReportPreview): string {
  const brand = p.brand || "This store";
  const cat = p.category || "its category";
  const title = fittedLines(brand, 1040, 64, 40);
  const frameLine = fittedLines(
    `Which brands AI assistants recommend in ${cat}`,
    1040, 34, 22,
  );
  const nLine = `measured across ChatGPT, Gemini & Perplexity${p.basedOnResponses > 0 ? ` — ${p.basedOnResponses} AI answers` : ""}`;
  let y = 250;
  const parts: string[] = [];
  for (const l of title.lines) {
    parts.push(textEl(80, y, title.size, INK, xml(l), { weight: 700 }));
    y += title.size + 12;
  }
  parts.push(textEl(80, y + 8, 28, MUTED, xml(`AI Visibility Report · ${cat}`)));
  y += 100;
  for (const l of frameLine.lines) {
    parts.push(textEl(80, y, frameLine.size, INK, xml(l)));
    y += frameLine.size + 12;
  }
  parts.push(textEl(80, y + 4, 26, MUTED, xml(nLine)));
  parts.push(textEl(80, 520, 26, GREEN, xml("See the full breakdown →"), { weight: 700 }));
  parts.push(engineFooter());
  return parts.join("\n  ");
}

/** The /report/:id share card. NO score, NO losing rate — the poster frames the
 *  category question; the merchant's numbers live on the page they lead to. */
export function buildReportCardSvg(p: ReportPreview, brandName: string): string {
  return frame(GREEN, brandName, "AI VISIBILITY REPORT", reportInner(p));
}

/** Everything the demo card renders — extracted from the sample report's own
 *  substitution frame so the card and the page tell the SAME story. */
export interface DemoCardModel {
  brand: string;
  category: string;
  /** The substitution-frame lead the demo page renders (NOT the retired mention-gap line). */
  headline: string;
  /** Named rivals with real recommendation counts, leaderboard-style. */
  rivals: Array<{ name: string; recCount: number }>;
  merchantCount: number | null;
  total: number | null;
}

/** The /demo share card — the RICHEST card of the family (fictional data built to sell;
 *  the SAMPLE badge is what licenses full disclosure). Index-card layout: substitution
 *  headline + named rivals with counts + the sample brand's own count against them. */
export function buildDemoCardSvg(m: DemoCardModel, brandName: string): string {
  const RED = "#d07a7a";
  const parts: string[] = [];
  parts.push(`<rect x="820" y="52" rx="8" width="300" height="44" fill="none" stroke="${GOLD}" stroke-width="2"/>`);
  parts.push(textEl(970, 81, 20, GOLD, xml("SAMPLE · FICTIONAL BRAND"), { weight: 700, anchor: "middle" }));

  parts.push(textEl(80, 208, 44, INK, xml(`${m.brand} — ${m.category}`), { weight: 700 }));

  // The substitution verdict IS the pitch — same lead as the page.
  const head = fittedLines(m.headline, 1040, 30, 20);
  let y = 262;
  for (const l of head.lines) {
    parts.push(textEl(80, y, head.size, GOLD, xml(l), { weight: 700 }));
    y += head.size + 10;
  }

  // Leaderboard rows: rivals + the sample brand, sorted by count, its row marked in red.
  const rows: Array<{ name: string; count: number | null; own: boolean }> = [
    ...m.rivals.map((r) => ({ name: r.name, count: r.recCount as number | null, own: false })),
    ...(m.merchantCount != null ? [{ name: m.brand, count: m.merchantCount as number | null, own: true }] : []),
  ].sort((a, b) => (b.count ?? 0) - (a.count ?? 0)).slice(0, 4);
  let ry = Math.max(y + 30, 356);
  for (const r of rows) {
    const color = r.own ? RED : INK;
    parts.push(textEl(80, ry, 30, color, xml(`${r.own ? "→ " : ""}${r.name}`), { weight: r.own ? 700 : 400 }));
    if (r.count != null) {
      parts.push(textEl(1120, ry, 30, r.own ? RED : MUTED, xml(m.total ? `${r.count} of ${m.total}` : String(r.count)), { anchor: "end" }));
    }
    ry += 44;
  }

  parts.push(engineFooter(`${m.total ? `· n=${m.total} answers ` : ""}· fictional sample data`));
  return frame(GOLD, brandName, "SAMPLE REPORT", parts.join("\n  "));
}

// ---- index cards (dominance-gated — same gate as the page) -----------------

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** The /index/:slug share card. `model` comes from indexOgModel(), which runs the SAME
 *  rankView dominance gate as the SSR page — crown here ⇔ crown on the page. */
export function buildIndexSlugCardSvg(model: IndexOgModel, brandName: string): string {
  const parts: string[] = [];
  const label = fittedLines(model.label, 1040, 54, 34);
  let y = 210;
  for (const l of label.lines) {
    parts.push(textEl(80, y, label.size, INK, xml(l), { weight: 700 }));
    y += label.size + 10;
  }
  // Honesty-gated headline: gold + ★ ONLY when the dominance gate passed.
  const head = fittedLines(model.headline, 1040, 30, 20);
  y += 24;
  for (const [i, l] of head.lines.entries()) {
    parts.push(textEl(80, y, head.size, model.gated ? GOLD : INK, xml(i === 0 && model.gated ? `★ ${l}` : l), { weight: 700 }));
    y += head.size + 10;
  }

  // Top rows with raw counts so closeness is self-evident (tie-aware ranks).
  const rows = model.rows.slice(0, 4);
  let ry = Math.max(y + 34, 386);
  for (const [i, r] of rows.entries()) {
    const isCrown = model.gated && i === 0;
    const countLabel = r.count != null && model.n ? `${r.count} of ${model.n}` : `${Math.round(r.recommendation * 100)}%`;
    parts.push(textEl(80, ry, 30, isCrown ? GOLD : INK, xml(`${r.rank}. ${r.brand}${isCrown ? "  ★" : ""}`), { weight: isCrown ? 700 : 400 }));
    parts.push(textEl(1120, ry, 30, isCrown ? GOLD : MUTED, xml(countLabel), { anchor: "end" }));
    ry += 44;
  }

  const metaBits = [
    model.updatedAt ? `· scanned ${fmtDate(model.updatedAt)}` : "",
    `· ${model.brandsRanked} brands ranked`,
    model.n ? `· n=${model.n} answers` : "",
  ].filter(Boolean).join(" ");
  parts.push(engineFooter(metaBits));
  return frame(model.gated ? GOLD : GREEN, brandName, "AI VISIBILITY INDEX", parts.join("\n  "));
}

/** The /index (category list) share card. */
export function buildIndexListCardSvg(categories: Array<{ label: string; brands: number }>, brandName: string): string {
  const parts: string[] = [];
  parts.push(textEl(80, 230, 56, INK, xml("The AI Visibility Index"), { weight: 700 }));
  const sub = fittedLines("Which brands ChatGPT, Gemini & Perplexity actually recommend when shoppers ask what to buy", 1040, 28, 20);
  let y = 286;
  for (const l of sub.lines) {
    parts.push(textEl(80, y, sub.size, MUTED, xml(l)));
    y += sub.size + 10;
  }
  let ry = Math.max(y + 30, 370);
  for (const c of categories.slice(0, 4)) {
    parts.push(textEl(80, ry, 30, INK, xml(c.label), { weight: 700 }));
    parts.push(textEl(1120, ry, 26, MUTED, xml(`${c.brands} brands ranked`), { anchor: "end" }));
    ry += 46;
  }
  if (categories.length > 4) parts.push(textEl(80, ry, 24, MUTED, xml(`+ ${categories.length - 4} more categories`)));
  parts.push(engineFooter("· measured by scan, not vibes"));
  return frame(GREEN, brandName, "AI VISIBILITY INDEX", parts.join("\n  "));
}

// ---- default brand card (landing + utility pages) ---------------------------

export function buildDefaultCardSvg(brandName: string, tagline: string): string {
  const parts: string[] = [];
  parts.push(textEl(80, 280, 72, INK, xml(brandName), { weight: 700 }));
  parts.push(textEl(80, 336, 30, GREEN, xml("Does AI recommend your store — or your competitors?"), { weight: 700 }));
  const tag = fittedLines(tagline, 1040, 26, 19);
  let y = 410;
  for (const l of tag.lines) {
    parts.push(textEl(80, y, tag.size, MUTED, xml(l)));
    y += tag.size + 10;
  }
  parts.push(engineFooter());
  return frame(GREEN, brandName, "AI SHOPPING VISIBILITY", parts.join("\n  "));
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
