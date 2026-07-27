# METHOD — how a category standard gets authored

So that category three is a **process**, not an act of invention.

Read [`SCHEMA.md`](SCHEMA.md) for what the fields mean and
[`ENGINE_CONTRACT.md`](ENGINE_CONTRACT.md) for what the engine can execute. This document is the
order of operations, the gates, and the one rule for choosing what to author next.

---

## 0. The shape of the work

| stage | output | gate to pass before moving on |
|---|---|---|
| 1. Category selection | a decision, with the score written down | the selection rule (§8) favours it, §8.4 does not warn against it, **and the engine can execute enough of it (§8.1a)** |
| 2. Engine contract | the executable vocabulary, re-derived from code | every requirement kind and evidence surface confirmed at a named commit |
| 3. Research | candidate questions with citations | ≥1 real citation per question, per class, from independent agents |
| 4. Refutation | verdicts on the candidates | a separate agent has tried to kill each one |
| 5. Triage | executable / advisory / blocked | every `executable` entry has a `binding` that names a real engine kind |
| 6. Adversarial pass | attacks on your own assertions | every `executable` entry has an `adversarial` record with an outcome |
| 7. Prediction *(optional, unranked)* | a direction and a confidence, with reasoning | it determines **nothing** — §5 |
| 8. Compile + validate | a green test suite | §7 — every gate, no exceptions |
| 9. Gaps | `ENGINE_GAPS.md` entries | every `blocked` entry cross-references a real gap id |
| **10. Category fitness** | **an error bound measured on THIS category** | **§6 — the publication gate. `status: draft` until it exists.** |
| **11. Discrimination measurement** | **per-entry verdicts with `n` and a date** | **§5.2 — no verdict below n=22; retirement is a `demoted` change** |

**Stages 3 and 4 are the expensive ones and they are the ones that cannot be skipped.** Everything
else is bookkeeping that a later session can redo; ungrounded questions are the artifact that reads
as machine-generated, and no amount of later polish removes that smell.

> **Stages 7, 10 and 11 are this document's correction, and each replaces a rule that was measured
> wrong on the first standard ever run.** Stage 7 used to be *"predict a numeric band"* and used to
> feed stage 5, so an author's guess could decide that an entry would never be run. On the first
> valid sample the bands held **2 of 10**, and **all eight misses were high**. Stage 11 used to be
> absent, so verdicts were recorded on nine products; three of ten inverted at n≈43. Stage 10 used
> to be absent, so the only error bound in evidence had been measured on a general sample, which is
> a different number: **0.83% general versus 13.68% on coffee, same engine, same day.**

---

## 1. The research protocol

**Independent agents on separate assertion classes.** Split by *class of claim*, not by alphabet —
for coffee: certification and registry landscape; process and production conventions; freshness and
handling; packaging, format and grind; purchase terms and logistics; regulatory and labelling
constraints. Each agent works blind to the others. Overlap between classes is a signal, not waste:
a question two independent researchers reach from different directions is better grounded than one
either reached alone.

**Each agent reports, per candidate question:**

- the question **as a shopper would ask it** — not as a spec field name;
- the demonstrable evidence that buyers ask it;
- specific citations with URLs and what each source *establishes*;
- the accepted evidence conventions;
- **what does not count** — the most valuable field an agent produces;
- whether an external register exists, and its concrete lookup mechanism;
- whether the claim is mandated, registry-resolvable, a trade convention, or self-declared;
- how sellers typically publish it, and whether a machine could read it from public page text.

**Constraints that must be in every research prompt.** Two are about safety and one is about
honesty:

1. **No fetching third-party storefronts or product pages.** Egress reputation is shared with
   whatever else the project is running, and a standards session has no reason to touch a store.
   Authoritative and community sources only.
2. **Cite specifically or mark ungrounded.** "Common knowledge" is not grounding, and a fabricated
   URL is worse than an admitted gap. Instruct explicitly that inventing a citation is the one
   unrecoverable failure.
3. **Never conflate four different things**: *mandated* (law requires it, cite the instrument),
   *registry-resolvable* (a public register confirms it for a named holder), *trade convention* (a
   documented norm with no register), *self-declared* (anyone can print it). Research that blurs
   these produces a standard that claims verification it cannot perform.

---

## 2. Refutation is a separate agent, not a review

**The refuter's only job is to kill things, and it should default to killing.** Two refuters, given
the *complete* candidate set from all researchers — this is one of the few places a barrier between
stages is genuinely correct, because "is this question shopper-driven or trade-invented?" cannot be
answered one question at a time:

**Refuter A — buyer demand.** Which questions do shoppers demonstrably ask, versus which were
invented by the trade, by roasters marketing themselves, or by the researcher? Verdicts:
`well_grounded`, `trade_invented`, `grounding_too_weak`, `claim_overstated`, `citation_unverifiable`.

> The substitution to hunt for: **a source that *defines* a term is not a source showing anyone
> asks about it.** This is the single commonest way an ungrounded question acquires a citation and
> looks grounded.

**Refuter B — registry reality.** For every claimed register: does it exist, is it public and free,
can it be searched by a key a *product page* actually carries, and — the question that catches the
most overclaiming — **at what level does it resolve?** A register that resolves to a *company*
cannot verify a specific bag.

> The other error to hunt: **a requirement that applies to the physical package is not a
> requirement that anything appears on a web page.** Net-quantity and country-of-origin marking
> rules govern the bag; a standard citing them as grounding for a *page* assertion has borrowed
> authority it does not have. Every mandated-status claim gets checked against this.

**Refuted questions do not silently vanish.** `grounding.refutation` records `challenged`,
`verdict` (`survived` / `narrowed` / `demoted` / `dropped`) and `resolution`, so the published
document shows the grounding was attacked. A dropped question is recorded in `GROUNDING.md` with
the reason — otherwise the next session re-proposes it.

---

## 3. Triage: executable, advisory, blocked

For each surviving question, in this order:

1. **Does an engine requirement kind fit its shape?** Not "could one be written" — does one of the
   eight exist today (`ENGINE_CONTRACT.md` §9). If yes, and the binding's key is in a live closed
   dictionary, it is a candidate for `executable`.
2. **Can public data adjudicate it?** If the only accepted evidence is a metafield, an SEO field, or
   an external register, it is not public. A public-tier assertion resting on a non-public surface
   can never pass a free test, and shipping one is a promise the product cannot keep.
3. **Does its shape collide with a pinned corpus gap?** If so it may still be `executable`, but it
   declares the collision in `known_gaps`, and the prediction's `reasoning` says which direction the
   gap pushes it.
4. **Otherwise:** `blocked` if the engine *should* be able to do it (→ `ENGINE_GAPS.md`);
   `advisory` if public data fundamentally cannot.

> ### ⚠️ THE STEP THAT USED TO BE HERE, AND WHY IT IS GONE
>
> Triage used to have a fourth step: *"is the predicted failure rate inside 15–85%? If not, it is
> `not_discriminating`: published, with the band and the reasoning, **and not run**."* That step is
> deleted. **An entry that compiles and executes is `executable`, and it stays executable until a
> measurement says otherwise** (§5.2).
>
> The step was not merely unreliable, it was **self-sealing**. `WEIGHT-001` was predicted 15–40%,
> measured 11.1% on nine products, and flagged `not_discriminating` — one reclassification from
> deletion. On a valid sample it measures 48.8%, which is the most informative rate in the standard.
> An entry that is not run cannot produce the evidence that would reverse the decision to stop
> running it, so the error had no route back. And because the five entries excluded on prediction
> were never adjudicated, the field's own accuracy on those five is **unmeasurable in principle** —
> the prediction selected the sample that would have tested it.
>
> "Runnable" and "worth running" are still different questions, and the second is still worth
> asking. It is now asked **of data**. The cost of asking it of a guess was measured; the cost of
> running a low-information row for one more cycle is a noisy line in a report, and `applicability`
> — not retirement — is the field that stops a row being asked of a product it does not fit.

**The honest ratio is small.** Most real buyer questions cannot be adjudicated from public data.
A standard claiming most of its questions are executable has either chosen only the easy questions
or is lying about one of them, and the first failure is worse: it produces a standard that tests
what is convenient rather than what buyers ask.

**`advisory` is a first-class tier, not a parking lot.** An advisory question a shopper recognises
is what makes the executable ones credible — it demonstrates the standard knows what matters and is
honest about what it can check. Advisory entries are published, never tested, and never scored.

### 3.1 Applicability is a PRECONDITION, not a field

`applicability` shipped as three prose fields that nothing executed. Once a predicate was written
and run over the first run's own snapshots, it excluded **16 of 25 products**. A standard applied
uniformly is the `cruelty_free` failure with a version number on it, and no amount of per-entry
honesty repairs a row that was asked of a t-shirt.

Three properties the gate must have, all learned by measurement:

- **Every exclusion is reported with a reason.** A conformance list that quietly drops entries is
  worse than one that runs them all, because the reader cannot tell *passing* from *not being asked*.
- **Excluding everything is a loud error** — `includedCount: null`, not `0`. Applying an empty
  requirement list is `INCOMPLETE` too, otherwise a compile that produced nothing and was then
  "applied" looks identical to a product asked everything and passing.
- **`unknown` is not the same as out-of-category, and refusing what it cannot classify is the
  correct default.** The shipped predicate is *stricter* than the hand count that preceded it — 16
  rather than 11 — because 3 of the 25 had no `product_type` and a title that decides nothing
  ("Net Wrecker", "Daybreak Glass"). It refuses those rather than guessing. This costs real
  coverage and the cost is visible: one of the three refusals is plausibly a genuine coffee
  ("Finca Santa Elena - Pacamara Honey"), so the gate is trading a false inclusion for a false
  exclusion, deliberately, in the direction where the error is recoverable.

⚠️ **A related production defect, recorded because it silently degrades the gate.**
`fetchPublicProduct` drops `product_type` whenever the page tier answers, so **15 of 44 products in
run 2 would have been unclassifiable using only what the engine itself exposes**. The same null flows
into `CATEGORY_CLAIMS` and `AttributeSpec.onlyFor`, so category inference degrades to the title alone
on roughly a third of stores. The run classified from `/products.json`'s published `product_type` —
public data, and the signal the standard's own `category_signals` names first — which is correct, and
which is also why the gap stayed invisible.

---

## 4. The adversarial pass on your own standard

For each `executable` assertion, an agent whose only job is to write **the store copy that satisfies
the letter and violates the spirit**: text that passes the assertion while misleading a buyer.

Every finding resolves to exactly one of `tightened_accepted_evidence`,
`enriched_insufficient_evidence`, `narrowed_applicability`, `demoted_to_advisory`, or
`survived_unchanged` — and records `residual_risk`.

**An assertion that survives this is worth publishing; one that does not was going to embarrass you
later.** The reason this is a rule and not a preference is measured in the engine's own history:
v2.3 audited seven real stores, found zero false positives, and that was close to worthless as a
general claim. v2.4 then ran 959 probes against the matcher and confirmed 131 defects on copy those
stores merely happened not to write.

> **Sampling real stores catches artefacts; only executing against deliberately chosen input catches
> logic.** An assertion is a matcher specification. It gets attacked like one.

Three attacker instructions that produce the highest yield:

- **Attack the near-synonym.** Every vague phrase that a keyword matcher will accept and a careful
  buyer will not (`chemical-free` for a named decaffeination process, `fresh roasted` for a date).
- **Attack the subject.** Write the true statement about something adjacent — the packaging, the
  shipment, a bundled item, a competitor, a review quote, a **sibling product**, a brew ratio
  instead of a net weight. These are the engine's largest confirmed false-pass class, they are
  still open, and a matched pair of benchmark runs against them is specified in
  [`acceptance/subject-tense/`](acceptance/subject-tense/README.md).
- **Attack with the merchant's own strings.** Titles and option values are merchant-controlled and
  reach linted output. A store can destroy its own report through one of them, and the standard must
  not create a new route for that. (`product_type` is **not** an evidence surface — see
  `VOCABULARY_REVIEW.md` §2.4, which said otherwise until it was executed.)

**Run the attacker on the assertion, not on the engine.** "The engine has a pinned gap here" is a
`known_gaps` entry. "This assertion is satisfiable by copy that misleads a buyer" is an
`adversarial` finding, and it is the standard's fault, not the engine's.

### 4.1 If the entry binds a VOCABULARY, the gate is stricter and the generation is scripted

An assertion that is too loose produces a weak finding; a term list that is too loose produces a
false statement about a real store. [`VOCABULARY_REVIEW.md`](VOCABULARY_REVIEW.md) is the gate, and
its eight attack classes are now **generated** rather than hand-written:

```bash
node --import tsx standards/attack/cli.ts <vocabulary.json> --context <category>
```

**What that changes, and what it does not.** The script writes the hostile copy for six of the eight
classes, reports coverage per term per class, and refuses to render a restricted run as a small
clean number. It does **nothing** for independence — a generated set is still the author's own set —
and it cannot produce the two classes that are a function of the *domain* rather than the *term*
(class 1's near-synonyms, class 2's adjacent-domain collisions). Those two are where the highest-
value findings have historically come from.

### 4.2 A realistic effort estimate, now that generation is scripted

For one vocabulary of roughly forty terms, from the decaf review's actual shape:

| step | before | now |
|---|---|---|
| write the hostile sentences for classes 3–8 | four agents, the bulk of the pass | **one command** |
| write the category context (`attack/contexts/*.json`) — nouns, and the adjacent domains | — | **a human, once per category**, and it is real research |
| write class 1's near-synonym / abbreviation / quantity / geography phrasings | included above | **a human, per vocabulary.** Unchanged, and it is the `insufficient_evidence` set |
| **adjudicate** the generated sentences: which are genuinely misleading, which are copy no merchant would write | the same agents | **a human, and this is now the dominant cost** |
| decide removed vs narrowed vs limit-recorded, per finding | a human | unchanged |
| independent refutation of the attacker's findings | a separate agent | unchanged |
| natural-frequency read against real merchant copy | **never performed** | **still never performed** — see below |

The honest summary: **generation stops being the expensive step and adjudication becomes it.** The
number of sentences to judge goes *up*, not down — 803 at the default cap for a forty-term
vocabulary — so a review that treats the coverage report as the result rather than as the input has
made the pass cheaper and worse. Budget for reading, not for writing.

**And the step that was never done is still not done.** No narrowing in any vocabulary here has been
measured against real merchant copy. The `origin` tombstone is what that costs: a narrowing that
closed every false pass in hand-built sets was measured on 5,322 real product descriptions at **17
true statements lost for 0 false passes gained**, and the class it closed had zero natural
instances. Scripting the attack does not touch this, and nothing in the tooling should be read as
though it did.

---

## 5. Discrimination is MEASURED. The prediction decides nothing.

A requirement's value is how well it **discriminates**, not how often it fails. The measured
evidence, from the engine's own production samples:

| requirement | fail rate | information |
|---|---|---|
| defaulted `cruelty_free` | 100% (13/13) | **none** |
| `price_under` | 0% (0/13) | **none** |
| `delivery` | 71% | near-optimal |

Target band: **15–85%**. Both failure modes matter, not just one. A near-0% assertion is noise; the
near-100% one is worse, because it *looks* like a finding. The `cruelty_free` row was **not false** —
the store genuinely did not state the attribute. It was **irrelevant, identical across unrelated
merchants, and enough to make a specific diagnosis read like a template**.

### 5.1 The prediction field, and its measured calibration

**Every `predicted_discrimination` band in the coffee standard was authored as an explicit
hypothesis. On the first valid sample — 43 in-category product records across 42 brands,
applicability enforced — the bands HELD 2 OF 10, and ALL EIGHT MISSES WERE HIGH.** Run 1 had seen
7 of 8 high on a confounded sample; the valid sample removed the single counter-example. The author
systematically over-estimated how much a category's stores publish, and there is no reason to think
a different author in a different category would not.

**A field wrong 80% of the time in a known direction is worse than no field, because it looks like
information.** Four repairs were considered, and the measurement was run on all of them against
those same ten entries:

| shape | hits | what it turned out to be |
|---|---|---|
| the numeric band as authored | **2/10** | worse than its own uniform-null expectation of 3.15 |
| `in_target_band` — the binary that **drove tier assignment** | 4/10 | one constant value across all ten entries; **lost to its own negation** at 6/10 |
| a three-valued direction (most fail / most pass / a split) | 3/10–8/10 | the score is a property of the tie-break for a band straddling 50%, not of the field |
| a two-valued direction (above or below 50%) | 9/10 | **statistically identical to "always predict most-to-fail"** (discordant 1/1, p=1.000) — it scores the sample's 9-of-10 fail-majority base rate, not the author |
| a band widened by the measured bias | 9/10 at ±25.1pp | by that width the band covers 77.5% of the outcome space and would hold 7.75/10 by chance |

**Read the last column, not the middle one.** At ten entries every one of these Wilson intervals is
39–53 percentage points wide and they all overlap. The only claim that survives a paired test is a
negative one: **the authored band is measurably worse than an author-free constant (p=0.016), and no
author-supplied alternative can be shown to carry more information than any other.** There is no
evidence here that direction beats bands as a *design*; there is evidence that the number was the
worst part.

> **The decision.** The numeric band is **removed** at grammar 1.1 and replaced by an **optional,
> unranked** `discrimination_prediction` carrying a **direction, a confidence, and the reasoning** —
> which is all an author who has not measured can honestly supply. `no_prediction` is a first-class
> value. The field is retained rather than dropped for one reason only: **the calibration above is
> computable solely because the predictions were preserved beside the measured rates.** A field
> nobody records cannot be shown to be wrong, and this project's history is that its instruments
> fail in the flattering direction. It is kept as a falsification target, not as a signal.
>
> Three constraints ride with it, all enforced by `standards/__tests__/discrimination.test.ts`:
> **it carries no number**; **it may not determine `tier` or a measured verdict**; and **its own
> schema documentation states the measured bias**, so an author reading the field cannot miss that
> bands have held 2 of 10 with every miss high.
>
> **Never overwrite a prediction with its measurement.** They live in different fields. Overwriting
> would have erased the only evidence that the method's prediction step was broken.

### 5.2 The measurement, and the minimum n — derived, not chosen

`standards/discrimination.ts` implements this and the test suite proves it. Four outcomes:

| outcome | condition | effect |
|---|---|---|
| *(no record)* | fewer than **22** adjudicated rows | unmeasured. Not a verdict, not a pass |
| `discriminating` | the **point estimate** is inside 15–85% | keeps running |
| `indeterminate` | neither of the below | **keeps running.** The measurement ran and decided nothing |
| `not_discriminating` | the **whole 95% Wilson interval** is outside the band, **and** §5.3 | may be retired, as a `demoted` change |

**Why 22, and how to reconstruct it.** A verdict claims the true rate is inside, or outside, the
band. Retirement requires the whole 95% interval on one side of an edge. Ask the cheapest question:
what is the smallest n at which the *most extreme observation that exists* — 0 of n, or n of n —
could do that? For 0 failures the Wilson upper bound collapses to `z²/(n + z²)`, so

```
z²/(n + z²) < b    ⟺    n > z²·(1 − b)/b    =    3.8416 × (0.85/0.15)   =   21.77   →   n = 22
```

and the upper edge gives the same number by symmetry. **Below 22 adjudicated rows, no observation
whatsoever can support a discrimination verdict.** Run 1 recorded its verdicts on **n=9** and **n=6**.

The floor is a function of the band edge and is recomputed rather than typed in — **35** at a 10%
edge, **22** at 15%, **16** at 20%, **12** at 25% — so a session that widens the band cannot quietly
weaken the floor. It is also robust to the choice of interval: Clopper–Pearson gives **23**, a
one-store difference. It is *not* robust to the choice of interval **family**: Wald gives **1**,
because Wald has zero width at 0/n and n/n, which is precisely where this decision lives. That
disqualifies Wald rather than merely disfavouring it.

**Adjudicated, never asked.** `requires_store_access` is not a fail — we could not look. DELIV-001
is 19 of 32 adjudicated = 59.4%, and 19 of 43 asked = 44.2%. Both numbers are computable and only
one is the answer. Note also that the exclusion policy *is* a choice that moves the rate: DELIV-001's
11 unadjudicated rows are 25.6% of what it was asked, and that missingness is not ignorable.

**The two directions cost different amounts, deliberately.** Wrongly keeping a low-information entry
costs one noisy row and is **self-correcting** — the row keeps accruing n. Wrongly retiring one is
**self-sealing**, and it is a governance event. So: *hard to leave, easy to return.* Retirement needs
the interval; re-instatement needs only the point estimate.

**What the rule does on the real record.** Of run 2's ten entries it keeps exactly the four the human
reading kept (FORMAT-001, GRIND-001, WEIGHT-001, DELIV-001), refuses run 1's WEIGHT-001 verdict two
independent ways, and permits exactly one retirement. **A point-estimate rule would have retired
six.** GRIND-002 — which the run itself calls "a marginal call that a third run could move back" — is
refused with 10.5pp to spare, so *marginal* understates it. Two entries the run classified as
carrying no information, CERT-001 and FORMAT-002, miss by **0.46pp** and **1.14pp** of lower bound:
retirements that were being decided by rounding on 41 and 43 stores.

**And it is unmoved by the sampling defect that moved the published rates.** Recomputed from run 2's
own JSONL, the discrimination table was **not** deduplicated (§6.2): every published denominator
counts one brand twice, and WEIGHT-001 is 21/42 = 50.0%, not 48.8%. **Not one verdict changes.** A
rule that reads an interval rather than a point is insensitive to exactly the defect that moved the
numbers under it.

### 5.3 R3 — a retirement decided by a margin smaller than a known bias is decided by the bias

A confidence interval bounds **sampling error and nothing else**. It does not cover a known
one-directional bias in the instrument doing the measuring, and run 2 discloses two: the semantic
tier was off (which can only *overstate* a claim row's fail rate) and the audit measured a **4.35%
false-pass rate** over 69 rows (which understates it).

The single entry the arithmetic permits retiring, CERT-002, clears the 85% edge by **2.94pp** — and
it is a claim row. **One row reclassified from fail to pass takes it to 41 of 43 and refuses.** So:

> **A `not_discriminating` verdict must declare the instrument's known one-directional biases.** An
> empty declaration is a claim and is allowed; an absent one is not. Any declared bias pointing
> toward the edge the interval cleared must be **quantified and smaller than the margin**. An
> unquantified bias in that direction blocks retirement outright — it cannot be shown to be smaller
> than something it was never measured against.

**Under R1+R2+R3, run 2 licenses zero retirements.** That is the honest reading of a 43-store sample.

### 5.3a What the rule does NOT deliver, stated because an independent pass had to extract it

Every claim below is a limit on the rule above, and each one was found by an agent whose only job
was to refute it. The floor of 22 survived; the story around it did not.

- **At reachable n this is a near-unanimity test, not a 15–85% test.** At n=43 the observation must
  be ≥42/43 (97.7%) or ≤1/43 (2.3%) to permit a retirement. The band in the rule is 15–85%; the band
  the rule can *act on* at this project's sample sizes is roughly 2–98%. Both numbers should be
  quoted together or the rule reads as stricter than it is in one direction and looser in the other.
- **Power is low and non-monotone.** A run intended to be *able* to retire needs **n ≈ 75** for 80%
  power against a true 95% fail rate; at n=43 such an entry has a **36%** chance of clearing, and at
  n=30 it is *lower* than at n=22 because the counts are discrete. "Add a few stores" is not a route
  to a verdict.
- **A published COUNT is a family-wise claim and needs a bigger floor.** Ten entries decided at 95%
  each are jointly right about 60% of the time. The Bonferroni floor is **45** for ten entries and
  **62** for fifty. **All ten of run 2's denominators (41, 41, 41, 41, 43, 43, 43, 43, 34, 32) are
  below 45.** So the sentence *"six of ten entries carry no information"* is inadmissible at every n
  that run reached, by the same logic that refuses a single verdict at n=9. `familyWiseFloor()`
  exposes the number; the grammar itself controls error per entry, because the decision it governs
  is per-entry retirement.
- **A frequently-unadjudicable entry is permanently unretirable.** To reach 22 adjudicated rows at
  DELIV-001's 74% adjudication rate needs 30 stores; at 50% it needs 44. Run 2's capture yield from
  its target list was 51.9%. **An entry resting on a surface the engine can rarely read immunises
  itself against retirement** — which is a real incentive and points the other way from every other
  rule here.
- **The floor is far more sensitive to the band than to anything else.** Wilson gives 22 and
  Clopper–Pearson 23 — one store. The band edge gives 73 at 5%, 35 at 10%, **22 at 15%**, 16 at 20%,
  12 at 25%. The 15–85% convention was itself asserted on three data points at n=13. The robustness
  that matters is the axis that does not vary, and it is not the reassuring one.

### 5.3b Two things the rule requires of the sample that no interval can check

- **One row per store.** The floor counts rows and the interval assumes they are independent. Twenty-
  two rows drawn as two products from each of eleven stores has an effective n of 18.3 at ICC 0.2 and
  nothing in the arithmetic can see it. `n_adjudicated` may not exceed the sample's store count, and
  the test suite enforces that. Note the asymmetry with §6: the *false-positive bound* must apply a
  design effect because a store contributes several pass rows; a *per-entry rate* must not, because
  m̄ = 1 makes the ICC unidentifiable rather than zero — applying one there would be inventing
  variance.
- **Pre-declare the re-measurement.** This grammar is built around re-running — `supersedes`,
  `larger_sample`, "a third run could move it back" — and a rule applied repeatedly until it fires is
  not a 95% rule. **Decide the sample size before the run and record it; do not re-measure until a
  verdict appears.** There is no stopping rule in the arithmetic, so it has to be in the method.

### 5.4 Re-measurement, and the never-weaken interaction

A superseded measurement is **kept in the document**, with a reason drawn from a closed list:
`larger_sample`, `prior_sample_invalid`, `applicability_gate_added`, `deduplication_corrected`,
`engine_changed`. One rule has teeth:

> **`larger_sample` is not an explanation for two 95% intervals that do not overlap.** Two disjoint
> intervals cannot both cover the true rate, so at most one of the samples measured what the entry
> claims. Size changes an interval's *width*; it does not move it off the old one. Name the
> systematic difference, or record `indeterminate`.

**Is retiring an entry a weakening?** Decided: **yes**, and the argument matters more than the
verdict. Retirement removes an assertion a merchant may have failed, which is mechanically identical
to the changelog's existing `demoted` — *"the row stops being tested at all"*. A merchant who failed
`WEIGHT-001` and then watches it disappear **cannot distinguish "removed because a measurement showed
it carried no information" from "removed because someone complained"**, and that indistinguishability
is the entire damage the never-weaken rule exists to prevent. The measurement does not exempt the
removal; it *justifies* it, and the justification goes in the change's `rationale`.

⚠️ **This closed a real hole.** `SCHEMA.md` §5 enumerated `demoted` as *"`executable` → `advisory` or
`blocked`"*. The `not_discriminating` tier was added later and §5's list was never updated — so
retirement was the one way to stop testing a row **without** triggering an attestation, which made it
the cheapest exit from the standard. It now costs the same as every other exit.

The reverse direction — a re-measurement that puts a retired entry back into service — is
`strengthened` and needs nothing. And the attestation is cheapest **before** publication, when
`prior_failures_exist` is false. That prices measuring early, which is what §6 asks for anyway.

---

## 6. THE PUBLICATION GATE: CATEGORY FITNESS

> **A standard may not publish an error bound measured on any sample other than its own category.**

`status: published` requires a `category_fitness` record. The schema enforces it, and until it exists
the standard is a `draft` however finished it looks.

### 6.1 The evidence, which is a single pair of numbers

Measured **the same day, by the same engine, with the same audit discipline**:

| | general DTC sample | **coffee sample** |
|---|---|---|
| stores | 172 | 42 |
| pass rows, every one audited individually | 506 | 69 |
| confirmed false positives | **0** | **3** |
| point estimate | 0% | 4.35% |
| naive 95% upper | 0.59% | 11.23% |
| **cluster-adjusted 95% upper (ICC 0.2)** | **0.83%** | **13.68%** |
| per store | 1.78% | 7.1% |

Sixteen-fold, and **not by chance**. The three coffee defects fire on copy only a coffee page writes:
a brewing recipe read as a net weight, a caffeine dose per 6oz serving read as the product's mass,
soil described as *rich in organic matter* read as an organic claim. A general DTC page contains none
of that vocabulary, so a general sample **structurally cannot** contain those defects.

> **The general-sample bound is not an estimate of the error rate. It is an estimate of the error
> rate on copy that looks like the average of every category at once — which is copy no individual
> merchant writes.** The number that matters to a coffee roaster is 13.68%.

This is the third sharpening of the same lesson and the first one that is a number. v2.8: *"zero
across 55 rows was a statement about sample size."* v3.0: *"zero across 506 rows of a broad sample is
a statement about sample SHAPE."* Run 2 measured the shape.

### 6.2 What a category-fitness measurement consists of

Five parts. Every one is a required field, and every one is here because its absence produced a wrong
number in a real run.

1. **The sample, with its provenance.** Stores, products, capture date, and the attrition of every
   attempted target logged with a cause. A sample whose attrition is unlogged cannot be shown to be
   unbiased.
2. **The applicability gate, enforced.** Not declared — *run*. See §6.3.
3. **A row-by-row audit of every pass row, reading untruncated evidence.** Not a sample of rows: this
   project audited 37 rows and then 18 and reported zero false positives both times, and an audit of
   100 rows then found two. And not the rendered quote: `presentableQuote` truncates at 180
   characters **from the start of the sentence rather than around the match**, and 19 of 506 rows in
   one general sample render a cut quote. Two separate audits nearly mis-classified a real row for
   exactly this reason.
4. **All three bounds, never one** — naive, cluster-adjusted at ICC 0.2, and per-store. Publishing
   the naive number alone understates, because pass rows cluster within stores; publishing only the
   per-store rate hides row-level exposure. The cluster adjustment can only *widen*: an adjusted
   bound narrower than the naive one means the arithmetic ran backwards, and it flatters the number.
   ⚠️ **Two arithmetic notes worth carrying.** The 2.09 rows/store that produces DEFF = 1.2182 is
   **69/33** — stores *carrying* a pass row — not 69/42; the doc used the more conservative
   denominator, which is right, but it must be stated. And the **naive 11.23% could not be
   reproduced** from Wilson (12.02%), Clopper–Pearson (12.18%), Wald (9.16%) or Agresti–Coull
   (12.52%); the closest is Jeffreys at 11.15%. **A fitness record must name the method that produced
   each bound.**
5. **The limits, stated by the party publishing them.** Never empty. A fitness record with no limits
   claims a completeness no sample of this size supports.

Plus: `completion_state`. `INCOMPLETE` **blocks publication rather than reading as clean**, per
`src/measure/completion.ts`. A measurement that did not complete is not a passing measurement.

### 6.3 The two sampling defects, both caught the hard way, both now rejected at the gate

**First-handle selection captures merchandise.** Roasters lead their catalogue with branded goods.
Taking each store's first product handle collected t-shirts, a hat, a tote bag, a Fellow mug and a
cocktail shaker; re-running the applicability predicate over run 1's own snapshots found that
**16 of 25 products should never have been asked** — 13 out of category and 3 the predicate refused
because it could not classify them. Select the first product the standard *applies to*, scanning the
full `?limit=250` page, since a large merch line can push every real product past the default 30.

**Duplicate brands inflate a denominator, and inflating a denominator flatters a bound.**
`deathwishcoffee.com` and `www.deathwishcoffee.com` are one brand. They produced the same product,
therefore the same false positive twice, and one extra row in the denominator.

> ⚠️ **And this defect recurred inside the document that reported it.** STANDARD_RUN_2 §0 says the
> duplicate *"is removed from every denominator"*. Recomputed from the run's own JSONL: it was
> removed from the false-positive bound (70 pass rows → 69, which is why 69 is right) and **was not
> removed from the discrimination table.** Every published denominator there — 43, 41, 34, 32 —
> matches the tally that counts the brand twice. WEIGHT-001 is 21/42 = **50.0%**, not 48.8% on n=43;
> the sample is 42 brands, not 43. The headline conclusions survive (HELD 2/10, 8 of 8 high, and
> under §5.2's rule not one verdict changes), but **a correction announced in prose was applied to
> one table and not the other, and only recomputation from the raw rows found it.** Deduplicate in
> code, at the point the denominator is formed, and assert it.

## 7. The compile-and-validate gate

`standards/__tests__` must be **pure** — no database, no network, no server, no model calls — and
must prove all of:

1. the standard **validates against the JSON Schema** (and the validator's own keyword coverage is
   proven by mutation fixtures — a hand-written validator that accepts everything reads exactly like
   a strict one);
2. every `executable` entry **compiles to a valid engine `Requirement`**;
3. every compiled `Requirement` is **accepted by the real `evaluate()`** — executed, not asserted,
   because an unknown claim key is a thrown `TypeError` rather than a failed row;
4. every id is **unique and well-formed**, and every engine `label` is unique (the engine keys every
   lookup off `label`, so duplicates silently update the wrong row);
5. **no entry cites an evidence surface the engine does not have**;
6. **no rendered string contains claim-linter forbidden vocabulary** — checked with the *real*
   `lintStrings`, never a copy of the rules;
7. every entry has non-empty **`insufficient_evidence`** and **`grounding`**;
8. **public-tier entries never depend on non-public surfaces**;
9. the **never-weaken attestation** is internally consistent, with a negative fixture that must
   fail;
10. the **`standard_hash` matches the content**.

**Run only your own tests.** The repo's `npm test` glob is `test/*.test.ts` and belongs to the
engine; a standards session has no business running it, and the gated suite additionally shares
local infrastructure with whatever else is running.

**Report the count and that they are pure.** And report the *completion state*, not just the count:
a suite that errored before reaching its assertions must never read the same as a green one. That is
the whole content of `src/measure/completion.ts` and it applies to this suite too.

---

## 8. THE CATEGORY-SELECTION RULE

> **score = (registry- or spec-verifiable claims ÷ experiential claims) × the merchant's measurable
> cost of claim failure × the share of the category's questions THE ENGINE CAN EXECUTE TODAY**

All three factors are necessary. A category full of checkable claims nobody is hurt by getting wrong
produces a standard nobody adopts; a category with expensive failures and nothing checkable produces
a standard that cannot adjudicate them; and a category the engine cannot execute produces a
**document**, not a test.

### 8.1a The third term, and why it was added

Coffee scores well on the first two and produced **90 candidate questions and 10 executable
entries**. The binding constraint was not the research and not public data — it was the size of two
hardcoded engine dictionaries, `CLAIM_TERMS` and `ATTRIBUTE_SPECS`, neither of which is exported
(`ENGINE_GAPS.md` G-06). **Of the three claim keys coffee can use, none was chosen for coffee; they
happen to exist.**

That is a property of the *engine*, not of the category, and it dominates the score. A ratio-perfect
category with no dictionary coverage yields a standard whose executable tier is empty, and an empty
executable tier is where the whole value is. So estimate it explicitly, before the research:

1. List the buyer questions (§8.1 step 1) — the same list, not a second one.
2. For each, name the engine requirement kind that would run it (`ENGINE_CONTRACT.md` §9) **and**,
   for `claim` and `attribute` kinds, the specific dictionary key. "A claim row could be written" is
   not a key that exists.
3. The third factor is that count over the total. **Coffee's is 10/90 ≈ 11%.**
4. Below roughly 10% the honest output is an `ENGINE_GAPS.md` entry and a decision to author the
   category *later* — not a standard that publishes forty questions and tests four.

The device-accessory draft is the useful contrast: it scores well on ratio and cost, and its
executable share is **lower still**, because compatibility assertions need an operator the engine has
no channel for at all (G-13). Discovering that is worth more than the draft.

**Familiarity is not a selection criterion.** Neither is market size, personal interest, or the
existence of an obvious competitor. The two questions are *can a third party check the claims* and
*does getting them wrong cost the merchant something measurable* — returns, chargebacks, complaints,
regulatory exposure, or a wrong purchase a buyer notices.

### 8.1 How to score a candidate

1. List the questions a competent buyer asks. Do not filter yet.
2. Mark each **registry-verifiable** (a public register confirms it), **spec-verifiable** (a defined
   format or enumerated value a third party can check against evidence), or **experiential** (only
   using the product answers it).
3. Take the ratio. Below roughly 1:1 the standard degrades into a structured-copy audit.
4. Estimate the cost of claim failure with something measurable — documented return rates,
   complaint patterns, regulatory penalties — not with intuition.
5. Multiply. Then apply §8.4 as a veto, because a high score in a hazardous category is a trap,
   not an opportunity.

### 8.2 Categories the rule favours

| category | why | verifiable spine |
|---|---|---|
| **Coffee** (v1.0) | claims resolve against external registers and documented process conventions rather than against experience | organic/fair-trade registers, named decaffeination processes, roast date, net weight, grind and format as purchasable options |
| **Device accessories** | almost entirely **compatibility and specification** — a structurally different assertion shape from provenance, which is exactly why it is the right generalisation test | model fitment lists, connector and port standards, wattage, certification marks |
| **Tyres and automotive parts** | the highest spec-density of any consumer category, and a wrong fit is an immediate, expensive, safety-relevant return | DOT codes, load/speed index, OE part numbers, tread depth |
| **Seafood and timber** | mature chain-of-custody registers with product-level certificate numbers | MSC/ASC, FSC/PEFC certificate registers |
| **Textiles and bedding** | material composition is legally mandated in many jurisdictions and third-party material certifications maintain registers | fibre-content labelling rules, OEKO-TEX, GOTS |
| **Wine and spirits** | protected designations of origin and mandated ABV give a legally-grounded spine | GI/AOC/DOC registers, mandated ABV and volume |
| **Baby and child products** | mandatory safety standards, and the cost of a wrong claim is the highest in retail | mandated safety standard references, recall registers |

### 8.3 Categories the rule warns against — degradation

Experiential-claim-heavy categories **degrade the test to a structured-copy audit**: the standard
ends up checking that fields are populated rather than that claims are true, which is a
catalog-readiness scanner — free, commoditised, and being absorbed by the platform.

Worst offenders: **fashion apparel** (fit, drape, feel), **home décor and art**, **fragrance**,
**furniture comfort**, **gifts**, **handmade goods where the claim *is* the maker's story**. A
standard here can honestly assert almost nothing beyond measurements and materials — and it should
say so rather than manufacture assertions to fill a document.

### 8.4 Categories the rule warns against — exposure. This is a veto, not a discount.

**Any category touching regulated efficacy claims carries exposure the standard must not walk
into.** Not "should be careful with" — must not enter.

| category | the exposure |
|---|---|
| **Dietary supplements** | health and structure/function claims are separately regulated in every major market, and substantiation requirements attach to whoever makes the claim. A standard that adjudicates "does this page support its efficacy claim" has taken a position on the claim. Tempting because COAs and third-party testing look registry-shaped — and that is the trap. |
| **Cosmetics and skincare with performance claims** | the boundary between a cosmetic and a drug claim is a regulatory line, and "adjudicating" a page's anti-ageing or acne claim puts the standard on it |
| **CBD, nootropics, and anything therapeutic-adjacent** | the claim landscape is actively enforced and the legal position varies by jurisdiction |
| **Medical devices and diagnostics** | regulated as devices; a conformance claim about a device page is a quality-system statement |
| **Pet health and therapeutic pet food** | the same efficacy regime with a different regulator |
| **Anything with a safety claim we cannot test** | asserting a safety property from page text is the one false pass that is not recoverable |

The safe form, where a category is otherwise attractive: assert only **structural and provenance**
properties — is a certificate of analysis published, is a certifier named, is a lot number stated —
and put every efficacy question in `out_of_scope` with the reason. **Never assert that a claim is
true; assert only that evidence for it is published, cited, and of a named form.** That is the
engine's existing discipline and it is also the legal boundary.

### 8.5 What to do when the grammar does not fit the next category

Author enough of it to find out, then **change the grammar**. A grammar that needs revising to
accommodate a structurally different category is the most valuable finding a standards session can
produce, because it is the only evidence that the grammar generalises — or does not. Revising the
schema is cheap now and expensive after three standards cite it.
