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
  // the preview must carry no PII (it's served publicly + drives the OG card)
  assert.ok(!JSON.stringify(p).includes("@"));
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
