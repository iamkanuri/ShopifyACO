import { test } from "node:test";
import assert from "node:assert/strict";
import { generateIntentCohort } from "../src/benchmarks/intents.js";

// App MEASUREMENT-path category-awareness (mirrors test/categoryAwareness.test.ts, which guards the
// WEB path). The app's benchmark prompt generator (benchmarks/intents.ts, via shopRun.ts) must NOT
// bake cookware/kitchen DNA into a non-cookware brand's benchmark — a fashion/supplement/furniture
// merchant must never be asked "what works best with a typical modern kitchen setup?". Pure, $0.

const COOKWARE = /coating|pfas|ptfe|pfoa|teflon|ceramic|oven-?safe|induction|dishwasher|nonstick|non-stick|kitchen|cookware/i;

const NON_COOKWARE = [
  { category: "luxury handbags", competitors: ["Gucci"], persona: "a fashion-forward professional" },
  { category: "daily multivitamins", competitors: ["Ritual"], persona: "a health-conscious adult" },
  { category: "modular sofas", competitors: ["Burrow"], persona: "a first-time apartment renter" },
  { category: "specialty coffee beans", competitors: ["Blue Bottle"] },
  { category: "running shoes", competitors: ["Nike"] },
];

test("app measurement: NO cookware/kitchen vocab leaks into a non-cookware benchmark", () => {
  for (const input of NON_COOKWARE) {
    const cohort = generateIntentCohort(input);
    for (const p of cohort) {
      assert.ok(!COOKWARE.test(p.text), `cookware/kitchen vocab leaked into a ${input.category} prompt [${p.intent}]: "${p.text}"`);
      // Specificity comes from the real category: every prompt names it.
      assert.ok(p.text.toLowerCase().includes(input.category.toLowerCase()), `prompt should name the category: "${p.text}"`);
    }
    assert.ok(cohort.length >= 8, `expected a full intent cohort for ${input.category}, got ${cohort.length}`);
  }
});

test("app measurement: compatibility + gift prompts are category-neutral (no hardcoded kitchen/wedding)", () => {
  const cohort = generateIntentCohort({ category: "running shoes", competitors: ["Nike"] });
  const compat = cohort.find((p) => p.intent === "compatibility");
  const gift = cohort.find((p) => p.intent === "gift_occasion");
  assert.ok(compat, "compatibility intent is still generated (just neutral now)");
  assert.ok(gift, "gift_occasion intent is still generated");
  assert.ok(!/kitchen/i.test(compat!.text), `compatibility must not hardcode 'kitchen': "${compat!.text}"`);
  assert.ok(!/wedding/i.test(gift!.text), `gift default must not hardcode 'wedding' when no occasion given: "${gift!.text}"`);
  // An explicit occasion is still honored.
  const withOccasion = generateIntentCohort({ category: "running shoes", occasion: "a marathon" });
  assert.ok(withOccasion.some((p) => p.intent === "gift_occasion" && /marathon/i.test(p.text)), "explicit occasion is used when provided");
});

test("app measurement: a genuine cookware category may still carry its own category words (no false neutralizing)", () => {
  // Neutralizing the hardcoded assumption must NOT strip legitimate category vocabulary — a cookware
  // brand's prompts naturally contain "cookware" because it's the actual category, and that's correct.
  const cohort = generateIntentCohort({ category: "nonstick cookware", competitors: ["Caraway"] });
  assert.ok(cohort.every((p) => p.text.toLowerCase().includes("nonstick cookware")), "cookware category is named in its own prompts");
  // But the hardcoded 'kitchen setup' assumption is gone even here.
  assert.ok(!cohort.some((p) => /kitchen/i.test(p.text)), "the hardcoded 'kitchen setup' prompt is gone for every category");
});
