import { test } from "node:test";
import assert from "node:assert/strict";
import type { Config, PromptEngineResult } from "../src/types.js";
import { extractDiscoveredBrands } from "../src/analysis/discoveredBrands.js";

// Fix 1: surface brands the AI recommended that weren't configured — with a hallucination floor
// (≥2 answers) and exclusion of the own brand + configured competitors. Tested with an INJECTED
// extractor so it's $0 and deterministic (no LLM). The extractor stands in for the LLM's per-answer
// output — a real LLM is prompted to drop negative/passing mentions; the FLOOR is our own guard
// that a brand appearing only once (a passing mention that slipped through) is never surfaced.

function answer(prompt: string, text: string): PromptEngineResult {
  return {
    prompt, template: "t", engine: "openai", model: "gpt-5.4-mini",
    groundingMode: "web_grounded", text, detections: [], usage: {},
  };
}

const cfg: Config = {
  brand: { name: "Burberry" },
  category: "luxury handbags",
  competitors: [{ name: "Prada" }, { name: "Saint Laurent", aliases: ["YSL"] }],
  promptTemplates: [],
};

test("surfaces ≥2-answer unlisted brands; drops single hits, own brand, and competitors", async () => {
  // Each answer's text encodes which brands the (fake) LLM would return.
  const perAnswer: Record<string, string[]> = {
    a1: ["Loewe", "Bottega Veneta", "Prada", "Burberry"], // Prada=competitor, Burberry=own → excluded
    a2: ["Loewe", "Hermès"], // Loewe → 2
    a3: ["Bottega Veneta", "The Row"], // Bottega → 2
    a4: ["Loewe", "YSL"], // Loewe → 3; YSL is Saint Laurent alias → excluded
    a5: ["Zara"], // single passing mention → dropped by the 2-answer floor
  };
  const results = Object.entries(perAnswer).map(([k]) => answer(k, `Answer ${k} recommending several handbag brands for everyday use.`));

  const { brands, answersConsidered } = await extractDiscoveredBrands(results, cfg, {
    apiKey: undefined,
    extractor: async (text) => ({ brands: perAnswer[text.split(" ")[1]!] ?? [], cost: 0 }),
  });

  assert.equal(answersConsidered, 5);
  const names = brands.map((b) => b.name);
  assert.deepEqual(names, ["Loewe", "Bottega Veneta"], "only ≥2-answer brands, by frequency");
  assert.equal(brands[0]!.answers, 3);
  assert.equal(brands[1]!.answers, 2);

  // Guards:
  assert.ok(!names.includes("Prada"), "configured competitor excluded");
  assert.ok(!names.includes("Burberry"), "own brand excluded");
  assert.ok(!names.includes("Saint Laurent") && !names.includes("YSL"), "competitor alias excluded");
  assert.ok(!names.includes("Zara"), "single-answer (passing) mention dropped by the 2-answer floor");
  assert.ok(!names.includes("Hermès") && !names.includes("The Row"), "single-answer hits dropped by the floor");
});

test("returns nothing without an apiKey or injected extractor", async () => {
  const results = [answer("a1", "some answer text that is long enough to be considered here")];
  const r = await extractDiscoveredBrands(results, cfg, { apiKey: undefined });
  assert.deepEqual(r, { brands: [], answersConsidered: 1, costUsd: 0 });
});
