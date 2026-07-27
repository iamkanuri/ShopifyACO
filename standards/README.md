# AisleLens Standards

A grammar for publishing **versioned, executable, category conformance standards** for product
pages, and the first standard authored against it.

**Nothing here is published.** The coffee standard **has** now been applied — offline, at $0, against
recorded captures of 42 real roasters — and that measurement is what forced the corrections in
[§ what the first measured standard taught the method](#what-the-first-measured-standard-taught-the-method).
No standard has been applied by a second party, so `posture.independently_applied` is still `false`
and this is still a rubric with a versioned changelog.

---

## What this is

Today the questions AisleLens tests are generated per product by a heuristic. That is a vendor's
private rubric. The position this directory exists to build is that those questions should be a
**published, versioned, executable standard** — so a merchant tests against a named public
specification rather than against a vendor's opinion, and a shopper can read the same document.

Every product category has questions a competent buyer asks. A standard turns them into **assertions
with defined evidence rules**, each citable by a stable id, so an agency can write *"your product
pages fail ALS-COFFEE-1.0-CERT-002"* in a client report and have it resolve to a specific text.

### What this is not

> **Until a second party independently applies one of these standards without us, it is a rubric with
> a versioned changelog, not a standard.** The difference is not headcount — SemVer and Markdown were
> each one person. It is whether someone else *can* apply it and whether anyone *does*. Every
> standard carries this as a machine-readable `posture.independently_applied` flag, and it is `false`.

Also not: a score, a grade, a seal, or a claim about whether any product is what its page says it is.
The engine adjudicates **evidence availability, never product truth**, and every executable entry
carries a `pass_means` field stating what a pass does and does not license a reader to conclude.

The vocabulary used throughout is **standard, assertion, conformance testing, evidence, verified
against**. The words *standards body*, *accredited*, *trusted by* and *guaranteed* appear nowhere, and
a test enforces that. *Certification* vocabulary appears only where it names a third party's scheme,
never in any field describing what these documents produce — a deliberate reading of the rule, with
the reasoning in `standard.test.ts`.

---

## State of each artifact

| artifact | what it is | state |
|---|---|---|
| [`SCHEMA.md`](SCHEMA.md) · [`schema.json`](schema.json) | **The grammar.** Human explanation and the validatable JSON Schema. | **v1.0, plus the v1.1 correction** the first measurement forced (`SCHEMA.md` §9). 1.0 documents stay valid. |
| [`discrimination.ts`](discrimination.ts) | The measured-verdict lifecycle: Wilson intervals, the derived minimum n, and the cross-field rules a schema cannot express. | **New.** Pure, no dependencies. |
| [`ENGINE_CONTRACT.md`](ENGINE_CONTRACT.md) | What the engine can actually execute, derived from the code at commit `96ceacd`. | **Complete.** Includes a section on where the commissioning brief was wrong. |
| [`ENGINE_GAPS.md`](ENGINE_GAPS.md) | 14 gaps: the specification for a future engine session. | **Complete and prioritised.** G-09 first; **G-14 is a campaign, not a session.** |
| [`METHOD.md`](METHOD.md) | How a standard gets authored, so category three is a process. | **Corrected against the first measurement** — §5, §6 and §8.1a all replace rules that did not survive it. |
| [`coffee/v1.0/`](coffee/v1.0/) | The first standard: 42 entries, 10 executable. | **Complete, validated, adversarially reviewed, and now MEASURED — which is what invalidated three of the method's rules.** Its own migration to grammar 1.1 is specified (`SCHEMA.md` §9.3) and deliberately not performed here. |
| [`accessory/v0.1-draft/`](accessory/v0.1-draft/) | A **partial draft** on a structurally different category. | **Deliberately incomplete.** Authored only as a generalisation test. |
| [`attack/`](attack/README.md) | **The attack templatizer.** Generates the review gate's hostile sentences from any vocabulary, deterministically, with a coverage report. | **Complete.** Covers 6 of 8 classes; §4 states exactly which 2 it cannot and why. |
| [`acceptance/subject-tense/`](acceptance/subject-tense/README.md) | **The acceptance target** for the engine's subject and tense handling — the 37 hostile shapes no term list can close, plus 19 that must not regress. | **Complete as a target.** `hostile 4/37` at `e9ec942`, an observation, not an expectation. |
| [`compile.ts`](compile.ts) · [`validate.ts`](validate.ts) · [`hash.ts`](hash.ts) · [`rehash.ts`](rehash.ts) | Compiler to engine requirements, schema validator, content hashing. | **Complete.** No new dependencies. |
| [`__tests__/`](__tests__/) | 181 pure tests. | **Green.** |

---

## The coffee standard in one table

| tier | count | meaning |
|---|---|---|
| executable | 10 | the engine runs it today, against public data |
| blocked | 16 | should be executable; the engine cannot yet, each naming its gap |
| not_discriminating | 5 | the engine *could* run it and deliberately does not. ⚠️ **All five were assigned on a PREDICTION, which grammar 1.1 forbids** — the re-derivation from measurement is specified in `SCHEMA.md` §9.3 and not performed here |
| advisory | 11 | a real buyer question public data cannot adjudicate |

**Ten of forty-two is the honest ratio, and the binding constraint is not the research** — 90
candidate questions were produced and refuted. It is the size of two hardcoded engine dictionaries
(`ENGINE_GAPS.md` G-06). Of the three claim keys coffee can use, none was chosen for coffee; they
happen to exist.

Read [`coffee/v1.0/STANDARD.md`](coffee/v1.0/STANDARD.md) for the entries and
[`coffee/v1.0/GROUNDING.md`](coffee/v1.0/GROUNDING.md) for the provenance — including the
**twenty-one questions researched and dropped**, which is a longer list than the standard.

---

## WHAT THE FIRST MEASURED STANDARD TAUGHT THE METHOD

Read this before authoring anything. The coffee standard was applied to 43 in-category product
records across 42 real roasters, with applicability enforced. **Three of the method's rules did not
survive contact with that measurement**, and none of the three failures was visible from inside the
document — every one needed real stores.

**1. The method predicted, and the predictions were wrong in one direction.** Ten authored
`predicted_discrimination` bands: **HELD 2 OF 10, with ALL EIGHT MISSES HIGH.** The author
systematically over-estimated how much a category's stores publish. Four repair shapes were scored on
the same ten entries and **none could be shown to carry information** — the best-looking one, a
two-valued direction at 9 of 10, is statistically identical to always guessing "most will fail". So
the band is gone at grammar 1.1, replaced by an optional direction and confidence that **may not
determine anything**, kept only because it is the falsification target that made this measurable.

**2. Tiers were assigned on that prediction, and it nearly deleted the standard's best entry.**
`WEIGHT-001` was predicted 15–40%, measured **11.1% on nine products**, and flagged
`not_discriminating` — published, not run, one reclassification from deletion. On a valid sample it
measures **48.8%**. The error had no route back: an entry that is not run cannot produce the evidence
that would reverse the decision to stop running it. Discrimination is now a **measured verdict** with
`n`, a date and its sample, and **no verdict may be recorded below 22 adjudicated rows** — a floor
derived from the 15–85% band rather than chosen, because below it *no observation that exists* can
support the conclusion.

**3. The error bound the project trusted was measured on somebody else's copy.** Same engine, same
day, same audit discipline: a 172-store general sample gave **0 false positives in 506 audited pass
rows, a 0.83% bound**. The 42-store coffee sample gave **3 in 69 rows, 13.68%**. All three coffee
defects fire on copy only a coffee page writes — a brewing recipe read as a net weight, a caffeine
dose per serving read as the product's mass, soil *rich in organic matter* read as an organic claim.
**A general-sample bound is not an estimate of the error rate; it is an estimate of the error rate on
copy that looks like the average of every category at once, which is copy no merchant writes.** A
standard now cannot publish without a fitness measurement on its own category.

And two smaller lessons that cost as much to learn:

- **Applicability is a precondition, not a field.** Run over the first run's own snapshots, the gate
  excluded **16 of 25 products** — roasters lead their catalogue with t-shirts and mugs. The shipped
  predicate is stricter than the hand count that preceded it, because it *refuses what it cannot
  classify* rather than guessing, and that is the correct default.
- **Sampling defects survive being written down.** The run document announced that a duplicated brand
  had been *"removed from every denominator"*. Recomputing from its own JSONL: it was removed from the
  false-positive bound and **not** from the discrimination table. A correction stated in prose was
  applied to one table and not the other, and only recomputation found it. (The corrected verdict rule
  is unmoved by it — not one verdict changes — which is the best available argument for reading an
  interval rather than a point.)

The full record, with the arithmetic, is [`METHOD.md`](METHOD.md) §5 and §6.

---

## The grammar was revised once during authoring, and again after measuring

The grammar shipped with three tiers and ten operators. Authoring found two things it could not say.

**A fourth tier, `not_discriminating`, forced by coffee.** The original tiers conflated *the engine
cannot test this* with *the engine should not test this*. "What does this cost?" is unambiguously a
buyer question and unambiguously executable — and price is exposed on essentially every platform
product, so testing it produces a row that passes for everyone. The engine has measured exactly that:
a price requirement failed for **zero of thirteen** real stores, and a defaulted cruelty-free claim
failed **thirteen of thirteen**; both carry the same information, which is none. Under three tiers the
only options were to publish noise, to mislabel it as untestable, or to omit price and look like the
standard forgot about it. None is honest.

**An operator, `includes_buyer_parameter`, forced by the accessory draft.** Every other operator
compares page evidence against a value fixed when the standard is written. A compatibility assertion
inverts it: the *list* is on the page and the *value* is the buyer's own model, supplied at test time.
The grammar had silently assumed the first shape.

**What survived is the more useful result.** Tier, evidence surfaces, `insufficient_evidence`,
`conflict_rules`, `pass_means`, `known_gaps`, `predicted_discrimination`, `adversarial`, `grounding`
and the never-weaken changelog all carried into a compatibility-and-specification category with no
strain — and two behaved *better* there. The grammar generalises.

---

## The one governance rule, honoured forever

> **The changelog may never show an assertion being weakened in the same window a merchant failed
> it.** That single event retroactively poisons every result the standard ever produced.

If a merchant can fail `X`, complain, and observe `X` become easier, then every prior pass is
suspected of having been bought and every prior fail of having been arbitrary. The damage is not to
the one result; it is to the claim that the standard means anything.

Mechanically: `weakened` and `demoted` changes are treated identically, because their effect on a
merchant who failed is identical. Either requires a `weakening_attestation`. If failures exist under
the prior form, the affected results must be **reissued or invalidated** — there is deliberately no
grandfathering value. `strengthened` changes are always safe and need no attestation.
[`SCHEMA.md`](SCHEMA.md) §5 states the rule and, honestly, its one hole: an `editorial` change can
weaken an assertion in practice while being logged as harmless, and only re-running a corpus against
both versions would catch it. The `standard_hash` at least makes any content change visible.

---

## Running the tests

```bash
node --import tsx --test standards/__tests__/*.test.ts
```

181 tests, **pure** — no database, no network, no server, no model calls. They prove:

- the standards validate against the JSON Schema — and **the hand-written validator is itself proven**
  by 20 mutation fixtures, one per keyword the schema uses, each of which must fail for the right
  reason at the right path, plus a tripwire asserting the schema uses no keyword the validator
  silently ignores;
- every `executable` entry **compiles to a real engine `Requirement`** and is **accepted by the real
  `evaluate()`**, executed rather than asserted, because an unknown dictionary key is a thrown
  `TypeError` and not a failed row;
- every executable assertion is **satisfiable** — its own published `accepted_evidence.example` must
  produce a passing state, so a form the standard advertises and the engine rejects is a build
  failure — and **refutable**, because an assertion nothing can fail carries no information;
- ids are unique and well-formed, engine labels are unique (the engine keys every lookup off `label`);
- no entry cites an evidence surface the engine does not have, and no public-tier entry depends on a
  non-public one;
- **no rendered string trips the real claim linter** — imported, not reimplemented, because a copy
  would drift;
- every entry has non-empty `insufficient_evidence` and real `grounding`;
- the never-weaken attestation is internally consistent, **with a negative fixture that must fail**,
  because a governance check nobody has watched fail is a check nobody has tested;
- `standard_hash` matches content;
- the **attack templatizer** is deterministic under a fixed seed, comparable under a new one,
  produces every class for every applicable term or names the omission, rejects a malformed
  vocabulary as `incomplete` rather than silently producing nothing, reports what its per-cell cap
  dropped, and **imports nothing that evaluates a sentence** — generation and adjudication are kept
  apart by a test, not by convention;
- the **subject/tense acceptance suite** parses, stratifies per class, and its must-not-regress half
  is non-empty and **currently green**, so it is a live regression guard rather than only a target.
  Its most dangerous mutation — deleting the term list, which would score the hostile half 37/37 —
  is caught before the runner produces a number;
- **the discrimination lifecycle**, which is the newest and least-trusted part: the Wilson bounds are
  checked against the equation that *defines* them rather than against the closed form that produced
  them; the minimum n of 22 is re-derived a third way, by exhaustive search, so the constant cannot
  drift from the band it depends on; the rule's verdicts are asserted against the real run's own
  counts; **and every one of the eighteen cross-field rules has a negative fixture that must provoke
  it**, with a meta-test that fails when a rule is added without one. It has already caught two of
  its own: a rule that permitted "measure once, retire, no attestation", and an interval tolerance
  wider than the narrowest margin the rule decides on.

Typecheck (the root config scopes to `src/`, so this directory needs its own):

```bash
npx tsc --noEmit -p standards/tsconfig.json
```

Recompute hashes after editing a standard:

```bash
node --import tsx standards/rehash.ts --write
```

Generate the review gate's attack set for a vocabulary:

```bash
node --import tsx standards/attack/cli.ts standards/coffee/v1.0/vocabulary/decaf-method.json --context coffee
```

Run the subject/tense acceptance target:

```bash
node --import tsx standards/acceptance/subject-tense/run.ts
```

---

## What has to happen next, in order

1. **`ENGINE_GAPS.md` G-09 — make a standard runnable at all.** The public test has no way to accept
   a supplied contract, so no conformance result can currently be produced against a public URL.
   Every other gap is academic until this is closed. The authenticated path already accepts a pinned
   contract, so this is plumbing rather than design.
2. ✅ **Measure the ten executable entries** — **DONE**, twice, and the second run is the one that
   counts. It invalidated three of the method's rules; see the section above. What is left is the
   **write-back**, which this session deliberately did not perform because another session owns those
   files: record a `measured_discrimination` on each of the ten entries, re-derive the five
   `not_discriminating` tiers from measurement instead of prediction, and migrate the document to
   grammar 1.1 (`SCHEMA.md` §9.3). **The five retirements cannot simply be carried over** — under the
   corrected rule not one of them is currently supportable, and one, `WEIGHT-001`, was measured as the
   standard's most informative entry.
2b. **Measure the coffee standard's category fitness and attach it**, so the document can ever leave
   `draft`. The measurement exists — 69 pass rows, 3 confirmed false positives, 13.68% cluster-adjusted
   — and it needs to be written into `category_fitness` in the shape the schema now requires, including
   the method that produced each of the three bounds (the naive 11.23% is not reproducible from Wilson,
   Clopper–Pearson, Wald or Agresti–Coull, and the closest match is Jeffreys at 11.15%).
3. **Close the subject and tense gap**, against
   [`acceptance/subject-tense/`](acceptance/subject-tense/README.md) — `hostile 4/37` today. This is
   the binding constraint on every vocabulary in every category, not a coffee problem: narrowing a
   term list closed every class a term list can close and **zero** of these. Judge any fix on both
   directions (the suite's 19 must-not-regress cases are green today) and do the natural-frequency
   read before shipping it.
4. **G-02, roast date** — the highest-value new assertion shape and the cheapest safe one, reusing two
   hooks the engine already has.
5. **G-04, registry resolution** — the genuinely empty market ground. Build the adapter seam and the
   result model *before* any specific register, and ship the first adapter in a mode that only ever
   confirms and never contradicts.
6. **Get a second party to apply the coffee standard without us.** Until then the flag stays `false`
   and this is a rubric.

---

## Scope of this work

This session authored the grammar and the standards. It **executed nothing against a real store,
fetched no storefront, published nothing, and changed no file outside `standards/`**. Where the work
implied a change elsewhere in the repo, it is written down as a proposal in `ENGINE_GAPS.md` rather
than made.
