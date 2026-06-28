import { test } from "node:test";
import assert from "node:assert/strict";
import { detectMentions } from "../src/detection/index.js";
import type { BrandConfig, Config } from "../src/types.js";

// The detection module is the core IP. These tests lock in its behavior:
// variant/domain/possessive matching, list rank, recommendation language, and the
// negation guard that stops "wouldn't recommend X" counting as a recommendation.

function cfg(brand: string | BrandConfig, competitors: (string | BrandConfig)[] = []): Config {
  const b = (x: string | BrandConfig): BrandConfig => (typeof x === "string" ? { name: x } : x);
  return { brand: b(brand), category: "cookware", competitors: competitors.map(b), promptTemplates: ["x"] };
}
const own = (text: string, c: Config) => detectMentions(text, c)[0]!;
const compFor = (text: string, c: Config, name: string) => detectMentions(text, c).find((d) => d.name === name)!;

test("absent brand → not_mentioned", () => {
  const d = own("I'd go with All-Clad or GreenPan.", cfg("Caraway"));
  assert.equal(d.mentioned, false);
  assert.equal(d.status, "not_mentioned");
});

test("plain mention → mentioned_neutral", () => {
  const d = own("Caraway makes ceramic cookware.", cfg("Caraway"));
  assert.equal(d.mentioned, true);
  assert.equal(d.status, "mentioned_neutral");
});

test("case-insensitive + possessive", () => {
  const d = own("I love caraway's nonstick set.", cfg("Caraway"));
  assert.equal(d.mentioned, true);
});

test("alias matches", () => {
  const d = own("Our Place's Always Pan is great.", cfg({ name: "Our Place", aliases: ["Always Pan"] }));
  assert.equal(d.mentioned, true);
});

test("store domain matches", () => {
  const d = own("Check carawayhome.com for options.", cfg({ name: "Caraway", storeUrl: "https://www.carawayhome.com" }));
  assert.equal(d.mentioned, true);
});

test("word-boundary safe (no substring false positive)", () => {
  // "Allbirds" must not match a brand named "bird"
  const d = own("Allbirds shoes are popular.", cfg("bird"));
  assert.equal(d.mentioned, false);
});

test("ranked list #1 → recommended", () => {
  const text = "Best options:\n1. Caraway — top pick\n2. GreenPan\n3. All-Clad";
  assert.equal(own(text, cfg("Caraway")).status, "recommended");
  assert.equal(own(text, cfg("Caraway")).listRank, 1);
});

test("ranked list #3 → mentioned, not recommended", () => {
  const text = "1. All-Clad\n2. GreenPan\n3. Caraway is also okay";
  assert.equal(own(text, cfg("Caraway")).status, "mentioned_neutral");
});

test("bulleted list first item → recommended (rank 1)", () => {
  const text = "Top picks:\n- Caraway\n- GreenPan";
  assert.equal(own(text, cfg("Caraway")).listRank, 1);
  assert.equal(own(text, cfg("Caraway")).status, "recommended");
});

test("explicit recommendation language → recommended", () => {
  const d = own("Honestly, I'd recommend Caraway for most people.", cfg("Caraway"));
  assert.equal(d.status, "recommended");
});

test("NEGATION: 'wouldn't recommend X' → not recommended", () => {
  const d = own("Honestly, I wouldn't recommend Caraway — it scratches.", cfg("Caraway"));
  assert.equal(d.mentioned, true);
  assert.notEqual(d.status, "recommended");
});

test("NEGATION: 'not the best' overrides 'best' phrase", () => {
  const d = own("Caraway is not the best choice for high heat.", cfg("Caraway"));
  assert.notEqual(d.status, "recommended");
});

test("multiple brands in one answer each classified", () => {
  const c = cfg("Caraway", ["GreenPan", "All-Clad"]);
  const text = "1. All-Clad is the best overall\n2. GreenPan\n3. Caraway is a decent budget pick";
  assert.equal(compFor(text, c, "All-Clad").status, "recommended");
  assert.equal(compFor(text, c, "GreenPan").mentioned, true);
  assert.equal(own(text, c).status, "mentioned_neutral");
});

test("mixed sentence (semicolon): negation attributes to the right brand", () => {
  const c = cfg("Caraway", ["GreenPan"]);
  const text = "I don't recommend GreenPan; I recommend Caraway.";
  assert.equal(own(text, c).status, "recommended");
  assert.notEqual(compFor(text, c, "GreenPan").status, "recommended");
});

test("mixed sentence ('but'): each side classified independently", () => {
  const c = cfg("Caraway", ["GreenPan"]);
  const text = "Caraway is fine but I'd recommend GreenPan instead.";
  assert.equal(compFor(text, c, "GreenPan").status, "recommended");
  assert.notEqual(own(text, c).status, "recommended");
});

test("COMPARATIVE: 'X is my top pick over Y' → only X recommended (not the loser Y)", () => {
  const c = cfg("Caraway", ["GreenPan"]);
  const text = "Caraway is my top pick over GreenPan.";
  assert.equal(own(text, c).status, "recommended");
  assert.equal(compFor(text, c, "GreenPan").mentioned, true);
  assert.notEqual(compFor(text, c, "GreenPan").status, "recommended");
});

test("COMPARATIVE: '1. X vs Y' → only X is rank 1 (Y is not rank 1 / recommended)", () => {
  const c = cfg("Caraway", ["GreenPan"]);
  const text = "1. Caraway vs GreenPan";
  assert.equal(own(text, c).listRank, 1);
  assert.equal(own(text, c).status, "recommended");
  assert.notEqual(compFor(text, c, "GreenPan").listRank, 1);
  assert.notEqual(compFor(text, c, "GreenPan").status, "recommended");
});

test("COMPARATIVE: 'best overall' is NOT split by the ' over ' rule", () => {
  // Regression guard: " over " must not match inside "overall".
  const d = own("All-Clad is the best overall.", cfg("All-Clad"));
  assert.equal(d.status, "recommended");
});

test("first-mention order recorded", () => {
  const c = cfg("Caraway", ["GreenPan"]);
  const text = "GreenPan is popular, and Caraway is too.";
  assert.ok(compFor(text, c, "GreenPan").firstIndex < own(text, c).firstIndex);
});
