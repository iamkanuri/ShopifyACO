# METHOD — how a category standard gets authored

So that category three is a **process**, not an act of invention.

Read [`SCHEMA.md`](SCHEMA.md) for what the fields mean and
[`ENGINE_CONTRACT.md`](ENGINE_CONTRACT.md) for what the engine can execute. This document is the
order of operations, the gates, and the one rule for choosing what to author next.

---

## 0. The shape of the work

| stage | output | gate to pass before moving on |
|---|---|---|
| 1. Category selection | a decision, with the score written down | the selection rule (§7) favours it, and §7.4 does not warn against it |
| 2. Engine contract | the executable vocabulary, re-derived from code | every requirement kind and evidence surface confirmed at a named commit |
| 3. Research | candidate questions with citations | ≥1 real citation per question, per class, from independent agents |
| 4. Refutation | verdicts on the candidates | a separate agent has tried to kill each one |
| 5. Triage | executable / advisory / blocked | every `executable` entry has a `binding` that names a real engine kind |
| 6. Adversarial pass | attacks on your own assertions | every `executable` entry has an `adversarial` record with an outcome |
| 7. Discrimination hypothesis | predicted bands | every band has reasoning and is flagged unmeasured |
| 8. Compile + validate | a green test suite | §6 — every gate, no exceptions |
| 9. Gaps | `ENGINE_GAPS.md` entries | every `blocked` entry cross-references a real gap id |

**Stages 3 and 4 are the expensive ones and they are the ones that cannot be skipped.** Everything
else is bookkeeping that a later session can redo; ungrounded questions are the artifact that reads
as machine-generated, and no amount of later polish removes that smell.

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

## 3. Triage: executable, advisory, blocked, not_discriminating

For each surviving question, in this order:

1. **Does an engine requirement kind fit its shape?** Not "could one be written" — does one of the
   eight exist today (`ENGINE_CONTRACT.md` §9). If yes, and the binding's key is in a live closed
   dictionary, it is a candidate for `executable`.
2. **Can public data adjudicate it?** If the only accepted evidence is a metafield, an SEO field, or
   an external register, it is not public. A public-tier assertion resting on a non-public surface
   can never pass a free test, and shipping one is a promise the product cannot keep.
3. **Does its shape collide with a pinned corpus gap?** If so it may still be `executable`, but it
   declares the collision in `known_gaps` and its `predicted_discrimination.reasoning` says which
   direction the gap pushes it.
4. **Is the predicted failure rate inside 15–85%?** If the engine can run it but the row would
   pass for nearly everyone or fail for nearly everyone, it is `not_discriminating`: published,
   with the band and the reasoning, and not run. **"Runnable" and "worth running" are different
   questions and the triage must ask both** — this is what the `cruelty_free` row cost the engine
   before it was removed.
5. **Otherwise:** `blocked` if the engine *should* be able to do it (→ `ENGINE_GAPS.md`);
   `advisory` if public data fundamentally cannot.

**The honest ratio is small.** Most real buyer questions cannot be adjudicated from public data.
A standard claiming most of its questions are executable has either chosen only the easy questions
or is lying about one of them, and the first failure is worse: it produces a standard that tests
what is convenient rather than what buyers ask.

**`advisory` is a first-class tier, not a parking lot.** An advisory question a shopper recognises
is what makes the executable ones credible — it demonstrates the standard knows what matters and is
honest about what it can check. Advisory entries are published, never tested, and never scored.

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

## 5. The discrimination hypothesis

A requirement's value is how well it **discriminates**, not how often it fails. The measured
evidence, from the engine's own production samples:

| requirement | fail rate | information |
|---|---|---|
| defaulted `cruelty_free` | 100% (13/13) | **none** |
| `price_under` | 0% (0/13) | **none** |
| `delivery` | 71% | near-optimal |

Target band: **15–85%**. Every `executable` entry carries a predicted band **with reasoning**, and
`measured` is `const: false` — it is a hypothesis to be tested later, never stated as fact.

**Two failure modes to predict against, not just one.** A near-0% assertion is noise. But the
near-100% one is worse, because it *looks* like a finding: the `cruelty_free` row was **not false**
— the store genuinely did not state the attribute. It was **irrelevant, identical across unrelated
merchants, and enough to make a specific diagnosis read like a template**. A fifty-question standard
applied uniformly is that failure with a version number on it, and `applicability` is the field that
prevents it.

**Predict, then plan the measurement.** A band with no measurement plan is decoration. The plan for
a standard is: apply it to a sample of real category stores, record per-entry pass/fail, and
**publish the measured rates with `n=`** — then update `predicted_discrimination.measured` in a
changelog entry. Until that happens the standard's own document must say the bands are untested.

---

## 6. The compile-and-validate gate

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

## 7. THE CATEGORY-SELECTION RULE

> **score = (registry- or spec-verifiable claims ÷ experiential claims) × the merchant's measurable
> cost of claim failure**

Both factors are necessary. A category full of checkable claims nobody is hurt by getting wrong
produces a standard nobody adopts; a category with expensive failures and nothing checkable produces
a standard that cannot adjudicate them.

**Familiarity is not a selection criterion.** Neither is market size, personal interest, or the
existence of an obvious competitor. The two questions are *can a third party check the claims* and
*does getting them wrong cost the merchant something measurable* — returns, chargebacks, complaints,
regulatory exposure, or a wrong purchase a buyer notices.

### 7.1 How to score a candidate

1. List the questions a competent buyer asks. Do not filter yet.
2. Mark each **registry-verifiable** (a public register confirms it), **spec-verifiable** (a defined
   format or enumerated value a third party can check against evidence), or **experiential** (only
   using the product answers it).
3. Take the ratio. Below roughly 1:1 the standard degrades into a structured-copy audit.
4. Estimate the cost of claim failure with something measurable — documented return rates,
   complaint patterns, regulatory penalties — not with intuition.
5. Multiply. Then apply §7.4 as a veto, because a high score in a hazardous category is a trap,
   not an opportunity.

### 7.2 Categories the rule favours

| category | why | verifiable spine |
|---|---|---|
| **Coffee** (v1.0) | claims resolve against external registers and documented process conventions rather than against experience | organic/fair-trade registers, named decaffeination processes, roast date, net weight, grind and format as purchasable options |
| **Device accessories** | almost entirely **compatibility and specification** — a structurally different assertion shape from provenance, which is exactly why it is the right generalisation test | model fitment lists, connector and port standards, wattage, certification marks |
| **Tyres and automotive parts** | the highest spec-density of any consumer category, and a wrong fit is an immediate, expensive, safety-relevant return | DOT codes, load/speed index, OE part numbers, tread depth |
| **Seafood and timber** | mature chain-of-custody registers with product-level certificate numbers | MSC/ASC, FSC/PEFC certificate registers |
| **Textiles and bedding** | material composition is legally mandated in many jurisdictions and third-party material certifications maintain registers | fibre-content labelling rules, OEKO-TEX, GOTS |
| **Wine and spirits** | protected designations of origin and mandated ABV give a legally-grounded spine | GI/AOC/DOC registers, mandated ABV and volume |
| **Baby and child products** | mandatory safety standards, and the cost of a wrong claim is the highest in retail | mandated safety standard references, recall registers |

### 7.3 Categories the rule warns against — degradation

Experiential-claim-heavy categories **degrade the test to a structured-copy audit**: the standard
ends up checking that fields are populated rather than that claims are true, which is a
catalog-readiness scanner — free, commoditised, and being absorbed by the platform.

Worst offenders: **fashion apparel** (fit, drape, feel), **home décor and art**, **fragrance**,
**furniture comfort**, **gifts**, **handmade goods where the claim *is* the maker's story**. A
standard here can honestly assert almost nothing beyond measurements and materials — and it should
say so rather than manufacture assertions to fill a document.

### 7.4 Categories the rule warns against — exposure. This is a veto, not a discount.

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

### 7.5 What to do when the grammar does not fit the next category

Author enough of it to find out, then **change the grammar**. A grammar that needs revising to
accommodate a structurally different category is the most valuable finding a standards session can
produce, because it is the only evidence that the grammar generalises — or does not. Revising the
schema is cheap now and expensive after three standards cite it.
