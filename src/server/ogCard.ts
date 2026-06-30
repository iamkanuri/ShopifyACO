import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import type { ReportPreview } from "./reportPreview.js";

// Dynamic 1200×630 OG/social share card for a report. Hand-built SVG → PNG via resvg, with a
// BUNDLED Inter font (resvg renders no text without a font on a slim container). No PII — only
// brand, category, score, and the mention→recommend gap. The PNG is deterministic per report,
// so the caller caches it to the volume (rasterize once; social scrapers re-fetch).

// The bundled Inter font path, resolved relative to THIS file (works regardless of cwd). It
// ships in the repo (assets/fonts), so it's in the deployed image. fontFiles + loadSystemFonts:
// false → resvg uses ONLY this font (no reliance on system fonts on a slim container).
const FONT_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "fonts", "Inter.ttf");
// Fail fast at boot if the font is missing (otherwise cards would render blank text).
readFileSync(FONT_PATH);

const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

function scoreColor(score: number | null): string {
  if (score == null) return "#8a8882";
  if (score >= 70) return "#6bbf9a"; // good (green)
  if (score >= 40) return "#cba35c"; // moderate (amber)
  return "#d07a7a"; // weak (red)
}

/** Build the SVG card for a report preview. brandName = the AisleLens public brand. */
export function buildOgSvg(p: ReportPreview, brandName: string): string {
  const score = p.score;
  const title = p.brand ? `${p.brand}${p.category ? ` · ${p.category}` : ""}` : (p.category || "Your store");
  const gapLine =
    p.mentionRate != null && p.recommendationRate != null && p.gapPoints != null
      ? `Mentioned ${p.mentionRate}% · recommended only ${p.recommendationRate}% — a ${p.gapPoints}-pt gap going to competitors`
      : "How often AI assistants recommend you vs your competitors";
  const c = scoreColor(score);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#14161f"/>
  <rect x="0" y="0" width="1200" height="8" fill="${c}"/>
  <text x="80" y="96" font-family="Inter" font-size="30" font-weight="700" fill="#ECEAE3" letter-spacing="0.5">${xml(brandName)}</text>
  <text x="80" y="132" font-family="Inter" font-size="22" fill="#8a8882">AI Shopping Visibility</text>

  <text x="80" y="250" font-family="Inter" font-size="46" font-weight="700" fill="#ECEAE3">${xml(title)}</text>

  <text x="80" y="430" font-family="Inter" font-size="180" font-weight="700" fill="${c}">${score == null ? "—" : score}</text>
  <text x="${80 + (score == null ? 70 : String(score).length * 108)}" y="430" font-family="Inter" font-size="56" fill="#8a8882">/ 100</text>
  <text x="84" y="478" font-family="Inter" font-size="26" font-weight="700" fill="#8a8882" letter-spacing="1">AI VISIBILITY SCORE</text>

  <text x="80" y="560" font-family="Inter" font-size="30" fill="#ECEAE3">${xml(gapLine)}</text>
</svg>`;
}

/** Rasterize the card to a 1200×630 PNG buffer. */
export function renderOgPng(p: ReportPreview, brandName: string): Buffer {
  const svg = buildOgSvg(p, brandName);
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: 1200 },
    font: { fontFiles: [FONT_PATH], defaultFontFamily: "Inter", loadSystemFonts: false },
  });
  return resvg.render().asPng();
}
