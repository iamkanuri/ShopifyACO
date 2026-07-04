import { test } from "node:test";
import assert from "node:assert/strict";
import type { Config } from "../src/types.js";
import type { MerchantAnalysis } from "../src/analysis/types.js";
import { discoverSeeds } from "../src/crawler/seeds.js";
import { crawlMerchantFacts } from "../src/paid/generate.js";
import { generateArtifacts } from "../src/artifacts/generate.js";
import { renderFactSentences } from "../src/artifacts/factSentences.js";
import { validateMerchantDraft } from "../src/artifacts/validateDraft.js";
import { MOCK_STORE_URL } from "../src/crawler/fixtures.js";

// Tier 2a END-TO-END through the ACTUAL crawl path (CRAWLER_MODE defaults to mock → $0, no network):
//   discoverSeeds → crawlSeeds → buildMerchantFacts → generateArtifacts.
// Everything mock-tested before this ran on HAND-BUILT MerchantFacts; this is the first test that the
// CRAWLER itself extracts correct facts and that they flow, tagged, into the paid artifacts.

const BRAND = { name: "AisleShop", storeUrl: MOCK_STORE_URL };

test("discoverSeeds (mock Shopify store): /products.json → homepage + PDP seeds", async () => {
  const d = await discoverSeeds(MOCK_STORE_URL, 7);
  assert.ok(d, "discovery returns a result");
  assert.equal(d!.method, "products_json", "prefers the Shopify products.json list");
  assert.equal(d!.seeds[0], MOCK_STORE_URL, "homepage is seed[0]");
  assert.ok(d!.seeds.includes("https://shop.example.com/products/vintage-cola"));
  assert.ok(d!.seeds.includes("https://shop.example.com/products/root-beer-float"));
  assert.ok(d!.seeds.length <= 8, "respects the 1 homepage + ≤7 PDP budget");
});

test("crawlMerchantFacts: the crawler extracts CORRECT structured facts from the store", async () => {
  const facts = await crawlMerchantFacts(BRAND);
  assert.ok(facts, "facts built from the crawl");
  // price: RANGE across the two PDPs, never averaged (R3).
  assert.equal(facts!.price!.currency, "USD");
  assert.equal(facts!.price!.min, 19);
  assert.equal(facts!.price!.max, 24);
  assert.equal(facts!.price!.productCount, 2);
  // ratings: range + the flagship exemplar (highest review count).
  assert.equal(facts!.ratings!.min, 4.6);
  assert.equal(facts!.ratings!.max, 4.8);
  assert.equal(facts!.ratings!.top!.productName, "Vintage Cola");
  assert.equal(facts!.ratings!.top!.rating, 4.8);
  assert.equal(facts!.ratings!.top!.reviewCount, 2341);
  // presence facts.
  assert.deepEqual(facts!.inStock, { count: 2, of: 2 });
  assert.equal(facts!.schemaPresence.returns, 2);
  assert.equal(facts!.coverage.pdpCount, 2);
  // a stated claim (verbatim, attributed) — free shipping copy from the store.
  assert.ok(facts!.stated.some((s) => s.kind === "shipping" && /free shipping/i.test(s.text)));
});

test("e2e: crawled facts fill the paid artifacts, tagged, and survive the honesty validator", async () => {
  const facts = await crawlMerchantFacts(BRAND);
  assert.ok(facts);

  const cfg: Config = { brand: { name: "AisleShop" }, category: "prebiotic soda", competitors: [], promptTemplates: [] };
  // A "winner" out-recommended by a DISCOVERED brand → a comparison page targeting it (real evidence).
  const analysis = {
    brand: "AisleShop", category: "prebiotic soda", threat: null, fixCards: [], clusters: [],
    proofPoints: [{ id: "ingredients_formulation", label: "Ingredients & formulation", hits: 3, competitors: [] }],
    discoveredBrands: [{ name: "Poppi", answers: 8 }],
    mentionGap: { recommendation: { count: 5, total: 24, rate: 0.21 } },
  } as unknown as MerchantAnalysis;
  const results = [{
    prompt: "best prebiotic soda?", template: "t", engine: "openai", model: "gpt-5.4-mini",
    groundingMode: "web_grounded" as const, text: "Poppi is a widely stocked prebiotic soda many shoppers reach for first.", detections: [], usage: {},
  }];

  const bundle = await generateArtifacts(analysis, results, cfg, { live: false, merchantFacts: facts! });

  // --- comparison page: real facts in "by the numbers", "Where you win" placeholder-only ---
  const cmp = bundle.artifacts.find((a) => a.kind === "comparison_page")!;
  assert.match(cmp.body, /## AisleShop by the numbers/);
  assert.match(cmp.body, /prices ranged from 19 to 24 USD\. \(fact F\d+ — crawled shop\.example\.com,/, "real crawled price range, tagged");
  assert.match(cmp.body, /4\.8★ across 2341 reviews.*\(fact F\d+ — crawled shop\.example\.com\/products\/vintage-cola,/, "flagship rating tagged to its PDP");
  // "Where AisleShop wins" is structurally placeholder-only (the Bombas fix).
  const winSection = cmp.body.slice(cmp.body.indexOf("Where AisleShop wins"));
  assert.match(winSection, /\(you provide\)\]/, "Where-you-win is a provide-it placeholder");
  assert.doesNotMatch(winSection, /\bbetter\b|\bsuperior\b|\bbeats\b/i, "no superiority claim in Where-you-win");
  assert.ok(cmp.provenance!.some((t) => /^\(fact F\d+/.test(t)), "artifact carries crawled-fact provenance");

  // The honesty validator must pass clean on the crawl-derived body (0 downgrades, no fallback).
  const sentences = renderFactSentences(facts!);
  const v = validateMerchantDraft(cmp.body, sentences, results.map((r) => r.text), ["AisleShop"]);
  assert.equal(v.downgrades, 0, `crawl-derived facts must validate clean: ${JSON.stringify(v.violations)}`);
  assert.equal(v.usedFallback, false);

  // --- llms.txt: real, dated price line substituted deterministically (no drafter) ---
  const llms = bundle.artifacts.find((a) => a.kind === "llms_txt")!;
  assert.match(llms.body, /Price range: 19–24 USD \(read from 2 of your product pages on \d{4}-\d{2}-\d{2}/);
  assert.match(llms.body, /https:\/\/shop\.example\.com/, "real store URL in Where-to-buy");

  // --- Product JSON-LD: flagship PDP's real values, still valid JSON ---
  const schema = bundle.artifacts.find((a) => a.kind === "product_schema")!;
  const parsed = JSON.parse(schema.body) as any;
  assert.equal(parsed.name, "Vintage Cola");
  assert.equal(parsed.offers.price, "19");
  assert.equal(parsed.offers.priceCurrency, "USD");
  assert.equal(parsed.aggregateRating.ratingValue, "4.8");
  assert.equal(parsed.aggregateRating.reviewCount, "2341");
});
