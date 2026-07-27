# THE AISLELENS STANDARD GRAMMAR — v1.0, and the 1.2 reconciliation (§9)

The machine-readable authority is [`schema.json`](schema.json). This document explains what each
field is *for*, and states the four rules a schema cannot express.

> **§9 is the part to read first if you are authoring a new standard.** The grammar was revised after
> the first standard was ever measured against real stores, and three of its rules did not survive
> that measurement: tiers were being assigned from a prediction that **held 1 of 10 on the
> 100-product sample**, verdicts were being recorded on nine products, and nothing stopped a standard
> publishing an error bound measured on somebody else's category. The corrected grammar is **1.2**,
> not 1.1 — §9 says why, and it is not a numbering preference. 1.0 and 1.1 documents remain valid and
> readable against the rules they were authored under.

**The grammar is the asset, not any individual standard.** A second category should be a script run
plus a review pass. If authoring category three still feels like invention, the grammar is wrong and
that finding outranks the category.

---

## 0. What a standard is, and what this one currently is

A standard is a published, versioned set of **assertions** about what a product page claims, each
with **defined evidence rules**, each **citable by a stable id**, and each **executable or honestly
marked as not**.

> **Until a second party independently applies a standard without us, it is a rubric with a
> versioned changelog, not a standard.** The difference is not headcount — SemVer and Markdown were
> each one person. It is whether someone else *can* apply it and whether anyone *does*. The
> `posture.independently_applied` flag carries this, and while it is `false` the published document
> must say so in its own words.

Vocabulary this grammar uses: **standard, assertion, conformance testing, evidence, verified
against**. Vocabulary it never uses, anywhere, in any field: *certification, certified, standards
body, accredited, trusted by, guaranteed*. The last one is also a claim-linter violation that would
block a merchant's entire report (§6), so it is enforced mechanically as well as editorially.

---

## 1. Standard-level fields

| field | purpose |
|---|---|
| `grammar_version` | Which grammar the standard is authored against. A standard is only readable against a stated grammar version, and a version is never redefined once a document has been published against it. `1.0`, `1.1`, `1.2`; **§9** is the difference and why the correction is 1.2 rather than a redefinition of 1.1. |
| `standard_id` | `ALS-{CATEGORY}`. Stable forever. Never reused for a different category. |
| `version` | `MAJOR.MINOR`. A MAJOR bump means a result under the old version is **not comparable** to one under the new — the same discipline as the engine's `contractVersion` (`src/server/productTest.ts:858`), and for the same reason: a before/after comparison is only evidence if both runs asked the same question. |
| `status` | `draft` \| `published` \| `withdrawn`. `draft` means *authored, never applied to a real store by anyone*. |
| `posture` | The rubric-until-independently-applied statement. |
| `applicability_envelope` | What products the standard covers, what it excludes, and **which product fields decide it**. |
| `out_of_scope` | An explicit list of what the standard does not attempt to adjudicate, each with a reason. Minimum three. A standard that does not bound itself will be read as bounding nothing. |
| `engine_contract` | Engine version, the contract document, the requirement kinds bound, and the commit the contract was verified against. |
| `changelog` | Releases and per-entry changes, governed by §5. |
| `standard_hash` | A content hash so a citation resolves to a specific text (§4). |
| `entries` | The assertions. |

### 1.1 `applicability_envelope.category_signals` mirrors the engine on purpose

The engine decides category from `product_type` first (authoritative), then `title`, and
**never from tags** — a coffee-scented soap must not read as a coffee product
(`src/server/productTest.ts:877-884`). A standard that classified products differently from the
engine that runs it would fire on the wrong products, so the grammar makes the signal order an
explicit, checkable field rather than an assumption.

---

## 2. Entry fields

Fifteen required fields. Four are required only for `executable` entries. The ordering below is the
order to author in — each field constrains the next.

### The consumer-facing half

**`question`** — plain language, as a shopper would ask it. Required for *every* tier, including
`blocked` and `advisory`. This is deliberate: the published document's value to a shopper does not
depend on whether a machine can currently check the answer, and an advisory question that a buyer
recognises is what makes the executable ones credible.

**`consumer_note`** — why it matters to a buyer, and how they could check it manually. If a shopper
cannot check it manually either, say that — it is the strongest possible argument for the
assertion's existence.

### The machine-facing half

**`assertion`** — `{ subject, operator, expected }`. The operator vocabulary is **closed** (ten
values). A new operator is a grammar change, not an authoring choice, because every operator implies
either an engine capability or an engine gap:

| operator | means | engine support today |
|---|---|---|
| `is_stated` | the page states the property in a form a machine can read | `claim`, `attribute` |
| `option_available` | a named purchasable option exists | `variant_option` |
| `is_present` | a structured field is present **and plausible** | `identifiers` |
| `is_purchasable` | availability is readable and positive | `in_stock` |
| `no_blocking_condition` | nothing contradicts an absence-based requirement | `no_subscription` |
| `less_than` | a readable numeric value is below a bound | `price_under` |
| `equals_one_of` | a stated value belongs to an enumerated set | **none** → `blocked` |
| `matches_format` | a stated value parses as a defined format (e.g. a date) | **none** → `blocked` |
| `derived_from` | computed from two other stated values | **none** → `blocked` |
| `resolves_against_register` | confirmed against a named external register | **none** → `blocked` |
| `includes_buyer_parameter` | a merchant-published **list** contains a value the **buyer** supplies | **none** → `blocked` |

Operators five through nine are the shape of every genuinely new capability the category standards
need. That is not a coincidence: `equals_one_of` is *process method*, `matches_format` is *roast
date*, `derived_from` is *price per unit weight*, `resolves_against_register` is the empty ground
nobody in this market occupies, and `includes_buyer_parameter` is *"will this fit my model"*.

### 2.1 `includes_buyer_parameter` — the operator the generalisation test forced

This operator, and the `buyer_parameter` field it requires, were **added to grammar 1.0 while
authoring the device-accessory draft**. They are the most valuable output of that exercise, because
they record a limitation the coffee standard could never have exposed.

Every other operator compares page evidence against a value **fixed when the standard is written** —
a claim key, an enumerated set, a format, a register. A compatibility assertion inverts the
direction: the *list* is on the page and the *value* comes from the buyer at test time. The grammar
had silently assumed the first shape, and one category was enough to break the assumption:

> `variant_option` can express *one* model. A standard cannot enumerate every model, and a standard
> that tried would be a device database with a version number on it.

The schema binds the two together conditionally — the operator requires the field, and the test suite
additionally asserts that no *other* entry carries the field and that an entry using the operator is
never `executable`, because the engine has no channel for a test-time parameter
([`ENGINE_GAPS.md`](ENGINE_GAPS.md) G-13).

**What survived unchanged is the more useful half of the result.** Tier, evidence surfaces,
`insufficient_evidence`, `conflict_rules`, `pass_means`, `known_gaps`, `predicted_discrimination`,
`adversarial`, `grounding` and the never-weaken changelog all carried over to a category built on
compatibility and specification rather than provenance and process, with **no change and no
strain** — and two of them behaved better there than in coffee: `registry.resolves_to_level` finally
had a `product`-level entry to describe (safety-mark listings resolve to a **model**, which nothing in
coffee does), and `predicted_discrimination` showed the *same* engine requirement discriminating
differently across categories, which is exactly what a per-entry prediction is for.

**One cosmetic inconsistency was found and left alone.** `standard_id` permits internal hyphens
(`ALS-DEVICE-ACC`) while the entry-id pattern does not, so a hyphenated family name would produce ids
that fail validation. The draft uses `ALS-ACCESSORY` and the constraint is recorded here rather than
patched, because tightening `standard_id` is a breaking change for a cosmetic gain.

**`tier`** — the honesty valve.

- `executable` — the engine runs it today. Requires `binding`, `adversarial`, `pass_means`.
- `advisory` — a real buyer question that **public data cannot adjudicate**. Published, never
  tested, never scored. Forbidden from having a `binding`, because a bound advisory entry is a lie
  about what gets run.
- `blocked` — *should* be executable; the engine cannot yet. Requires `blocked_by` referencing
  `ENGINE_GAPS.md`.
- `unbound` *(grammar 1.2)* — the engine **can** run this kind and public data **can** adjudicate it;
  this standard has not authored the `binding` or run the adversarial pass. The obstacle is neither
  the evidence nor the code but unwritten work in this document. Requires `unbound_reason` naming the
  engine `ReqKind` that fits; forbidden from having a `binding` or a `measured_discrimination`. §9.4.
- `not_discriminating` — the engine **could** run it and deliberately does not, because the failure
  rate falls outside the 15–85% band and the row would carry no information. Published so a reader
  can see the question was considered rather than missed. No `binding`.

  > ⚠️ **At grammar 1.0 and 1.1 this tier is assigned from a PREDICTION, and that was measured
  > wrong.** At **1.2 it requires a `measured_discrimination` whose verdict is
  > `not_discriminating`** — the schema rejects the tier without one, so the most confident
  > prediction an author can write cannot retire an entry. §9, and [`METHOD.md`](METHOD.md) §5.

> **Why the fourth tier exists — a grammar change made during authoring, and the most useful thing
> the coffee standard taught the grammar.** (The fifth, `unbound`, came later and for a different
> reason: §9.4.)
>
> The original three tiers conflated *the engine cannot
> test this* with *the engine should not test this*, and the second is the engine's single
> most-cited design lesson: the defaulted `cruelty_free` row failed 13/13 and `price_under` fails
> 0/13, and both were removed or deprioritised for carrying no information rather than for being
> unrunnable (`src/server/productTest.ts:87-89`).
>
> Coffee forced the issue immediately. *"How much does it cost?"* is unambiguously a buyer question
> and unambiguously executable — and price is essentially always public on a Shopify product, so
> testing it would produce a row that passes for everyone. Under three tiers the only options were
> to publish it as `executable` (a row of pure noise), mislabel it `advisory` (false — public data
> adjudicates it perfectly), or omit it (leaving a shopper to wonder whether the standard forgot
> about price). None of those is honest. The fourth tier is.
>
> It is guarded against becoming a dumping ground: the test suite requires a
> `not_discriminating` entry's predicted band to genuinely fall outside 15–85%. **If it
> discriminates, run it.**
>
> ⚠️ **That guard was not enough, and the measurement said so.** It checks the band against itself,
> so it can only catch an author who contradicts their own prediction — never an author whose
> prediction is simply wrong. `WEIGHT-001` predicted 15–40%, measured 11.1% on nine products, and
> passed this guard on its way to being flagged `not_discriminating`. It measures 48.8% on a valid
> 43-product sample and 49.0% on 100 — the most stable figure in the document, and its most
> informative split. **At grammar 1.2 the guard is replaced by a measurement**: the tier requires a
> `measured_discrimination` verdict, so the price question stays `executable` and *runs* until data
> retires it. The fourth tier's reason for existing is unchanged and correct; what changed is who is
> allowed to put an entry into it. §9.

The ratio matters and should not be flattered. Most real buyer questions cannot be adjudicated from
public data, and saying so plainly is more credible than pretending otherwise.

**`binding`** — the engine `Requirement` the entry compiles to, plus `passing_states`.

> `passing_states` exists because `pass_no_blocking` is an **absence-based inference, not proof**
> (`src/server/productTest.ts:1179-1183`). It is only correct for `req_kind: no_subscription`.
> Listing it on any other entry claims proof the engine did not produce, and the test suite fails
> the build for it.

### The evidence rules — the actual content of a standard

**`accepted_evidence`** — which surfaces, and what forms count. Surfaces come from a closed
enumeration: the engine's nine `QuotableSurface` values, the three non-text structural surfaces it
also reads, and `external_register`, which the engine cannot read at all and which therefore forces
`tier: blocked`.

**`insufficient_evidence`** — **what explicitly does not count.** This is the differentiator field.
It is where the standard states that *"chemical-free" does not establish Swiss Water process*, that
*"fresh roasted" is not a roast date*, that *"single origin" on a page whose variants name three
countries is contradicted by the page itself*. The schema forbids it being empty and the test suite
re-checks it, because an empty `insufficient_evidence` turns an assertion into a keyword match.

Every entry's `insufficient_evidence` should cover the near-miss classes that actually occur:

1. the **vague synonym** that sounds like the claim (`natural decaf` for a named process);
2. the **aspiration** (`we believe fair trade should be the industry standard`);
3. the **placeholder** (`Roast date: TBD`, `Origin: N/A`);
4. the **negation** (`we do not offer whole bean`);
5. the claim about **something other than the product** — packaging, the shipment, a bundled item, a
   competitor, a review quote;
6. the **merchant-controlled string** that would reach a linted output (a title, a product type, an
   option value);
7. the **wrong subject of the same unit** — a brew ratio in grams read as net weight.

Classes 5 and 7 are not hypothetical; they are pinned open defects in the engine's adversarial
corpus, and an entry that collides with one must say so in `known_gaps`.

**`conflict_rules`** — minimum one. Two surfaces disagreeing is the normal case, not the exception:
a title says *Whole Bean*, the variant options offer only *Ground*; a description says *single
origin*, the structured data names a blend. A standard with no conflict rule silently resolves these
by whichever surface the matcher reached first, which is an implementation detail masquerading as a
rule.

**`public_inspectable`** — whether a free public test can adjudicate it. `true` requires that no
accepted surface is `product_metafield`, `seo_description`, or `external_register`. This is checked
by the test suite rather than the schema, because it is a cross-field constraint.

> **Why this field earns its place.** A public-tier assertion that depends on metafields can never
> pass a free test — the public path's `buildEvidence` is called with six surfaces and metafields is
> not among them (`src/server/productTest.ts:771-778`). There is no configuration that changes it.

**`registry`** — where the claim resolves against an external register, with the register named, its
lookup key, its lookup method, and — the field that prevents the most likely overclaim —
`resolves_to_level`. A register that resolves to a **company** cannot verify a specific bag's claim.
`engine_can_perform` is `false` for every entry in grammar v1.0 and a `true` value without an engine
change is a false statement.

### The honesty fields

**`predicted_discrimination`** *(grammar 1.0 and 1.1)* / **`discrimination_prediction`**
*(grammar 1.2)* — what the author expects, before measuring. Target band 15–85%.

The engine's own measurements are why a discrimination field exists at all: a defaulted
`cruelty_free` claim failed **13/13 = 100%** and carried zero information; `price_under` fails
**0/13 = 0%** and carries zero information; `delivery` fails **71%** and is near-optimal
(`src/server/productTest.ts:87-89`, `:1017`). The `cruelty_free` row was *not false* — the store
genuinely did not state the attribute. It was **irrelevant, identical across unrelated merchants,
and enough to make a specific diagnosis read like a template**. A fifty-question standard applied
uniformly is that failure with a version number on it, and `applicability` is what prevents it.

> ⚠️ **THE 1.0 FORM OF THIS FIELD WAS MEASURED AND IT WAS WRONG, AND MORE DATA MADE IT WORSE.** Ten
> authored bands, tested on 43 in-category coffee records: **HELD 2 OF 10, with ALL EIGHT MISSES
> HIGH.** On 100 products: **HELD 1 OF 10.** At 1.2 the band is gone and the field is a direction, a
> confidence and the reasoning — optional, and forbidden from determining a tier. §9.1, and
> [`METHOD.md`](METHOD.md) §5.1 for the four alternative shapes that were scored and why none of them
> could be shown to be better.

**`measured_discrimination`** — the verdict, **with `n`, a date and the sample it came from**.
Optional at every grammar version, so a 1.0 or 1.1 standard can record a measurement without being
rewritten. Absent means *unmeasured*, which is not the same as *measured and fine*.

> ⚠️ **ONE FIELD NAME, TWO SHAPES, AND THE DOCUMENT'S OWN `grammar_version` DECIDES WHICH** — never a
> guess from the keys present. At 1.0/1.1 it is the first shape (`fail_rate_pct`, `asked`, a
> two-valued verdict against the *predicted* band, `carries_information`), which is what
> `ALS-COFFEE 1.1` contains on ten entries. At 1.2 it is the shape that carries a 95% interval, an
> `n_asked` beside the `n_adjudicated`, the pinned target band, the decision rule, and the sample
> provenance. A 1.2 verdict may not be recorded below **22 adjudicated rows** — a floor derived from
> the target band, not chosen, and derived twice from opposite edges — and the schema enforces it.
> §9.2.

**`pass_means`** — what a conformant result licenses a reader to conclude, and what it does not.
Required for `executable`. This is the field that stops *"verified against
ALS-COFFEE-1.0-CERT-ORG-001"* being read as *"certified organic"*. The engine tests **evidence
availability, never product truth**, and the published standard has to carry that distinction into
the hands of whoever quotes it.

**`adversarial`** — the attack, and what it changed. Required for `executable`. §3.

**`known_gaps`** — the pinned corpus defects this entry's shape collides with, and in which
direction. An entry that collides with a pinned gap is knowingly unreliable; the grammar makes it
declare that in the published document rather than in a source comment.

**`grounding`** — §7. Mandatory, and the reason this grammar is not just a data format.

**`merchant_remediation`** — where truthful evidence should be exposed, in the merchant's own store.
Must be a **placement** instruction. It may never be an instruction to *state* something that might
not be true: "publish your roast date in a product field" is legitimate; "say your coffee is
single-origin" is not, and would also trip the claim linter's `product-truth` rule.

---

## 3. The adversarial pass is part of the grammar, not part of a session

For each `executable` entry, an independent pass writes the store copy that would **satisfy the
letter and violate the spirit** — text that passes the assertion while misleading a buyer. Every
finding must resolve to exactly one of:

- `tightened_accepted_evidence` — the accepted forms were too loose;
- `enriched_insufficient_evidence` — the near-miss is now named explicitly;
- `narrowed_applicability` — the entry was firing on products it should not;
- `demoted_to_advisory` — the assertion cannot be made honestly from public data;
- `survived_unchanged` — the attack failed.

`residual_risk` records what the attack can still achieve after the fix. **Honest residual risk beats
a claim of immunity**, and an entry claiming `survived_unchanged` with no residual risk should be
treated as an entry whose attacker was not trying.

This mirrors the engine's own standard, and for the reason the engine records: v2.3 audited seven
real stores, found zero false positives, and that was close to worthless as a general claim. v2.4
then ran 959 probes against the matcher and confirmed 131 defects.
**Sampling real stores catches artefacts; only executing against deliberately chosen input catches
logic.** The same is true of an assertion: a plausible-sounding assertion that has never been
attacked has been reviewed, not tested.

---

## 4. `standard_hash` — how a citation resolves

`sha256` over the canonical form of the standard **with the `standard_hash` object removed**, keys
sorted recursively, `JSON.stringify` with no whitespace, UTF-8. Implemented in
[`hash.ts`](hash.ts) and verified by the test suite, so a hash that drifts from the content is a
failing build rather than a stale number.

Why it matters: an agency writing *"your PDPs fail ALS-COFFEE-1.0-DECAF-002"* in a client report is
citing a specific text. Without a content hash, "1.0" is a promise that the text has not changed,
enforced by nothing.

---

## 5. THE NEVER-WEAKEN RULE

> **The changelog may never show an assertion being weakened in the same window a merchant failed
> it.** That single event retroactively poisons every result the standard ever produced.

The reasoning is worth stating rather than assuming. If a merchant can fail `X`, complain, and
observe `X` become easier, then every prior pass is suspected of having been bought and every prior
fail is suspected of having been arbitrary. The damage is not to the one result; it is to the claim
that the standard means anything at all. A single instance is unrecoverable, which is why this rule
is structural rather than a policy note.

### How the grammar enforces it

Two `change_type` values weaken an assertion, and they are treated identically because their effect
on a merchant who failed is identical:

- **`weakened`** — the same store copy that failed before now passes.
- **`demoted`** — `executable` → `advisory`, `blocked`, `not_discriminating`, **or `unbound`**. The
  row stops being tested at all.

  > `unbound` is on that list for the same reason `not_discriminating` is, and the reason is worth
  > stating because the tier's honest purpose makes it easy to miss: `unbound` is the correct
  > destination for an entry that was **never** executable, and moving one that **was** is a
  > demotion like any other. The merchant who failed the row cannot tell "we never wrote the
  > binding" from "we withdrew the row you failed".

  > ⚠️ **`not_discriminating` was missing from this list, and that was a hole.** The tier was added
  > to the grammar after §5 was written, and its effect on a merchant who failed the row is
  > *identical* to a demotion to advisory: the row stops being tested. So until now, retiring an
  > entry was the one way to stop testing it **without** triggering an attestation — the cheapest
  > exit from a standard, and the one an aggrieved-merchant scenario would reach for. It now costs
  > the same as every other exit. See [`METHOD.md`](METHOD.md) §5.4 for the argument, including why
  > a *measured* retirement is still a weakening: a merchant who fails an entry and then watches it
  > disappear cannot distinguish "the measurement said it carried no information" from "someone
  > complained", and that indistinguishability is the whole damage this rule exists to prevent.

For comparison, **`strengthened`** (copy that passed before now fails) is always safe to ship, needs
no attestation, and is the direction a maturing standard should mostly move.

Either weakening change **requires** a `weakening_attestation`:

```json
{
  "prior_failures_exist": true,
  "remediation": "results_reissued",
  "affected_result_count": 12,
  "attested_by": "...",
  "attested_date": "2026-08-01"
}
```

- If `prior_failures_exist` is **false**, `remediation` must be `not_applicable_no_failures`.
- If `prior_failures_exist` is **true**, `remediation` must be `results_reissued` or
  `results_invalidated`. **`not_applicable_no_failures` is then a contradiction and fails the
  build.** There is no third option and deliberately no "grandfathered" value: a weakening that
  leaves standing failures in place under the old text is exactly the event the rule forbids.

JSON Schema can require the attestation object; it cannot cleanly express the cross-field
dependency between `prior_failures_exist` and `remediation`. That check lives in the test suite
(`standards/__tests__/standard.test.ts`, group 9) — and the suite includes a **negative fixture**
that must fail, because a governance check nobody has watched fail is a governance check nobody has
tested.

### What the rule does not cover, stated so it is not mistaken for covering it

An **editorial** or **clarified** change can weaken an assertion in practice while being logged as
harmless — a reworded `accepted_evidence` that happens to admit a new form. The grammar cannot
detect that from the changelog alone; only re-running the corpus against both versions can. This is
a real limitation of the mechanism and it is recorded here rather than papered over. The mitigation
available today is the `standard_hash`: any content change is visible, even when the changelog
mislabels it.

---

## 6. The claim linter constrains the grammar itself

Every `binding.label` is rendered to a merchant and passes through
`src/server/claimLinter.ts`. **A single violation returns the merchant's ENTIRE report as
`unreachable`** (`src/server/productTest.ts:1560-1571`) — not the row, the report, for a store the
engine read perfectly well.

This is why the linter's vocabulary is a *grammar* constraint and not an editorial preference. Two
recorded instances of the failure: a `warranty` requirement was **dropped from the engine** because
its term list collided with the `guarantee` rule, and a product titled *"Lifetime Guarantee Leather
Belt"* returned a whole report as `unreachable`.

The full forbidden set is tabulated in [`ENGINE_CONTRACT.md`](ENGINE_CONTRACT.md) §6. Three that bite
a standard author hardest:

- **`guarantee` in any inflection.** No assertion may be labelled "freshness guarantee",
  "guaranteed roast date", or anything similar.
- **`your coffee is` / `your coffee contains` / `your coffee does not`.** `coffee` is one of only six
  nouns in the linter's `product-truth` rule. A coffee standard is structurally the most exposed
  category there is to this specific rule, and it exists nowhere else in the engine.
- **`missing`/`no evidence of` within 30 characters of `price` or `cost`.** This rules out the
  obvious phrasing for a unit-price assertion.

`standards/__tests__` runs the **real** `lintStrings` over every entry's `binding.label`, `question`,
`consumer_note` and `merchant_remediation` — not a reimplementation of it. A copy of the rules would
drift, and the point of the check is that it cannot.

---

## 7. GROUNDING IS MANDATORY

**No question enters a standard because it sounds plausible.** An ungrounded fifty-question standard
is exactly the artifact that reads as machine-generated, and it is the fastest way to lose the
credibility the whole position rests on.

`grounding.citations` must cite **specifically**: a named source, its kind, a URL where one exists,
and what that source *establishes*. **"Common knowledge" is not grounding.** Nor is a source that
merely *defines* a term: a definition establishes that the term has meaning, not that any shopper
asks about it. The refuting pass exists to catch precisely that substitution, and the grammar
records its verdict in `grounding.refutation` so a reader can see the grounding was attacked.

`demand_basis` is a closed list, and one of its values is a warning label: **`trade_convention_only`
marks a question the trade cares about and shoppers may not.** It must never be the sole basis for
an `executable` entry — a standard whose executable core is trade concerns is a standard that tests
merchants against their suppliers' interests rather than their buyers'.

### The research protocol that produces grounding

Independent agents on separate assertion classes, then a **separate agent whose only job is to
refute**: which questions are actually asked by shoppers versus invented by the trade, and which
"standards" are self-declared rather than registered. Full protocol in [`METHOD.md`](METHOD.md).

---

## 8. What the grammar deliberately does not have

- **No score.** No weighting, no grade, no pass percentage. A conformance result is a list of
  per-assertion outcomes. The moment a standard emits a single number, that number is what gets
  cited and every honesty field above becomes decoration.
- **No severity ranking.** Tempting, and rejected: severity is a function of the buyer's purpose,
  not of the assertion. A shopper avoiding a solvent decaf and a shopper hunting a Geisha weight
  the same entries differently.
- **No remediation automation hook.** The grammar says where evidence *should* live; it never
  generates the sentence. The engine has a separate, four-way-gated write path for that, and
  merging the two would let a standard author cause a store mutation.
- **No `certified` / `compliant` vocabulary**, per §0.

---

## 9. GRAMMAR 1.1 AND THE 1.2 RECONCILIATION

**Two concurrent sessions each authored a revision of this grammar, and both called it 1.1.** They
were not variations on one design — they disagreed about the shape of a measurement, about the name
of the fitness block, and about which states an entry may be in. One of them shipped:
`standards/coffee/v1.1/standard.json` declares `grammar_version: "1.1"`, is byte-frozen, and is
served at a stable URL that citations resolve through.

**So the reconciliation is 1.2.** Redefining "1.1" to mean the other session's grammar would make a
published document invalid against the version it names, and a grammar version is resolved through
the same contract as a `standard_hash`: a reader must be able to take a document and the version
string it declares and get one unambiguous set of rules. Renaming the rules under a version that is
already in the world breaks that, and it breaks it silently — the document does not change, the
answer to "is it valid" does.

`grammar_version` is now `"1.0" | "1.1" | "1.2"`. 1.0 and 1.1 documents validate exactly as they
always did. Everything below is the difference, and every item exists because a specific number
invalidated a specific rule. The measurement record is [`METHOD.md`](METHOD.md) §5 and §6.

| | 1.0 | 1.1 | **1.2** |
|---|---|---|---|
| the prediction | `predicted_discrimination` — **required**, a numeric band, `in_target_band` | same, and `measured` loosened from `const: false` to a boolean | `discrimination_prediction` — **optional**, a direction and a confidence, **no number**. The band is *forbidden* |
| the measurement | *(nothing)* | `measured_discrimination`, first shape: `fail_rate_pct` / `asked` / `verdict` / `carries_information` | `measured_discrimination`, second shape: a 95% interval, a derived minimum n, a three-valued verdict, and a recorded sample |
| what assigns `tier: not_discriminating` | the author's prediction | the author's prediction | **a `measured_discrimination` whose verdict is `not_discriminating`.** The schema rejects the tier without one |
| the tiers | executable · advisory · blocked · not_discriminating | same | **+ `unbound`** (§9.4) |
| fitness | *(nothing)* | `measured_fitness` | `category_fitness` — a **rename, not an alias**; `measured_fitness` is forbidden |
| publishing | `status: "published"` needs nothing | needs nothing | requires `category_fitness` |

**Where the reconciliation took from the shipped 1.1 rather than from the other grammar:** the
`applied_by_author` status and the entry-level `supersedes`. Neither is a compromise. `draft` was
false of the coffee document (it had been executed against 100 real products and published at a
stable URL) and `published` would have been a lie (no second party had touched it); a document that
is wrong about itself is the failure this project treats as unrecoverable, and it does not become
acceptable because the error is modest. `supersedes` is what makes every prior entry id resolve at
the new version.

**And the field name is `category_fitness`.** `checkCategoryFitness` in
[`discrimination.ts`](discrimination.ts) reads `std.category_fitness`, and **6 of the 21 cross-field
rules run off it** — that is executable code with negative fixtures, against a name only a renderer
knows. It also says the thing that decides publication: fitness *on this category*. `measured_fitness`
only says the number was measured, which at 1.2 every number in a document is.

### 9.1 `discrimination_prediction` — a field that is deliberately unranked

Three properties, all executed by `standards/__tests__/discrimination.test.ts` rather than asserted
here:

1. **It carries no number.** Its properties are exactly `direction`, `confidence`, `reasoning`,
   `notes`, and a test fails the build if any of them becomes numeric. A band authored wide enough
   to always hold carries no information, which is the failure the band was supposed to detect.
2. **It cannot determine anything.** Setting the most extreme direction at the highest confidence
   changes no validation outcome, which the suite checks across all twelve combinations. It may not
   determine `tier`, it may not determine a `measured_discrimination.verdict`, and no test may read
   it.
3. **Its own `description` in `schema.json` states the measured bias**, so an author filling the
   field in cannot avoid reading how the last author did. A test asserts that text is present.

**THE BIAS, AND IT GOT WORSE WITH MORE DATA.** Authored bands held **2 of 10** on the 43-product
sample and **1 of 10** on the 100-product one (`standards/coffee/v1.0/fitness.json`,
`entry_discrimination.bands_held`), with every miss HIGH — the author consistently over-estimated
how much a category's stores publish. The survivor is `GRIND-001` at 84.8% against a predicted
55–85%.

⚠️ **Three numbers that are not the same number**, and a brief has already run two of them together:
**bands held 1 of 10** (the prediction was right once) · **above its band 8 of 10** (the entry
discriminates *less* than predicted) · **carries information 4 of 10** (the *measured* rate lands
inside 15–85%). `FORMAT-001` at 73.7% against a predicted 30–60% is above its band and squarely
inside the informative one. **"Above its band" does not mean "carries no information."**

`no_prediction` is a first-class value. **The field is kept rather than dropped, and the argument
against it is real**: a field that by construction determines nothing is authoring cost with no
downstream effect, and deleting it would cost nothing that any rule reads. It loses on two counts.

1. **The calibration that condemned the band is computable only because the predictions were
   preserved beside the measured rates.** "Bands held 1 of 10, every miss high" is the most useful
   sentence this programme has produced about its own authoring, and deleting the field destroys the
   instrument that produced it. A field nobody records cannot be shown to be wrong.
2. **The cost objection is answered by `no_prediction` being first-class.** An author with no
   grounded expectation writes one word, so the field costs nothing when there is nothing to say.

### 9.2 `measured_discrimination` — and the minimum n, which is derived

The full argument is [`METHOD.md`](METHOD.md) §5.2. The schema's part of it:

- **`n_adjudicated` has `"minimum": 22`.** Below 22 adjudicated rows no observation whatsoever — not
  0 of n, not n of n, the two most extreme results obtainable — can place a 95% Wilson interval
  outside the 15–85% band, because `n > z²(1−b)/b = 21.768`. A verdict there is arithmetically
  incapable of supporting itself, so this is a schema `minimum` and not a guideline.

  **Verified independently, and from both edges, because a floor derived once is a floor nobody
  checked.** At `k = n` (every row fails) the Wilson *lower* bound must clear 85; at `k = 0` (no row
  fails) the *upper* bound must clear 15:

  | n | Wilson lower at k=n | clears 85? | Wilson upper at k=0 | clears 15? |
  |---|---|---|---|---|
  | 20 | 83.89% | no | 16.11% | no |
  | 21 | 84.54% | no | 15.46% | no |
  | **22** | **85.13%** | **yes** | **14.87%** | **yes** |

  The two edges are independent derivations and both give exactly 22. `standards/discrimination.ts`
  recomputes the floor from the band rather than hard-coding it, and the test suite re-derives it a
  *third* way, by exhaustive search, so the constant cannot drift away from the band it depends on.
  Changing the band is a grammar change, and it moves the floor steeply: 73 at a 5% edge, 35 at 10%,
  22 at 15%, 16 at 20%. That is why `target_band` is a `const` in the record rather than a free
  number — a record allowed to declare its own 10–90% band would pass a `minimum` of 22 while its own
  derived floor was 35.
- **The verdict is one of three**, because `src/measure/completion.ts` has three for the same reason:
  `indeterminate` means the measurement ran and decided nothing, and it must never read as either
  decision. **The rule is asymmetric, and `verdictFor()` is the authority for what it is:**
  `not_discriminating` needs the WHOLE interval outside the band, `discriminating` needs only the
  POINT ESTIMATE inside it, and `indeterminate` is everything between. *Hard to leave, easy to
  return* — retirement is a one-way door, so it demands the interval; keeping a row costs a noisy
  line in a report, so it demands only the rate.

  > ⚠️ **This paragraph said something else, and the something else contradicted the code it
  > documents.** It claimed `discriminating` required the whole interval INSIDE the band, and
  > published a split of 3 / 2 / 5 on that basis. A symmetric rule of that shape would retire
  > nothing and demote almost everything to `indeterminate`. The real split, re-derived by
  > `verdictFor()` itself rather than by hand, is **discriminating 4 · indeterminate 1 ·
  > not_discriminating 5**, and the error survived three documents — here, `schema.json`'s own
  > `verdict` description, and the session brief — because each was written from the same
  > paraphrase instead of from the function. `METHOD.md` §5.2, written independently *from the
  > code*, had it right the whole time.

  The single disagreement with the shipped two-valued `carries_information` is `SOURCE-001`: at
  89.0% it reads as a settled *no* — and its interval [81.37, 93.75] crosses 85, so the
  measurement in fact decides nothing. A two-valued verdict has to call that, and calls it wrongly.
- **The interval and the rate are recomputed by the test suite** from `fail_count` / `n_adjudicated`,
  to a tolerance tighter than the Wald–Wilson gap. A published interval nobody recomputes is a
  number, not evidence.
- **`instrument_bias` is required for a retirement.** An interval bounds *sampling* error only; a
  declared one-directional bias pointing at the cleared band edge must be quantified and smaller than
  the margin, and an *unquantified* one blocks the retirement outright. On this engine the coffee
  false-pass rate is 6.17% point / 12.78% cluster-adjusted 95% bound, so a retirement decided by a
  2.94pp margin is decided by the instrument rather than by the stores.
- **`supersedes` is append-only.** A superseded measurement stays in the document, because the
  disagreement is itself the finding, and `larger_sample` is rejected as the explanation for two
  intervals that do not overlap.

### 9.3 What a 1.1 standard has to do to become a 1.2 standard

Not performed here — specified, so the session that owns those files can do it deliberately. It is a
**reissue**, not an edit: v1.1's bytes are frozen and its hash is pinned, so every step below produces
a new version directory and the old one keeps being served.

1. Run every `executable` entry against a category sample and record a `measured_discrimination` in
   the 1.2 shape — interval, `n_asked` *and* `n_adjudicated`, `target_band`, `decision_rule`, and the
   `sample` provenance. The rate is computed over ADJUDICATED rows; counting rows the engine could
   not decide as failures silently changes the answer.
2. Re-derive every `not_discriminating` tier from its measurement. An entry whose verdict is
   `discriminating` or `indeterminate` **goes back to `executable`** — a `strengthened` change,
   no attestation needed. An entry with **no measurement at all** cannot stay `not_discriminating`,
   and if it has no `binding` either it cannot become `executable`: see §9.4.
3. Replace each `predicted_discrimination` with a `discrimination_prediction`, **preserving the
   reasoning text verbatim and discarding the band**, with `direction: "no_prediction"`. Do not
   translate the band into a direction: the band was the part that was wrong, and a direction derived
   from it inherits the error.
4. Rename `measured_fitness` to `category_fitness` and fill the fields the new shape adds — sample
   provenance, the audit discipline flags, all three bounds, a completion state, and stated limits.
   The schema forbids carrying both names.
5. Set `grammar_version` to `"1.2"`, bump the standard's own `version`, set `supersedes` on every
   entry so prior citations resolve, and write the changelog — including a `demoted` change with a
   `weakening_attestation` for any entry being retired.
6. Rehash (`node --import tsx standards/rehash.ts --write`).

⚠️ **Step 2 is where a real document stops being mechanical.** In `ALS-COFFEE 1.1` five entries are
`not_discriminating` — `PRICE-001`, `STOCK-001`, `TERMS-001`, `DECAF-004`, `DIET-001` — and **none of
them carries a measurement, and none carries a `binding`.** They were never run, so there is nothing
to re-derive them from, and nothing to return them *to*.

### 9.4 `unbound` — the tier the correction forced

Correcting the `not_discriminating` rule left those five entries with nowhere honest to go, and that
is a finding rather than a nuisance: `not_discriminating` had been the parking place for questions
nobody had built yet, and removing that use exposed that **the grammar had no name for the state they
were actually in.**

The two remaining tiers each state something **false** about at least three of them:

- **`advisory`** means *public data cannot adjudicate it*. False for `PRICE-001` (a price is on every
  product page), `STOCK-001` (`in_stock` is a live engine kind), `DIET-001` (`vegan` and
  `gluten_free` are both live claim keys).
- **`blocked`** means *the engine cannot yet*, and its `blocked_by` must cite a `G-NN` gap. False for
  `STOCK-001`, `TERMS-001` (`no_subscription` exists, and its own reasoning names the absence-based
  inference that kind produces), `DIET-001` (`claim`).

So grammar 1.2 adds **`unbound`**: *the engine can run this kind, public data can adjudicate it, and
this standard has not authored a binding or put the assertion through the adversarial pass.* The
obstacle is neither the evidence nor the code — it is unwritten work in this document.

- `unbound_reason` is **required**, and must name the engine `ReqKind` that fits. Naming the kind is
  what distinguishes `unbound` from `blocked`; saying the adversarial pass has not happened is what
  stops it being read as executable-in-waiting.
- A `binding` is **forbidden** — an entry that has one is either `executable` or is claiming to run
  something it does not.
- A `measured_discrimination` is **forbidden**, and that is the harder half: a fail rate can only be
  produced by *running* the entry, so a measurement on an unbound entry records a run the document
  says never happened.

It is a **1.2-only tier**, excluded from the 1.0/1.1 tier vocabulary by the version gate, because a
reader of an earlier version has no definition for it and a tier a reader cannot resolve is worse
than the wrong tier.

**`unbound` adds no matcher, no category and no executable entry.** It is the honest name for a state
the document is already in. Without it, correcting the retirement rule would force a false sentence
into a published document — and where a kind genuinely does not exist (`PRICE-001` needs a
`price_is_stated` the engine has no equivalent of; `DECAF-004` adjudicates a *different* product),
the entry says so in `unbound_reason` and the gap is filed in
[`ENGINE_GAPS.md`](ENGINE_GAPS.md) as a proposal, rather than a binding being invented here to make
the tier fit.

