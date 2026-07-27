# ENGINE GAPS — the specification for a future engine session

Every place the coffee standard needs something the engine cannot do. This is a first-class
deliverable, not an appendix: **a standard whose assertions the engine cannot execute is a
document**, so the honest half of authoring a standard is writing down precisely what is missing.

Each gap states: the assertions it blocks, why the current mechanism is insufficient, what would be
required, and **the risk of building it** — especially against the 31 defects pinned open in
`test/adversarialCorpus.test.ts`. Be sceptical of every "this is easy" instinct here; three of
these gaps have already been attempted in some form and reverted.

Read alongside [`ENGINE_CONTRACT.md`](ENGINE_CONTRACT.md), which is where the current capability is
recorded. Line references are to commit `96ceacd`.

**Priority, if a future session can only do some.** `G-09` first, because without it no standard can
be run against a public URL at all and every other gap is academic. Then `G-02` (roast date) as the
highest-value new assertion shape and the cheapest safe one. Then `G-04` (registry), which is the
genuinely empty market ground. `G-01` last, despite being commercially central, because it is the
one with a measured history of failing in both directions.

---

## G-01 — Provenance: country, region, farm, producer

**Blocks:** `ALS-COFFEE-1.0-PROV-001` (country of origin), `-PROV-002` (region), `-PROV-003`
(farm/producer/co-operative), `-PROV-004` (harvest year). All four are `blocked`, and provenance is
the most commercially central claim class in coffee.

**Why the current mechanism is insufficient: there is no mechanism.** The `origin` attribute was
**removed** in v2.8 CP2 (`src/server/productTest.ts:182-240`), and two structural tests in the
adversarial corpus assert it can never come back by accident — including one that runs the
`Coffee` category explicitly (`test/adversarialCorpus.test.ts:195-213`).

**Why it was removed matters more than that it was removed.** It was wrong in *both* directions on
real merchant copy:

| direction | example | cause |
|---|---|---|
| false pass | `"Made in Georgia pine."` | a wood read as a US state via the gazetteer |
| false fail | `"Made in the U.S.A."` | `splitSentences` cuts on the abbreviation's dots |
| false fail | `"Handcrafted in Nepal."`, `"Grown in Panama."`, `"Milled in Japan."` | the frame list did not carry these verbs |
| false fail | `"Made in Los Angeles."`, `"Made in Barcelona."` | the gazetteer held **no cities** |
| false fail | `"Origin — Italy"` | only `:` was accepted as a label separator |

And it carried little information even when right: a **0.91** production fail rate, 10 of the 11
stores that had the row.

### What would be required

**Not a third head-noun rule.** The engine's own instruction is explicit
(`CLAUDE.md`: *"Do not attempt a third head-noun rule"*), and the reasoning is measured rather than
stylistic: the two attempts differed only in which nouns they listed, and a third list has the same
failure mode as the first two.

The measured path back, from `experiments/v2-8/FITNESS.md` as summarised in the tombstone, separates
into two halves **of which only one did any work**:

- **The TERMINATOR rule** — a place name must be followed by a clause end or an allow-listed
  continuation. This **closed every false pass**.
- **The FRAME narrowing** — restricting which verbs count. This **closed none** and cost **32 of the
  33 lost positives**.

So: shipped frames **plus** the terminator rule projects to **73.0% recall at 100% specificity**.
⚠️ **That is a projection and has never been measured. It must be measured before it is believed** —
and the reason to insist on that is in the file's own history: v2.6 and v2.7 shipped three headline
changes, each measured as a success by its author, and each reverted after an independent adversarial
pass contradicted it.

Three cheap mechanical bugs to fix first, all pre-existing and all independent of the design
question:

1. **Protect dotted abbreviations before the clause split** — this alone fixes `"Made in the
   U.S.A."`, which is not a niche phrasing.
2. **The gazetteer holds no cities**, while `AMBIGUOUS_PLACE` listed `sydney`, `columbia`,
   `victoria`, `jersey` and `york` — **none of which were in `PLACES`**, so they were dead entries
   that could never fire. Coffee makes this acute: `"Grown in Huila"`, `"Yirgacheffe"`,
   `"Antigua"` are regions, not countries, and region is the level a specialty buyer actually asks
   about.
3. **Accept `-` and `—` as label separators**, not just `:`.

### Risk of building it

**High, and asymmetric.** Coffee provenance vocabulary is unusually hostile to a gazetteer:

- Region names collide with ordinary words and with other categories' vocabulary
  (`Antigua` is a Guatemalan region *and* a country; `Java` and `Sumatra` are islands, regions, and
  generic coffee-style words; `Kona` is a place and a legally contested label).
- Varietal names are place names (`Bourbon` is a variety, a US whiskey style, and a French island;
  `Geisha`/`Gesha` is a variety and an Ethiopian place).
- A blend legitimately names **several** origins in one sentence, so "a place is stated" is not the
  same question as "the origin of this coffee is stated" — and the second is what a buyer asked.

**The corpus collision:** any place matcher inherits every pinned aboutness gap, because the
comparative veto in `src/server/subject.ts:70` tolerates exactly one word between `most` and its
verb — so `"Most cheap versions are grown in Vietnam."` walks straight through, crediting a
competitor's origin to this product. That gap is pinned and open today.

**Recommendation:** do the three mechanical fixes, then **measure the terminator rule against a
coffee-specific natural-frequency corpus before writing any new frame logic.** If the measurement
does not reproduce ≥95% specificity on an independently-authored negative set, leave provenance
blocked. Losing one row of depth costs less than one false statement about a real store.

---

## G-02 — Date-valued assertions (`matches_format`)

**Blocks:** `ALS-COFFEE-1.0-FRESH-001` (roast date published), `-FRESH-002` (roast date is a real
date rather than a placeholder), `-FRESH-003` (best-before distinguished from roast date).

**This is the highest-value gap in the standard**, because roast date is the freshness signal
specialty buyers actually look for and stores rarely make machine-readable — which is exactly the
profile of a well-discriminating assertion.

**Why the current mechanism is insufficient.** There is no operator for "a stated value parses as a
date". The nearest thing is `attribute` with `requireDigit`, which asks only that *some* digit exists
in the sentence — the same weakness that let `"Available in 3 colors with a relaxed length"` pass as
a stated measurement (`src/server/productTest.ts:277-279`). A `claim`-style term list can find the
phrase `"roast date"` and cannot tell `"Roast date: 2026-07-14"` from `"Roast date: TBD"` or from
`"Ask us for the roast date"`.

### What would be required

A new `AttributeSpec` shape, or a fourth requirement kind, carrying:

1. a **term list** for the label (`roasted on`, `roast date`, `roasted:`);
2. a **format validator** on the value — the `valueGuard` hook already exists and is the right
   place; it just needs a date parser instead of a regex;
3. a **placeholder rejection** — and the engine already has the right function:
   `isPlaceholderIdentifier` (`src/server/productTest.ts:368`) was written for exactly this class
   and is pinned by 20 corpus cases. **Reuse it rather than writing a second one.**

### Risk of building it

**Moderate, and the risks are specific:**

- **Date ambiguity.** `03/04/2026` is two different dates depending on locale. A validator that
  guesses is worse than one that accepts only unambiguous forms (ISO, or a spelled month).
  Recommendation: accept only unambiguous forms and let the ambiguous ones be `not_proven` — the
  fail-closed direction.
- **The `12 fl. oz.` lesson.** `splitSentences` breaks after any `. ` and does not know
  abbreviations, which is a pinned open gap. `"Roasted on Jan. 14, 2026."` will be split into
  fragments and the date will be unreachable, exactly as `"This mug holds 12 fl. oz."` is today.
  **Do not fix this with abbreviation-aware splitting inside a date change** — that can merge
  genuinely separate sentences and is a false-pass risk of its own, and the corpus already records
  the decision not to attempt it inside an adjacency-only change.
- **A date is not freshness.** A roast date three months old is a *published* roast date. The
  assertion is evidence availability, and the standard's `pass_means` must say so — otherwise the
  first merchant to publish a stale date will be told they conform.
- **A relative statement is not a date.** `"Roasted to order"`, `"Ships within 48 hours of
  roasting"` are real, honest, and not dates. They belong in `insufficient_evidence` for the date
  assertion and arguably in a separate assertion of their own.

**Recommendation: build this first among the new-capability gaps.** It is bounded, it reuses two
existing hooks, and its failure mode is a false *fail*, which is recoverable.

---

## G-03 — Enumerated-value assertions (`equals_one_of`)

**Blocks:** `ALS-COFFEE-1.0-PROC-001` (processing method), `-ROAST-001` (roast level),
`-GRIND-002` (grind specified for a named brew method), `-DECAF-001` and `-DECAF-002`
(decaffeination method — see also G-06), `-VAR-001` (varietal).

**Why the current mechanism is insufficient.** `claim` answers *"is term X present?"*. These
questions are *"which of a defined set of values is stated?"* — a different shape. Encoding them as
`claim` rows would need one closed dictionary key per value (`washed`, `natural`, `honey`,
`anaerobic`, …), which means one row per value in the merchant's table and a label collision as soon
as two entries share a key. It also cannot express the thing that makes the assertion useful: that
the stated value belongs to a **named, defined vocabulary** rather than being any adjacent word.

### What would be required

A requirement kind carrying `{ vocabulary: string[], synonyms: Record<string, string[]>, label }`
that reports **which** member matched, not merely that one did. Two properties are essential:

- **the matched member must be returned**, so the standard can state what was found and the merchant
  can see it;
- **near-synonyms must be excludable per-vocabulary**, which is where the standard's
  `insufficient_evidence` becomes executable rather than advisory.

### Risk of building it

**Moderate-to-high, and the risk is the vocabulary, not the code.**

- **The vocabularies are not all real.** *Processing method* has documented trade definitions;
  *roast level* is largely vendor-defined (one roaster's "medium" is another's "medium-dark") and
  an instrumented measure exists but is almost never published. **A vocabulary assertion over a
  vendor-defined vocabulary tests nothing** — it would report that a store stated a word, which the
  standard's own `pass_means` would then have to disclaim into meaninglessness. Recommendation:
  build the mechanism, then apply it **only** to vocabularies with an external definition, and keep
  the rest advisory.
- **Longest-match-first interacts badly with nested members.** `honey` is inside `honey process`;
  `natural` is inside `natural decaf`, which means something completely different. The engine's
  ordering rule (`src/server/testEvidence.ts:272`) handles this correctly *if* the vocabulary is
  authored with the compound forms present — and silently wrongly if not.
- **Tasting-note collision, which is the specific trap for coffee.** `"Notes of honey and stone
  fruit"` states a *flavour*, not a *process*. `"Natural sweetness"` is not the natural process.
  `"Washed with bright acidity"` — the word `washed` in a sentence about mouthfeel. These are the
  commonest sentences on a specialty coffee page, and a bare vocabulary match reads every one of
  them as a process statement. **This is the single highest-yield attack on this gap and it must be
  in the corpus before the feature ships.**

---

## G-04 — External register resolution (`resolves_against_register`)

**Blocks:** `ALS-COFFEE-1.0-CERT-003` (the organic claim resolves against the certifier's register),
`-CERT-004` (the fair-trade claim resolves), `-CERT-005` (a named certifier is verifiable). Also the
upgrade path for the two *executable* certification entries, which today can only establish that a
page **states** a claim.

**This is the genuinely empty ground.** Registry resolution is what upgrades a finding from *"the
page says so, cited"* to *"an independent register confirms"*, and as far as this session could
establish, nobody in this market performs the lookup. It is also the gap with the most external
dependency and the most ways to overclaim.

**Why the current mechanism is insufficient: there is no network client for anything but a product
page.** The crawler (`src/crawler/fetch.ts`) is SSRF-hardened, DNS-pinned, byte-capped and
robots-respecting — it is the right transport — but there is no register adapter, no cache, no
result model, and no notion in `Assertion` of *"confirmed by a third party"*.

### What would be required

1. **A `RegisterAdapter` seam**, exactly parallel to `EngineAdapter` (`src/engines/types.ts`) and
   `NotificationProvider` (`src/notify/provider.ts`) — the codebase's established pattern for a
   pluggable external dependency. One adapter per register: `name`, `isConfigured()`,
   `lookup(key) → { found, holder, scope, status, asOf, sourceUrl }`.
2. **A fifth result state**, or an explicit qualifier on `pass_evidenced`. This is the hard design
   question and it should not be answered casually: the four current states are all statements about
   *our* evidence access, and "an external register confirms" is a statement about *someone else's*
   record. Folding it into `pass_evidenced` loses the distinction that makes it valuable.
3. **A resolution-level field on the result.** A register that resolves to a *company* cannot verify
   a specific bag. This must be structural, not prose, because it is the most likely overclaim.
4. **Caching and staleness.** A register answer has an `asOf`. A cached "confirmed" that is a year
   old is a different claim from a fresh one.
5. **A negative-result policy.** "Not found in the register" must **never** render as "this claim is
   false". A roaster can legitimately sell certified coffee without holding a certificate itself —
   the certificate may be held by the importer or the co-operative. Rendering absence as falsity
   would be the worst false statement the product could make about a store, and it is the
   easy mistake here.

### Risk of building it

**High, and the risks are mostly not technical:**

- **The lookup-key problem, which is close to fatal for the naive version.** A register is searched
  by an operation name or a certificate number. A product page carries a *brand* name. Those are
  frequently not the same string, and matching them is fuzzy entity resolution — which is a source
  of false positives, not a lookup. **Any register assertion that silently fuzzy-matches a brand to
  a certificate holder has invented its evidence.** Recommendation: require the page to publish the
  certifier name or certificate number, and treat its absence as `not_proven` on the *page*, not as
  a failed lookup.
- **Resolution level.** See above. Most relevant registers resolve to an operation or a company, not
  a product.
- **Availability and terms.** A register can rate-limit, change its schema, go offline, or forbid
  automated access. A conformance result that silently degrades when a register is unreachable
  reintroduces exactly the `not_proven`-versus-`requires_store_access` confusion the engine works
  hard to avoid — so an unreachable register must produce its own honest state, never a failure.
- **Legal care.** Asserting that a claim is *unverified* about a named business is a different act
  from asserting that a page does not state something. The standard's existing discipline —
  evidence availability, never product truth — is also the safe legal boundary, and a register
  feature is where a future session is most likely to cross it.

**Recommendation:** build the adapter seam and the result model **before** any specific register, and
ship the first adapter in a mode that only ever *confirms* — never contradicts. The asymmetry is the
same one `pass_no_blocking` already encodes: presence of evidence is a stronger claim than absence.

---

## G-05 — Derived assertions across two stated values (`derived_from`)

**Blocks:** `ALS-COFFEE-1.0-PRICE-002` (price per unit weight is derivable from public data).

**Why the current mechanism is insufficient.** `price_under` compares one readable number to a
constant. Price-per-unit-weight needs **two** stated values from **two different surfaces** (the
variant price, and the net weight from product text) combined arithmetically. No requirement kind
takes two inputs, and `evaluate` is a pure per-requirement function with no cross-requirement
channel.

### What would be required

A requirement kind that names its inputs by other requirement ids and a combining rule, plus an
evaluation order. The natural shape is a small dependency graph over already-evaluated assertions —
which is a real change to `evaluate`'s contract, currently one requirement in, one assertion out.

### Risk of building it

**Low technically, moderate in honesty terms:**

- **A derived value inherits every weakness of its inputs.** Net weight is read from prose by a
  matcher with pinned open gaps around usage quantity and shipment weight. A price-per-ounce
  computed from a brew ratio is a confidently wrong number, and a number reads as more authoritative
  than a sentence.
- **The linter blocks the obvious phrasing.** `(does not state|doesn't state|missing|no evidence
  of)[^.]{0,30}\b(price|cost)\b` (`src/server/claimLinter.ts:44`) rules out "missing price per unit"
  and similar. Any label and detail for this row must be worded around that rule, and the rule
  exists for a good reason — price *is* always public — so it should not be relaxed.
- **It may not be a real buyer question in the form it is easiest to build.** Unit pricing is a
  documented shopper behaviour; whether a shopper wants the *store* to publish it, or simply wants
  the two inputs so they can divide, is a different question. Check the grounding before building.

**Recommendation:** low priority. The two inputs being separately readable is most of the value, and
both already have entries.

---

## G-06 — The claim dictionary is closed, and cannot be extended by a standard

**Blocks:** every category-specific claim that is not one of thirteen hardcoded keys. For coffee
specifically: `-DECAF-001` (decaffeination method), `-DECAF-003` (`chemical-free` is explicitly
insufficient), `-PROC-001`, `-ROAST-001`, `-VAR-001`, `-ELEV-001`.

**Why the current mechanism is insufficient.** `CLAIM_TERMS` is a module-level `const` with **no
`export`** (`src/server/productTest.ts:47`), and `ATTRIBUTE_SPECS` likewise (`:243`). Adding a claim
means editing engine source. There is no registration API, no configuration, and no way for a
standard to supply its own vocabulary.

**The consequence for this standard, stated plainly:** the binding constraint on how many coffee
questions are executable is **not the research and not public data — it is the size of two
hardcoded dictionaries.** Of the three claim keys coffee can use, `single_origin`, `organic` and
`fair_trade`, none was chosen for coffee: they happen to exist. Every genuinely
coffee-specific claim class is blocked here.

### What would be required

Either:

- **(a) export the dictionaries and accept a `claimVocabulary` override in `RunOptions`** — small,
  and immediately dangerous, because a supplied term list bypasses every review the built-in lists
  received. If this path is taken, the vocabulary must pass through the same adversarial corpus gate
  before it can be used, and the standard's `insufficient_evidence` becomes the negative test set.
- **(b) a registry keyed by standard id**, so a vocabulary ships *with* a versioned standard and is
  reviewed *as* a standard. Slower, and it is the correct shape: it makes the vocabulary a published
  artifact rather than a runtime argument, and it puts the term list under the same changelog and
  never-weaken discipline as the assertion it serves.

### Risk of building it

**High if done as (a), because the term lists are the engine's most defect-dense surface.** The
measured history is not encouraging about hand-written vocabularies: `gluten_free` had a violating
term that was a substring of its own supporting term and told compliant stores they stated the
opposite; `organic` matched inside `inorganic`; `no added fragrance` matched its own violating term.
Every one of those was a *carefully reviewed* built-in list.

A decaffeination vocabulary would have all of the same hazards plus one that is worse: **the
marketing synonyms actively mislead.** `chemical-free`, `natural decaf`, `solvent-free` and
`water process` are what stores write, and they do not establish the specific licensed process a
buyer asked about. So a decaf vocabulary must be built with its `insufficient_evidence` set *first*
and treated as a negative test suite, not as documentation. That is the strongest argument for
option (b).

---

## G-07 — The `identifiers` row is broken in the authenticated path

**Blocks:** nothing in the standard's *public* tier — `ALS-COFFEE-1.0-IDENT-001` is executable and
works publicly. It breaks that entry the moment a merchant connects their store, which is worse
than a gap: it is a **regression triggered by the merchant doing what the product asked**.

**The mechanism.** `snapshotFromCatalog` sets `extracted: null`
(`src/server/authenticatedTest.ts:129`). `evaluate`'s `identifiers` branch takes the `!p.extracted`
path (`src/server/productTest.ts:1251`) and returns `requires_store_access` — *for a store we have
access to*. And the data is present: `NormalizedVariant` carries `barcode` and `sku`
(`src/catalog/normalize.ts:8-9`).

So the row's own copy — "we couldn't read this product's page markup" — is shown to a merchant whose
barcode is sitting in the synced catalog, and `diffAssertions` will record the movement as
`unchanged` rather than `resolved`, so the install-argument metric quietly under-counts.

### What would be required

Populate a synthetic `extracted.product` in `snapshotFromCatalog` from the catalog's own identifier
fields — `barcode` → `gtin`, `sku` → `sku` — or add a variant-level branch to the `identifiers`
evaluation. Small, and it needs a decision on which variant's barcode represents the product when
they differ, which is a real question for coffee (a 12 oz bag and a 5 lb bag are different GTINs).

### Risk of building it

**Low, with one caveat worth stating.** `isPlaceholderIdentifier` and the GTIN check-digit validation
must apply to the catalog values exactly as they do to JSON-LD values — the whole point of those
guards is that a merchant filling a required field with `N/A` is the normal case, and an Admin API
value is no more trustworthy than a JSON-LD one. Reuse, do not reimplement.

---

## G-08 — Two requirement kinds can block a merchant's entire report

**Blocks:** nothing directly. It is a **latent hazard the standard cannot design around**, and it is
recorded here because a coffee store is unusually likely to trigger it.

**The mechanism.** The claim linter runs over `evidenceQuote`, and one violation returns the whole
result as `errorKind: "unreachable"` (`src/server/productTest.ts:1560-1571`). `claim` and
`attribute` rows defend against this by pre-filtering their evidence with `lintStrings`
(`:1093`, `:1205-1207`), so an unquotable sentence is skipped and the search continues.
**`delivery` (`:1284`) and `no_subscription` (`:1171`) read `p.evidence` directly, with no
pre-filter.**

So a store whose shipping policy says **"delivery guaranteed within 3 business days"** has its
entire report refused — a flatly false statement about a store the engine read perfectly well. This
is the identical failure class that got the `warranty` requirement dropped
(`src/server/productTest.ts:288-295`), still reachable through two other rows.

Coffee raises the odds: freshness and delivery-speed language is central to the category, and
"guaranteed fresh" / "delivery guaranteed" are ordinary phrasings.

### What would be required

Apply the same `lintStrings` pre-filter in the `delivery` and `no_subscription` branches. Four lines.
**Fail closed per row, never fail the whole report** — the rule is already written in the
`attribute` branch's comment and simply is not applied in these two.

### Risk of building it

**Very low.** The change makes a row `not_proven` where it currently destroys the report. The only
thing to check is that a *genuinely* unquotable delivery sentence still yields the honest
`not_proven` / `requires_store_access` split rather than a silent pass.

---

## G-09 — A standard cannot be executed against a public product URL at all

**Blocks: the entire standard, on the public path.** This is the gap that makes the others academic
and it should be built first.

**The mechanism.** `runProductTest(url, deps)` calls `buildBuyerTask(fetched)` unconditionally
(`src/server/productTest.ts:1461`) and `RunOptions` carries only `force` and `semantic`
(`:1426-1431`). There is **no way to supply a pinned set of requirements to the public test.** The
requirements are generated per product by a heuristic — `inferClaims` plus `SURFACE_PRIORITY` plus a
`MAX_REQUIREMENTS` cap of 10 — which is precisely the vendor's private rubric this standard exists
to replace.

**The asymmetry is the useful finding.** `runAuthenticatedTest` **already accepts a pinned
contract**: `requirements?: Requirement[]`, falling back to a generated one
(`src/server/authenticatedTest.ts:195-204`). So **a standard can be executed against a connected
store today, and cannot be executed against a public URL.** The pure evaluator is shared, so this is
a plumbing gap, not a design gap.

### What would be required

1. `RunOptions.requirements?: Requirement[]` on the public path, threaded to replace
   `buildBuyerTask`'s output while keeping its `summary` generation (which is linted and must
   stay).
2. A **standard identity on the result** — `standardId`, `standardVersion`, `standardHash` — so a
   conformance result says which text it was tested against. Without this a result is not citable
   and the whole standards position is decorative.
3. `MAX_REQUIREMENTS = 10` (`:966`) is a table-length cap for a generated task. A standard has more
   entries than that. The cap should apply to *rendering*, not to *evaluation*.
4. The delivery-policy fetch is triggered by `requirements.some(r => r.kind === "delivery")`
   (`:1465`) and would keep working unchanged — worth confirming rather than assuming.

### Risk of building it

**Low, with two things to get right:**

- **`contractVersion` must cover the standard identity**, or two runs under different standard
  versions will compare as though they asked the same question. The existing fingerprint covers
  requirement fields only (`:858-875`), and it was deliberately built so that pre-v2.3 contracts
  hash unchanged — so widening it is a decision with a documented precedent to respect.
- **The `requires_store_access` collapse.** At most one such row appears in the table and the rest
  move to `deferred` (`:1481-1486`). That is right for a generated 10-row task and probably wrong
  for a standard, where a reader wants the full conformance list. This is a rendering decision, not
  an evaluation one, and it should be made deliberately rather than inherited.

---

## G-10 — A standard cannot gate its own applicability

**Blocks:** `ALS-COFFEE-1.0-DECAF-*` (must not fire on caffeinated coffee), `-POD-001` (must fire
only on pods and capsules), and the correctness of *every* entry's `applicability` field.

**The mechanism.** Applicability is decided in the engine by `CATEGORY_CLAIMS`
(`src/server/productTest.ts:72-79`) — a hardcoded regex-to-two-claims map — and by `AttributeSpec.onlyFor`
(`:311`). Both are engine-internal. A standard's `applicability` field is therefore **documentation
that nothing enforces**: if a compiled requirement list is handed to `evaluate`, every entry fires on
every product.

Note that `evaluate` does **not** consult `onlyFor` at all — only `buildBuyerTask` does (`:994`). So
binding `attribute: care` for a coffee product would be evaluated against laundry vocabulary and
return `not_proven` for every coffee store on earth: the exact `cruelty_free` failure, reintroduced
by the standard rather than by the engine.

### What would be required

An applicability predicate compiled from the standard and evaluated against the product snapshot
before the requirement list is built. It must use the **same** signal order the engine already uses —
`product_type` authoritative, `title` fallback, **never tags** (`:877-884`, and the reason is
recorded: a coffee-scented soap must not read as a coffee product).

For decaf specifically the honest answer may be that applicability is **undecidable from public
data** — "is this a decaf product" is itself one of the questions being asked. An entry whose
applicability depends on its own answer cannot be gated, and the standard should say so rather than
gate it wrongly. The grammar has a value for this: `applicability.signal:
"undecidable_from_public_data"`.

### Risk of building it

**Moderate, and the risk is silent no-ops.** `SURFACE_PRIORITY` already contains a documented
instance of exactly this failure: `attr:warranty` stayed in the priority list for three sessions
after the requirement it named stopped existing, because a priority entry matching no candidate is a
silent no-op (`:1020-1022`). An applicability predicate that matches nothing would suppress an entry
entirely and look identical to an entry that passed.

**Recommendation:** whatever the predicate mechanism, it must **report** which entries it excluded
and why, and a standard whose predicate excludes everything must be a loud error rather than an
empty conformance result. The `INCOMPLETE` state in `src/measure/completion.ts` is the right model.

---

## G-13 — An assertion cannot take a parameter supplied at test time

**Blocks:** `ALS-ACCESSORY-0.1-FIT-001` — *"Will this fit the exact model I own?"* — and, by
extension, **every compatibility assertion in every category**.

**Found by authoring the device-accessory draft, and it is the most valuable finding of that
exercise**, because it is a limitation of the *grammar* and the *engine* rather than of a category.

**The mechanism.** Every one of the engine's eight requirement kinds compares page evidence against a
value fixed when the contract is built: a claim key, an attribute key, a fixed `optionValue`, a
numeric cap. `evaluate(p, req)` has no channel for anything the *buyer* supplies. And a compatibility
question inverts the usual direction:

- an ordinary assertion asks *"does the page state X?"*, where X is authored into the standard;
- a compatibility assertion asks *"does the page's published list contain the buyer's model?"*, where
  the list is on the page and **the value comes from the buyer at test time**.

`variant_option` can express *one* model — `optionValue: "A-14"` — but a standard cannot enumerate
every model, and doing so would make the standard a device database with a version number.

### What was already changed in response

The **grammar** was revised, which is the cheap half: `schema.json` gained an
`includes_buyer_parameter` operator and a required `buyer_parameter` field, with a conditional
binding the two together, and the test suite asserts that an entry using the operator declares its
parameter and is never `executable`. The **engine** side is this gap.

### What would be required

1. A `Requirement` variant carrying a **list selector** (where on the page the compatible-model list
   is published) and a **parameter name**, plus a parameter value threaded through `RunOptions`.
2. A **result state for "the parameter was not supplied"**, distinct from a failure. A compatibility
   row run without a buyer model is not a failing row; it is an unasked question. Note this is the
   *third* place a fifth state is wanted — G-04 wants "an external register confirms", G-12 wants
   "ambiguous across offers", and this wants "not asked". **Answer the state-model question once for
   all three rather than three times.**
3. List extraction that survives the ways sellers actually publish a model list — comma-separated
   prose, a bulleted block, a table, a structured attribute — which is a parsing problem the engine
   has never had to solve, because every existing matcher looks for a *phrase* rather than a *set*.

### Risk of building it

**Moderate, and the risks are specific to set matching rather than to parameters:**

- **Substring collisions inside model names are systematic, not incidental.** Model designations
  nest — a shorter name is frequently a prefix of a longer one — so a naive containment test reports
  that a list covering only the larger model covers the smaller one. The engine's
  longest-match-first rule helps and does not solve it: the failure here is a *false positive on the
  wrong member*, which longest-match makes more likely rather than less.
- **A family name is not a set.** If extraction expands a family into its members, the assertion
  starts claiming coverage the seller never stated. If it does not, a genuine family-level claim
  fails. Neither is clearly right and the choice must be recorded rather than defaulted.
- **Absence must never render as incompatibility.** A model missing from a seller's list means the
  seller has not said, and rendering that as "does not fit" would be a false statement about a
  product rather than about a page — the one class of error this project treats as unrecoverable.

**Recommendation:** do not build this before G-09. A compatibility assertion is worthless until a
standard can be executed against a public URL at all, and the state-model question in point 2 should
be settled alongside G-04 and G-12 rather than in isolation.

---

## G-12 — Evidence cannot be resolved per purchasable offer

**Blocks:** `ALS-COFFEE-1.0-NETQ-001` (net weight resolved for the *selected* variant), and it is the
reason `ALS-COFFEE-1.0-WEIGHT-001` has to be labelled "a measurement is stated" rather than "the net
weight of what you are buying is stated".

**The mechanism.** `evaluate(p, req)` takes one `PublicProduct` covering the whole product and one
requirement. The evidence index is built once from product-level text (`productTest.ts:771-778`);
`minPriceUsd` is the **minimum across variants** (`:784`); and `optionValues` is a de-duplicated
**union** of every option (`:759`). Nothing in the snapshot associates a piece of text with a
particular offer.

For most categories this is a nuance. For coffee it is the single commonest false pass the research
identified: **a page titled `"Ethiopia Guji 12 oz"` that sells 12 oz, 2 lb and 5 lb bags states a mass
that is the net weight of exactly one of the three offers**, and `product_title` is a quotable
evidence surface, so the row passes on it. The same shape defeats format ("Whole Bean / Espresso /
Filter" asserts nothing about what ships), unit price (the large size's rate shown against a small
selection), and subscription pricing (an intro price shown where the go-forward price applies).

### What would be required

Per-offer evidence scoping: a variant-aware snapshot in which `accepted_evidence` can be resolved
against the offer under test, plus a notion of the **default selection** so "what will this buyer
receive" is answerable at all. Shopify's `.json` variant list has the option values, so the data
exists; the missing piece is that evidence text is not attributable to an offer.

### Risk of building it

**Moderate, and mostly about honesty rather than mechanics.** A per-variant run multiplies the row
count by the number of variants, which for a coffee product with 3 sizes × 4 grinds is 12 — a
conformance table nobody will read. The useful form is probably a single verdict qualified by *which
offer it was resolved against*, with an explicit `ambiguous_across_offers` outcome when a page-level
statement cannot be attributed. **An `ambiguous` verdict is the honest answer here and there is
currently no state for it** — the four existing states are all about *our access*, and this is about
the *page's* ambiguity. Same design question as G-04's fifth state, and worth answering once for both.

---

## G-11 — Sentence-scoped evidence cannot see facts the way stores write them

**Blocks:** partially degrades every text-based entry. Not fixable as a feature; recorded so a
future session does not mistake it for one.

Three pinned corpus limits with direct coffee consequences:

1. **Abbreviation splitting.** `splitSentences` breaks after any `. `, so `"12 fl. oz."` becomes
   three fragments and the unit loses its digit. Coffee weights are written this way constantly
   (`fl. oz.`, `lb.`, `Jan. 14`). Pinned open.
2. **Cross-sentence facts.** `"Our decaf is different. We use only water and pressure."` states a
   process across two sentences, and the matcher sees neither. Pinned open in the pronoun-subject
   case.
3. **Spec blocks are matchable but not quotable.** `presentableQuote` rejects symbol soup at 55%
   letter density (`src/server/testEvidence.ts:228-229`), which is correct — it is not a sentence —
   but coffee pages state origin, altitude, varietal and process in exactly that form. Such a row
   passes with no quote (`src/server/productTest.ts:1227-1229`), which is honest and weakens the
   evidence a reader gets.

**Why this is not a work item.** Fixing (1) means abbreviation-aware splitting, which can **merge
genuinely separate sentences** and is a false-pass risk of its own — the corpus records the explicit
decision not to attempt it inside an adjacency-only change. Fixing (2) means cross-sentence
coreference, which is a much larger change and would need the semantic tier, which **returns empty
with no API key and therefore cannot be measured by the offline acceptance gate at all**
(`src/server/subject.ts:24-27`). **A fix the gate cannot measure is not a fix.**

**Recommendation:** treat as a standing limitation. State it in the standard's own limits section,
and prefer assertions whose true phrasing fits one sentence. This is a real constraint on what a
standard should *contain*, not a to-do.
