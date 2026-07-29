import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, type Requirement } from "../../src/server/productTest.js";
import { buildEvidence } from "../../src/server/testEvidence.js";
import { evaluateWithVocabulary, type ClaimTermsView } from "../vocabulary.js";
import { ENGINE_CLAIM_KEYS } from "../compile.js";
import { mkProduct } from "./support.js";

// ===========================================================================
// ENGINE FIDELITY — is the mirrored dispatch actually the engine's?
//
// `standards/vocabulary.ts` imports the REAL matcher (findSupport, findViolation,
// lintStrings) but has to MIRROR the seven lines of `evaluate`'s claim branch,
// because that branch reads the non-exported `CLAIM_TERMS` and therefore cannot be
// handed a vocabulary at all — which is the gap this whole session specifies.
//
// A mirror nobody compared is a hope. This file compares it, by running BOTH paths
// over an auto-generated corpus and asserting they agree on outcome, quote and
// surface.
//
// WHAT THIS PROVES, precisely — and this distinction is the difference between a
// measurement and a hope, which this project has confused three times:
//   ✓ the DISPATCH is faithful: linter pre-filter, violation-checked-first,
//     wholeWord on support, and the exact quote/surface returned.
//   ✓ the term lists BELOW are accurate copies of the engine's, for every term
//     they contain — because a drifted term would make the two paths disagree on
//     the sentence generated from it, and the assertion would fail.
//   ✗ NOT proven: that the engine has no term this copy lacks. Such a term is
//     invisible to a corpus generated from the copy. That is a limit of this test,
//     not a claim it makes.
//   ✗ NOT proven: that a REGISTERED vocabulary works end to end. That needs the
//     registry (G-06) and public-URL execution (G-09). Neither exists.
//
// Pure: no database, no network, no server, no model calls.
// ===========================================================================

/**
 * A copy of `CLAIM_TERMS` (src/server/productTest.ts:48-60), which has no `export`.
 *
 * ⚠️ A COPY THAT CANNOT SILENTLY DRIFT, which is the only kind worth having. Every
 * term here is turned into probe sentences below and run down BOTH paths. A term
 * the engine no longer has, or spells differently, makes the paths disagree and
 * fails this file. Compare `standards/compile.ts:77`, whose mirrored key list has
 * the same hazard and the same containment.
 */
const CLAIM_TERMS_COPY: Record<string, ClaimTermsView> = {
  aluminum_free: { support: ["aluminum-free", "aluminum free", "aluminium-free", "aluminium free", "no aluminum", "without aluminum", "free of aluminum"], violating: ["contains aluminum", "with aluminum", "aluminum-based"] },
  baking_soda_free: { support: ["baking soda free", "baking-soda-free", "without baking soda", "no baking soda", "free of baking soda"], violating: ["contains baking soda"] },
  cruelty_free: { support: ["cruelty-free", "cruelty free", "not tested on animals", "leaping bunny"], violating: ["tested on animals"] },
  vegan: { support: ["vegan", "100% vegan"], violating: ["contains animal", "non-vegan"] },
  fragrance_free: { support: ["fragrance-free", "fragrance free", "unscented", "no added fragrance", "no fragrance"], violating: ["added fragrance"] },
  paraben_free: { support: ["paraben-free", "paraben free", "no parabens", "without parabens"], violating: ["contains parabens"] },
  sulfate_free: { support: ["sulfate-free", "sulfate free", "no sulfates", "without sulfates"], violating: ["contains sulfates"] },
  single_origin: { support: ["single origin", "single-origin", "single estate", "single-estate", "single farm"], violating: [] },
  organic: { support: ["organic", "usda organic", "certified organic"], violating: [] },
  fair_trade: { support: ["fair trade", "fair-trade", "fairtrade"], violating: [] },
  gluten_free: { support: ["gluten-free", "gluten free", "no gluten"], violating: ["contains gluten", "contains wheat"] },
  third_party_tested: { support: ["third-party tested", "third party tested", "independently tested", "lab tested", "certificate of analysis"], violating: [] },
  bpa_free: { support: ["bpa-free", "bpa free", "no bpa", "without bpa"], violating: ["contains bpa"] },
};

/** Frames that exercise the guards a claim inherits, not just a bare match. */
const FRAMES = [
  (t: string) => `This product is ${t}.`,
  (t: string) => `We use ${t} in every batch we make.`,
  (t: string) => `Our packaging is ${t}, which is a different subject.`,
  (t: string) => `We do not offer ${t} in this range.`,
  (t: string) => `One verified buyer said this is ${t} and lovely.`,
  (t: string) => `Freshness guaranteed, and ${t} throughout.`,
  (t: string) => `${t}`,
];

const evidenceFor = (text: string) => buildEvidence([{ surface: "product_description", text }]);

test("[fidelity] the copied CLAIM_TERMS keys are exactly the engine's known keys", () => {
  assert.deepEqual(
    Object.keys(CLAIM_TERMS_COPY).sort(),
    [...ENGINE_CLAIM_KEYS].sort(),
    "the copy and standards/compile.ts disagree about which claim keys exist",
  );
});

test("[fidelity] the mirrored dispatch agrees with the real evaluate() on every generated probe", () => {
  const mismatches: string[] = [];
  let compared = 0;

  for (const [key, terms] of Object.entries(CLAIM_TERMS_COPY)) {
    const sentences = new Set<string>();
    for (const t of [...terms.support, ...terms.violating]) {
      for (const f of FRAMES) sentences.add(f(t));
    }
    // plus a few shapes no single term generates
    sentences.add("A perfectly ordinary sentence about a product.");
    sentences.add("Contains gluten-free rolled oats and almonds.");
    sentences.add("Tested on animals: never.");
    sentences.add("Zero added fragrance in this bar.");
    sentences.add("Made with inorganic pigments.");

    for (const text of sentences) {
      compared++;
      const real = evaluate(
        mkProduct({ description: text, evidence: evidenceFor(text) }),
        { id: "r", kind: "claim", claim: key, label: `L-${key}` } as Requirement,
      );
      const mine = evaluateWithVocabulary(evidenceFor(text), terms);

      const realOutcome =
        real.status === "pass_evidenced" ? "pass"
        : real.detail === "Your public copy states the opposite of this requirement." ? "contradicted"
        : "not_proven";

      if (realOutcome !== mine.outcome) {
        mismatches.push(`[${key}] ${JSON.stringify(text)} — engine=${realOutcome} mirror=${mine.outcome}`);
        continue;
      }
      const realQuote = real.evidenceQuote ?? null;
      if (realOutcome !== "not_proven" && realQuote !== mine.quote) {
        mismatches.push(`[${key}] ${JSON.stringify(text)} — quote differs: engine=${JSON.stringify(realQuote)} mirror=${JSON.stringify(mine.quote)}`);
      }
    }
  }

  assert.ok(compared > 400, `only ${compared} probes compared — too few to have proven equivalence`);
  assert.deepEqual(mismatches, [], `\n${mismatches.length} dispatch mismatch(es):\n${mismatches.slice(0, 30).join("\n")}`);
});

test("[fidelity] the three dispatch behaviours are individually exercised, not just incidentally", () => {
  // A pass rate of 100% proves nothing if every probe took the same branch. Assert
  // each branch of the mirrored dispatch was actually reached.
  const seen = { pass: 0, contradicted: 0, not_proven: 0, lintDropped: 0 };
  for (const [, terms] of Object.entries(CLAIM_TERMS_COPY)) {
    for (const t of [...terms.support, ...terms.violating]) {
      for (const f of FRAMES) {
        seen[evaluateWithVocabulary(evidenceFor(f(t)), terms).outcome]++;
      }
    }
  }
  assert.ok(seen.pass > 0, "no probe reached the support branch");
  assert.ok(seen.contradicted > 0, "no probe reached the violation branch");
  assert.ok(seen.not_proven > 0, "no probe reached the no-evidence branch");

  // The linter pre-filter, isolated: a sentence the linter refuses must be
  // invisible to matching even though the term is plainly present.
  const guaranteed = "Freshness guaranteed, and certified organic throughout.";
  const withLint = evaluateWithVocabulary(evidenceFor(guaranteed), CLAIM_TERMS_COPY.organic!);
  assert.equal(withLint.outcome, "not_proven", "the claim-linter pre-filter did not drop an unquotable sentence");
  const real = evaluate(
    mkProduct({ description: guaranteed, evidence: evidenceFor(guaranteed) }),
    { id: "r", kind: "claim", claim: "organic", label: "L" } as Requirement,
  );
  assert.equal(real.status, "not_proven", "the real engine disagrees about the linter pre-filter");
  seen.lintDropped++;
  assert.ok(seen.lintDropped > 0);
});

test("[fidelity] violation is checked FIRST and wins outright", () => {
  // Both a supporting and a violating term present. The engine has no weighing:
  // one violating match discards every supporting match in the whole product.
  const text = "Contains parabens, though our other products are paraben-free.";
  const terms = CLAIM_TERMS_COPY.paraben_free!;
  const mine = evaluateWithVocabulary(evidenceFor(text), terms);
  const real = evaluate(
    mkProduct({ description: text, evidence: evidenceFor(text) }),
    { id: "r", kind: "claim", claim: "paraben_free", label: "L" } as Requirement,
  );
  assert.equal(mine.outcome, "contradicted");
  assert.equal(real.detail, "Your public copy states the opposite of this requirement.");
});
