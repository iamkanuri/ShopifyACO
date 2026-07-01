import { test } from "node:test";
import assert from "node:assert/strict";
import type { Config } from "../src/types.js";
import type { MerchantAnalysis } from "../src/analysis/types.js";
import { analyzeRun } from "../src/analysis/index.js";
import { generateArtifacts } from "../src/artifacts/generate.js";
import { fashionRun } from "./support/categoryFixtures.js";

// Paid-report Phase 2: the done-for-you bundle. Mock ($0) — LLM drafting is gated on live+apiKey;
// without it the deterministic templates run, so the pipeline + placeholders + restraint are testable.

test("generateArtifacts drafts a grounded bundle with merchant placeholders (mock, $0)", async () => {
  const run = fashionRun();
  const a = analyzeRun(run);
  const bundle = await generateArtifacts(a, run.results, run.config, { live: false });

  assert.equal(bundle.costUsd, 0);
  const kinds = bundle.artifacts.map((x) => x.kind);
  assert.ok(kinds.includes("comparison_page"), "a real threat → a comparison page");
  assert.ok(kinds.includes("llms_txt") && kinds.includes("product_schema"), "always ships llms.txt + schema");

  const cmp = bundle.artifacts.find((x) => x.kind === "comparison_page")!;
  assert.match(cmp.body, /Prada/, "names the real threat");
  assert.ok(cmp.placeholders.length > 0, "never fabricates store facts — carries [placeholders]");
  assert.equal(cmp.drafted, "template");

  const schema = bundle.artifacts.find((x) => x.kind === "product_schema")!;
  assert.doesNotThrow(() => JSON.parse(schema.body), "JSON-LD scaffold is valid JSON");

  assert.match(bundle.bridge, /AisleLens Shopify app/, "bundle closes with the recurring-app bridge");
});

test("restraint: a winning brand (no threat) gets NO manufactured comparison page", async () => {
  const cfg: Config = { brand: { name: "WinnerCo" }, category: "widgets", competitors: [], promptTemplates: [] };
  const a = {
    brand: "WinnerCo", category: "widgets", threat: null,
    fixCards: [], proofPoints: [], clusters: [], discoveredBrands: [],
  } as unknown as MerchantAnalysis;

  const bundle = await generateArtifacts(a, [], cfg, { live: false });
  assert.ok(!bundle.artifacts.some((x) => x.kind === "comparison_page"), "no vs page when winning");
  assert.ok(bundle.artifacts.some((x) => x.kind === "llms_txt"), "still gets the hygiene artifacts");
});
