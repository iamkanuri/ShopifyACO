import { test } from "node:test";
import assert from "node:assert/strict";
import { indexOgModel } from "../src/server/indexSsr.js";
import { buildDemoCardSvg, buildIndexListCardSvg, buildIndexSlugCardSvg, buildReportCardSvg, renderCardPng } from "../src/server/ogCard.js";
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

test("demo card is rich but honestly labeled a fictional sample", () => {
  const svg = buildDemoCardSvg(PREVIEW, "AisleLens");
  assert.ok(svg.includes("SAMPLE"));
  assert.ok(svg.includes("FICTIONAL"));
  assert.ok(svg.includes("When shoppers ask AI, competitors get named instead."));
});

test("cards rasterize to a real 1200×630 PNG", () => {
  const png = renderCardPng(buildIndexListCardSvg([{ label: "Test Category", brands: 12 }], "AisleLens"));
  // PNG magic bytes + IHDR dimensions.
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});
