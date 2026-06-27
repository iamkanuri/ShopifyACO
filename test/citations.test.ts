import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeHttpUrls } from "../src/engines/citations.js";
import { extractResponsesCitations } from "../src/engines/openai.js";
import { extractGeminiCitations } from "../src/engines/gemini.js";
import { extractPerplexityCitations } from "../src/engines/perplexity.js";

// Citation extraction (Phase 4 → 5). These URLs are what the live crawler diagnoses against,
// so getting them out of each provider's grounded response is the linchpin of real evidence.

test("dedupeHttpUrls keeps http(s) only, trims, de-dupes, and caps", () => {
  assert.deepEqual(
    dedupeHttpUrls(["https://a.com", " https://a.com ", "http://b.com", "ftp://x", "not a url", null, undefined, ""]),
    ["https://a.com", "http://b.com"],
  );
  assert.equal(dedupeHttpUrls(Array.from({ length: 50 }, (_, i) => `https://x${i}.com`)).length, 25);
  assert.equal(dedupeHttpUrls(Array.from({ length: 50 }, (_, i) => `https://x${i}.com`), 3).length, 3);
});

test("OpenAI: extracts url_citation annotations from output_text parts", () => {
  const json = {
    output: [
      { type: "message", content: [
        { type: "output_text", text: "GreenPan is great", annotations: [
          { type: "url_citation", url: "https://greenpan.com/x" },
          { type: "url_citation", url: "https://atk.com/review" },
          { type: "file_citation", url: "https://ignored.com" }, // not a url_citation
        ] },
      ] },
      { type: "reasoning", content: [{ type: "output_text", annotations: [{ type: "url_citation", url: "https://drop.me" }] }] },
    ],
  };
  // Only message-type items count; reasoning is skipped.
  assert.deepEqual(extractResponsesCitations(json), ["https://greenpan.com/x", "https://atk.com/review"]);
  assert.deepEqual(extractResponsesCitations({}), []);
});

test("Gemini: extracts groundingChunks web URIs", () => {
  const json = {
    candidates: [{
      groundingMetadata: { groundingChunks: [
        { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc" } },
        { web: { uri: "https://competitor.com/p" } },
        { web: {} }, // no uri
        {},          // no web
      ] },
    }],
  };
  assert.deepEqual(extractGeminiCitations(json), [
    "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc",
    "https://competitor.com/p",
  ]);
  assert.deepEqual(extractGeminiCitations({ candidates: [{}] }), []);
});

test("Perplexity: unions top-level citations and search_results urls", () => {
  const json = {
    citations: ["https://a.com", "https://b.com"],
    search_results: [{ url: "https://b.com" }, { url: "https://c.com" }, {}],
  };
  assert.deepEqual(extractPerplexityCitations(json), ["https://a.com", "https://b.com", "https://c.com"]);
  assert.deepEqual(extractPerplexityCitations({}), []);
});
