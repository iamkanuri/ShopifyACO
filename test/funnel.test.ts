import { test } from "node:test";
import assert from "node:assert/strict";
import { reportPreview } from "../src/server/reportPreview.js";
import { detectShopify } from "../src/server/shopifyDetect.js";

// ---- reportPreview: the no-PII ungated slice (shared by preview API, OG card, meta) ----
test("reportPreview extracts score + mention→recommend gap + weakest engine", () => {
  const results = {
    meta: { isShopify: true },
    analysis: {
      brand: "Olipop", category: "prebiotic soda", basedOnResponses: 48, weakestEngine: "ChatGPT",
      headline: "AI assistants mention Olipop more than they recommend it.",
      visibilityScore: { score: 72 },
      mentionGap: { mention: { rate: 0.85 }, recommendation: { rate: 0.58 } },
    },
  };
  const p = reportPreview(results)!;
  assert.equal(p.score, 72);
  assert.equal(p.mentionRate, 85);
  assert.equal(p.recommendationRate, 58);
  assert.equal(p.gapPoints, 27);
  assert.equal(p.weakestEngine, "ChatGPT");
  assert.equal(p.isShopify, true);
  assert.equal(p.brand, "Olipop");
  // a real gap → the "leaking to competitors" framing
  assert.match(p.gapLine, /27-point gap is demand going to competitors/);
  // the preview must carry no PII (it's served publicly + drives the OG card)
  assert.ok(!JSON.stringify(p).includes("@"));
});

// The edge case the gap line MUST get right: a brand AI never surfaces has a 0-point gap, which
// is NOT "demand leaking to competitors" — it's being invisible. (Same line drives all 3 surfaces.)
test("gapLine reframes the no-visibility case as invisibility, not a competitor leak", () => {
  const invisible = reportPreview({
    analysis: { brand: "HP Envy", category: "printers", basedOnResponses: 15,
      visibilityScore: { score: 11 }, mentionGap: { mention: { rate: 0 }, recommendation: { rate: 0 } } },
  })!;
  assert.equal(invisible.gapPoints, 0);
  assert.match(invisible.gapLine, /don't surface HP Envy/);
  assert.doesNotMatch(invisible.gapLine, /going to competitors/);
});

test("gapLine calls out a brand AI both knows and recommends as winning", () => {
  const winning = reportPreview({
    analysis: { brand: "Caraway", category: "cookware", basedOnResponses: 30,
      visibilityScore: { score: 88 }, mentionGap: { mention: { rate: 0.9 }, recommendation: { rate: 0.9 } } },
  })!;
  assert.equal(winning.gapPoints, 0);
  assert.match(winning.gapLine, /both know and recommend Caraway/);
  assert.doesNotMatch(winning.gapLine, /going to competitors/);
});

test("reportPreview returns null when there's no analysis yet", () => {
  assert.equal(reportPreview({ meta: {} }), null);
  assert.equal(reportPreview(null), null);
});

// ---- detectShopify: safe default (no URL → false, no network) ----
test("detectShopify defaults to false without a URL (no fetch)", async () => {
  assert.deepEqual(await detectShopify(""), { isShopify: false, signal: null });
  assert.deepEqual(await detectShopify(null), { isShopify: false, signal: null });
  assert.deepEqual(await detectShopify(undefined), { isShopify: false, signal: null });
});
