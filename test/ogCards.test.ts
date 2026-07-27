import { test } from "node:test";
import assert from "node:assert/strict";
import { indexOgModel } from "../src/server/indexSsr.js";
import {
  buildDefaultCardSvg, buildIndexListCardSvg, buildIndexSlugCardSvg, buildReportCardSvg,
  renderCardPng, cardRightEdge, CARD_WIDTH,
} from "../src/server/ogCard.js";
import { TAGLINE } from "../viewer/src/copy.js";
import type { ReportPreview } from "../src/server/reportPreview.js";
import type { CategoryIndexRow } from "../src/db/supabase.js";

// ===========================================================================
// OG share cards. The one invariant that matters most: the IMAGE obeys the same
// honesty rules as the page — a crown renders ONLY when the page's dominance gate
// passes, and a merchant's report card never headlines their score/losing rate
// (winner- or field-headlined, never loser-headlined).
// ===========================================================================

const row = (entries: Array<{ brand: string; mention: number; recommendation: number }>): CategoryIndexRow =>
  ({ slug: "test-cat", label: "Test Category", entries, updated_at: "2026-07-08T00:00:00Z", run_id: null } as unknown as CategoryIndexRow);

// n=90. Crowned: 24 vs 9 (ratio 2.7×, count ≥ 8 → gate passes).
const CROWNED = row([
  { brand: "ezpz", mention: 0.5, recommendation: 24 / 90 },
  { brand: "Runner Up", mention: 0.4, recommendation: 9 / 90 },
  { brand: "Third", mention: 0.3, recommendation: 4 / 90 },
]);
// Contested: 24 vs 13 (ratio < 2× → no crown). Mirrors the real artisan-shave-soap data.
const CONTESTED = row([
  { brand: "Barrister and Mann", mention: 0.5, recommendation: 24 / 90 },
  { brand: "Stirling Soap Co", mention: 0.4, recommendation: 13 / 90 },
  { brand: "Third", mention: 0.3, recommendation: 5 / 90 },
]);
// Tied at the top: never crowns.
const TIED = row([
  { brand: "A", mention: 0.5, recommendation: 10 / 90 },
  { brand: "B", mention: 0.4, recommendation: 10 / 90 },
]);

test("indexOgModel crowns ONLY when the page's dominance gate passes", () => {
  const crowned = indexOgModel(CROWNED, 90)!;
  assert.equal(crowned.gated, true);
  assert.match(crowned.headline, /ezpz — the clear AI favorite/);
  assert.match(crowned.headline, /24 of 90/);

  const contested = indexOgModel(CONTESTED, 90)!;
  assert.equal(contested.gated, false);
  assert.match(contested.headline, /no runaway leader/);
  assert.match(contested.headline, /Barrister and Mann/);
  assert.match(contested.headline, /Stirling Soap Co/);

  const tied = indexOgModel(TIED, 90)!;
  assert.equal(tied.gated, false);
  assert.match(tied.headline, /No single favorite/);
});

test("index slug card renders the crown only for a gated leader", () => {
  const crownedSvg = buildIndexSlugCardSvg(indexOgModel(CROWNED, 90)!, "AisleLens");
  assert.ok(crownedSvg.includes("★"), "gated card should carry the crown");
  assert.ok(crownedSvg.includes("24 of 90"), "counts with n travel on the card");

  const contestedSvg = buildIndexSlugCardSvg(indexOgModel(CONTESTED, 90)!, "AisleLens");
  assert.ok(!contestedSvg.includes("★"), "a contested card must NOT crown anyone");
  assert.ok(contestedSvg.includes("no runaway leader"));
  // The date stamp travels with the claim.
  assert.ok(contestedSvg.includes("Jul 8, 2026"));
});

const PREVIEW: ReportPreview = {
  brand: "Olipop", category: "prebiotic soda", score: 43, mentionRate: 85, recommendationRate: 58,
  gapPoints: 27, gapLine: "Known by AI 85% of the time, recommended only 58% — that 27-point gap is demand going to competitors.",
  weakestEngine: "ChatGPT", headline: "When shoppers ask AI, competitors get named instead.", isShopify: false, basedOnResponses: 48,
};

test("report card is category-framed and NEVER headlines the merchant's score or losing rate", () => {
  const svg = buildReportCardSvg(PREVIEW, "AisleLens");
  assert.ok(svg.includes("Olipop"));
  assert.ok(svg.includes("Which brands AI assistants recommend in prebiotic soda"));
  assert.ok(svg.includes("48 AI answers"));
  // The doctrine assertions: no score, no losing-rate framing on the poster.
  assert.ok(!svg.includes("43"), "the merchant's score must not appear on the poster");
  assert.ok(!svg.includes("/ 100"));
  assert.ok(!svg.includes("gap is demand"), "the losing gap line stays on the page, not the poster");
});

// v3.3 — the demo card's test is GONE with the card. It asserted a fictional brand's
// rival leaderboard ("AI recommends Sennen in just 2 of 36 answers about skincare"),
// which is the product this one replaced.

test("the DEFAULT card describes THIS product, not the one it replaced", () => {
  // ⚠️ WHY THIS TEST DID NOT EXIST BEFORE, WHICH IS THE POINT. `/og/default.png` is the
  // share image for the landing page and every utility page, and it was the ONE card
  // variant this file never imported. It rendered "ChatGPT · Gemini · Perplexity" under
  // a header reading "PUBLISHED BUYING STANDARDS" — the retired positioning, in the
  // image that travels every link to this site. v3.2 swept the site for retired
  // vocabulary and passed, because every one of those sweeps reads source strings and
  // no absence check over source can see a phrase rendered into a PNG.
  const svg = buildDefaultCardSvg("AisleLens", TAGLINE);
  assert.ok(svg.includes("PUBLISHED BUYING STANDARDS"));
  assert.doesNotMatch(svg, /ChatGPT|Gemini|Perplexity|Copilot/,
    "the default card names AI assistants — that is the retired product, baked into an image");
  assert.doesNotMatch(svg, /\b(score|ranking|visibility|share of voice)\b/i,
    "banned vocabulary on the card that travels every share of this site");
});

/** resvg's OWN text shaping with the card's OWN font — not our 0.53em character-width
 *  model, which is the thing under test. `cardRightEdge` lives in ogCard.ts so the
 *  measurement can never be taken with a different font from the render; measuring
 *  without `fontFiles` shapes every glyph to zero width and reports a clean 1200. */
function rightEdge(svg: string): number {
  const edge = cardRightEdge(svg);
  assert.ok(edge != null, "resvg could not measure the card — the instrument, not the card, failed");
  return edge!;
}

test("NO CARD RENDERS PAST ITS OWN CANVAS", () => {
  // ⚠️ THE DEFECT THIS CATCHES, MEASURED IN PRODUCTION. The old wrapper split text at
  // the midpoint and truncated only the SECOND line; line 1 was emitted verbatim,
  // never measured against any width. On the live default card that put line 1 at
  // ~134 characters and the card's right edge at 1378.6 on a 1200px canvas, so
  // lens.thirdocular.com/og/default.png clipped its own description mid-word
  // ("…written as exe") in every unfurl since it shipped.
  //
  // Every previous assertion in this file is `svg.includes(…)` on the SVG SOURCE, and
  // a <text> element that runs to x=1489 contains exactly the same characters as one
  // that fits. Presence cannot see position. This measures.
  const cards: Array<[string, string]> = [
    ["default", buildDefaultCardSvg("AisleLens", TAGLINE)],
    ["report", buildReportCardSvg(PREVIEW, "AisleLens")],
    ["index-list", buildIndexListCardSvg([{ label: "Baby-led weaning tableware", brands: 12 }], "AisleLens")],
    ["index-slug/crowned", buildIndexSlugCardSvg(indexOgModel(CROWNED, 90)!, "AisleLens")],
    ["index-slug/contested", buildIndexSlugCardSvg(indexOgModel(CONTESTED, 90)!, "AisleLens")],
  ];
  const over = cards
    .map(([name, svg]) => [name, rightEdge(svg)] as const)
    .filter(([, edge]) => edge > CARD_WIDTH);
  assert.deepEqual(over, [], `card content runs past the ${CARD_WIDTH}px canvas: ${over.map(([n, e]) => `${n} → ${e.toFixed(1)}`).join(", ")}`);

  // TWO-SIDED LIVENESS. A measurement that reports "nothing overflows" is worthless if
  // the instrument cannot detect an overflow at all, and this whole file used to be
  // exactly that. A card built with text that MUST overflow has to measure > 1200.
  const canary = buildIndexListCardSvg(
    [{ label: `${"Wide".repeat(60)}`, brands: 1 }], "AisleLens".repeat(30),
  );
  assert.ok(rightEdge(canary) > CARD_WIDTH, "the overflow detector did not fire on deliberately oversized text — the instrument is collapsed, and a clean result from it means nothing");
});

test("the default card wraps its whole tagline instead of deleting the end of it", () => {
  // The tagline is byte-identical to viewer/src/copy.ts (siteCopy.test.ts asserts the
  // pair), so the card must WRAP it, never shorten it. An ellipsis here means the share
  // image is publishing a sentence the site does not say.
  const svg = buildDefaultCardSvg("AisleLens", TAGLINE);
  const rendered = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]!);
  const body = rendered.join(" ").replace(/&amp;/g, "&").replace(/&apos;/g, "'").replace(/&quot;/g, '"');
  assert.ok(!body.includes("…"), "the default card truncated its own tagline");
  // Every word of the tagline survives, in order, once punctuation-insensitive.
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  assert.ok(norm(body).includes(norm(TAGLINE)), "the tagline is not rendered whole on the default card");
});

test("cards rasterize to a real 1200×630 PNG", () => {
  const png = renderCardPng(buildIndexListCardSvg([{ label: "Test Category", brands: 12 }], "AisleLens"));
  // PNG magic bytes + IHDR dimensions. NOTE: these come from `fitTo: { mode: "width",
  // value: W }`, so they are canvas constants by construction and read 1200×630 no
  // matter how far the text runs off the edge. That is what the getBBox test above is
  // for; this one only proves the rasterizer works at all.
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});
