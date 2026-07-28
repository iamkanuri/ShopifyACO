import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluate, type PublicProduct, type Requirement } from "../../src/server/productTest.js";
import { buildEvidence, type QuotableSurface } from "../../src/server/testEvidence.js";
import { requireDecisive } from "../../src/measure/completion.js";
import { loadContext, parseContext } from "../attack/context.js";
import { fnv1a, generateAttacks, shapeProblems } from "../attack/generate.js";
import { attackSetToJson, renderAttackSet } from "../attack/render.js";
import { ORTHOGRAPHY, TEMPLATES, substanceOf, termShape } from "../attack/templates.js";
import { ATTACK_CLASSES, type AttackClass, type AttackSet } from "../attack/types.js";
import type { Vocabulary } from "../vocabulary.js";
import { STANDARDS_DIR, loadJson } from "./support.js";

// ===========================================================================
// PURE. No database, no network, no server, no model calls, no edits to
// compile.ts. The generator itself evaluates nothing — a test below proves that
// by scanning its source — so these tests are about COVERAGE and DETERMINISM,
// which is all a generator can be right or wrong about.
// ===========================================================================

const DECAF = "coffee/v1.0/vocabulary/decaf-method.json";
const SOLVENT = "coffee/v1.0/vocabulary/decaf-solvent-disclosure.json";
const coffee = loadContext("coffee");
const vocab = loadJson<Vocabulary>(DECAF);
const solvent = loadJson<Vocabulary>(SOLVENT);

const gen = (v: unknown, opts = {}): AttackSet => generateAttacks(v, { context: coffee.context, ...opts });

// ---- GROUP 1 — the context loads ------------------------------------------

test("[attack] the coffee context loads with no problems", () => {
  assert.deepEqual(coffee.problems, [], "a context that half-loads silently reduces class 2 coverage");
  assert.ok(coffee.context.adjacentDomains.length > 0, "class 2's non-mechanisable half needs domains");
});

test("[attack] a malformed context degrades LOUDLY, never silently", () => {
  const { context, problems } = parseContext({ id: "x", adjacentDomains: [{ domain: "d" }] });
  assert.ok(problems.some((p) => /adjacentDomains\[0\]/.test(p)), `expected a named problem, got ${JSON.stringify(problems)}`);
  assert.equal(context.adjacentDomains.length, 0);
});

// ---- GROUP 2 — DETERMINISM -------------------------------------------------

test("[attack] the same seed produces a byte-identical set", () => {
  const a = gen(vocab, { seed: "fixed-seed" });
  const b = gen(vocab, { seed: "fixed-seed" });
  assert.equal(attackSetToJson(a), attackSetToJson(b), "a review that cannot be reproduced cannot be re-reviewed");
});

test("[attack] a DIFFERENT seed produces a different but COMPARABLE set", () => {
  const a = gen(vocab, { seed: "seed-a" });
  const b = gen(vocab, { seed: "seed-b" });
  // Comparable: same classes, same per-class counts, same coverage verdict.
  assert.deepEqual(a.coverage.byClass, b.coverage.byClass, "two seeds must produce the same SHAPE of set");
  assert.equal(a.state, b.state);
  assert.equal(a.attacks.length, b.attacks.length);
  // Different: order-based truncation would re-test the same first three
  // templates for ever, which makes a re-review after a term change vacuous.
  const idsA = a.attacks.map((x) => x.id).join("|");
  const idsB = b.attacks.map((x) => x.id).join("|");
  assert.notEqual(idsA, idsB, "seeded selection must actually vary, or the seed is decoration");
});

test("[attack] the selection hash is a hash, not a random number", () => {
  assert.equal(fnv1a("swiss water process"), fnv1a("swiss water process"));
  assert.notEqual(fnv1a("a"), fnv1a("b"));
});

test("[attack] no template reads a clock or a random source", () => {
  for (const f of ["templates.ts", "generate.ts", "context.ts", "render.ts", "types.ts"]) {
    const src = readFileSync(join(STANDARDS_DIR, "attack", f), "utf8");
    assert.ok(!/Math\.random|Date\.now|new Date\(/.test(src), `${f} reads a clock or a random source — the set would not be reproducible`);
  }
});

// ---- GROUP 3 — GENERATION AND ADJUDICATION STAY APART ----------------------

test("[attack] the generator imports nothing that evaluates a sentence", () => {
  // A generator that also judges is the self-attack failure mechanised. This is
  // the one property of this module that a reviewer cannot check by reading the
  // output, so it is checked by scanning the source.
  const FORBIDDEN = /\b(evaluateWithVocabulary|findSupport|findViolation|passesAboutness|isNegated|lintStrings|validateVocabulary)\b/;
  for (const f of ["templates.ts", "generate.ts", "render.ts", "context.ts", "types.ts", "cli.ts"]) {
    const src = readFileSync(join(STANDARDS_DIR, "attack", f), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!FORBIDDEN.test(code), `attack/${f} references the engine matcher — generation and adjudication must stay separate`);
  }
});

test("[attack] no sentence carries a verdict field", () => {
  const set = gen(vocab);
  for (const s of [...set.attacks, ...set.controls].slice(0, 50)) {
    assert.ok(!("expected" in s) && !("outcome" in s) && !("actual" in s), `${s.id} carries an adjudication field`);
  }
});

// ---- GROUP 4 — the generator is CATEGORY-AGNOSTIC --------------------------

test("[attack] no category vocabulary leaks into a generated sentence", () => {
  // Checked BEHAVIOURALLY rather than by scanning the source. A source scan
  // cannot tell a hardcoded category noun from a comment citing the measured
  // coffee finding, and the first version of this test failed on the latter —
  // which would have pushed the evidence out of the code to satisfy a check.
  //
  // The real property: run the generator over NEUTRAL terms on the default
  // context, and no coffee word may appear in any output. Anything category-
  // shaped in a real run therefore came from the vocabulary or the context file,
  // which is where it belongs.
  const COFFEE = /\b(decafs?|coffee|roaster|roastery|swiss|mountain water|espresso|beans?|caffeine|arabica|huila|lot)\b/i;
  const neutral = {
    claim_key: "k", standard_id: "S", standard_version: "1.0",
    supporting_terms: [{ term: "widget certified" }, { term: "alpha process" }, { term: "assembled with tin" }],
    violating_terms: [{ term: "assembled with lead" }],
  };
  const set = generateAttacks(neutral);          // DEFAULT_CONTEXT
  assert.ok(set.attacks.length > 50);
  for (const s of [...set.attacks, ...set.controls]) {
    const hit = COFFEE.exec(s.text);
    assert.equal(hit, null, `${s.id} emitted the category word ${JSON.stringify(hit?.[0])} in ${JSON.stringify(s.text)}`);
  }
});

test("[attack] the generic default still produces seven of the eight classes", () => {
  // The point of mechanising: a category with no context file is not stuck.
  const set = generateAttacks(vocab);       // no context ⇒ DEFAULT_CONTEXT
  const withAttacks = ATTACK_CLASSES.filter((c) => set.coverage.byClass[c]! > 0);
  assert.ok(withAttacks.length >= 6, `only ${withAttacks.length} classes produced anything on the default context`);
  assert.equal(set.contextId, "generic");
});

// ---- GROUP 5 — COVERAGE ----------------------------------------------------

test("[attack] every term gets every applicable class, or the omission is NAMED", () => {
  const set = gen(vocab);
  const terms = [...vocab.supporting_terms.map((t) => t.term), ...vocab.violating_terms.map((t) => t.term)];
  // The matrix is complete: one cell per (term, class), none missing.
  assert.equal(set.coverage.cells.length, terms.length * ATTACK_CLASSES.length,
    "the coverage matrix has a hole — a missing cell is a term nobody looked at");
  for (const c of set.coverage.cells) {
    if (c.count === 0) {
      assert.ok(c.omission, `${c.attackClass} × ${JSON.stringify(c.term)} produced nothing and gave no reason — silence is the failure this reporting exists to prevent`);
      assert.ok(c.omission.detail.length > 20, `${c.attackClass} × ${c.term}: omission reason is too thin to act on`);
    } else {
      assert.equal(c.omission, null, `${c.attackClass} × ${c.term} produced ${c.count} attacks AND claims an omission`);
    }
  }
});

test("[attack] every sentence carries its class and its term, so results stratify", () => {
  const set = gen(vocab);
  const termSet = new Set([...vocab.supporting_terms.map((t) => t.term), ...vocab.violating_terms.map((t) => t.term)]);
  assert.ok(set.attacks.length > 100, `only ${set.attacks.length} attacks generated`);
  for (const s of set.attacks) {
    assert.ok((ATTACK_CLASSES as readonly string[]).includes(s.attackClass), `${s.id} has an unknown class`);
    assert.ok(s.subclass && s.term && s.text && s.intent, `${s.id} is missing a required field`);
    assert.ok(termSet.has(s.term), `${s.id} targets ${JSON.stringify(s.term)}, which is not in the vocabulary`);
    assert.ok(s.text.trim().length > 3, `${s.id} produced an empty sentence`);
  }
  const ids = set.attacks.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, "attack ids must be unique or a review cannot cite one");
});

test("[attack] a class that ran against NOTHING is named, not rendered as zero", () => {
  // decaf-method.json ships an EMPTY violating list by a measured decision, so
  // `violation` attacks nothing. The first run of this generator printed
  // `violation 0` under a FULL COVERAGE headline — a class that never ran,
  // rendered identically to a class that ran and found nothing.
  const set = gen(vocab);
  assert.equal(vocab.violating_terms.length, 0, "this test's premise moved; re-derive it");
  assert.deepEqual(set.coverage.notExercised, ["violation"]);
  assert.match(set.summary, /NOT EXERCISED: violation/);
  assert.match(renderAttackSet(set), /NOT EXERCISED — no terms of this class's role/);

  // …and the vocabulary that DOES carry violating terms exercises it.
  const withViolating = gen(solvent);
  assert.deepEqual(withViolating.coverage.notExercised, []);
  assert.ok(withViolating.coverage.byClass.violation! > 0);
});

test("[attack] a term with no attack in a class is reported as UNTESTED", () => {
  // Forced: a context with no adjacent domains cannot cover class 2 for a
  // single-word term, and the report must say so rather than passing quietly.
  const oneWord = { ...vocab, supporting_terms: [{ ...vocab.supporting_terms[0]!, term: "organic" }], violating_terms: [] };
  const set = generateAttacks(oneWord);            // generic context: no domains
  const cell = set.coverage.cells.find((c) => c.attackClass === "adjacent_vocabulary");
  assert.equal(cell?.count, 0);
  assert.equal(cell?.omission?.reason, "requires_category_context");
  assert.ok(set.coverage.untested.some((c) => c.attackClass === "adjacent_vocabulary"));
  assert.equal(set.state, "defects_found", "an untested term/class cell is a coverage gap, not a clean run");
  // A COMPLETED run with gaps reports a NUMBER; only a run that did not complete
  // reports null. The two must never be confusable in either direction.
  assert.equal(typeof set.uncoveredCount, "number");
});

// ---- GROUP 6 — INCOMPLETE beats a small clean number -----------------------

test("[attack] a restricted run reports INCOMPLETE, never a small clean number", () => {
  const set = gen(vocab, { classes: ["orthography"] as AttackClass[] });
  assert.equal(set.state, "incomplete", "omitting seven of eight classes must not read as coverage");
  assert.equal(set.uncoveredCount, null, "uncoveredCount must be null on incomplete — never 0");
  assert.equal(set.decisive, false);
  assert.ok(set.attacks.length > 0, "the run still generated sentences; the point is that the COUNT is not coverage");
  assert.match(set.summary, /that number is NOT coverage/);
  assert.throws(() => requireDecisive({ ...set, confirmedCount: set.uncoveredCount } as never, "restricted run"), /not decisive/);
});

test("[attack] a malformed vocabulary is REJECTED, not silently empty", () => {
  const cases: Array<[string, unknown]> = [
    ["null", null],
    ["an array", []],
    ["no claim_key", { supporting_terms: [], violating_terms: [] }],
    ["supporting_terms not an array", { claim_key: "k", supporting_terms: "x", violating_terms: [] }],
    ["a term that is not a string", { claim_key: "k", supporting_terms: [{ term: 7 }], violating_terms: [] }],
    ["an empty term", { claim_key: "k", supporting_terms: [{ term: "  " }], violating_terms: [] }],
    ["both lists empty", { claim_key: "k", supporting_terms: [], violating_terms: [] }],
  ];
  for (const [name, input] of cases) {
    assert.ok(shapeProblems(input).length > 0, `${name}: shapeProblems found nothing`);
    const set = gen(input);
    assert.equal(set.state, "incomplete", `${name}: a malformed vocabulary must be INCOMPLETE`);
    assert.equal(set.uncoveredCount, null, `${name}: uncoveredCount must be null, never 0`);
    assert.equal(set.attacks.length, 0);
    assert.match(set.summary, /INCOMPLETE/);
    // The rendered form must not look like a clean run either.
    assert.doesNotMatch(renderAttackSet(set), /FULL COVERAGE/);
  }
});

test("[attack] a well-formed vocabulary is NOT rejected", () => {
  assert.deepEqual(shapeProblems(vocab), [], "the shape check must not reject the shipped artifact");
  assert.deepEqual(shapeProblems(solvent), []);
});

// ---- GROUP 7 — THE PROOF AGAINST THE KNOWN CORPUS --------------------------

interface CorpusRow { text: string; class: string; subclass: string; direction: string; source: string }
const corpus = loadJson<{ sentences: CorpusRow[] }>("attack/corpus/decaf-review.json");

test("[attack] the generator produces every CLASS the human attackers found", () => {
  // The brief's test: not the identical strings, the coverage. A class the
  // humans found and the generator cannot reach is a generator defect.
  // `perCellLimit: 99` on purpose: this measures what the generator can REACH,
  // not what the default cap happens to show. Written at the default first, it
  // reported `violation/free_of` as unreachable when it was merely un-picked —
  // a measurement of the seed dressed up as a measurement of the generator.
  const set = gen(vocab, { perCellLimit: 99 });
  const generated = new Set(set.attacks.map((a) => a.attackClass));
  const fromSolvent = gen(solvent, { perCellLimit: 99 });
  for (const c of fromSolvent.attacks) generated.add(c.attackClass);

  const human = new Set(corpus.sentences.filter((s) => s.direction === "hostile").map((s) => s.class));
  const missing = [...human].filter((c) => !generated.has(c as AttackClass));
  assert.deepEqual(missing, [], `classes the humans found and the generator cannot produce: ${missing.join(", ")}`);
  assert.ok(human.size >= 7, `the corpus should span at least 7 classes, spans ${human.size}`);
});

test("[attack] the SUBCLASSES the generator cannot reach are exactly the two DOMAIN-dependent ones", () => {
  // ⚠️ THIS IS THE HONEST LIMIT OF MECHANISATION AND IT IS THE POINT OF THIS
  // TEST. Pinned exactly, so a future change that quietly widens the gap fails
  // here rather than being discovered by a reviewer who trusted the tool.
  const set = gen(vocab, { perCellLimit: 99 });
  const fromSolvent = gen(solvent, { perCellLimit: 99 });
  const generated = new Set([...set.attacks, ...fromSolvent.attacks].map((a) => `${a.attackClass}/${a.subclass}`));

  const humanSubclasses = new Set(
    corpus.sentences.filter((s) => s.direction === "hostile").map((s) => `${s.class}/${s.subclass}`),
  );
  const unreachable = [...humanSubclasses].filter((k) => !generated.has(k)).sort();

  // EVERY ONE of these is a `letter_not_spirit` subclass in which the hostile
  // string is NOT the term and cannot be derived from it: `chemical-free` for a
  // named process, `WP` for a specific abbreviation, `99.9% of the caffeine` for
  // a method, `decaffeinated at origin` for a geography. Knowing that
  // `chemical-free` reads as a near-synonym of `swiss water process` is domain
  // knowledge, and no amount of template engineering produces it.
  assert.deepEqual(unreachable, [
    "letter_not_spirit/generic_abbreviation",
    "letter_not_spirit/geography_not_method",
    "letter_not_spirit/manner_adverb",
    "letter_not_spirit/mechanism_without_name",
    "letter_not_spirit/near_synonym",
    "letter_not_spirit/quantity_without_name",
  ], "the mechanisation limit moved — update attack/README.md §4 in the same commit, or the document is now false");
});

test("[attack] class 2's domain collisions are REPLAYED from the context, never derived", () => {
  // The generator "produces" these only because a human put them in
  // `contexts/coffee.json`. Coverage the human supplied must never be read as
  // coverage the machine found, so this is asserted rather than described.
  const set = gen(vocab);
  const replayed = set.attacks.filter((a) => a.subclass === "domain_collision").map((a) => a.text);
  const inContext = new Set(coffee.context.adjacentDomains.flatMap((d) => d.sentences));
  for (const t of replayed) assert.ok(inContext.has(t), `${JSON.stringify(t)} is not from the context file`);

  const withoutDomains = generateAttacks(vocab, { context: { ...coffee.context, adjacentDomains: [] } });
  assert.equal(withoutDomains.attacks.filter((a) => a.subclass === "domain_collision").length, 0,
    "with no supplied domains the generator must produce ZERO domain collisions — it cannot derive them");
});

test("[attack] the mechanisable half of class 2 IS derived", () => {
  // Fragment probes: the term's maximal proper prefix and suffix. This reaches
  // the `water process` inside `Sparkling Water Process` shape without anyone
  // having to think of it.
  const set = gen(vocab);
  const frags = set.attacks.filter((a) => a.subclass.startsWith("fragment_"));
  assert.ok(frags.length > 10, `only ${frags.length} fragment probes`);
  assert.ok(frags.some((f) => /Water Process/i.test(f.text) && !/Swiss/i.test(f.text)),
    "the `water process` fragment of `swiss water process` must be reachable");
});

test("[attack] the violation class DE-FRAMES a framed term, which a human had to think of", () => {
  // `VOCABULARY.md` §3.2 forces violating terms to be FRAMED. The violation
  // attack needs the sentence a COMPLIANT store writes, and a compliant store
  // writes the bare substance. `substanceOf` derives that by rule.
  assert.equal(substanceOf("decaffeinated with methylene chloride", "predicate"), "methylene chloride");
  assert.equal(substanceOf("decaffeinated using ethyl acetate", "predicate"), "ethyl acetate");
  assert.equal(substanceOf("ethyl acetate process", "process_name"), "ethyl acetate");

  const set = gen(solvent, { perCellLimit: 99 });
  const texts = set.attacks.filter((a) => a.attackClass === "violation").map((a) => a.text);
  // The exact sentence a human attacker wrote by hand, reproduced by rule.
  assert.ok(texts.includes("Our decaf is free of methylene chloride."),
    `de-framing did not reproduce the hand-written corpus sentence. Got: ${JSON.stringify(texts.slice(0, 4))}`);
  assert.ok(texts.includes("Methylene chloride free decaf, made to order."));
  for (const t of texts) {
    assert.doesNotMatch(t, /free of decaffeinated with/, "a framed term leaked into a free-from construction");
  }
});

test("[attack] the per-cell cap is REPORTED, never silent", () => {
  // CLAUDE.md's rule: a sweep that bounds its own coverage must log what it
  // dropped, or silent truncation reads as "covered everything". This defect was
  // in the first version and the corpus proof is what exposed it.
  const capped = gen(vocab, { perCellLimit: 1 });
  assert.ok(capped.coverage.droppedByCap.length > 100, `only ${capped.coverage.droppedByCap.length} drops recorded at limit 1`);
  assert.match(capped.summary, /CAP: \d+ sentence\(s\)/);
  assert.match(renderAttackSet(capped), /A cell showing N attacks is not a cell with N available/);

  const uncapped = gen(vocab, { perCellLimit: 99 });
  assert.deepEqual(uncapped.coverage.droppedByCap, [], "nothing may be dropped when the cap exceeds what is available");
  assert.doesNotMatch(uncapped.summary, /CAP:/);
});

// ---- GROUP 8 — the term-shape and orthography machinery --------------------

test("[attack] term shapes are assigned as documented", () => {
  const c = coffee.context;
  assert.equal(termShape("decaffeinated with methylene chloride", c), "predicate");
  assert.equal(termShape("swiss water process", c), "process_name");
  assert.equal(termShape("swiss water decaf", c), "nominal_product");
  assert.equal(termShape("swiss water processed", c), "attributive");
  assert.equal(termShape("carbon dioxide decaffeination", c), "process_name");
});

test("[attack] every orthography transform is either applied or explicitly inapplicable", () => {
  for (const o of ORTHOGRAPHY) {
    const multi = o.apply("swiss water process");
    assert.ok(multi === null || multi !== "swiss water process", `${o.subclass} is a no-op on a multi-word term`);
    const single = o.apply("organic");
    assert.ok(single === null || single !== "organic", `${o.subclass} is a no-op on a one-word term and did not decline`);
  }
});

test("[attack] the orthography class reaches the ® form the engine measurably cannot match", () => {
  const set = gen(vocab);
  const orth = set.attacks.filter((a) => a.attackClass === "orthography");
  assert.ok(orth.some((a) => /Water® Process/.test(a.text)), "the internal-® form is the measured failure and must be generated");
  assert.ok(orth.some((a) => a.subclass === "period_split"), "the sentence-splitter hazard must be generated");
});

test("[attack] every template declares a real class and at least one role and shape", () => {
  for (const t of TEMPLATES) {
    assert.ok((ATTACK_CLASSES as readonly string[]).includes(t.attackClass), `${t.subclass} has an unknown class`);
    assert.ok(t.roles.length > 0 && t.shapes.length > 0, `${t.subclass} can never fire`);
    assert.ok(t.intent.length > 30, `${t.subclass} has no usable intent for the adjudicator`);
  }
});

// ---- GROUP 9 — the surface facts these attacks depend on -------------------

const mk = (surface: QuotableSurface, text: string, productType = "Thing"): PublicProduct => ({
  origin: "https://store.example", handle: "p", title: "Thing", vendor: "Acme", productType,
  tags: [], descriptionText: "", variants: [{ title: "Default", priceUsd: 12, available: true, options: ["Default"] }],
  minPriceUsd: 12, optionNames: [], optionValues: [], extracted: null,
  evidence: buildEvidence([{ surface, text }]), ldAvailability: null, storefrontObjectId: null,
  // v3.8 — null: this fixture declares no currency, so the non-USD price refusal
  // cannot fire and every attack expectation here is unchanged by it.
  declaredCurrency: null, policyStatus: "not_fetched",
  fetched: { json: true, page: false, js: false, policy: false },
  diagnostics: { attempted: [], answeredBy: "json", throttled: [], degraded: false, robots: "ok", throttleSource: null },
} as PublicProduct);

const CLAIM: Requirement = { kind: "claim", label: "organic claim", claim: "organic" } as Requirement;
const ORGANIC = "This product is certified organic.";

test("[attack] a claim reaches EIGHT evidence surfaces — every one but the shipping policy", () => {
  // Executed, because the count is the whole basis of the merchant-controlled
  // class. Three of these were unprobed by anyone until the decaf review's
  // refuting pass.
  //
  // ⚠️ THIS TEST SAID **NINE** AND WAS WRITTEN AGAINST A DIFFERENT ENGINE. It was
  // authored on `feat/standards-v1`, where the claim branch filtered `p.evidence`
  // on the LINTER alone and restricted no surface. `feat/v3-0-bridge` then closed
  // the policy-chrome false pass: a claim about THIS PRODUCT must not be provable
  // from a document about ORDERS, because the shipping policy's SEO chrome carried
  // an organic phrase on a real tea store and proved a product claim with it.
  // `productTest.ts` now filters `e.surface !== "shipping_policy"` on claim rows.
  //
  // The merge is where the two met, and the tripwire fired exactly as designed —
  // its own message asked for the attack class to be re-derived, so that is what
  // this is, not a silenced assertion. `shipping_policy` moves to the NEGATIVE
  // control below: it must stay unreachable, and this fails if it ever passes again.
  const REACHABLE: QuotableSurface[] = [
    "product_description", "structured_data", "product_faq", "product_title", "product_options",
    "meta_description", "product_metafield", "seo_description",
  ];
  const reached = REACHABLE.filter((s) => evaluate(mk(s, ORGANIC), CLAIM).status === "pass_evidenced");
  assert.deepEqual(reached, REACHABLE, "a surface stopped accepting a claim — the merchant-controlled attack class must be re-derived");

  // The negative control. A claim proven from the shipping policy is the measured
  // false pass v3.0 CP1 closed; if this flips, that fix has been lost.
  assert.equal(evaluate(mk("shipping_policy", ORGANIC), CLAIM).status, "not_proven",
    "the shipping policy proved a product claim again — the v3.0 CP1 policy-chrome fix has regressed");

  // Every one of those surfaces is generated for.
  const set = gen(vocab);
  const generatedSurfaces = new Set(set.attacks.map((a) => a.surface));
  for (const s of ["product_title", "product_options", "meta_description", "shipping_policy", "product_metafield", "seo_description"] as QuotableSurface[]) {
    assert.ok(generatedSurfaces.has(s), `no attack is placed on ${s}`);
  }
});

test("[attack] `product_type` is NOT an evidence surface, contrary to VOCABULARY_REVIEW §2.4", () => {
  // The gate document instructs an attacker to "put each supporting term in a
  // product title, a product type, and a variant option value". The middle one
  // does not exist: `productType` is read only for category inference
  // (`productTest.ts`), never folded into the evidence index. An attacker
  // following the instruction writes a probe that can never fire and records a
  // pass that means nothing. Pinned bidirectionally — if the engine ever indexes
  // product_type, this fails and the gate document must be corrected back.
  const withTypeOnly = mk("product_description", "", ORGANIC);
  assert.equal(evaluate(withTypeOnly, CLAIM).status, "not_proven",
    "product_type now reaches the claim branch — VOCABULARY_REVIEW §2.4 is correct again and this test must be retired");
});
