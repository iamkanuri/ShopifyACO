import { test } from "node:test";
import assert from "node:assert/strict";
import { registrableDomain, analyzeCitedSources } from "../src/analysis/citedSources.js";
import { detectMentions } from "../src/detection/index.js";
import type { Config } from "../src/types.js";

// The careful piece (Fable-flagged): registrable-domain normalization. Getting multi-part TLDs or
// subdomains wrong over/under-merges sources and corrupts the whole "where does AI cite" signal.
test("registrableDomain: www/subdomain/path/query/port/case reduce correctly", () => {
  assert.equal(registrableDomain("https://www.wirecutter.com/reviews/x/"), "wirecutter.com");
  assert.equal(registrableDomain("https://www.goodhousekeeping.com/best?utm=x&a=b"), "goodhousekeeping.com");
  assert.equal(registrableDomain("https://sub.blog.nytimes.com/2026"), "nytimes.com");
  assert.equal(registrableDomain("www.forbes.com"), "forbes.com"); // no scheme
  assert.equal(registrableDomain("https://example.com:8443/p"), "example.com");
  assert.equal(registrableDomain("HTTPS://WWW.Prada.COM/Handbags"), "prada.com");
  assert.equal(registrableDomain("https://example.com./x"), "example.com"); // trailing dot
});

test("registrableDomain: multi-part TLDs are NOT reduced to the suffix", () => {
  assert.equal(registrableDomain("https://blog.example.co.uk/post"), "example.co.uk");
  assert.equal(registrableDomain("https://shop.example.com.au/p?x=1"), "example.com.au");
  assert.equal(registrableDomain("https://news.bbc.co.uk/story"), "bbc.co.uk");
  // a bare 2-label suffix host stays as-is (it IS the registrable domain here)
  assert.equal(registrableDomain("https://co.uk"), "co.uk");
});

test("registrableDomain: rejects non-http(s) schemes but not host:port", () => {
  for (const bad of ["ftp://files.example.com/x", "mailto:hi@example.com", "tel:+15551234", "javascript:alert(1)", "data:text/html,hi", "not a url", "https://localhost/x", ""]) {
    assert.equal(registrableDomain(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
  assert.equal(registrableDomain("example.com:8443"), "example.com"); // host:port, no scheme → kept
  assert.equal(registrableDomain("https://192.168.1.1/x"), "192.168.1.1"); // bare IP kept, not merged
});

test("analyzeCitedSources: aggregates conditioned on outcome (all / lost / per-engine) with n=", () => {
  const cfg: Config = { brand: { name: "Olipop" }, category: "prebiotic soda", competitors: [{ name: "Poppi" }], promptTemplates: [] };
  const mk = (prompt: string, engine: string, text: string, citations: string[]) =>
    ({ prompt, template: "t", engine, model: engine, groundingMode: "web_grounded" as const, text, detections: detectMentions(text, cfg), citations });
  const results = [
    mk("best prebiotic soda?", "openai", "1. Poppi — top pick.\n2. Olipop — also solid.", ["https://www.wirecutter.com/x?y=1", "http://reddit.com/r/soda"]),
    mk("best prebiotic soda?", "gemini", "Olipop is my top recommendation. Poppi is also decent.", ["https://www.healthline.com/best"]),
    mk("healthiest soda?", "perplexity", "1. Poppi\n2. Olipop", ["https://www.wirecutter.com/gut", "https://goodhousekeeping.com/best"]),
    mk("olipop vs poppi?", "openai", "I recommend Poppi over Olipop.", ["https://reddit.com/r/soda/vs"]),
  ];
  const rep = analyzeCitedSources(results, cfg);

  // Overall: 4 answers with citations; reddit + wirecutter cited in 2 each.
  assert.equal(rep.overall.n, 4);
  const overall = Object.fromEntries(rep.overall.sources.map((s) => [s.domain, s.count]));
  assert.equal(overall["wirecutter.com"], 2);
  assert.equal(overall["reddit.com"], 2);
  assert.equal(overall["healthline.com"], 1);

  // On LOST answers (3 — the won gemini/Olipop answer excluded): healthline (won-only) must NOT appear.
  assert.equal(rep.onLostAnswers.n, 3);
  const lost = Object.fromEntries(rep.onLostAnswers.sources.map((s) => [s.domain, s.count]));
  assert.equal(lost["wirecutter.com"], 2);
  assert.equal(lost["reddit.com"], 2);
  assert.equal(lost["goodhousekeeping.com"], 1);
  assert.equal(lost["healthline.com"], undefined, "a source cited only on a WON answer must not be in on-lost");

  // Per engine present + friendly-labeled.
  assert.ok(rep.byEngine["ChatGPT"], "ChatGPT bucket present");
  assert.ok(rep.byEngine["Gemini"], "Gemini bucket present");
  // Sources carry example prompts + counts are deduped per answer.
  assert.ok(rep.overall.sources.every((s) => s.examplePrompts.length >= 1));
});

test("analyzeCitedSources: no-citation runs (old data) return empty buckets, never throw", () => {
  const cfg: Config = { brand: { name: "X" }, category: "y", competitors: [], promptTemplates: [] };
  const results = [{ prompt: "p", template: "t", engine: "openai", model: "m", groundingMode: "web_grounded" as const, text: "some answer", detections: detectMentions("some answer", cfg) }];
  const rep = analyzeCitedSources(results, cfg);
  assert.equal(rep.overall.n, 0);
  assert.equal(rep.overall.sources.length, 0);
  assert.equal(rep.onLostAnswers.n, 0);
});
