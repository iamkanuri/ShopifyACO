# AisleLens Standards

A grammar for publishing **versioned, executable, category conformance standards** for product
pages, and the first standard authored against it.

**The coffee standard is published, and it has been applied — by us.** It sits at stable URLs a
citation resolves against, and it has been run offline, at $0, against recorded captures of **100
real coffee products across 100 storefronts**, with every one of the **162** rows it reported as
proven audited individually against the store's full page text. **Ten of those passes were wrong.**
That measurement is what forced the corrections in
[§ what the first measured standard taught the method](#what-the-first-measured-standard-taught-the-method).

**No second party has applied it.** `posture.independently_applied` is `false`, the document's own
`status` is `applied_by_author` — not `published`, which the grammar reserves for a standard a second
party has run without us — and until that happens this is a rubric with a versioned changelog **and a
measured error rate**, rather than a settled standard.

> ⚠️ **"Nothing here is published" is what this line used to say, and it was one of three clauses
> that went false in the flattering-in-reverse direction — they understated the work.** Numbers in
> this file are generated from or traceable to [`coffee/v1.0/fitness.json`](coffee/v1.0/fitness.json)
> and `measured_fitness` in [`coffee/v1.1/standard.json`](coffee/v1.1/standard.json). Check them
> there before quoting them anywhere else.

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
| [`SCHEMA.md`](SCHEMA.md) · [`schema.json`](schema.json) | **The grammar.** Human explanation and the validatable JSON Schema. | **Grammar 1.2** — the reconciliation of two independently-authored 1.1s (`experiments/v3-4/DECISION.md` §1). 1.0 **and 1.1** documents stay valid: `coffee/v1.1` declares `grammar_version: "1.1"`, and a grammar version resolves through the same citation contract as a `standard_hash`, so 1.1 keeps meaning what that document was authored against. |
| [`discrimination.ts`](discrimination.ts) | The measured-verdict lifecycle: Wilson intervals, the derived minimum n, and the cross-field rules a schema cannot express. | **New.** Pure, no dependencies. |
| [`ENGINE_CONTRACT.md`](ENGINE_CONTRACT.md) | What the engine can actually execute, derived from the code at commit `96ceacd`. | **Complete.** Includes a section on where the commissioning brief was wrong. |
| [`ENGINE_GAPS.md`](ENGINE_GAPS.md) | The standing proposal register: the specification for a future engine session. | **Live — read the file for the current set**, do not quote a count from here. 14 gaps when this directory was authored; **G-09 and G-10 have since closed**, verified in code rather than asserted (`RunOptions.requirements` + `StandardIdentity` in `src/server/productTest.ts`; `standards/applicability.ts` plus a per-standard sidecar). **G-14 is a campaign, not a session.** |
| [`METHOD.md`](METHOD.md) | How a standard gets authored, so category three is a process. | **Corrected twice against measurement.** §5, §6 and §8.1a replaced rules the first run killed; §0, §3.5, §5 and §6 now carry the n=100 figures that superseded the n=43 ones, and §3.5 adds the `unbound` tier. |
| [`coffee/v1.0/`](coffee/v1.0/) | The first standard: 42 entries, 10 executable. | **Byte-frozen** at `standard_hash` `334389c4…` and still served, because citations resolve through it. Its measurement arrived *after* it shipped, so it lives in the [`fitness.json`](coffee/v1.0/fitness.json) **sidecar** — changing the document would have invalidated every citation made against v1.0. |
| [`coffee/v1.1/`](coffee/v1.1/) | The reissue, forced by three posture clauses going false. | `status: applied_by_author`, grammar 1.1, hash `f8ec2780…`. Its measurement existed *before* the version did, so `measured_fitness` lives **inside** the document and is covered by the hash. **Same sidecar rule, opposite outcome.** Migration to grammar 1.2 is specified (`SCHEMA.md` §9.3) and not performed here. |
| [`accessory/v0.1-draft/`](accessory/v0.1-draft/) | A **partial draft** on a structurally different category. | **Deliberately incomplete.** Authored only as a generalisation test. |
| [`attack/`](attack/README.md) | **The attack templatizer.** Generates the review gate's hostile sentences from any vocabulary, deterministically, with a coverage report. | **Complete.** Covers 6 of 8 classes; §4 states exactly which 2 it cannot and why. |
| [`acceptance/subject-tense/`](acceptance/subject-tense/README.md) | **The acceptance target** for the engine's subject and tense handling — the 37 hostile shapes no term list can close, plus 19 that must not regress. | **Complete as a target.** `hostile 4/37` at `e9ec942`, an observation, not an expectation. |
| [`compile.ts`](compile.ts) · [`validate.ts`](validate.ts) · [`hash.ts`](hash.ts) · [`rehash.ts`](rehash.ts) | Compiler to engine requirements, schema validator, content hashing. | **Complete.** No new dependencies. |
| [`__tests__/`](__tests__/) | The compile-and-validate gate. | **Pure** — no database, no network, no server, no model calls. Report the count **and the completion state** from an actual run (`METHOD.md` §7); this table deliberately caches neither, because a cached count goes stale silently and "green" written down is not "green" observed. |

---

## The coffee standard in one table

| tier | count | meaning |
|---|---|---|
| executable | 10 | the engine runs it today, against public data |
| blocked | 16 | should be executable; the engine cannot yet, each naming its gap |
| not_discriminating → **`unbound`** | 5 | `PRICE-001`, `STOCK-001`, `TERMS-001`, `DECAF-004`, `DIET-001`. ⚠️ **All five were assigned on a PREDICTION, and grammar 1.2 removes the tier** — that verdict now requires a measurement and none of these has one. They are not `advisory` and not `blocked` either; both would state something false about at least three of them, so 1.2 gives them **`unbound`** (`METHOD.md` §3.5). The re-tiering is specified in `SCHEMA.md` §9.3 and not performed here |
| advisory | 11 | a real buyer question public data cannot adjudicate |

⚠️ **`WEIGHT-001` is not one of the five, and it has never been retired.** It is `tier: executable`
in both `coffee/v1.0` and `coffee/v1.1`, and it measures **49.0%** — the most informative split in
the standard. It was *flagged* at n=9 under a triage step that no longer exists, which is the hazard
demonstrated, not an instance of the damage. Retelling a near-miss as a casualty makes the argument
weaker and false at the same time.

**Ten of forty-two is the honest ratio, and the binding constraint is not the research** — 90
candidate questions were produced and refuted. It is the size of two hardcoded engine dictionaries
(`ENGINE_GAPS.md` G-06). Of the three claim keys coffee can use, none was chosen for coffee; they
happen to exist.

Read [`coffee/v1.0/STANDARD.md`](coffee/v1.0/STANDARD.md) for the entries and
[`coffee/v1.0/GROUNDING.md`](coffee/v1.0/GROUNDING.md) for the provenance — including the
**twenty-one questions researched and dropped**, which is a longer list than the standard.

---

## WHAT THE FIRST MEASURED STANDARD TAUGHT THE METHOD

Read this before authoring anything. The coffee standard was applied to **100 in-category products,
one per store**, with applicability enforced. **Three of the method's rules did not survive contact
with that measurement**, and none of the three failures was visible from inside the document — every
one needed real stores.

**1. The method predicted, and the predictions were wrong in one direction.** Ten authored
`predicted_discrimination` bands: **HELD 1 OF 10, with EIGHT OF THE NINE MISSES HIGH.** The author
systematically over-estimated how much a category's stores publish. Four repair shapes were scored on
the same ten entries and **none could be shown to carry information** — the best-looking one, a
two-valued direction at 9 of 10, is statistically identical to always guessing "most will fail". So
the band is gone, replaced by an optional direction and confidence that **may not determine
anything**, kept only because it is the falsification target that made this measurable.

> ⚠️ This supersedes **"HELD 2 OF 10, ALL EIGHT MISSES HIGH"**, measured on 43 records across 42
> brands. `GRIND-001` is the only band still standing at n=100, and the sample's one *low* miss —
> `DELIV-001` at 45.0% against a predicted 50–80% — means the over-estimation is no longer unanimous.
> Source: `bands_held: 1` over `n_products: 100` in `fitness.json` `entry_discrimination`.

**2. Tiers were assigned on that prediction, and it nearly deleted the standard's best entry.**
`WEIGHT-001` was predicted 15–40% and measured **11.1% on nine products**, which under the triage
step of the day made it a candidate for `not_discriminating` — published, not run, one
reclassification from deletion. On valid samples it measures **48.8% at n=43 and 49.0% at n=100**.
The error had no route back: an entry that is not run cannot produce the evidence that would reverse
the decision to stop running it. Discrimination is now a **measured verdict** with `n`, a date and
its sample, and **no verdict may be recorded below 22 adjudicated rows** — a floor derived from the
15–85% band rather than chosen, because below it *no observation that exists* can support the
conclusion. (**The step was deleted before it fired**: `WEIGHT-001` shipped `executable` and stayed
executable. The hazard is the argument; the casualty never happened.)

**3. The error bound the project trusted was measured on somebody else's copy — and then the
correction turned out to be about audit method, not just sample shape.** Same engine, same audit,
**not the same audit depth**:

| | general DTC sample | **coffee sample** |
|---|---|---|
| products evaluated | 172 | 100 |
| pass rows audited | 509 | 162 |
| audit depth | **one defect class, re-checked mechanically** | **every row, every class, full untruncated evidence** |
| confirmed false positives | **18** | **10** |
| cluster-adjusted 95% upper (ICC 0.2) | **7.80% — a FLOOR** | **12.78%** |

> ⚠️ **The general 7.80% is a FLOOR, not a bound, wherever it appears.** Its own `is_floor: true` and
> `supersedes` fields say so. Only the `identifiers` class was re-checked — rows passing on an `mpn`
> that is the store's own Shopify product id or a byte-copy of its SKU. A completed audit can only
> move that number **up**.

**This corrects 0.83%, which this project published for three versions.** An earlier audit read all
507 *rendered* rows of that same sample and confirmed **zero** false positives; one mechanical check
of one class found **eighteen** — because an identifier row **renders no quote**, so it reads
identically whether the value is a real GS1 barcode or a number the store minted about itself.

**The direction survives; the magnitude does not.** Seven of coffee's ten defects fire on copy only a
coffee page writes — a brewing recipe or a caffeine dose per serving read as the product's net weight
(3), the soil-science sense of *organic* (2), `single-origin` inside a sentence describing a **blend**
(2) — and a general DTC page contains none of that vocabulary, so a general sample **structurally
cannot** contain them. That is a mechanism. What is *not* a measurement is the ratio: the published
*"order of magnitude"* becomes **about 1.6×** (12.78 ÷ 7.80), and even 1.6× is unreliable, because
the two samples are **not audited to the same depth** and because on the single class both *were*
checked for the general sample is worse (18 in 509 rows against coffee's 3 in 162). See
[`METHOD.md`](METHOD.md) §6.1.

**A general-sample bound is not an estimate of the error rate. It is an estimate of the error rate on
copy that looks like the average of every category at once — which is copy no merchant writes — for
the defects somebody thought to look for.** A standard now cannot publish without a fitness
measurement on its own category.

And two smaller lessons that cost as much to learn:

- **Applicability is a precondition, not a field.** Run over the first run's own snapshots, the gate
  excluded **16 of 25 products** — roasters lead their catalogue with t-shirts and mugs. The shipped
  predicate is stricter than the hand count that preceded it, because it *refuses what it cannot
  classify* rather than guessing, and that is the correct default.
- **Sampling defects survive being written down.** The n=43 run document announced that a duplicated
  brand had been *"removed from every denominator"*. Recomputing from its own JSONL: it was removed
  from the false-positive bound and **not** from the discrimination table. A correction stated in
  prose was applied to one table and not the other, and only recomputation found it. (The corrected
  verdict rule is unmoved by it — not one verdict changed — which is the best available argument for
  reading an interval rather than a point.) The n=100 run deduplicates on registrable domain
  **before capture**, so the duplicate cannot reach either table.

The full record, with the arithmetic, is [`METHOD.md`](METHOD.md) §5 and §6.

---

## The grammar was revised during authoring, again after measuring, and again to reconcile two 1.1s

The grammar shipped with three tiers and ten operators. Authoring found two things it could not say.

**A fourth tier, `not_discriminating`, forced by coffee — and then removed.** The original tiers
conflated *the engine cannot test this* with *the engine should not test this*. "What does this
cost?" is unambiguously a buyer question and unambiguously executable — and price is exposed on
essentially every platform product, so testing it produces a row that passes for everyone. The engine
has measured exactly that: a price requirement failed for **zero of thirteen** real stores, and a
defaulted cruelty-free claim failed **thirteen of thirteen**; both carry the same information, which
is none. Under three tiers the only options were to publish noise, to mislabel it as untestable, or
to omit price and look like the standard forgot about it. None is honest.

> ⚠️ **The tier was right about the problem and wrong about the remedy, and it took a measurement to
> tell them apart.** `not_discriminating` was assigned on a *prediction*, which made it a route to
> stop running an entry with no evidence and no way back. At grammar 1.2 it survives only as a
> **measured verdict** (`n`, a date, a sample, an interval) and is gone as an authoring tier. The
> five entries that carried it were never runnable in the first place — no `binding` — so they are
> now **`unbound`** (`METHOD.md` §3.5), a tier that had to be added because `advisory` and `blocked`
> would each have stated something false about them. **Removing a wrong tier is what exposed the
> missing one.**

**An operator, `includes_buyer_parameter`, forced by the accessory draft.** Every other operator
compares page evidence against a value fixed when the standard is written. A compatibility assertion
inverts it: the *list* is on the page and the *value* is the buyer's own model, supplied at test time.
The grammar had silently assumed the first shape.

**What survived is the more useful result.** Tier, evidence surfaces, `insufficient_evidence`,
`conflict_rules`, `pass_means`, `known_gaps`, `adversarial`, `grounding` and the never-weaken
changelog all carried into a compatibility-and-specification category with no strain — and two
behaved *better* there. The grammar generalises.

**And one field survived only by being demoted.** `predicted_discrimination` carried a numeric band
that drove tier assignment; at 1.2 it is `discrimination_prediction` — optional, unranked,
**numberless**, forbidden from determining a tier or a verdict, and readable by no test. It is kept
for one reason: *"bands held 1 of 10, every miss high"* is computable **only because the predictions
were preserved beside the measured rates**. A field nobody records cannot be shown to be wrong. It is
retained as a falsification target, not as a signal.

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

**Pure** — no database, no network, no server, no model calls. Report the count **and the completion
state** from the run itself (`METHOD.md` §7): a count cached in a README goes stale silently, and a
suite that errored before reaching its assertions must never read the same as a green one. They
prove:

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
  counts; **and every one of the twenty-one cross-field rules has a negative fixture that must
  provoke it**, with a meta-test that fails when a rule is added without one. Twenty-one, not
  eighteen — counted from the `ALL_RULES` literal in [`discrimination.ts`](discrimination.ts): **14**
  over `measured_discrimination`, **6** over `category_fitness`, **1** never-weaken interaction. It
  has already caught two of its own: a rule that permitted "measure once, retire, no attestation",
  and an interval tolerance wider than the narrowest margin the rule decides on.

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

1. ✅ **`ENGINE_GAPS.md` G-09 — make a standard runnable at all** — **CLOSED.** A pinned contract now
   runs against a PUBLIC url: `RunOptions.requirements` + `standard`, with the result carrying
   `standardId`/`version`/`hash` so a citation resolves, and a `c1s-` tag folded into
   `contractVersion`. **G-10 (applicability gating) is closed too**, `standards/applicability.ts` plus
   a per-standard sidecar. Both verified in code rather than read off a changelog.
2. ✅ **Measure the ten executable entries** — **DONE**, three times, and the n=100 run is the one
   that counts. It invalidated three of the method's rules; see the section above. What is left is the
   **write-back**, which this session deliberately did not perform because another session owns those
   files: record a `measured_discrimination` on each of the ten entries, re-tier the five
   `not_discriminating` entries as **`unbound`** rather than re-deriving them from a measurement they
   do not have, and migrate the document to grammar **1.2** (`SCHEMA.md` §9.3).
   ⚠️ **Two traps in that write-back, both of which a careless pass will walk into.** The five
   `not_discriminating` entries are `PRICE-001`, `STOCK-001`, `TERMS-001`, `DECAF-004`, `DIET-001` —
   **`WEIGHT-001` is not among them**, is `executable` in both shipped versions, and measures 49.0%.
   And the five entries that *do* now carry a measured `not_discriminating` verdict are a different
   five again (`METHOD.md` §5.2); retiring any of them additionally needs an `instrument_bias`
   declaration, which the two known one-directional biases currently block for the claim rows.
2b. **Write the measured category fitness into `category_fitness`**, so the document can ever leave
   `applied_by_author`. The measurement exists — **162 pass rows audited individually, 10 confirmed
   false positives, 12.78% cluster-adjusted at ICC 0.2 over 100 products and 77 pass-carrying stores**
   — and it needs the shape the schema now requires, **including the method that produced each
   bound**, which is currently the weak point: coffee's naive 10.47% reproduces only as a one-sided
   95% Poisson upper limit, while the general sample's 5.56% reproduces only as a two-sided
   Agresti–Coull upper. **Two bounds from two estimator families are not comparable**, and the
   superseded naive 11.23% matched no standard estimator at all.
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

**The authoring session** produced the grammar and the standards. It **executed nothing against a
real store, fetched no storefront, published nothing, and changed no file outside `standards/`**.
Where the work implied a change elsewhere in the repo, it was written down as a proposal in
`ENGINE_GAPS.md` rather than made.

⚠️ **That is a statement about that session, not about this directory today**, and the difference is
the whole content of the section above: the coffee standard has since been **published** at stable
URLs and **applied** — offline, at $0, over recorded captures, never live against a store — and the
measurements that came back invalidated three of the method's rules. **Read a scope note as dated.**
