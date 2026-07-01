import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeSnippet } from "../src/analysis/text.js";

// Fix 2: real web-grounded answers carry markdown + citation + URL cruft. The sanitizer strips
// FORMATTING only — it must keep the actual sentence (and any leading/trailing ellipsis).

test("sanitizeSnippet strips markdown, citations, and URLs but keeps the sentence", () => {
  const raw =
    "…the **Loewe Flamenco**, **Louis Vuitton Neverfull** ([goodhousekeeping.com](https://www.goodhousekeeping.com/x?utm_source=openai)) are top picks [4].";
  const out = sanitizeSnippet(raw)!;

  assert.doesNotMatch(out, /\*\*/, "markdown bold not stripped");
  assert.doesNotMatch(out, /\[\d+\]/, "citation marker not stripped");
  assert.doesNotMatch(out, /https?:\/\//, "inline URL not stripped");
  assert.doesNotMatch(out, /\([^)]*\.(com|org|net)/i, "parenthetical domain not stripped");
  assert.doesNotMatch(out, /utm_/, "tracking param not stripped");
  // meaning preserved
  assert.match(out, /Loewe Flamenco/);
  assert.match(out, /Louis Vuitton Neverfull/);
  assert.match(out, /are top picks/);
  assert.match(out, /^…/, "leading ellipsis preserved");
});

test("sanitizeSnippet is idempotent and null-safe", () => {
  const raw = "**Prada** is praised [1] for craftsmanship (vogue.com).";
  const once = sanitizeSnippet(raw)!;
  assert.equal(sanitizeSnippet(once), once);
  assert.equal(sanitizeSnippet(undefined), undefined);
  assert.match(once, /Prada is praised for craftsmanship/);
});
