import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ENGINE_LABELS } from "../src/engines/labels.js";

// Guards the bundled /demo sample against the "source copy changed but the pre-generated
// artifact didn't" class of bug — the stale "rarely chosen" headline lived in this file for
// weeks after the analysis code was fixed. Regenerate with:
//   npm run analyze -- viewer/public/sample-results.json
const sample = JSON.parse(readFileSync("viewer/public/sample-results.json", "utf8")) as {
  analysis: { weakestEngine: string | null };
};

test("demo sample uses current analysis copy (no retired 'rarely chosen' claim)", () => {
  const a = JSON.stringify(sample.analysis).toLowerCase();
  assert.ok(!a.includes("rarely"), "sample analysis still contains the retired 'rarely' wording — regenerate it");
});

test("demo sample shows product labels, not raw engine slugs", () => {
  const a = JSON.stringify(sample.analysis);
  for (const slug of Object.keys(ENGINE_LABELS)) {
    assert.ok(!a.includes(`"${slug}"`), `sample analysis exposes the raw engine slug "${slug}" — regenerate it`);
  }
  if (sample.analysis.weakestEngine) {
    assert.ok(
      Object.values(ENGINE_LABELS).includes(sample.analysis.weakestEngine),
      "weakestEngine should be a product label (e.g. ChatGPT), not a raw slug",
    );
  }
});
