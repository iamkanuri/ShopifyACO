# THE VOCABULARY FORMAT — v1.0

A **vocabulary** is the term list behind one claim key, published *with* a versioned standard and
reviewed *as* a standard.

The machine-readable authority is [`schema.json`](schema.json) `$defs/vocabulary`; the rules a schema
cannot express are implemented and **executed** in [`vocabulary.ts`](vocabulary.ts). This document
says what each field is for and why each rule exists. Every "why" traces to a measurement in
[`VOCABULARY_MECHANISM.md`](VOCABULARY_MECHANISM.md), not to a preference.

---

## 0. Why this exists, and why it is not a `RunOptions` override

`CLAIM_TERMS` is a module-level `const` with no `export` (`src/server/productTest.ts:47`). Adding a
claim means editing engine source. G-06 named two ways out:

- **(a)** export the dictionaries and accept a `claimVocabulary` override in `RunOptions`;
- **(b)** a registry keyed by standard id.

**(b), and the burden on (a) turned out to be higher than G-06 argued.** G-06's case against (a) was
that a supplied term list bypasses review. Executing the mechanism produced a sharper one: a term
list that has bypassed review can tell a compliant merchant that **their own copy states the opposite
of what it says**, and quote that sentence as the proof. That is not a degraded result; it is a false
statement about a real store, in the one direction this project treats as unrecoverable.

It is also not hypothetical or hard to hit. This vocabulary is entirely reasonable-looking:

```
support:   ["free of solvents", "free from solvents", "without solvents", "no solvents"]
violating: ["solvents"]
```

Run through the real engine matcher:

```
"Free of solvents."                  -> states the opposite (term=solvents)
"This decaf is free of solvents."    -> states the opposite (term=solvents)
"Our process is free from solvents." -> states the opposite (term=solvents)
"Made without solvents."             -> PASS
"No solvents are used."              -> PASS
```

`free of` and `free from` are not in the engine's closed negator list; `without` and `no` are. Under
(a), that vocabulary reaches a merchant. Under (b), rule **V1** rejects it before it is published,
and names the pair.

> **The same defect is live in a shipped built-in list.** `cruelty_free` has violating
> `tested on animals` suffix-aligned inside supporting `not tested on animals`, and the real
> `evaluate` returns *"Your public copy states the opposite of this requirement"* for the sentence
> `"Tested on animals: never."`. Careful review did not catch it. Execution did.

---

## 1. The artifact

One file per claim key: `standards/{category}/{version}/vocabulary/{name}.json`.

| field | purpose |
|---|---|
| `vocabulary_grammar_version` | `1.0`. A vocabulary is only readable against a stated grammar version. |
| `standard_id`, `standard_version` | The standard it ships with. A vocabulary is not a free-floating list. |
| `claim_key` | The engine key it defines. **May not collide with a built-in** (V8) — a registry that can shadow a reviewed list is option (a) through the back door. |
| `title`, `status` | `draft` \| `published` \| `withdrawn`, same semantics as a standard. |
| `scope` | `establishes` / `does_not_establish`. The `pass_means` of a vocabulary. §6. |
| `serves` | Which standard entries it serves and **how far it takes each one** — `unblocks`, `narrows`, or `supports_refusal_only`. §7. |
| `accepted_surfaces` | Where a match should count. **Declared, not enforced** — §5. |
| `matching` | `whole_word: true`, `case_sensitive: false`, and the engine call site they are read from. Both are `const`. §4.2. |
| `supporting_terms` | Each with grounding and **positive examples that must pass**. |
| `violating_terms` | Each with grounding and **contradicting examples that must contradict**. May be empty — with a rationale. |
| `insufficient_evidence` | **The negative test suite.** Built first, executed, minimum three, hazard-classed. |
| `limits` | The false-pass and false-fail channels it cannot close. Honest residual risk beats a claim of immunity. |
| `review` | The gate from [`VOCABULARY_REVIEW.md`](VOCABULARY_REVIEW.md), recorded in the artifact. |
| `changelog` | Never-weaken, extended to terms. §8. |
| `vocabulary_hash` | Same canonicalisation as `standard_hash`, omitting `vocabulary_hash`. |

---

## 2. Author the insufficient set FIRST

Not a style note. For any claim worth testing, the misleading phrasings outnumber the honest ones,
and a term list written positive-first is a list of things the author hoped stores write. Writing the
refusals first makes the supporting list *what is left over* after the near-misses are excluded,
which is the correct residue.

The format makes the ordering structural in two ways: `insufficient_evidence` has `minItems: 3` and
mandatory hazard-class coverage (V9), and every entry is **executed** (V4). A vocabulary cannot be
valid while its negative suite is aspirational.

---

## 3. The rules

Each rule is implemented in [`vocabulary.ts`](vocabulary.ts) and pinned by a deliberately malformed
fixture in `standards/__tests__/vocabulary.test.ts` — a rule whose fixture still validates is a rule
that is not enforced, which is the mutation discipline the engine's `experiments/v2-4/mutate.mjs`
and this repo's `standards/__tests__/fixtures.ts` already use.

| rule | what it rejects | measured cause |
|---|---|---|
| **V1** | a violating term suffix-aligned inside a supporting term whose extra prefix is **not** a negator the engine recognises | `findViolation`'s overlap rule requires the support match to end *strictly beyond* the violation (`testEvidence.ts:354`); suffix-aligned pairs fail that test, and the only other rescue is a closed negator list that excludes `free of`, `free from`, `sans`, `non`, `absent of` |
| **V3** | a supporting term that does not pass its own vocabulary in **any** neutral frame | the silent-loss class: `findSupport` fails closed across terms, so a shorter supporting term matching inside a longer negator-carrying one discards the whole sentence |
| **V4** | any `insufficient_evidence` example whose outcome is not **exactly** its declared one | the field is a test suite or it is decoration — and `contradicted` is worse than a pass, see §3.2 |
| **V13** | a violating term that reports a **compliant** sentence as stating the opposite | the bare-substance defect: `Methylene chloride free decaf.` trips a bare violating term because no supporting term overlaps it and `free` is not a negator |
| **V4n** | fewer than three insufficient examples sharing a token with any supporting term | a negative suite of distant straw men proves nothing about the terms actually shipped. A heuristic, and labelled as one |
| **V4g** | a probe pinned `passes_known_gap` while `limits` declares no `false_pass` channel | otherwise the debt lives in the test and not in the published document, where a reader would look |
| **V5a** | a supporting term matched by **none of its own** positive examples | a term that cannot fire reads identically to a term that never had to |
| **V5b** | a positive example that does not pass the **whole** vocabulary | the behavioural form of V1, and the only thing that catches a violating term eating its own support |
| **V5c** | a contradicting example that is not reported as contrary | a violating term nobody proved fires |
| **V6** | a term not already in engine-normalised form, or containing `". "` | `normalize` would search for a different string; `splitSentences` breaks the text at `". "`, so such a term is structurally unmatchable |
| **V7** | duplicates within a list, or a term in both lists | violation is checked first, so a term in both could never reach support |
| **V8** | a `claim_key` colliding with a built-in | see §0 |
| **V9** | missing `misleading_synonym`, `wrong_subject`, or `merchant_controlled_string` hazard classes | the three near-miss classes every matcher meets |
| **V10** | an empty `violating_terms` with no rationale | emptiness must be a decision on the record, like `registry.resolvable: false` |
| **V11** | a weakening changelog entry without a consistent attestation | §8 |
| **V12** | a `vocabulary_hash` that does not cover the content | a citation must resolve to a specific text |

### 3.2 Two rules the SECOND vocabulary forced, and what they cost to find

Both changes came out of authoring `decaf-solvent-disclosure.json`, whose hazard is
**self-negation** rather than misleading synonyms. Neither was visible from the first vocabulary,
which is the entire argument for stressing a format on a second shape.

**`expected_outcome`: probes assert an EXACT outcome, not merely "does not pass".** The first version
of V4 asked only that an insufficient example fail. That silently permits `contradicted` — the engine
printing *"Your public copy states the opposite of this requirement"* beside the merchant's own
sentence. For a compliant store that is **strictly worse than a missed pass**, and a rule checking
only for a pass cannot see it. Every probe now declares `not_proven`, `contradicted` or
`passes_known_gap` and must produce exactly that.

**V13: a violating term must be FRAMED, and the author must prove it.** A negative claim invites a
violating list of bare substances. Measured, with violating `methylene chloride`:

```
"Our decaf is free of methylene chloride."          -> states the opposite
"Methylene chloride free decaf, roasted to order."  -> states the opposite
```

The violating term matches, no supporting term overlaps it to trigger the discard rule, and `free`
is not in the engine's negator list. The fix is to frame the term —
`decaffeinated with methylene chloride` — after which all four compliant forms return `not_proven`.

**The engine already learned this lesson and never carried it across.** `ATTRIBUTE_SPECS.materials`
uses composition *frames* (`made of`, `made from`) rather than bare material nouns, with a comment
saying why: *"aluminum alone would match aluminum-free"* (`productTest.ts:248-253`). The same defect
in a claim vocabulary has a worse consequence, because a claim vocabulary has a contrary branch and
an attribute spec does not.

So `violating_terms[].must_not_contradict_examples` is **required, non-empty, and executed**: the
violation attack from [`VOCABULARY_REVIEW.md`](VOCABULARY_REVIEW.md) §2 promoted from a review step
to a schema field. The validator additionally sweeps auto-generated free-from constructions and
reports them as **notes** — never errors, because failing a vocabulary on copy no seller would write
is the invented-copy narrowing the `origin` removal rejected. That sweep is scoped to bare-substance
terms after its first version generated `decaffeinated with methylene chloride free decaf` and
flagged all four terms of a correctly-authored vocabulary. A note that cries wolf trains authors to
ignore notes.

### 3.1 Two rules the brief asked for that the mechanism refused

**"No violating term may be a substring of any supporting term, in either direction."** The
*in either direction* half would forbid `vegan` inside `non-vegan` — which is **deliberate shipped
behaviour**, with a comment at `testEvidence.ts:348` recording the adversarial pass that added it: a
plain "any overlap" test caused a store saying its product is NON-vegan to have the violation dropped
and then pass on the `vegan` fragment. So V1 forbids one direction, permits the other with a note,
and — because the geometry is subtle enough that no lexical rule should be trusted alone — is backed
by the behavioural proof in V5b.

**"Whole-word matching is the default and turning it off requires an explicit justification field."**
There is nothing to turn off. The engine hardcodes `{ wholeWord: true }` at the claim call site
(`productTest.ts:1113`) and `findViolation` reaches `true` through its own default. A vocabulary
requesting `false` would be describing behaviour the engine cannot produce, so the field is
`const: true` and exists to *record* the constraint. The `organic`/`inorganic` failure the rule was
written for was fixed in v2.5 and is not reachable today.

---

## 4. Orthography — the mechanic that decides the term list

### 4.1 A trademark symbol defeats a multi-word term

`normalize` folds Unicode dashes and curly apostrophes and **nothing else**. So with only the term
`swiss water process`:

| sentence | result |
|---|---|
| `Decaffeinated with the Swiss Water Process.` | PASS |
| `Decaffeinated with the Swiss Water® Process.` | **not_proven** |
| `Decaffeinated with the Swiss Water™ Process.` | **not_proven** |
| `Decaffeinated with the Swiss-Water Process.` | **not_proven** |

The failure is **inverted against the truth**: a registered mark is what a *licensed* seller writes,
so the more carefully a store attributes the process, the more likely it fails. And the obvious
patch — add the bare term `swiss water` — false-passes on `"Swiss water is the softest water in
Europe."` and `"Mountain water from the Sierra Madre."`

The format's answer is **enumerated variants**, tagged with `orthography`, and forced by **V5b**:
write the ® form as a positive example and the vocabulary will not validate until a term matches it.
The rule does the work; the author does not have to remember the hazard.

The engine's answer would be one line in `normalize` — strip `®`, `™`, `℠` — which would improve
every existing vocabulary at once. That is a `src/` change and is filed in G-06, not made here.

### 4.2 `matching` is a record, not a knob

Both fields are `const`. They exist so that a reader of the artifact knows what semantics the terms
were authored against, and so that a future engine change to either is a *visible* grammar change
rather than a silent reinterpretation of every published vocabulary.

---

## 5. `accepted_surfaces` is declared and NOT enforced

The claim branch matches over all six public evidence surfaces in array order and offers no way to
restrict them. Two of the six — `product_title` and `product_options` — are **merchant-controlled
strings**, which `SCHEMA.md` §2 already names as insufficient evidence. Measured:

| probe | result |
|---|---|
| `single_origin`, evidence = title `"Single Origin Colombia Huila 12oz"` only | `pass_evidenced`, quoting the title |
| `single_origin`, evidence = options `"Single Origin Whole Bean"` only | `pass_evidenced`, quoting the option |
| `organic`, evidence = title `"Organic Decaf"` only | `pass_evidenced`, **with no quote at all** |

So a standard's `accepted_evidence` is documentation nothing enforces — the same finding G-10 records
for `applicability`. The format therefore *declares* the surfaces and the validator *measures* the
exposure: `metrics.passOnUnacceptedSurface` counts insufficient examples that would pass if placed on
a title. The number is reported, never asserted on, because the vocabulary cannot fix it. Enforcement
is asked of the engine in G-06.

---

## 6. What a vocabulary can establish

A term list can establish that **a page claimed something**. It can never establish that the claim is
true. For a licensed process name the gap is explicit: a trademark register resolves **ownership of a
mark** and says nothing about licensees, so even a perfectly matched process name is a claim of fact,
not a fact. `scope.does_not_establish` carries this into the published artifact rather than leaving
it to be inferred.

---

## 7. What a vocabulary does NOT unblock

A claim key answers *"is a term present?"*. That is the `is_stated` operator. It is **not**
`equals_one_of`, which asks *which member of a defined set is stated* and additionally requires the
matched member to be **reported** — a different requirement kind and a different gap (G-03).

`serves[].effect` makes this explicit per entry, and the three values are all real:

- **`unblocks`** — the entry as written becomes executable.
- **`narrows`** — a *weaker sibling* assertion becomes executable while the entry as written stays
  blocked, with `still_blocked_by` naming what remains. This is the common case and the one most
  likely to be glossed over.
- **`supports_refusal_only`** — the vocabulary enforces the entry's `insufficient_evidence` **by
  exclusion** (the misleading phrases are simply not supporting terms, so they produce `not_proven`)
  without making the entry's positive assertion executable.

Recording `narrows` honestly is the difference between "G-06 unblocks six coffee entries" and the
truth, which is that it unblocks the *presence* half of some of them.

---

## 8. Never-weaken, extended to terms

> **A term may not be added to the supporting list, or removed from the violating list, in the same
> window a merchant failed the assertion it serves.**

Three `change_type` values weaken, and they are treated identically because their effect on a
merchant who failed is identical:

| change | effect |
|---|---|
| `supporting_term_added` | copy that failed now passes |
| `violating_term_removed` | copy reported as contradicting no longer is |
| `insufficient_probe_removed` | a form the standard refused is no longer refused |

Each requires a `weakening_attestation`, reusing the standard's own definition. Their opposites —
removing a supporting term, adding a violating term, adding an insufficient probe — are
**strengthening** and always safe to ship.

The cross-field dependency (`prior_failures_exist` versus `remediation`) is checked in
`vocabulary.ts` V11 rather than in the schema, for the same reason `SCHEMA.md` §5 gives, and it has a
negative fixture that must fail.

**The same limitation applies as for a standard, and is recorded rather than papered over:** an
`editorial` change can weaken a vocabulary in practice — a supporting term rewritten as an
"orthographic variant" that happens to admit a new form. The changelog cannot detect that; only
re-running the corpus against both versions can. The mitigation available today is
`vocabulary_hash`.

---

## 9. What validation actually proves

Stated precisely, because this project has three times confused a simulation with a measurement:

- **Matching is engine-real.** `findSupport`, `findViolation`, `buildEvidence`, `normalize`,
  `isNegated`, `termMatches` and `lintStrings` are imported from `src/`. Nothing about term
  matching, negation, aboutness, quoting or linting is reimplemented.
- **Dispatch is mirrored.** `evaluateWithVocabulary` re-states the seven lines of `evaluate`'s
  `claim` branch, because that branch reads the non-exported `CLAIM_TERMS` and cannot be handed a
  vocabulary at all — which is the gap being specified. The mirror is **proven equivalent** to the
  real `evaluate` over every built-in claim key in
  `standards/__tests__/vocabulary.engine.test.ts`.
- **Not proven at all:** that a registered vocabulary works end to end. That needs the registry
  (G-06) *and* the ability to run a standard against a public URL (G-09). Neither exists. No test in
  this session claims otherwise.

`validateVocabulary` returns a **completion state**, never a boolean, and `defectCount` is
`number | null` — `null` on `INCOMPLETE`, never `0` — so an incomplete validation cannot be summed
into a total or read as a pass by a caller that only looks at the number
(`src/measure/completion.ts`).

---

## 10. What the format deliberately does not have

- **No regex terms.** The engine matches literal normalised substrings; a regex field would be a
  capability the engine does not have, and every historical defect in this area came from a term list
  being more powerful than its author's model of it.
- **No weights, no confidence per term.** A match passes or it does not. A weighted term list is a
  score, and `SCHEMA.md` §8 already rejects scores for the reason that the number becomes the only
  thing cited.
- **No `synonyms` map keyed by canonical value.** That is `equals_one_of`'s shape (G-03), and
  building it here would produce a structure the engine cannot consume while implying it can.
- **No per-term surface restriction.** The engine cannot honour even a vocabulary-level one (§5);
  a per-term one would be twice the fiction.
