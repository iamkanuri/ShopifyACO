import { test } from "node:test";
import assert from "node:assert/strict";
import type { Config, PromptEngineResult } from "../src/types.js";
import { nameableRivals } from "../src/analysis/nameableRivals.js";

// The nameable-rivals gate: only genuinely RECOMMENDED rivals may headline the substitution frame.
// A merely-referenced competitor ("alternatives to X") is DEMOTED; a discovered brand is re-checked
// by the detector so the LLM extractor alone can't get one named.

const ans = (engine: string, prompt: string, text: string): PromptEngineResult =>
  ({ prompt, template: "t", engine, model: "m", groundingMode: "web_grounded", text, detections: [], usage: {} } as unknown as PromptEngineResult);

const cfg: Config = { brand: { name: "ARMRA" }, category: "colostrum supplements", competitors: [{ name: "Sovereign Laboratories" }], promptTemplates: ["x"] };

test("referenced competitor DEMOTED; genuinely-recommended discovered brand NAMEABLE, with proof snippets", () => {
  const results = [
    ans("openai", "alternatives to sovereign?", "Good alternatives to Sovereign Laboratories include WonderCow (best overall)."),
    ans("perplexity", "best colostrum?", "The best colostrum supplement is WonderCow. I'd recommend WonderCow for most people."),
    ans("openai", "top colostrum brand?", "My top pick is WonderCow."),
  ];
  const { nameable, mentionedOnly } = nameableRivals(results, cfg, ["WonderCow"]);

  // WonderCow: recommended across engines → nameable, cross-engine, with raw snippets.
  const wc = nameable.find((r) => r.name === "WonderCow");
  assert.ok(wc, "WonderCow is nameable");
  assert.ok(wc!.recCount >= 2, "recommended in multiple answers");
  assert.ok(wc!.engines.length >= 2, "cross-engine corroborated");
  assert.ok(wc!.recSnippets.length >= 1, "carries raw proof of the recommendation");
  assert.equal(wc!.source, "discovered");

  // Sovereign: only the reference in "alternatives to X" → NOT recommended → demoted.
  assert.ok(!nameable.some((r) => r.name === "Sovereign Laboratories"), "Sovereign is NOT nameable");
  assert.ok(mentionedOnly.some((r) => r.name === "Sovereign Laboratories"), "Sovereign demoted to mentioned-only");

  // Every nameable rival is one the detector agrees was recommended — no bare mentions in the set.
  assert.ok(nameable.every((r) => r.recCount >= 1 && r.recSnippets.length >= 1));
});

test("a discovered brand only MENTIONED (never recommended) is not nameable", () => {
  const results = [ans("openai", "best colostrum?", "Some people also mention Elm & Rye, but I'd recommend WonderCow.")];
  const { nameable, mentionedOnly } = nameableRivals(results, cfg, ["Elm & Rye", "WonderCow"]);
  assert.ok(nameable.some((r) => r.name === "WonderCow"));
  assert.ok(!nameable.some((r) => r.name === "Elm & Rye"), "a passing mention can't be named");
  assert.ok(mentionedOnly.some((r) => r.name === "Elm & Rye"));
});
