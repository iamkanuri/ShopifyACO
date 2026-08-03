# ENGINE GAPS — the specification for a future engine session

Every place the coffee standard needs something the engine cannot do. This is a first-class
deliverable, not an appendix: **a standard whose assertions the engine cannot execute is a
document**, so the honest half of authoring a standard is writing down precisely what is missing.

Each gap states: the assertions it blocks, why the current mechanism is insufficient, what would be
required, and **the risk of building it** — especially against the **57** defects pinned open in
`test/adversarialCorpus.test.ts`. Be sceptical of every "this is easy" instinct here; three of
these gaps have already been attempted in some form and reverted.

> ⚠️ **That number was `36` until v3.5 and it is worth knowing why it moved**, because reading it as
> "the engine got worse" is exactly backwards. `+2` at CP2b: identifier defects had **no field to be
> recorded in** until CP2a added one, which is how a whole class (v3.2 CP3's 18 false passes) sat
> inside a corpus reporting 36. `+4` at CP2c: recall gaps deliberately reinstated when the CP2a GTIN
> widening was reverted. `+13` net at CP2d: the residuals an independent adversarial pass measured
> against rule D, minus one entry whose `correct` field turned out to be the thing that was wrong.
> `+1` at CP2e: the shape that only a four-tree re-run could show — the recall gap intersecting
> rule D (P-06). `+1` at CP3: the six named real merchants below, whose GTIN sits on a Product node
> the extractor does not select — **+1 case, 0 new defects**, and a shape the corpus could not
> express at all until it was written. **A class nobody can count is not progress.**

Read alongside [`ENGINE_CONTRACT.md`](ENGINE_CONTRACT.md), which is where the current capability is
recorded. **Line references are to commit `9843cb6`** (`main`, == production `/healthz`), verified by
execution at v3.4 CP-2 — see the re-pin notice at the top of `ENGINE_CONTRACT.md` for the method and
what it caught. Historical references to `96ceacd` and `989b33d` are kept only where the *change*
between them is the point.

---

## ⚠️ READ THIS FIRST — five gaps have CLOSED, and this file used to open by telling you otherwise

This document's opening instruction was: **build G-09 first, "because without it no standard can be
run against a public URL at all and every other gap is academic."** That was true when it was
written. It has been false since `0faac0d`, and it was the first thing a standards author read.

**A stale priority list is worse than no priority list**, because it spends the one thing it is
supposed to save. An author following it would have started by building a feature that already
exists — and the reason it survived is the reason a line number survives: nothing about a closed gap
looks different from an open one until someone executes against the code.

| gap | status | closed by | what changed |
|---|---|---|---|
| **G-09** — a standard cannot run against a public URL | 🟢 **CLOSED** | `0faac0d` | `RunOptions.requirements` + `RunOptions.standard`; identity folded into `contractVersion` as `c1s-…`; `MAX_REQUIREMENTS` scoped to generation; the `requires_store_access` collapse disabled for a pinned run; pinned runs bypass the cache in both directions |
| **G-10** — a standard cannot gate its own applicability | 🟢 **CLOSED** | `be14e37` | `standards/applicability.ts` + a per-standard sidecar; every exclusion reported with a reason; excluding everything is a loud error with `includedCount: null` |
| **G-08** — two kinds can block a merchant's entire report | 🟢 **CLOSED** | `5931b6a` (lint pre-filter) · `cd8b5ec` (`wholeWord`) | both halves; `no_subscription`'s half was already closed by v2.9 before the gap was written |
| **G-06 §2** — a missing vocabulary fails HARD, not closed | 🟢 **CLOSED** | `d35b26e` | `unsupportedRow` on both the claim and attribute branches, plus a ninth `ReqKind` so a row that cannot be re-asked is reported rather than dropped |
| **G-07** — `identifiers` broken in the authenticated path | 🟡 **PLUMBING CLOSED, GAP REDEFINED** | `0faac0d` | `extractedFromCatalog` populates `gtin`/`sku`. The entry now records a **different and worse** defect in the same row — see G-07 |
| **G-06 §1, §3, §4** — the claim dictionary is closed | 🔴 **OPEN** | — | no registry, no `acceptedSurfaces`, `normalize` still does not strip `®`/`™` |
| G-01 · G-02 · G-03 · G-04 · G-05 · G-11 · G-12 · G-13 · G-14 | 🔴 **OPEN** | — | unchanged |
| **G-15** — REFERENT: the term's governing NP does not denote this product | 🔴 **OPEN, MEASURED, SCOPED ONLY** | — | **NEW at v3.7 CP-4.** The residual G-06's own conclusion named as staying open, now carrying a number: 17 false passes in 71 live claim rows, REF hostile 17/17 and the sole hostile dimension in 14. Filed as a gap, with no design, because its acceptance suite tests the wrong sentences |

**A closed gap's record is NOT deleted.** Its argument is the material for the next one: G-09's
"the pure evaluator is shared, so this is plumbing, not design" is exactly the diagnosis that made
it cheap, and G-10's "a predicate that excludes everything must be a loud error" is a rule the next
predicate will need. Each closed section keeps its full text with a closure notice on top.

### The priority list that replaces it

1. **`G-06` §1 + §3 together — the vocabulary registry and surface scoping.** Now the top item.
   It is the binding constraint on how much of *any* category is executable, and §3 is what makes a
   standard's `accepted_evidence` real rather than prose. **Do not ship §1 without §3**: a registry
   without surface scoping delivers a vocabulary whose stated evidence rules the engine ignores, and
   `product_title` / `product_options` are merchant-controlled strings.
   ⚠️ And read G-06's measured conclusion before starting: **closing the dictionary is NECESSARY AND
   NOT SUFFICIENT.** Every attack class about the *term* closes; every class about the *subject*
   stays open, and no term list can supply tense, modality or attribution.
2. **`G-02` (date-valued assertions)** — the cheapest safe new assertion shape, reusing two hooks
   that already exist, and its failure mode is a false *fail*, which is recoverable.
3. **`G-04` (external registers)** — the genuinely empty market ground, and the most ways to
   overclaim. Build the adapter seam and the result model before any specific register.
4. **`G-01` (provenance)** last, despite being commercially central: it is the one with a measured
   history of failing in **both** directions, and its removal is a tombstone the repo tells you not
   to reopen with a third head-noun rule.

`G-14` is not on this list because it is not a build — it is a measurement campaign, and it must be
scheduled rather than squeezed in. See its own trigger.

`G-15` is not on this list either, and for a different reason: it is the largest measured live defect
class in the engine and it is still **not** the next thing to build. Its precondition — an acceptance
suite whose cases are the sentences merchants actually write — is an attended session on its own, and
that session must not be the one that writes the guard. See G-15's own precondition section.

> **G-14 is not like the others.** Every gap G-01 to G-13 is a capability the engine lacks. G-14 is a
> **measurement** the engine has never had: the thirteen claim keys that run for every merchant today
> have never been attacked systematically, and both defects known in them were found by accident. It
> is written as a campaign specification rather than a session's work, and its trigger is explicit —
> **it must run against the shipped engine, not a pinned worktree.**

---

## 📌 OWNERSHIP, and the STANDING PROPOSAL REGISTER

**This file is owned by the main session as of v3.4.** It was previously maintained by whichever
standards session last touched it, which is how its opening instruction went twelve commits stale
without anyone being wrong to leave it alone.

**The rule it now carries, and the reason this file exists in the shape it does:**

> **Where work implies a change elsewhere, write it down as a proposal rather than make it.**

An agent that fixes what it notices produces a diff nobody scoped, in files someone else owns,
justified by reasoning that is not in the record. A proposal costs one table row and survives the
session. This applies to engine source, to published standards, and to this document.

**Proposals are DATA, not decisions.** A row here has not been agreed to by the owner of the file it
names, and nothing may cite it as though it had. The register is at the bottom of this document
under **"Standing proposal register"**; every row names the file, the change, the argument, and who
owns the decision.

⚠️ **A proposal against a PUBLISHED artifact is subject to the sidecar rule.** `standard_hash` covers
`standard.json`'s bytes and a citation resolves through it, so a proposal that would edit a shipped
standard must say whether it is a **reissue** (new version, prior ids resolving via `supersedes`) or
a **sidecar** — never an in-place edit. Getting this wrong invalidates every citation made against
the version.

---

## G-01 — Provenance: country, region, farm, producer

**Blocks:** `ALS-COFFEE-1.0-PROV-001` (country of origin), `-PROV-002` (region), `-PROV-003`
(farm/producer/co-operative), `-PROV-004` (harvest year). All four are `blocked`, and provenance is
the most commercially central claim class in coffee.

**Why the current mechanism is insufficient: there is no mechanism.** The `origin` attribute was
**removed** in v2.8 CP2 (`src/server/productTest.ts:306-364`), and two structural tests in the
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
a stated measurement (`src/server/productTest.ts:571-573`). A `claim`-style term list can find the
phrase `"roast date"` and cannot tell `"Roast date: 2026-07-14"` from `"Roast date: TBD"` or from
`"Ask us for the roast date"`.

### What would be required

A new `AttributeSpec` shape, or a fourth requirement kind, carrying:

1. a **term list** for the label (`roasted on`, `roast date`, `roasted:`);
2. a **format validator** on the value — the `valueGuard` hook already exists and is the right
   place; it just needs a date parser instead of a regex;
3. a **placeholder rejection** — and the engine already has the right function:
   `isPlaceholderIdentifier` (`src/server/productTest.ts:684`) was written for exactly this class
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
  ordering rule (`src/server/testEvidence.ts:331`) handles this correctly *if* the vocabulary is
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
`export`** (`src/server/productTest.ts:47`), and `ATTRIBUTE_SPECS` likewise (`productTest.ts:537`). Adding a claim
means editing engine source. There is no registration API, no configuration, and no way for a
standard to supply its own vocabulary.

**The consequence for this standard, stated plainly:** the binding constraint on how many coffee
questions are executable is **not the research and not public data — it is the size of two
hardcoded dictionaries.** Of the three claim keys coffee can use, `single_origin`, `organic` and
`fair_trade`, none was chosen for coffee: they happen to exist. Every genuinely
coffee-specific claim class is blocked here.

### ⚠️ Corrections to the paragraphs above, all measured

Three statements in the framing above are wrong and one is materially incomplete. They are corrected
here rather than edited away, because the errors are instructive.

1. **`-DECAF-003` is not the `chemical-free` entry — `-DECAF-002` is.** `-DECAF-003` is *residual
   caffeine*, a `matches_format` quantity question. **A vocabulary does nothing for it.**
2. **The `gluten_free` failure was not a term-list substring collision.** There is no supporting term
   `contains gluten-free`; the support list is `["gluten-free", "gluten free", "no gluten"]`. The
   real geometry is a violating term overlapping a supporting one *in the same sentence*, which a
   rule phrased as "no violating term may be a substring of a supporting term" would not have caught.
3. **`organic`/`inorganic` is fixed, not live.** The claim branch passes `{ wholeWord: true }`
   explicitly (`productTest.ts:1676`). Measured: `"Made with inorganic pigments."` → `not_proven`.
4. **The hazard is not only false passes.** For a coffee vocabulary the measured *dominant* failure
   is a false **fail**, inherited from gates a vocabulary cannot influence: `CONTEXT_VETO`'s
   subscription-widget and related-product regexes, and the claim linter's pre-filter. Measured:
   `"Swiss Water Process decaf, delivered every 2 weeks."` → `not_proven`.

Full derivation: [`VOCABULARY_MECHANISM.md`](VOCABULARY_MECHANISM.md).

### The decision: (b). And (a) is not the cheap option — it may not be implementable at all.

G-06 offered (a) *"export the dictionaries and accept a `claimVocabulary` override in `RunOptions`"*
as the small-and-dangerous path. **`RunOptions` cannot reach the matcher.** `evaluate(p, req)` is a
two-argument pure function with no dependency channel, called from two modules that do not share a
`RunOptions` value — the public path, and `runAuthenticatedTest` (`authenticatedTest.ts:313`), whose
signature has no `RunOptions` at all. Delivering a vocabulary to `evaluate` under (a) therefore means
either a third parameter on a pure function called from two places, or a **module-level mutable
registry** — and a module-level mutable registry with per-request contents is a cross-tenant leak in
a multi-shop server.

**And the strongest argument for (b) is one measurement.** This vocabulary is entirely
reasonable-looking, and it is what an unreviewed author writes:

```
support:   ["free of solvents", "free from solvents", "without solvents", "no solvents"]
violating: ["solvents"]
```

Run through the real matcher:

```
"Free of solvents."                  -> "Your public copy states the opposite of this requirement."
"This decaf is free of solvents."    -> "Your public copy states the opposite of this requirement."
"Made without solvents."             -> PASS
```

`free of` and `free from` are not in the engine's closed negator list; `without` and `no` are. Under
(a) that reaches a merchant. Under (b) rule V1 rejects it at authoring time and names the pair.

> **The same defect is live in a shipped built-in list today.** `cruelty_free` has violating
> `tested on animals` suffix-aligned inside supporting `not tested on animals`, and the real
> `evaluate` returns *"Your public copy states the opposite of this requirement"*, quoting
> `"Tested on animals: never."` as the proof. Careful review did not catch it; execution did.

### 🟢 A live defect this gap already caused — FIXED in `d35b26e`, both causes

> This section was the top of the priority list ("four lines, closes a live crash"). Both of the two
> independent causes it identified were fixed, and the fix went further than "four lines" in one
> useful way: the engine gained a **ninth `ReqKind`**, `unsupported`, so a row that cannot be
> reconstructed is *reported* rather than dropped — "a contract that quietly loses a row the merchant
> already saw is the same class of dishonesty as a conformance list that drops entries."
>
> | cause this section named | fix at `9843cb6` |
> |---|---|
> | `contractFromPublicResult` discards the requirement KIND and falls through to `claim` | `requirementFromLabel` reconstructs the kind; an unreconstructable label becomes `kind: "unsupported"` carrying an `unsupportedReason` |
> | `CLAIM_TERMS[req.claim!]!` fails **hard** instead of **closed** | the `!` is gone; `if (!fx) return unsupportedRow(…)` (`src/server/productTest.ts:1635`). The attribute branch's `throw` became the same call (`productTest.ts:1788`) |
>
> `unsupportedRow` (`productTest.ts:1608`) returns `requires_store_access` with copy that names the limitation as
> **ours** — *"That's a limitation on our side, not a finding about your store"* — and logs. The row
> is reported as unchecked rather than as a result, which is the `not_proven` / `requires_store_access`
> distinction the whole product turns on.
>
> ⚠️ **`compileStandard` must still refuse an unknown key at compile time, and does.** The runtime
> path is a backstop. A conformance list that answers "we couldn't check this" for an entry the
> standard publishes is the failure G-10 exists to prevent, one layer down.
>
> 📋 **Proposal (see the register at the bottom): `standards/compile.ts:141`'s thrown message still
> says the engine "would throw, not fail the row".** That is now false. It is user-visible output,
> i.e. logic, so it was not edited by the documentation pass that found it.

**The mechanism, as it was. Verified by execution, not inference.** `contractFromPublicResult`
(`src/server/buyerTests.ts:142`)
rebuilds a pinned contract from a *rendered* public result, which stores assertion **labels** rather
than `Requirement` objects. It recognises price, option, stock, subscription and delivery labels by
regex and **falls through to `claim` for everything else**, minting a key with `claimKeyFromLabel`:

| rendered label | reconstructed as | `evaluate` |
|---|---|---|
| `Materials are stated` | `claim`, key `materials_are_stated` | **TypeError: Cannot read properties of undefined (reading 'violating')** |
| `Measurements are stated` | `claim`, key `measurements_are_stated` | **TypeError** |
| `Care or use instructions are stated` | `claim`, key `care_or_use_instructions_are_stated` | **TypeError** |

`runAuthenticatedTest` evaluates with a bare `requirements.map((r) => evaluate(snapshot, r))` and
**no try/catch**, so the exception propagates out of the run. Three of the engine's own attribute
labels are among the commonest rows there are. **A merchant who imports a public buyer test whose
table contained a materials or measurements row has pinned a contract that throws when re-run.**

Two independent causes, and the registry work touches both: `contractFromPublicResult` discards the
requirement *kind*, and `CLAIM_TERMS[req.claim!]!` fails **hard** instead of failing **closed**.
This is not a standards problem and it should be fixed regardless of whether the registry is built.

### Half the work already exists: the semantic tier is vocabulary-agnostic

`judgeClaims` (`src/server/semanticTier.ts:109`) takes `attributes: Array<{ key, label }>` as an
**argument**, builds its allow-list from that argument, and **never consults `CLAIM_TERMS`**. Only
the **lexical** half is closed. The ask is therefore narrower than it looks: hand the lexical matcher
the two term lists the semantic tier already accepts as data.

⚠️ Standing caveat: `judgeClaims` returns empty with no API key, so anything routed through the
semantic tier **cannot be measured by the offline acceptance gate**. The vocabulary format is
deliberately lexical-only for that reason.

---

### What to build — the specification

The format is authored and proven: [`VOCABULARY.md`](VOCABULARY.md) (human),
`schema.json` `$defs/vocabulary` (machine), [`vocabulary.ts`](vocabulary.ts) (the executed rules),
[`VOCABULARY_REVIEW.md`](VOCABULARY_REVIEW.md) (the gate). Two worked artifacts exist under
`standards/coffee/v1.0/vocabulary/`. **Nothing below requires rediscovering any of it.**

#### 1. The registration seam

```ts
// src/server/claimVocabulary.ts  (new)
export interface ClaimVocabulary { support: readonly string[]; violating: readonly string[] }
export interface VocabularySource { resolve(key: string): ClaimVocabulary | null }
```

- `CLAIM_TERMS` becomes the **built-in source**, unchanged in content.
- A standard's compiled contract carries its vocabularies **by value**, resolved at compile time from
  the standard's own directory. Not a global mutable map: the requirement list is already per-run and
  per-tenant, and that is the only structure that is.
- Concretely: `Requirement` gains an optional `vocabulary?: ClaimVocabulary`, and the claim branch
  reads `req.vocabulary ?? CLAIM_TERMS[req.claim!]`. **No signature change to `evaluate`, no new
  parameter, no module state, no cross-tenant surface.** This is the whole engine change and it is
  small — which it only is because the resolution happens in `compileStandard`, outside the engine.

> ⚠️ **Set `wholeWord` explicitly on every path that forwards a vocabulary.** `findSupport`'s default
> is **`false`** (`opts.wholeWord === true`, `testEvidence.ts:358`) while `findViolation`'s is
> **`true`** — the two functions default in opposite directions and the unsafe one is the default on
> the function that produces a pass. Measured: `findSupport(ev("Made with inorganic mineral
> pigments."), ["organic"])` returns `organic`. The claim branch is safe only because it passes the
> flag explicitly. `findTimingSupport` does not, and that is a live false pass (see G-08). A registry
> that forwards a vocabulary without the flag silently reinstates the `organic`/`inorganic` defect
> this gap cites as history.

#### 2. Fail closed, never hard — 🟢 **ALREADY BUILT** (`d35b26e`)

This sub-section is **done**, ahead of the registry it was specified for. The shipped shape is the
one proposed here, with the null check factored into a named helper:

```ts
const fx = CLAIM_TERMS[req.claim!];                              // productTest.ts:1634
if (!fx) return unsupportedRow(p, req, `unknown claim key '${req.claim}'`);   // productTest.ts:1635
```

A missing vocabulary is an honest row, not a thrown `TypeError`. **`compileStandard` still refuses
an unresolvable key at compile time** — the runtime path is a backstop, not the primary check.

⚠️ **When the registry (§1) is built, this line is the one to change, and it is the whole engine
diff:** `const fx = req.vocabulary ?? CLAIM_TERMS[req.claim!];`. The null check below it already
does the right thing for a vocabulary the build does not carry, so §2 does not need revisiting —
**only the lookup does.**

#### 3. Surface scoping — the one genuinely new capability

`accepted_surfaces` is declared in the format and **the engine cannot honour it**. Measured:

| probe | result |
|---|---|
| evidence = title `"Single Origin Colombia Huila 12oz"` only | `pass_evidenced`, quoting the title |
| evidence = options `"Single Origin Whole Bean"` only | `pass_evidenced`, quoting the option |
| evidence = title `"Organic Decaf"` only | `pass_evidenced`, **with no quote at all** |

`product_title` and `product_options` are **merchant-controlled strings**, which `SCHEMA.md` §2
already names as insufficient evidence. So `accepted_evidence` in a published standard is
documentation nothing enforces — the same finding G-10 records for `applicability`. This matters more
in coffee than elsewhere: process-in-title is the normal convention in specialty and green-coffee
listings.

**Ask:** `Requirement.acceptedSurfaces?: QuotableSurface[]`, applied as a filter on `p.evidence`
before matching. Four lines, and it is the difference between a standard's evidence rules being real
and being prose. Both worked vocabularies pin the current behaviour as `passes_known_gap`, so
building this **fails those pins** and tells you the debt is closed.

#### 4. One line in `normalize` worth more than it looks

`normalize` folds Unicode dashes and curly apostrophes and nothing else, so `swiss water process`
cannot match `Swiss Water® Process`. **The failure is inverted against the truth: a registered mark
is what a *licensed* seller writes.** The worked vocabulary works around it by enumerating symbol
variants, which is correct-but-ugly data.

**Ask:** strip `®`, `™`, `℠` in `normalize`. It improves every existing vocabulary at once.
⚠️ It is a **weakening** change in the never-weaken sense — copy that failed would pass — so it needs
the attestation, and every published vocabulary needs re-validation (its symbol-variant terms become
redundant, not wrong).

### What the ENGINE enforces vs what the STANDARD enforces

The division is deliberate: the engine cannot re-run an authoring-time proof on every request, and
the standard cannot enforce anything about a surface it does not control.

| enforced by | what |
|---|---|
| **the standard, at authoring time** (`vocabulary.ts`, in CI) | every structural rule V1–V13: substring geometry, term normalisation, duplicates, self-consistency, the executed insufficient set, the executed positive examples, the violation attack, hazard-class coverage, never-weaken, the hash |
| **`compileStandard`, at compile time** | the claim key resolves; it does not shadow a built-in; the vocabulary's hash matches; `review.state` is not `incomplete` |
| **the engine, at runtime** | only two things: a missing vocabulary fails **closed**, and `acceptedSurfaces` is honoured |

The engine deliberately does **not** re-check the term lists. A vocabulary is a reviewed published
artifact; re-deriving its safety per request would be both expensive and a second implementation of
the rules, which is how the two drift.

### The review gate

A standard may bind a vocabulary only when `validateVocabulary` returns `VERIFIED_CLEAN`, an
**independent attacker** has run the six attack classes, an **independent refuter** has attacked the
attacker, and `review.state` is not `incomplete`. `incomplete` **blocks** — it does not read as clean
and it does not read as a small number of defects. Two of those conditions (attacker ≠ author; all
six classes attempted) are **not machine-checkable** and are marked as such rather than given a field
that would imply they were verified. Full protocol: [`VOCABULARY_REVIEW.md`](VOCABULARY_REVIEW.md).

### 🔴 THE MEASURED CONCLUSION: closing the dictionary is NECESSARY AND NOT SUFFICIENT

This is the most important output of the vocabulary session and it is uncomfortable, so it is stated
before the risk section rather than after it.

The worked vocabulary (`standards/coffee/v1.0/vocabulary/decaf-method.json`) was attacked by **four
independent agents that did not author it**, producing **40 hostile sentences**, and then a **fifth
independent agent refuted the attackers**. Narrowing and framing stopped 21 of those specific
sentences at zero cost to true positives.

> ⚠️ **The refutation showed that sentence count is the wrong measure, and it caught a false claim in
> the first version of this section.** The attackers' industry/competitor sentences happened to carry
> no frame verb, so framing stopped them — and this table originally generalised from four sentences
> to a class. Rewritten *into the shipped frames*, the class passes **13 of 13**:
> `"Blue Bottle's decaf is decaffeinated with methylene chloride."`,
> `"Avoid any methylene chloride decaf."` **Attribution is a subject problem wearing a term's
> clothes.** The error is corrected here rather than deleted, because it is the exact shape the
> completion-state rule exists to prevent and it was made by the author re-attacking their own fix.

Corrected stratification — by **class**, not by sentence:

| attack class | genuinely closed by fixing the terms? |
|---|---|
| adjacent vocabulary (fermentation, sustainability, nitro dispense, packaging gas, botanical extraction, cupping defect, co-fermentation) | **YES — 7 / 7** |
| denial (`free of X`, `we avoid X`, `X: never`, `X is banned`) | **YES — 5 / 5** |
| industry, competitor and warning copy | **NO — 0 / 13 when rewritten into the shipped frames** |
| **subject attribution** (sibling product, gift set, subscription rotation, cross-sell, shipment, packaging, review pull-quote) | **NO — 0 / 12** |
| **tense and modality** (used-to, hope-to, evaluating, asked-about, conditional) | **NO — 0 / 6** |
| comparative (`sweeter than a typical …`) | **NO — 0 / 1** |

**Only the classes about the TERM closed. Every class about the SUBJECT is open, and not one of them
is a property of the dictionary.** These all still return `pass_evidenced` on ordinary roaster copy:

```
"Our Ethiopian decaf uses the Swiss Water Process."             (a sibling product)
"Until 2024 we used the Swiss Water Process for this lot."      (past tense)
"We hope to move this coffee to the Swiss Water Process."       (aspiration)
"The gift set that goes with this bag contains a Swiss Water decaf."
"Our subscribers get the Mountain Water decaf in month three."
```

So the worked vocabulary is published as a **draft and a specification input, and is explicitly NOT
bound to an executable entry.** The standard this project already set when it removed the `origin`
attribute applies unchanged: *losing one row of depth costs less than one false statement about a
real store.*

**What that means for whoever builds this gap.** Build the registry — it is correct, it is specified
below, and it closes a live crash on the way. But **do not expect it to unblock the coffee
decaffeination entries by itself**, and do not let a green vocabulary validation be read as a
runnable assertion. Three things gate that, in order of how much they cost:

1. **Surface scoping** (§3 below) — small, and it removes the merchant-controlled-title channel.
2. **Subject attribution** — the sibling/bundle/subscription/cross-sell class. This is the same
   root as G-01's comparative-veto hole and G-11's cross-sentence limit. It is the single highest-value
   engine investment the standards work has surfaced, and it is worth more than any new requirement kind.
3. **Tense and modality** — nothing in the engine reads either, and no term list can supply them.

> **(2) and (3) now have a measurable target.**
> [`acceptance/subject-tense/`](acceptance/subject-tense/README.md) turns them into a pass/fail
> suite: **37 hostile cases** across 15 strata with the outcome the engine *should* produce, and
> **19 must-not-regress cases** — the half that makes it honest, since v2.6 measured 16/16 on its own
> set and an independent pass then measured it as a net regression. It reports **per stratum**,
> never as a single number, because a fix closing sibling-product while breaking past-tense is a
> different result from one closing both.
>
> ```bash
> node --import tsx standards/acceptance/subject-tense/run.ts
> ```
>
> Observed at `e9ec942`: **hostile 4/37, must-not-regress 19/19.** An observation, not an
> expectation — the four that pass are closed by existing guards, and the guard half being green is
> what makes any future regression visible.
>
> It deliberately proposes **no design**. v2.6's precedent is that a plausible design measured worse
> than the naive code it replaced. And it states, in the artifact and on every run, that it measures
> **capability, not value**: a fix passing it still needs the natural-frequency read the `origin`
> tombstone requires, which — see the third bullet below — has still never been performed for
> anything in this gap.

Two supporting notes, both measured. `CONTEXT_VETO` is a **closed phrase list**, so it covers
`also available` but not `also stock`, `comes with` but not `goes with`, and cadence phrases like
`deliver every 2 weeks` but not the bare word `subscription`. And the subject rule **fails open on an
unrecognised subject by design** — correctly, since vetoing on "unknown" would gut depth — which
means every unlisted subject is a pass.

Three further findings from the refutation, all of which change the ask:

- **Surface scoping must cover NINE surfaces, not six.** Six is the count the *public* path indexes;
  `QuotableSurface` defines nine, and `shipping_policy`, `product_metafield` and `seo_description`
  were never probed by anyone. Measured: a process name on any of the three passes, and two of them
  are merchant-controlled.
- **Framing a term buys the denial class and sells recall.** An adjective between the frame verb and
  the compound defeats the term: `"Decaffeinated with natural ethyl acetate from sugarcane."` →
  `not_proven`, and that is the specialty trade's *standard* EA disclosure. A literal term list
  cannot admit an arbitrary modifier inside a frame. If the registry ever grows a matching feature,
  this is the one worth having.
- **No narrowing here has been measured against real merchant copy.** The natural-frequency read the
  `origin` tombstone requires was not performed — this session was barred from fetching stores — so
  every narrowing was decided on hand-written adversarial sets, which is precisely the configuration
  the tombstone records as unarbitrable. **Treat none of them as settled.**

### Risk of building it

**Low for the engine change, high for the vocabularies — which is the point of putting the risk in
the artifact rather than in the code.** The engine change is an optional field, a null check and a
surface filter. The danger was never the plumbing; it was that a term list reaches a merchant without
review, and (b) is the shape that makes that structurally impossible.

Residual risks the format does **not** close, all declared in each artifact's `limits`:
false fails from `CONTEXT_VETO` and the linter pre-filter; sentence-scoped matching missing
cross-sentence facts; and the merchant-controlled-surface false pass until §3 is built.

~~**Recommendation: build §2 first and separately**~~ — 🟢 **DONE** (`d35b26e`). It was four lines,
it fixed a live crash, and it needed no registry.

**Recommendation now: §1 and §3 TOGETHER, and this gap is the top of the whole file's priority
list.** They must ship together because a registry without surface scoping delivers a vocabulary
whose stated evidence rules the engine ignores — and `product_title` and `product_options` are
merchant-controlled strings, which `SCHEMA.md` §2 already names as insufficient evidence. §4
(`normalize` stripping `®`/`™`) is a one-line rider that improves every existing vocabulary at once,
but it is a **weakening** change in the never-weaken sense and needs the attestation plus
re-validation of every published vocabulary.

⚠️ **Ship it expecting it NOT to unblock the coffee decaffeination entries**, and do not let a green
vocabulary validation be read as a runnable assertion. That is this gap's own measured conclusion
and it is the most important sentence in the section above: **closing the dictionary is NECESSARY
AND NOT SUFFICIENT.** Only the attack classes about the TERM close; every class about the SUBJECT —
sibling product, gift set, subscription rotation, cross-sell, shipment, packaging, review
pull-quote — stays open, and so do tense and modality, which no term list can supply.

### 📌 OBSERVATION — 2026-07-28 · the residual named above has now been MEASURED

> **This is an observation appended BESIDE the recommendation, not a re-ranking of it.** The
> priority list is unchanged and G-06 §1+§3 is still item 1. What follows is the number the next
> session should be holding while it reads that recommendation, and one correction to *how* §3
> should be built that the measurement makes unavoidable. Nothing here is a design.

The paragraph above names eight classes about the SUBJECT and says they stay open. Sessions v3.6
CP-1 (natural frequency) and CP-2 (the collapse test) measured what leaving them open costs.
**335 deduped real stores** (166 coffee / 169 general), one product each, **3,349 prose sentences**,
replayed through `fetchPublicProduct` → `buildBuyerTask` → `evaluate` with only the transport
swapped; 335/335 readable, 0 replay misses, resolves COMPLETE. Records: `experiments/v3-6/freq/`
and `experiments/v3-6/collapse/`.

**Consequence — the only number that decides anything.** All **71 passing claim rows** (over 54
stores) were read individually against the engine's own product title, with no unadjudicated
remainder: **41 true passes · 17 FALSE PASSES over 14 stores · 2 wrong-evidence-but-incidentally-true
· 9 marginal · 2 not adjudicable because the row renders no quote** (the v3.2 CP3 class, in a second
measurement). **13 of the 17 are attributable to one of the 15 hostile strata.** Among the 34 rows a
merchant actually sees, 10 are false and 6 are attributable.

**Occurrence — and eight of the fifteen named classes cost nothing.** `packaging`, `shipment`,
`comparative`, `past_tense`, `future_conditional`, `modal`, `review_quote` and `enquiry_evaluation`
produced **zero** false passes across all 71 rows, and three of those are among the *most frequent*
shapes in the corpus (`shipment` on a projected 17–37 stores, `packaging` 7–25, `past_tense` 4–17).
`enquiry_evaluation` returned an exact zero — **0 hits over 3,349 sentences**, 95% upper bound
**1.13%**, at a detector proven live on its own cases. That is the `origin` tombstone's configuration
exactly. `review_quote`'s zero is a *different kind of answer* and must not be printed the same way:
all three hits are review chrome and `productTest.ts:1229` excludes review surfaces on purpose, so it
is ambiguous between "merchants do not write it" and "we never read where they write it".

**The residual is ONE capability, not eight.** CP-2 labelled every case on four dimensions —
the term's governing noun phrase (REF), the speaker (SPKR), whether the property is asserted as
holding now (TIME), and whether the predicate is an assertion at all (FORCE) — and asked the single
question *would one change move both?*

| | of the 17 confirmed false passes |
|---|---|
| REF hostile (the term's governing NP does not denote this product) | **17 / 17** |
| REF the **sole** hostile dimension | **14 / 17** |
| TIME hostile | **0 / 17** |
| SPKR hostile | 1 / 17 · FORCE hostile 2 / 17 |

**And it is not the SUBJECT.** 8 of the 17 have **no surface subject at all** (imperatives, NP lists,
participial fragments); 1 more has **this product as its subject** and is still false
(`blossomcoffeeroasters.com`, *"our Cold Brew Blend features a washed single-origin from Guatemala"*);
and five must-not-regress cases share `xsl-01`'s exact subject `We`. That is **9 of 17 a subject frame
cannot reach before any collision count**, which confirms the standing suspicion that "read the
subject" is the wrong frame. Executed: the engine returns an identical outcome **and an identical
matched term** on 17/17 minimal pairs, so it reads none of this today.

**Two things this does NOT license, both measured on the same corpus.** The cost side is
10–60× the benefit side: `trade_form` is projected at **90–211 of 335 stores (27–63%)**,
`first_person` is **180 stores (53.73%, exact)**, `plain_present` 91–175, `spec_block` 66–144, and
**2 of 16 sampled `already_refused` hits are `without X` used as the claim itself, on live passing
rows today**. And four of the 17 false passes sit **outside all 21 strata** — two are `single-origin`
inside a sentence describing a *blend*, two are the soil-science sense of `organic`, which G-14 below
already lists as a vocabulary hazard. Structurally those two are REF instances as well, so the same
capability partially subsumes a class currently filed under G-14.

### Which way this points

**G-06 §1+§3 stays first, and one of these numbers argues for it rather than against it — but §3's
measured value is conditional on a step that currently lives in G-14.**

1. **§3 and the subject residual are COMPLEMENTARY, not competing.** The 3 false passes referent
   resolution provably *cannot* close are the ones whose governing NP is a class of undecidable
   membership — and the only must-PASS cases sharing that label are `fps-01`/`fps-03`, the suite's
   own designated near-identical twins, so no single referent reading separates them. **2 of those 3
   are on the `page description` surface**, which is §3's lever. §3 is four lines; the residual has
   no design.
2. ⚠️ **§3's NAMED hazard did not fire, and a different surface did.** The ask above is written
   around `product_title` / `product_options`. In this sample `product_title` produced **2 of 71**
   passing rows and **0 of 17** false passes, while `page description` produced **15 of 71 and 4 of
   17** — including the one where a store's *only* `organic` evidence anywhere on the page was its
   meta description. Build §3 with `page_description` in view, not only the title. (n is small on
   the title figure; report it as 2 rows, not as a rate.)
3. ⚠️ **§3 closes zero live merchant rows on its own.** `acceptedSurfaces` is a per-*requirement*
   field, and all 17 false passes came from the **13 built-in claim keys**, which no vocabulary
   artifact covers. Until the built-ins are expressed as artifacts with surfaces declared — which is
   G-14's step 1, not G-06's — §3 is plumbing with nothing plumbed into it. That pairing is the
   cheapest measured win on this page and it spans two gaps.
4. **Nothing here touches G-06's coverage argument**, which is about whether a standard's rows can
   run at all. Zero executable rows is a different quantity from a wrong answer on a row that runs.

**The counter-case, stated so a later session can act on it rather than rediscover it:** 17 false
passes in 71 rows is the largest measured live defect class in this engine, it affects every merchant
today, and G-06's own conclusion is that closing the dictionary unblocks none of it. What holds it
below §1+§3 is not its size — it is that **every subject-shaped change this repo has measured has
come back worse than the code it replaced** (v2.6's negation-scope rewrite, v2.8's `origin`
narrowing, v3.2's four guards reverted after 2 attackers found 192 regressions where a 216-store
replay found 0). CP-2 was barred from designing one, deliberately. **The measurement licenses SCOPING
the residual as a numbered gap; it does not license shipping a guard for it.**

### Reusable for G-14's campaign — yes, and it removes that campaign's stated blind spot

`experiments/v3-6/freq/{extract,strata,canary,sample}.ts` + `experiments/v3-6/collapse/probe.ts` give
G-14, off the shelf: **335 replayable real stores** whose RAW HTTP bytes are captured (so a re-run is
transport-only and re-executes against **any** commit — which satisfies G-14's non-negotiable
"must run against the SHIPPED engine, not a pinned worktree" trigger); per-claim-key row execution
through the engine's own `evaluate`; and the two-sided-canary + `INCOMPLETE` discipline already
wired. It also supplies the thing G-14's own honesty section says it cannot buy — **natural-frequency
weighting**, so the ~1,500 sentences to adjudicate can be ordered by how often the shape occurs
instead of read uniformly. It buys no independence, exactly as G-14 says. **Do not start G-14 on the
strength of this; its trigger is explicit and it must be scheduled.**

*Baseline re-proved at the end of CP-2 on `6cffd1b`: `standards/acceptance/subject-tense/run.ts` →
hostile 4/37, must-not-regress 19/19. Nothing under `standards/acceptance/` or `src/` was edited.*

---

## G-07 — The `identifiers` row passes on identifiers that identify nothing

> 🟡 **The gap this entry was opened for is CLOSED (`0faac0d`). The entry is not, because a
> different and worse defect in the same row was measured afterwards, and they are one row.**
>
> This is a single entry rather than two because the row has one promise — *this page publishes an
> identifier a machine buyer can resolve against an external catalogue* — and both defects are that
> promise failing. Splitting them would let a future session close one and read the row as fixed.
> **Both arguments are preserved below in full.**

**Blocks:** nothing in the standard's *public* tier — `ALS-COFFEE-1.1-IDENT-001` is executable and
runs on both paths. What is broken is not availability but **truth**: the row reports a pass on
values that cannot do the job the row's own `pass_means` describes.

---

### Part 1 — the plumbing defect. 🟢 CLOSED in `0faac0d`.

Kept because the argument is reusable, and because the shape — *a feature that got worse when the
merchant did what the product asked* — is one to recognise again.

**The mechanism, as it was.** `snapshotFromCatalog` set `extracted: null`. `evaluate`'s
`identifiers` branch took the `!p.extracted` path (`src/server/productTest.ts:1848`) and returned
`requires_store_access` — *for a store we have access to*. The data was present the whole time:
`NormalizedVariant` carries `barcode` and `sku` (`src/catalog/normalize.ts:8-9`).

So the row's own copy — "we couldn't read this product's page markup" — was shown to a merchant
whose barcode was sitting in the synced catalog, and `diffAssertions` recorded the movement as
`unchanged` rather than `resolved`, so the install-argument metric quietly under-counted. **A
regression triggered by the merchant doing what the product asked** is worse than a gap.

**What was built**, exactly as this section specified: a synthetic `extracted.product` in
`snapshotFromCatalog` from the catalog's own identifier fields — `barcode` → `gtin`, `sku` → `sku`
(`src/server/authenticatedTest.ts:216`, via `extractedFromCatalog`). The caveat this section raised
was honoured: `isPlaceholderIdentifier` and the GTIN check-digit validation apply to catalog values
exactly as to JSON-LD values, reused rather than reimplemented — *an Admin API value is no more
trustworthy than a JSON-LD one*.

⚠️ **Two things the fix deliberately did NOT decide, and a standard author must know both.**
`mpn` is set to `null` on the authenticated path, because the catalog has no MPN field and inventing
one is precisely Part 2's defect — so an authenticated `identifiers` row can only ever pass on a
valid GTIN, and the public and authenticated rows are therefore not asking the same question. And
the question this section raised — *which variant's barcode represents the product when they
differ* — is still open; for coffee it is live, since a 12 oz bag and a 5 lb bag are different GTINs.

---

### Part 2 — 🟡 **MOSTLY CLOSED by rule D (`66a80a4`), and the residue is deliberate**

> 🟡 **RULE D SHIPPED, THE BOUND WAS RE-MEASURED, AND ONE OF THE THREE NAMED STORES SURVIVES.**
> `mpn` is now disqualified when it is byte-identical to the storefront's own product object id,
> read from the analytics bootstrap. Executed on the current tree over the captured corpus:
>
> | sample | pass rows | confirmed | cluster-adjusted 95% bound | |
> |---|---|---|---|---|
> | coffee, before | 162 | 10 | **12.78%** | |
> | coffee, after | 160 | 8 | **10.97%** | both the numerator and the denominator fall |
> | general, before | 509 | 21 | **8.81%** (18 → 8.81 recomputes to 7.80 at x=18) | |
> | general, after | 488 | **0** | ~~0.85%~~ | **a FLOOR, and NOT a rate — see below** |
>
> ⚠️ **THE GENERAL FIGURE IS THE TRAP, AND IT IS THE POINT OF THE RE-MEASUREMENT.** Closing all 21
> returns that sample to **x = 0 over one examined class** — the exact epistemic state that produced
> the retired **0.83%**. The arithmetic returns **0.85%**, which is 0.83% again to within two
> hundredths of a point, for the same reason it was wrong the first time. It is published as
> `INCOMPLETE` with the count scoped to the one class ever re-checked, the site refuses to draw any
> ratio against it, and no page states it as a low error rate. Figures:
> `standards/coffee/v1.3/fitness.json`; instruments: `experiments/v3-2/bound.mjs` and
> `general_bound.mjs`, unmodified.
>
> **`www.stumptowncoffee.com` still passes**, and that is a decision rather than an oversight: its
> `mpn` copies its own SKU, not its object id, and rule A (`mpn === sku`) scored **0 true positives
> and 7 false** over all 36 MPN-publishing products, convicting exactly the compliant case. Items 1
> and 3 below are therefore still open; item 2 is what rule D implements.

**This defect corrected a published error bound that this project had been citing since v2.9.**

**The mechanism.** `evaluate` rejects placeholders (`N/A`, `TBD`) via `isPlaceholderIdentifier` and
validates GTIN check digits — but it accepts **any** non-placeholder `mpn` string. And the row
**renders no quote**: it says *"Your structured data publishes MPN."* So an auditor reading rendered
evidence has nothing to be suspicious of. The row looks identical whether the value is a real GS1
barcode or a number the store minted about itself.

Checked mechanically against captured bytes, over both fitness samples:

```
identifier rows asked      216
identifier rows passed      53
  rescued by a valid GTIN   29    honest passes
  DEFECTS                   21    general 18, coffee 3
```

Verified from raw HTML, never from an agent's prose:

- `glowrecipe.com` — the published `mpn` also appears as `rid`, `source_product_id`, `product.id`
  and `data-product-id`. **It is Shopify's internal product id, put in `mpn` by a theme.**
- `www.lacolombe.com` and `sightglasscoffee.com` share one JSON-LD emitter byte-for-byte, so this is
  a **theme behaviour, not two unlucky merchants** — which is why 21 instances is a floor, not a
  count.
- `www.stumptowncoffee.com` — `"sku":"100754","mpn":"100754"` adjacent in one object. **The
  store-local SKU is exactly what the row excludes**, because a SKU cannot match a product to an
  EXTERNAL catalogue, which is the row's entire promise.

**What it did to the published bound.** The general sample's audit read all 507 rendered rows and
confirmed **zero** false positives. One mechanical check of this one class found **eighteen** in
that same sample:

| GENERAL sample | was | now |
|---|---|---|
| confirmed false positives | 0 | **18** (one class — a FLOOR) |
| cluster-adjusted 95% bound | **0.83%** | **7.80%** |

> ⚠️ **The general lesson, and it is the reason this is filed as an engine gap rather than a data
> correction: a defect class that renders NO QUOTE is invisible to every audit that reads rendered
> evidence, however many rows it reads.** v2.8: "zero across 55 rows was a statement about sample
> SIZE." v3.0: "…about sample SHAPE." v3.2: **also about AUDIT METHOD.**

#### What would be required

1. **Reject an `mpn` that equals the page's own `sku`**, normalised. This is the `stumptowncoffee`
   case and it is unambiguous — the row explicitly excludes store-local identifiers, so an `mpn`
   that IS the sku fails the row's own definition. Cheapest, and closes a whole emitter's output.
2. **Reject an `mpn` that appears elsewhere on the page as a platform id** — `product.id`,
   `data-product-id`, `rid`, `source_product_id`. This is the `glowrecipe` case. It needs the raw
   page, which the public path has and the authenticated path does not, so it is a **public-only**
   guard and must degrade to `not_proven` rather than to a pass.
3. **Render a QUOTE, or render the VALUE.** The deepest fix and the one with the widest benefit:
   the row's invisibility to audit is what let 21 instances survive two audits, and it will hide the
   next class too. `presentableQuote` correctly refuses a bare identifier (symbol soup, <3 words),
   so this needs a different renderer for structural evidence — *show the value and the surface*,
   not a sentence. **Do this one even if 1 and 2 are skipped.**

#### Risk of building it

**Low for 1, moderate for 2, low for 3 — and the asymmetry matters.** All three make the row
*harder* to pass, so every failure mode is a false **fail**, which is recoverable and which the
`origin` tombstone's rule already prices: *losing one row of depth costs less than one false
statement about a real store.*

The specific risk in 2 is over-reach: a legitimate MPN can coincidentally equal a numeric platform
id, and a page that mentions the same number for an unrelated reason would be read as a defect.
Recommendation: require the number to appear in an **identified platform-id position**, not merely
anywhere in the bytes — and pin the three named stores as corpus cases before shipping, per the
adversarial-corpus standard. **A guard whose removal breaks no corpus case is not a guard.**

---

## G-08 — Two requirement kinds can block a merchant's entire report

**Blocks:** nothing directly. It is a **latent hazard the standard cannot design around**, and it is
recorded here because a coffee store is unusually likely to trigger it.

> 🟢 **CLOSED.** Both halves: the lint pre-filter in `5931b6a`, the `wholeWord` defect in `cd8b5ec`.
> Kept in full — the mechanism is the clearest statement in this repo of *fail closed per ROW, never
> fail the report*, and the second defect is the canonical example of a matcher whose two halves
> default in opposite directions.
>
> **One correction the fix produced, recorded because the gap was wrong about its own scope:**
> `no_subscription`'s half **was already closed** by v2.9's policy-surface work *before this gap was
> written up*. Only `delivery` was still exposed at v3.0. A future session must not go looking for a
> second fix. Verified at `src/server/productTest.ts:1763`, which carries the note in the code.

**The mechanism, as it was.** The claim linter runs over `evidenceQuote`, and one violation returns
the whole result as `errorKind: "unreachable"` (`src/server/productTest.ts:2223-2234`). `claim` and
`attribute` rows defend against this by pre-filtering their evidence with `lintStrings`
(`productTest.ts:1656`, `productTest.ts:1802-1804`), so an unquotable sentence is skipped and the
search continues. **`delivery` (`productTest.ts:1893`) and `no_subscription`
(`productTest.ts:1764`) read `p.evidence` directly, with no pre-filter.**

So a store whose shipping policy said **"delivery guaranteed within 3 business days"** had its
entire report refused — a flatly false statement about a store the engine read perfectly well. This
is the identical failure class that got the `warranty` requirement dropped
(`src/server/productTest.ts:582-589`), and it was still reachable through two other rows.
Reproduced as a fixture before the fix existed: **10 rows → 0**.

✅ **Both now filter.** `delivery` applies `lintStrings` only, with **no surface filter, deliberately**
— it is the one requirement whose subject genuinely *is* the shipping policy, so excluding that
surface would delete the row's best evidence. `no_subscription` applies both. The asymmetry is
recorded at each site rather than left to be rediscovered as an oversight.

Coffee raises the odds: freshness and delivery-speed language is central to the category, and
"guaranteed fresh" / "delivery guaranteed" are ordinary phrasings.

### 🔴 A second, unrelated defect in the same row, found in the v1.0 vocabulary session

`findTimingSupport` (`src/server/testEvidence.ts:499-511`) calls `findSupport` **without**
`wholeWord`, and `findSupport`'s default is `false` (`opts.wholeWord === true`, `testEvidence.ts:358`). So the
`delivery` row matches its timing terms as **raw substrings**. Verified by executing the real
function:

| sentence | matched term | row outcome |
|---|---|---|
| `Ships internationally to 40 countries.` | **`ships in`** | `pass_evidenced` — "delivery timing is stated" |

`ships in` is a substring of `ships internationally`, and `requireDigit` is satisfied by the
unrelated `40`. **A store that ships internationally and publishes no delivery window is told it
published one** — and `delivery` is the engine's best-discriminating requirement at a 71% fail rate,
so this fires on the row that matters most.

Fix: pass `{ wholeWord: true }` in both `findTimingSupport` calls, then re-check the
self-contained terms, which contain hyphens and must still match (`next-day shipping`). Note the
asymmetry that caused it: `findViolation` defaults `wholeWord` to **true** and `findSupport` defaults
it to **false**, so the unsafe direction is the default on the function that produces a pass.

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

> 🟢 **CLOSED in `0faac0d`** ("cp3+cp4: identifiers in the authenticated path (G-07), contract
> injection on the public path (G-09)"). **All four numbered requirements below were built**, and
> the two risks were both answered rather than inherited. This section is kept in full because its
> diagnosis — *the pure evaluator is shared, so this is a plumbing gap, not a design gap* — is why
> the whole standards position stopped being decorative for the cost of a few dozen lines, and that
> is the kind of read worth being able to repeat.
>
> **Verified at `9843cb6`:**
>
> | required | shipped |
> |---|---|
> | 1. `RunOptions.requirements?: Requirement[]`, keeping `buildBuyerTask`'s linted `summary` | `productTest.ts:2059`; `buildBuyerTask` still always runs and only the requirement LIST is replaced (`productTest.ts:2102-2106`) |
> | 2. a standard identity on the result | `RunOptions.standard?: StandardIdentity` (`productTest.ts:2063`) and on the result (`productTest.ts:2036`) |
> | 3. `MAX_REQUIREMENTS` applies to rendering, not evaluation | scoped to `buildBuyerTask` alone; supplied requirements bypass it **by construction** (`productTest.ts:1479`), asserted by a test that runs an 18-entry pinned contract and requires 18 rows back |
> | 4. the delivery fetch keeps working | confirmed rather than assumed — it triggers off the **effective** requirement list (`productTest.ts:2117`), so a standard's `delivery` entry still fetches the policy |
> | risk A: `contractVersion` must cover the standard identity | folded in, and **byte-compatibly**: no standard → `c1-…` unchanged; a standard → `c1s-…` with id+version+hash inside the hash (`productTest.ts:1353-1375`) |
> | risk B: the `requires_store_access` collapse is wrong for a conformance list | disabled for a pinned run (`productTest.ts:2141-2150`); `deferred` stays empty and every entry keeps its own row |
>
> **One thing built that this section did not ask for, and it would have been a live defect:**
> a pinned run **bypasses the result cache in both directions** (`productTest.ts:2074`). The cache is keyed on the
> normalised URL alone, so without it a conformance result would have been served to the public
> funnel — a merchant shown a conformance table against a standard they never asked about — and, in
> reverse, a conformance run would have silently returned a generated 10-row task.

**Blocked, when open: the entire standard, on the public path.** This was the gap that made the
others academic.

**The mechanism, as it was.** `runProductTest(url, deps)` called `buildBuyerTask(fetched)`
unconditionally (`src/server/productTest.ts:2105`) and `RunOptions` carried only `force` and
`semantic` (`productTest.ts:2042-2064`). There was
**no way to supply a pinned set of requirements to the public test.** The
requirements are generated per product by a heuristic — `inferClaims` plus `SURFACE_PRIORITY` plus a
`MAX_REQUIREMENTS` cap of 10 — which is precisely the vendor's private rubric this standard exists
to replace.

**The asymmetry is the useful finding.** `runAuthenticatedTest` **already accepts a pinned
contract**: `requirements?: Requirement[]`, falling back to a generated one
(`src/server/authenticatedTest.ts:282-291`). So **a standard can be executed against a connected
store today, and cannot be executed against a public URL.** The pure evaluator is shared, so this is
a plumbing gap, not a design gap.

### What would be required

1. `RunOptions.requirements?: Requirement[]` on the public path, threaded to replace
   `buildBuyerTask`'s output while keeping its `summary` generation (which is linted and must
   stay).
2. A **standard identity on the result** — `standardId`, `standardVersion`, `standardHash` — so a
   conformance result says which text it was tested against. Without this a result is not citable
   and the whole standards position is decorative.
3. `MAX_REQUIREMENTS = 10` (`productTest.ts:1479`) is a table-length cap for a generated task. A standard has more
   entries than that. The cap should apply to *rendering*, not to *evaluation*.
4. The delivery-policy fetch is triggered by `requirements.some(r => r.kind === "delivery")`
   (`productTest.ts:2117`) and would keep working unchanged — worth confirming rather than assuming.

### Risk of building it

**Low, with two things to get right:**

- **`contractVersion` must cover the standard identity**, or two runs under different standard
  versions will compare as though they asked the same question. The existing fingerprint covers
  requirement fields only (`productTest.ts:1353-1375`), and it was deliberately built so that pre-v2.3 contracts
  hash unchanged — so widening it is a decision with a documented precedent to respect.
- **The `requires_store_access` collapse.** At most one such row appears in the table and the rest
  move to `deferred` (`productTest.ts:2141-2150`). That is right for a generated 10-row task and probably wrong
  for a standard, where a reader wants the full conformance list. This is a rendering decision, not
  an evaluation one, and it should be made deliberately rather than inherited.

---

## G-10 — A standard cannot gate its own applicability

> 🟢 **CLOSED in `be14e37`** ("cp3: applicability gating") — `standards/applicability.ts` plus a
> per-standard `applicability.json` sidecar. Kept in full: its two honesty requirements are general
> rules that the next predicate mechanism will need, and its risk note is what produced them.
>
> **Both non-optional properties this section demanded were built and are tested:**
>
> - **Every exclusion is reported with a reason.** A list that drops entries silently is worse than
>   one that runs them all, because the reader cannot tell "passed" from "was never asked". This
>   section's own cautionary instance is quoted in the module: `attr:warranty` sat in
>   `SURFACE_PRIORITY` for three sessions after its requirement stopped existing, because a priority
>   entry matching no candidate is a **silent no-op**.
> - **Excluding everything is a loud error, never an empty pass** — `includedCount: null`, not `0`,
>   exactly on the `src/measure/completion.ts` model this section named.
>
> **The signal order is the engine's own and this gap's:** `product_type` authoritative → JSON-LD
> category → breadcrumb → `title` FALLBACK → **never tags**. Tags are excluded *structurally*:
> `ClassifiableProduct` has no tags field, so the module cannot read them even when handed them.
> `unknown` is its own class — a product with no `product_type` and an undecisive title is not the
> same as one that clearly does not match, and neither is the same as one that passed.
>
> **The rules live BESIDE the document, not inside it**, and the reason generalises to every
> proposal in this file: `standard_hash` covers `standard.json`'s bytes and a citation resolves
> through it, so encoding the executable reading of prose already in the document must not
> invalidate every citation made against v1.0.
>
> ⚠️ **What its absence cost, measured on the first run's own snapshots: 16 of 25 products should
> never have been asked** — 13 out of category (`Merch`, `Home`, `Gifts`, an espresso machine, a
> cocktail shaker, three t-shirts) and 3 unclassifiable. Run 1 caught 11 by hand. **Three of run 1's
> ten verdicts were artefacts of n=9**, including two of the standard's best entries.
>
> ⚠️ **A follow-on defect this gap surfaced and `d84eba8` fixed:** `product_type` was being dropped
> whenever a page's JSON-LD was complete, so 15 of 44 coffee products were unclassifiable — and the
> same null flows into `CATEGORY_CLAIMS` and `AttributeSpec.onlyFor`, meaning category inference in
> **production** was degrading to the title alone at that rate. After the fix, G-10 skips 15 → 2.
> The obvious fix (fetch `/products/{handle}.json` anyway) was the wrong one: it spends the request
> the tier order exists to avoid **and invalidates every existing snapshot**. *A fix that
> invalidates the corpus it must be measured on is not a fix.*

**Blocked, when open:** `ALS-COFFEE-1.0-DECAF-*` (must not fire on caffeinated coffee), `-POD-001`
(must fire only on pods and capsules), and the correctness of *every* entry's `applicability` field.

**The mechanism, as it was.** Applicability is decided in the engine by `CATEGORY_CLAIMS`
(`src/server/productTest.ts:72-79`) — a hardcoded regex-to-two-claims map — and by `AttributeSpec.onlyFor`
(`productTest.ts:604`). Both are engine-internal. A standard's `applicability` field is therefore **documentation
that nothing enforces**: if a compiled requirement list is handed to `evaluate`, every entry fires on
every product.

Note that `evaluate` does **not** consult `onlyFor` at all — only `buildBuyerTask` does (`productTest.ts:1507`). So
binding `attribute: care` for a coffee product would be evaluated against laundry vocabulary and
return `not_proven` for every coffee store on earth: the exact `cruelty_free` failure, reintroduced
by the standard rather than by the engine.

### What would be required

An applicability predicate compiled from the standard and evaluated against the product snapshot
before the requirement list is built. It must use the **same** signal order the engine already uses —
`product_type` authoritative, `title` fallback, **never tags** (`productTest.ts:1377-1384`, and the reason is
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
silent no-op (`productTest.ts:1533-1535`). An applicability predicate that matches nothing would suppress an entry
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
requirement. The evidence index is built once from product-level text (`productTest.ts:1143-1150`);
`minPriceUsd` is the **minimum across variants** (`productTest.ts:1163`); and `optionValues` is a de-duplicated
**union** of every option (`productTest.ts:1131`). Nothing in the snapshot associates a piece of text with a
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
   letter density (`src/server/testEvidence.ts:287-288`), which is correct — it is not a sentence —
   but coffee pages state origin, altitude, varietal and process in exactly that form. Such a row
   passes with no quote (`src/server/productTest.ts:1824-1826`), which is honest and weakens the
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

---

## G-14 — the thirteen built-in claim keys have never had the six-class treatment

**This is not a capability gap. It is a MEASUREMENT gap, and it is the only one on this list that
touches every merchant the product has.** [`VOCABULARY_REVIEW.md`](VOCABULARY_REVIEW.md) defines
eight hostile classes and [`attack/`](attack/README.md) generates six of them from any vocabulary
artifact. That machinery has been pointed at exactly one term list — the coffee `decaf-method`
vocabulary, which **ships in no engine and runs for no merchant.** The thing that actually runs is
`CLAIM_TERMS` at `src/server/productTest.ts:47`: **one dictionary, thirteen keys, 56 supporting terms
and 13 violating terms**, none of which has ever been attacked systematically.

> A note on nouns, because the two counts get conflated. There is **one** claim dictionary holding
> **13 keys**. The "two hardcoded dictionaries" that bound how much of a category is executable
> (G-06) are `CLAIM_TERMS` **and** `ATTRIBUTE_SPECS`. This gap is about the first one's contents.

**The two defects known in that dictionary were both found by accident, not by review** — one while
auditing something else, one while writing a worked example for a documentation section:

| key | defect | status |
|---|---|---|
| `gluten_free` | `contains gluten` is a substring of `contains gluten-free`, and violating terms are checked first — so a store *stating* the claim was told its copy "states the opposite", quoting its own compliant sentence | **CLOSED.** Fixed by `findViolation`'s overlap rule (`src/server/testEvidence.ts:408-420`) and pinned green in `test/adversarialCorpus.test.ts` |
| `cruelty_free` | `tested on animals` is **suffix-aligned** inside supporting `not tested on animals`, which the overlap rule does not reach. `"Tested on animals: never."` produces *"Your public copy states the opposite of this requirement"*, because `:` is a `CLAUSE_BOUNDARY` and the denial cannot reach back | **LIVE.** Recorded in `VOCABULARY_MECHANISM.md` and in G-06 above; **not pinned in the engine's own corpus** |

⚠️ Do not conflate the two geometries, and do not describe `gluten_free` in the present tense. Its
was *strictly inside*; `cruelty_free`'s is *suffix-aligned*, which is exactly why the first fix does
not cover the second. And the same `cruelty_free` sentence stem has a *third* recorded outcome —
`"Never tested on animals."` produces `not_proven`, a false **fail** — so one key errs in both
directions at once.

**The other eleven keys have had neither treatment.** That is the gap.

---

### ✅ STEP 1 IS MEASURED — 2026-07-28, against `6a3e5d7` (v3.8)

**Status moves from "never run" to "step 1 measured on 2026-07-28, against `6a3e5d7`."** No fix was
made and none is licensed by this; the table below is the target for the fix sessions it licenses.
Artifacts: `experiments/v3-8/g14_generate.ts` · `out/g14_sentences.json` · `g14_merge.mjs` ·
`g14_table.mjs`.

⚠️ **THIS SECTION'S OWN HEADING WAS WRONG, AND SO WAS THE PARAGRAPH ABOVE.** The templatizer has
**EIGHT** classes, not six, and it generates all eight rather than "six of them":
`letter_not_spirit` · `adjacent_vocabulary` · `wrong_subject` · `merchant_controlled_string` ·
`orthography` · `violation` · `tense_modality` · `denial`. The must-not-regress direction is not a
ninth class — it is built in as `control: true` templates. The heading is left as written because
it is what the gap was filed under and citations resolve through it.

**Method.** The thirteen keys and their 69 terms were enumerated by lifting the `CLAIM_TERMS`
literal out of the engine's own source bytes and evaluating it (it has no `export`, and a regex
would also match the copy in `standards/__tests__/vocabulary.engine.test.ts`), then round-tripping
**69/69** through the real `evaluate()`. Key set cross-checked against `ENGINE_CLAIM_KEYS`. Every
sentence was run down BOTH the real `evaluate()` and the proven mirror `evaluateWithVocabulary`,
which agreed on **all 3,681**. Ten parallel adjudicators (batched class-major round-robin so no one
adjudicator owned a class), then four independent refuters told to default to `refuted: true` under
uncertainty.

```
sentences executed   3,681   (hostile 3,500 · controls 181)
dropped by cap           0   — full coverage, not a sample
controls meeting their expected outcome   181/181
groups                 779   adjudicated 779/779, missing 0, duplicates 0
refuter verdicts       327   → 55 claims refuted away
```

**CONFIRMED FALSE PASSES / HOSTILE SENTENCES, per key × class:**

| claim key | letter_not_spirit | adjacent_vocab | wrong_subject | merchant_ctrl | orthography | violation | tense_modality | denial |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `aluminum_free` | 32/35 | ~0/14 | 46/128 | 0/60 | 0/86 | 1/24 | 53/90 | 10/59 |
| `baking_soda_free` | 23/25 | ~0/10 | 27/80 | 0/36 | 0/60 | 0/8 | 37/54 | 3/41 |
| `cruelty_free` | 19/20 | ~0/8 | 28/66 | 0/30 | 0/47 | 0/8 | 33/45 | 0/33 |
| `vegan` | 18/20 | ~0/6 | 27/76 | 0/36 | 0/45 | 0/16 | 36/54 | 4/34 |
| `fragrance_free` | 21/25 | ~0/8 | 31/80 | 0/36 | 0/51 | 0/8 | 38/54 | 11/41 |
| `paraben_free` | 18/20 | ~0/8 | 30/66 | 0/30 | 0/45 | 0/8 | 30/45 | 6/33 |
| `sulfate_free` | 18/20 | ~0/8 | 25/66 | 0/30 | 0/45 | 0/8 | 30/45 | 6/33 |
| `single_origin` | 25/25 | ~0/6 | 40/70 | 0/30 | 0/40 | n/a | 40/45 | 10/40 |
| `organic` | 14/15 | ~0/4 | 23/42 | 0/18 | 0/25 | n/a | 23/27 | 3/24 |
| `fair_trade` | 15/15 | ~0/2 | 18/42 | 0/18 | 0/20 | n/a | 24/27 | 6/24 |
| `gluten_free` | 15/15 | ~0/8 | 21/62 | 0/30 | 0/45 | 0/16 | 26/45 | 6/26 |
| `third_party_tested` | 23/25 | ~0/10 | 27/70 | 0/30 | 0/52 | n/a | 37/45 | 0/40 |
| `bpa_free` | 19/20 | ~0/8 | 25/66 | 0/30 | 0/45 | 0/8 | 32/45 | 4/33 |
| **TOTAL** | **260/280** | **~0/100** | **368/914** | **0/414** | **0/606** | **1/104** | **439/621** | **69/461** |

Completion states: **`n/a`** = the class does not attack that key's term roles (`violation` against
a key whose violating list is empty) — nothing was owed. **`~`** = HALF-RUN, see below. No cell is
empty, and no `0` in this table means "we did not look" except where marked.

**Sentence-level roll-up:** confirmed false passes **1,137** · correct 1,464 · generator artefacts
**735** · false fails **164**, over 3,500 hostile sentences.

⚠️ **`generator_artifact` IS A THIRD STATE AND IT IS 735 SENTENCES.** The generator is a documented
heuristic; it produced `"Our carton is Contains Aluminum."` and `"Our product is free of vegan."` —
sentences no merchant writes, on which the engine's answer carries no information in either
direction. Counting them as defects would have inflated this campaign by two-thirds. Counting them
as correct would hide real coverage loss. They are their own column, and where a template's slot
needed a substance and received an absence-claim, that is a GENERATOR defect to fix before the next
run, not an engine defect.

⚠️ **FALSE FAILS ARE COUNTED SEPARATELY AND NEVER MERGED.** 164 of them. A false fail is the
recoverable direction; a false pass is not. A single number over both would be the arithmetic this
repo has spent four releases learning not to publish.

#### What the table says, in three sentences a stranger needs

1. **The engine reads keywords, not sentences, on three axes and reads them well on three others.**
   `tense_modality` (439/621), `letter_not_spirit` (260/280) and `wrong_subject` (368/914) are
   wide open; `merchant_controlled_string` (0/414), `orthography` (0/606) and `violation` (1/104)
   are clean.
2. **`letter_not_spirit` is the worst RATE at 93%, and `tense_modality` the worst COUNT at 439** —
   nothing in the engine reads tense, modality or condition, so *"We hope to move this batch to a
   Fragrance-Free product next season."* is credited as proof the product is fragrance-free today.
3. **The defect is uniform across all thirteen keys**, which means it is a property of the matcher
   and not of any term list — so no amount of editing `CLAIM_TERMS` addresses it.

#### ⚠️ THE COVERAGE THIS TABLE DOES NOT HAVE, stated because a `0` cannot say it

`adjacent_vocabulary` ran its **mechanisable half only** — fragment probes over multi-word terms.
`DEFAULT_CONTEXT.adjacentDomains` is empty, so the **domain-collision half was never attempted for
any of the thirteen keys.** That matters more than `0/100` suggests: two of this repo's known
confirmed defects live exactly there — `organic` in its soil-science sense, and homographs such as
`REACH`. Reading that column as "attacked and clean" is precisely the mistake the generator's own
`notExercised` logic exists to prevent, one level up. **A human-authored `adjacentDomains` set for
the thirteen keys is the next step and it is not optional.**

#### Two findings banked independently of adjudication

- **The real claim branch REFUSES the `shipping_policy` surface** (`productTest.ts:1746`) and the
  mirror `evaluateWithVocabulary` does not. `standards/__tests__/vocabulary.engine.test.ts` proves
  the mirror faithful but only ever probes `product_description`, so its proof structurally cannot
  see this. **And `attack/templates.ts`'s `merchant_controlled_string/shipping_policy` template
  asserts in its own `intent` that "the claim branch restricts no surface" — that comment is
  STALE**, and the sentences it generates cannot reach the branch at all.
- **The engine has no `contradicted` status for a claim.** Contrary evidence returns
  `status: "not_proven"` distinguished only by the detail sentence *"Your public copy states the
  opposite of this requirement."* Any instrument checking `status === "contradicted"` silently
  reads every contradiction as a plain miss.

#### Why nothing was pinned in the adversarial corpus

274 confirmed false-pass groups over 1,137 sentences. Pinning them would move
`EXPECTED_OPEN_GAPS` from 60 to the high hundreds in a single commit, in a session whose brief said
**"No fixes. Not one."** and whose value is an unfitted measurement. `EXPECTED_OPEN_GAPS` stays at
**60**. The table is the artifact; selecting a representative pin set is a decision for the fix
session, which should choose its pins to match the guard it is building. *Where work implies a
change elsewhere, write it down as a proposal rather than make it.*

### What the campaign is

Express each built-in as a vocabulary artifact, generate the attack set, execute it, and produce a
**defect inventory with reproducible minimal pairs** — the decaf review's shape, thirteen times.

1. **Synthesise a `vocabulary.json` per key.** `CLAIM_TERMS` carries bare strings; the artifact
   requires, per term, `grounding` (at least one citation), `positive_examples`, and — for every
   violating term — `contradicting_examples` **and** `must_not_contradict_examples`. That last field
   is the whole point and **cannot be derived**: it enumerates the ways a *compliant* store mentions
   the substance, which is a claim about how merchants write, not about the term. A human writes it
   or the pass is theatre.
2. **Write the category contexts.** Only `attack/contexts/coffee.json` exists. Class 2
   (adjacent-domain collisions) contributes almost nothing without one, and the templatizer reports
   those cells as `requires_category_context` rather than as clean — which is correct, and which
   means a run without contexts reports mostly "not tested". Five more are needed: personal care,
   supplements, food, drinkware and containers, and general DTC.
3. **Generate.** Thirteen CLI invocations. Effectively free.
4. **Adjudicate.** Roughly 1,500 sentences at the default per-cell cap, ~3,700 uncapped. **This is
   the entire cost**, and METHOD.md §4.2's conclusion applies harder here than it did for one
   vocabulary: generation stops being the expensive step and reading becomes it.
5. **Refute independently, then inventory.** Each confirmed defect gets a minimal pair — the sentence
   that misfires and the smallest edit that stops it — because a defect without a minimal pair cannot
   be told apart from the guard someone will write for it. This is the move that turned one of this
   project's own findings from "the change caused it" into "the change only altered which strings
   reach the pre-existing leak".

### Shape hazards already visible by inspection — starting hypotheses, not results

- **`organic` is one bare word** and `wholeWord` only blocks `inorganic`. It does not block another
  domain's noun phrase: *"lined with organic cotton"*, *"organic silhouette"*, and the measured
  production case *"the farm's volcanic soils are rich in organic matter"*.
- **`third_party_tested` has `lab tested` in its SUPPORT list.** *"Lab tested for potency in our own
  facility."* satisfies a **third-party** requirement with an in-house lab. The highest-value
  letter-versus-spirit hazard in the set, and it is inside the dictionary rather than outside it.
- **Nine violating terms are unframed states rather than disclosure frames**: `tested on animals`,
  `contains gluten`, `contains wheat`, `with aluminum`, `aluminum-based`, `added fragrance`,
  `contains parabens`, `contains sulfates`, `contains bpa`. *"Unlike sticks made with aluminum, ours
  is a salt."* and *"We replaced our aluminum-based formula in 2022."* both report a contradiction.
  The schema already records this lesson for authored vocabularies — *frame the violating term* — and
  it was never carried back to the built-ins.
- **Orthography is internally inconsistent.** `aluminum_free` covers `aluminium`; `sulfate_free` does
  not cover `sulphate`. `third_party_tested` lacks the fully-hyphenated `third-party-tested`.
- **Four of thirteen keys are unreachable by category routing at all** — `cruelty_free`, `vegan`,
  `sulfate_free`, `fair_trade` — reachable only through the tag fallback, which uses a plain
  substring test with **no `wholeWord`**, unlike evaluation. A tag `vegan leather` can route the
  `vegan` claim onto a wallet. And **`sulfate_free` is dead in the one category it exists for**: the
  shampoo regex routes to `fragrance_free` and `paraben_free`.
- **`ENGINE_CONTRACT.md` publishes the 13 keys with their SUPPORTING terms only.** The violating
  lists — the half that can print *"your copy states the opposite"* — are absent from the contract
  entirely. Fix that first; it is an hour, and it is a prerequisite for anyone reviewing the rest.

### THE TRIGGER, AND WHY IT IS NOT NEGOTIABLE

> **This must run against the SHIPPED engine, not against a pinned worktree.** The matchers are being
> changed right now; an inventory measured against stale code is worthless in the expensive
> direction, because it reports defects that are already closed and misses the ones just introduced.
> Wait for the engine to be quiet, pin the commit, record it in the inventory, and **re-execute every
> claim mechanically against that commit** rather than trusting an agent's verdict. This project has
> twice had an adversarial pass whose verdicts had to be demoted to candidates because `src/` changed
> underneath it, and once had a pass report zero regressions where there were nine.

### The expected yield, stated honestly enough to decide against

- **Roughly 1,500 sentences to read** at the default cap; 3,700 uncapped, of which 62% are dropped by
  the per-cell cap. A cell showing three attacks is not a cell with three available, and a coverage
  report that does not say so reads as completeness.
- **About 170 of them are structurally malformed at source.** The nine `contains X` / `with X`
  violating terms are finite-verb phrases, and every template routing through a noun-phrase transform
  produces ungrammatical copy from them — *"Our product is free of contains gluten."* Those are
  coverage-count inflation, not attacks. **This is itself the campaign's highest-value early finding
  and it is a generator defect**: the templatizer has no shape case for a finite-verb violating term.
- **The `violation` class — the one that produces the unrecoverable error — is the SMALLEST class in
  the set**: about 39 sentences across all thirteen keys, and it exercises nothing at all for the
  four keys with no violating terms.
- **The last full adversarial pass left 75 residual defects already live in production, and that pass
  resolved `INCOMPLETE`** — so 75 is a floor of unknown depth, not a count, and its own bucket
  arithmetic leaves 26 of 123 claims unlabelled. This campaign adds to a pile the project cannot
  currently clear. **An inventory is a specification for a campaign, not a session's deliverable**,
  and it should be sized and scheduled as one.
- **It buys no independence.** A generated attack set is still the author's own set. The decaf review
  verified 21 narrowings by re-running the attacker's own sentences — which felt independent and was
  not — and an independent refuter then found a false claim in the committed review record: a class
  reported as 5 of 5 closed was 13 of 13 still failing. Generating 1,500 sentences changes the cost
  of coverage and changes nothing about that.
---

## G-15 — REFERENT: the term's governing noun phrase does not denote this product

> **Filed at v3.7 CP-4 as a NUMBERED GAP, and deliberately not as a proposal or a design.** v3.6
> measured this residual and reached its own conclusion in one sentence: *"The measurement licenses
> SCOPING the residual as a numbered gap; it does not license shipping a guard for it."* This section
> is that scoping. It contains no rule, no term list and no frame, on purpose.
>
> **It is NOT on the priority list.** G-06 §1+§3 stays item 1. G-15 has a precondition (below) that
> is itself an unscheduled attended session, and every subject-shaped change this repo has measured
> has come back worse than the code it replaced.

**Blocks:** nothing in any standard's tier — every affected row runs and returns an answer. What is
broken is **truth on rows that run**, which is why this is a gap and not a coverage item. It is the
largest measured live defect class in the engine and it reaches every merchant the product has.

### The measurement

335 deduplicated real stores (166 coffee / 169 general), one product each, 3,349 prose sentences,
replayed through `fetchPublicProduct` → `buildBuyerTask` → `evaluate` with only the transport
swapped; 335/335 readable, 0 replay misses, resolves COMPLETE. All **71 passing claim rows** over 54
stores read individually with no unadjudicated remainder. Records: `experiments/v3-6/freq/` and
`experiments/v3-6/collapse/`.

```
71 passing claim rows   →  41 true · 17 FALSE PASSES over 14 stores
                           2 wrong-evidence-but-incidentally-true · 9 marginal
                           2 not adjudicable because the row renders no quote
as a merchant SEES it   →  34 rows, 10 false, 6 attributable to a named stratum
```

| | of the 17 confirmed false passes |
|---|---|
| **REF hostile** — the term's governing NP does not denote this product | **17 / 17** |
| **REF the SOLE hostile dimension** | **14 / 17** |
| TIME hostile (the property is not asserted as holding now) | **0 / 17** |
| SPKR hostile | 1 / 17 |
| FORCE hostile (the predicate is not an assertion) | 2 / 17 |

**One capability, not eight.** The classes G-06 lists as staying open — sibling product, bundled
item, competitor, cross-sell, gift set, subscription rotation, shipment, packaging, review
pull-quote — are not nine problems. `sibling_product` · `bundled_item` · `competitor` ·
`cross_sell` account for 9 of the 13 attributable rows and **one referent resolution moves all
four**, because in each the term's governing NP denotes something other than the product under
test. `site_wide` (2) · `subscription` (1) · `industry_generic` (1) complete the 13. Four of the 17
sit outside all 21 strata — two are `single-origin` inside a sentence describing a *blend*, two are
the soil-science sense of `organic` — and both shapes are **structurally REF instances too**, so
the same capability partially subsumes a class currently filed under G-14.

**And it is not the SUBJECT.** 8 of the 17 have no surface subject at all (imperatives, NP lists,
participial fragments); 1 more has *this product* as its subject and is still false
(`blossomcoffeeroasters.com`, *"our Cold Brew Blend features a washed single-origin from
Guatemala"*); and five must-not-regress cases share `xsl-01`'s exact subject `We`. **9 of 17 are
unreachable by any subject frame before a single collision is counted.** Executed: the engine
returns an identical outcome *and an identical matched term* on 17/17 minimal pairs, so it reads
none of this today.

**The cost side, which is 10–60× the benefit side and is why nothing ships on this number alone:**
`first_person` is **180 of 335 stores — 53.73%, exact, not a projection**, because that detector is
presence of *we/our/us*; `trade_form` is projected at **90–211 of 335 (27–63%)**; `plain_present`
91–175; `spec_block` 66–144. And **2 of 16 sampled `already_refused` hits are `without X` used as
the claim itself, on live passing rows today.**

### ⚠️ PRECONDITION — the acceptance suite tests the wrong sentences, and a guard validated against it is validated against nothing

This is the part of G-15 that must be read before any design, and it was sharpened at v3.7 CP-4 by
re-executing the adjudications against `standards/acceptance/subject-tense/suite.json` rather than
by reading the v3.6 writeup.

- **`competitor`: the suite's cases are RIVALS; the real instances never are.** `cmp-01` and `cmp-02`
  are both *"Northbank Coffee …"* — a named competing roaster. Of 25 adjudicated real occurrences,
  **0 are a rival.** Every confirmed one is a **supplier, farm or co-operative**
  (`tinyarms.co`, `spyhousecoffee.com`, `pilgrimscoffee.com`). A referent rule tuned to separate
  "our product" from "a competitor's product" is tuned against a sentence merchants do not write.

- **`site_wide`: the suite's cases are QUANTIFIED; the two that actually cost something are not —
  and the site_wide detector never fired on either.** `sit-01` (*"All of our decafs use the Swiss
  Water Process."*) and `sit-02` (*"Every decaf we stock is a Mountain Water Decaf."*) both lead with
  a quantifier, and so do **9 of the 10** detector-confirmed real occurrences. But the two
  consequence rows — the passing rows a site-wide reading makes false — are
  `brooklyncandlestudio.com` *"Shop for vegan luxury products crafted in Brooklyn."* and `equator.ca`
  *"Equator Coffee Roasters specializes in roasting and delivering fresh organic coffee."* **Neither
  carries a quantifier, neither appears in `hits/site_wide.jsonl` at all, and the detector classified
  both as `trade_form`.** The shape that causes the damage is *the store as an entity does X*, with no
  quantifier and often no finite predication of the product — and it exists in the suite in **neither
  direction**.
  ⚠️ Do not restate this as "site_wide's real instances carry no quantifier" without the
  occurrence/consequence split. Read over occurrences it is false (9 of 10 carry one); read over
  consequences it is true (0 of 2). Two different populations, opposite answers, one stratum name.

- **So suite 1.0 cannot serve as the gate.** It needs a **1.1 derived from the adjudicated real
  instances** — expected outcome = the recorded adjudication, provenance per case, a pinned
  matched-term per case with a dictionary-hash tripwire, **additive to a byte-frozen 1.0**.

⚠️ **AND THE SESSION THAT BUILDS THE GUARD MUST NOT BE THE SESSION THAT AUTHORS SUITE 1.1.** A guard
measured against a gate its own author wrote is v2.6's failure mode, and it is the disguised form of
the rule this repo has now recorded seven times: re-running the attacker's own sentences after the
fix feels independent and is not. Suite 1.1 is **its own attended session, derivation-only** — no
guard, no matcher, no frame.

### ⚠️ One case in the 17 is arguably not a false pass at all, and the real shape is absent from the suite

`sub-01` has **no hostile dimension on any of the four axes**. Carrying it in the 17 is defensible
only as "the evidence is about a subscription rather than about the product", which is a referent
claim the case's own labelling does not support — so the 17 should be read as **16 firm + 1
contested**, and any design that reports closing 17 of 17 has miscounted its own target.

The real-world subscription failure is different in kind and the suite contains it in **neither**
direction: a **disjunctive purchase option** — *"Available as a one-time purchase or on
subscription"* — where the product genuinely can be bought either way, so a rule that treats any
subscription mention as hostile produces a false **fail** on a compliant merchant. `subscription` was
also v3.6's **highest-precision detector** (12 of 13 sampled hits confirmed), which makes it the most
tempting stratum to write a rule against and the one where a wrong rule is most likely to ship.

### 🔴 ATTEMPTED AT v4.0 AND REVERTED — the cost is now a number, not a fear

**G-15-R**, a supply-chain **attachment-head veto** with a partitive predicative branch, was
designed, implemented, wired, measured and reverted in one session. It is the **sixth**
subject-shaped attempt in this repo and the **fifth** to be reverted. It never reached
production and `main` never carried it; the record is commit `deb0fe1` on
`feat/v4-0-referent`, reverted in the commit that follows it.

```
CLOSED   6 of its own 8 primary real-copy targets (A022 and A047 survived)
COST     119 confirmed true-row losses
RATIO    19.8 true rows lost per real-copy defect closed
BAR      2.33 (strict) / 5.13 (raw) — experiments/v3-9/out/robust.json
                                              8.5x over. No discounting reaches the bar.
```

**Every instrument the author could run said ship.** 349-store A/B over 2,928 rows: 4 status
changes, all `pass_evidenced → not_proven`, all on rows the v3.9 adjudication confirms
misleading, **0 true rows lost**. Suite 1.0 `4/37 → 5/37`, must-not-regress `19/19`. Suite
2.0 hostile `0/8 → 6/8`, must-not-regress `17/17`. G-14: 13 cells moved, all `wrong_subject`,
all down. A fourth attacker separately measured **0 occurrences of the blocking frame across
319 snapshots** and 4 flips in 11,791 executions, all correct.

Four independent attackers executing **chosen input** against the same frozen commit found
**126 candidate regressions**, of which a refuter re-executing every one confirmed 119.
**Tenth instance in the series, and the second time the gate ran BEFORE ship rather than as
an autopsy.**

#### THE FINDING IS A DIRECTION ERROR, NOT A LIST HOLE — which is why no dial-down answers it

`referentVeto`'s Rule 1 reads only **FORWARD** from the matched term and never checks whether
the term is already predicated of the product **behind** it. Rule 2 computes exactly that
predicate (`before` + `COPULA_LEAD`) and spends it on the partitive branch alone. So the
bridge crosses a bare `and` — which `CLAUSE_SPLIT` does **not** cut on, because it requires a
comma — walks out of the clause carrying the claim, and vetoes on **the subject of the next
independent clause**. `FOLLOWER_OK` then accepts that subject's finite verb, so the
head-position test returns its most confident answer on exactly the input where it is wrong.

Executed here, guard-off and guard-on in one process, three-legged canary live
(`experiments/v4-0/verify_kill.ts`) — **13 of 13 lost**:

> *"The beans are organic and farmers in Huila are paid above the C price."* → `not_proven`
> *"The granola is gluten free and family farms in Montana grow the oats."* → `not_proven`
> *"The bottle is BPA-free and local growers are paid within seven days."* → `not_proven`
> *"This coffee comes from an organic farm in Antioquia."* → `not_proven`

Note the second and third: `gluten_free` is an **allergen** row, and `bpa_free` has no
agricultural reading at all. **The class is not confined to the claims the guard was aimed at.**

⚠️ **ONE COMMA FLIPS THE VERDICT, and the merchant cannot see why.** Executed minimal pair:
`"The bar is vegan and small farmers are paid a premium."` → `not_proven`; the same sentence
with a comma before `and` → `pass_evidenced`. The forward scan and the clause splitter
disagree about where a clause ends.

#### What a successor must answer BEFORE writing any list

1. **Decline the veto when `COPULA_LEAD` matches immediately before the term and the copula's
   subject is not partitive.** The predicate is already computed; it is simply not consulted.
2. **Stop the bridge at any coordinator introducing a new finite clause**, or remove the
   coordinators from the bridge entirely.
3. **`ENTITY_HEAD` conflated parties with PROCESS nouns, and the file decided that question
   against itself.** `practices` / `principles` / `methods` were excluded *with the reason
   written out* — *"grown using organic methods"* is a live passing row adjudicated NOT
   misleading — and the bare deverbal nouns those words modify (`farming`, `agriculture`,
   `cultivation`, `husbandry`) were kept. Executed: *"Organic farming is used from seedling to
   harvest."* fails while *"Organic farming practices are used from seedling to harvest."*
   passes. **Same proposition, opposite verdict, decided by morphology.**
4. **For `fair_trade` the certification is held by the producer organisation BY DEFINITION,
   and for `organic` it attaches to the operation and the cultivation practice.** A rule
   premised on *"the head is a supply-chain party, therefore not about the product"* is
   inverted for the two keys carrying the most dictionary terms. `single farm` is itself a
   SUPPORT term for `single_origin`, so the vocabulary treats a farm as proof while the guard
   vetoed the adjacent phrasing.
5. **The partitive branch has no test that its subject denotes a class.** `PROPORTION`'s
   of-less alternative matches any leading `most|many|much|some|several|plenty` with no
   plural or mass head required, so fronted adjuncts fire: *"Much loved by pastry chefs, the
   oil is certified organic."*, *"Most notably, the flour is organic."* — and the real brand
   *"SOME BY MI is vegan and cruelty free."*

⚠️ **THE PRE-PRICED DIAL-DOWN WAS FALSE AS MEASURED, and the way it was wrong generalises.**
The design priced dropping `LANDHOLDING` as *"removes every farm-direct hazard"*. Measured two
ways on the frozen tree: **4 of 17** and **54 of 119** — under half, and it touches none of the
copula class. **A dial-down priced against the author's own corpus was priced against the
instrument that cannot see the class.**

⚠️ **BLAST RADIUS REACHED THE PUBLISHED CONTRACT.** The guard was mirrored into
`standards/vocabulary.ts` — correctly, since otherwise the acceptance suites would have
measured the guard-OFF path — so every published Coffee Standard claim row inherited it. A
successor must scope that deliberately. It also fired identically on `product_title` and
`product_options`, the two surfaces whose corpus coverage is **zero**; they were safe only
because the finite-verb gate declines fragments, which is an accident of syntax rather than a
surface gate.

**What the attempt bought, recorded so the revert is not read as the work being worthless:**
6 of 8 targets closed, **0 of 18 honest carriers lost**, the corpus instrument clean, and the
finite-verb gate holding under 13 direct title/option probes. The design is sound where it is
measurable and it is unmeasurable exactly where it is wrong.

### Risk of building it

**Highest on this page, and the history is the argument.** Every subject- or scope-shaped change this
repo has measured has come back worse than the code it replaced: v2.6's negation-scope rewrite;
v2.8's `origin` narrowing, reverted after four attempts and now a tombstone; v3.2's four aboutness
guards, reverted when two independent attackers found **192 regressions** where a 216-store replay
found **0 real positives lost**. G-15's blast radius is measured and enormous — `first_person` alone
is 53.73% of stores — and the 17 rows it would fix are 17.

**What would make it safe, in order:** (1) suite 1.1, authored by a different session, from the
adjudicated real instances; (2) a fail-open design, because the ordinary subject-less sentence that
fills a Shopify description must keep passing (`nonProductSubject`'s rule, for the same reason);
(3) an independent adversarial pass as the **gate**, not as an autopsy — v3.5 ran one as a gate for
the first time and it paid for itself immediately, refusing a change a 338-store replay had approved;
(4) an A/B against the parent commit comparing **the rendered quote**, not the status, because two of
v3.5's eleven regressions were invisible to a status diff.

---

# STANDING PROPOSAL REGISTER

> **The rule:** *where work implies a change elsewhere, write it down as a proposal rather than make
> it.* An agent that fixes what it notices produces a diff nobody scoped, in files someone else
> owns, justified by reasoning that is not in the record. A proposal costs one table row and
> survives the session.
>
> **A row here is DATA, not a decision.** Nothing may cite a proposal as though the owner had agreed
> to it. A row leaves this register only by being **applied** (with the commit) or **rejected**
> (with the argument). It does not leave by going stale.

Opened at v3.4 CP-2. Each row names the file, the change, the argument, and **who decides**.

**P-06 … P-14 were filed at v3.5 CP2d**, out of one independent adversarial pass over the identifier
row — 78 cases, 234 executions across three worktrees, 0 failures. They are not nine unrelated
observations; they cluster, and the clustering is the useful part:

| rows | the one thing they are about | who has to move first |
|---|---|---|
| **P-06 · P-07 · P-12** | *which value on the page is this product's GTIN* | P-12 is a DOCUMENT question and the other two presume its answer |
| **P-08 · P-11** | *when are two different strings the same identifier* | the standard — there is no normalisation rule at all |
| **P-09 · P-10 · P-14** | *how far rule D reaches* | the engine, except P-14's first half |
| **P-13** | *are GS1 reserved prefixes acceptable evidence* | the standard; low priority, and it says so |

**P-15 was filed at v3.5 CP3**, and it belongs with the first row: it is what P-12's absence makes
the engine *say*, measured on 34 stores.

**P-17 was filed at v3.7 CP-1** and belongs to none of them either. It is the one row on this page
that is not about language: four defect classes in the **fetch and normalisation** layer, carrying
14 of the 18 confirmed false passes the first complete general-sample audit found — a currency
never read, integer cents read as dollars, a missing availability flag defaulted to purchasable, and
a "lowest readable price" that is the page's maximum. Its real content is that **that layer has
never been attacked**, by any of this project's five adversarial passes.

**P-16 was filed at v3.5 CP5** and belongs to none of them: it is not about identifiers at all. It
records that the 338-file snapshot corpus every bound in this repo is computed over holds **334
distinct merchants**, and that no published figure moves for it — which is a fact about the
INSTRUMENT, and the only reason it is here rather than lost is that a bound was recomputed and
somebody counted first.

⚠️ **Two of these are not "future work" in the ordinary sense.** **P-11** records a mechanical,
one-character bypass of a guard that shipped days ago. **P-12** records a merchant who marks their
page up *correctly* and is told they publish no identifier — and as of v3.5 CP3 it is no longer a
constructed case: **six named real merchants**, four of whom need no descent at all. Both are pinned
as executable corpus cases, so neither can go quiet — but neither is waiting on a discovery, only on
a decision.

## P-01 · Three coffee entries are `blocked_by` a gap that is now CLOSED

| | |
|---|---|
| **file** | `standards/coffee/v1.0/standard.json`, `standards/coffee/v1.1/standard.json` |
| **change** | drop `"G-10"` from `blocked_by` on `INGR-001`, `ALLERG-001`, `KONA-001` |
| **decides** | the coffee standard's owner |
| **tier impact** | **NONE.** Each entry retains a live blocker, so all three stay `blocked`. |

Verified by reading both artifacts, not by grep over prose:

| entry | `blocked_by` now | after | still blocked by |
|---|---|---|---|
| `...-INGR-001` | `[G-06, G-10]` | `[G-06]` | G-06 — the claim dictionary is closed |
| `...-ALLERG-001` | `[G-06, G-10]` | `[G-06]` | G-06 — same |
| `...-KONA-001` | `[G-01, G-10]` | `[G-01]` | G-01 — provenance has no mechanism |

**Why it still matters even though no tier moves.** `blocked_by` is the machine-readable answer to
*"what would it take to run this?"*. A closed gap listed there overstates the cost of unblocking the
entry and points a future session at work that is already done — the same failure as this file's own
stale priority list, one artifact down.

⚠️ **This is a REISSUE, not an edit.** `standard_hash` covers `standard.json`'s bytes and every
citation resolves through it, so v1.1 cannot be edited in place. Either fold the correction into the
next version with `supersedes` carrying the prior ids, or leave the documents alone and let this row
carry the correction. **Do not hand-edit a published document to fix a field.**

## P-02 · Five `unbound` entries — three need a BINDING, two need an ENGINE change

Per [`experiments/v3-4/DECISION.md`](../experiments/v3-4/DECISION.md) §3, grammar 1.2 adds the tier
`unbound` for the state these five are actually in: *the engine can run this, public data can
adjudicate it, and this standard has not authored a binding or put it through the adversarial pass.*
All five currently sit at `not_discriminating` with **no `binding` and no measurement**, which 1.2
correctly forbids.

> ⚠️ **THE DISTINCTION THIS ROW EXISTS TO ENFORCE: a standard-side gap is NOT an engine gap, and
> must not be filed as one.** Three of these five need nothing from the engine — only authoring work
> the standard has not done. Filing them as engine gaps would inflate this register with items no
> engine session can act on, and would let a standard's unfinished authoring read as a platform
> limitation. Only the two marked 🔧 are engine work.

| entry | question | fitting engine kind | classification |
|---|---|---|---|
| `...-STOCK-001` | "Can I actually buy this right now?" | `in_stock` — **exists, no change needed** | 📗 **standard-side.** Binding + adversarial pass not authored. |
| `...-TERMS-001` | "Can I buy a single bag without a subscription?" | `no_subscription` — **exists** | 📗 **standard-side.** Absence-based: `passing_states` may list **`pass_no_blocking` only**, and `compile.ts` throws if `pass_evidenced` is listed for this kind. The entry must not be worded as though a one-time purchase were *proven*. |
| `...-DIET-001` | "Is this coffee vegan and gluten-free?" | `claim` × `vegan` / `gluten_free` — **both live keys** | 📗 **standard-side.** Needs two entries, or one compound decision. ⚠️ `ENGINE_CONTRACT.md` §1.1 records that this standard *deliberately does not ask* these, on discrimination grounds — so the first question is whether to bind it at all. |
| `...-PRICE-001` | "What does this cost?" | `price_under` exists but **requires a `cap_usd`**; there is no kind for *"a price is published"* | 🔧 **ENGINE.** See P-02a. |
| `...-DECAF-004` | "Can I buy a decaf version of this same coffee?" | **none** — it adjudicates a *different product* | 🔧 **ENGINE.** See P-02b. |

### 🔧 P-02a — a `price_published` shape, or a nullable cap on `price_under`

`price_under` answers *"is the lowest readable price below N?"*. `PRICE-001` asks *"is a price
published at all?"*, which has no kind. Encoding it as `price_under` with an absurd cap would make
the standard assert a threshold it does not mean, and the rendered label would say so to a merchant.

⚠️ **And it may not be worth building.** `ENGINE_CONTRACT.md` §7 measures `price_under` at a
**0/13 fail rate — zero information** — and the claim linter carries a dedicated
`price-is-always-public` rule forbidding any "price not stated" phrasing, *because price is always
public on a Shopify product*. An assertion that passes for every store is the `cruelty_free` failure
with the sign flipped. **Recommendation: do not build it. Retire the question, or keep it advisory
with that measurement cited in its own reasoning.**

### 🔧 P-02b — a cross-product kind

`DECAF-004` asks whether a decaf version of *this* coffee exists. Every one of the engine's kinds
compares evidence about **one** `PublicProduct` against a value fixed in the contract; nothing
addresses a sibling product. This is a genuinely new capability, and it is **not** G-13 (a
buyer-supplied parameter) or G-12 (per-offer resolution) — though it shares their unanswered
state-model question, which is now wanted in four places and should be settled once.

⚠️ **It also inherits G-06's hardest measured finding.** "A decaf version exists" is a *sibling
product* claim, and sibling attribution is the exact class G-06's refutation measured as **0 of 12
closed** — `"Our Ethiopian decaf uses the Swiss Water Process."` still passes on a page selling the
caffeinated lot. **Recommendation: do not open this as a buildable gap until subject attribution
moves.** File it as a question the grammar can express and the engine cannot answer.

## P-03 · `compile.ts`'s thrown message describes behaviour that no longer exists

| | |
|---|---|
| **file** | `standards/compile.ts:141` |
| **change** | the `CompileError` message says an unknown claim key means `evaluate()` **"would throw, not fail the row"** |
| **decides** | the owner of `compile.ts` |

G-06 §2 closed in `d35b26e`: `evaluate` now returns `unsupportedRow` (`productTest.ts:1635`) instead
of dereferencing `undefined`. The message is user-visible output — **logic, not a comment** — so the
v3.4 CP-2 documentation pass that found it did not edit it. The comment above the throw records the
discrepancy in place rather than leaving the two silently disagreeing.

⚠️ **The refusal itself must NOT be relaxed, and that is the substance of this row.** The runtime
change makes a bad key *survivable*, not *acceptable*: it costs the merchant one unchecked row, and
a conformance list silently answering "we couldn't check this" for an entry the standard publishes
is the failure G-10 was built to prevent, one layer down. Only the wording is wrong. Suggested:
*"...`evaluate()` would report the row as unchecked rather than answer it."*

## P-04 · A document that cites `file:line` needs the check WIRED, not just performed

| | |
|---|---|
| **files** | `package.json` (test/typecheck wiring), `experiments/v3-4/verify_contract.mjs` |
| **change** | run the citation verifier in CI over `ENGINE_CONTRACT.md`, `ENGINE_GAPS.md` and `compile.ts` |
| **decides** | the owner of the build |

At v3.4 CP-2, **81 of 112 citations in `ENGINE_CONTRACT.md` were wrong** and every gate was green,
because no gate reads them. This is the same shape as the rule already in `CLAUDE.md`: *"Merging
`standards/` protected nothing until it was wired."* A correction performed once decays at exactly
the rate the engine changes, which is fast.

The verifier is cheap — no network, one `git show` per cited file — and resolves to
`VERIFIED_CLEAN` / `DEFECTS_FOUND` / `INCOMPLETE` per `src/measure/completion.ts`. It needs one
addition to become a gate: **each document must declare its base commit in a machine-readable form**
rather than in prose, so the check cannot silently compare against the wrong commit.

⚠️ **And it must fail on `INCOMPLETE`, not only on `DEFECTS_FOUND`.** Its own first run extracted
**zero** citations from `compile.ts` and reported a 102-row tally that looked complete. A gate that
treats "found nothing" as "nothing is wrong" is the instrument this repo has been burned by four
times.
## P-05 · `compile.ts` does not know the tier grammar 1.2 adds, and its `not_discriminating` label is now false

| | |
|---|---|
| **file** | `standards/compile.ts:50`, `standards/compile.ts:231-232`, `standards/compile.ts:278` |
| **change** | add `"unbound"` to `StandardEntry["tier"]`; correct the `not_discriminating` explanatory string |
| **decides** | the owner of `compile.ts` — **coordinate with the schema owner**, since `schema.json` is the authority on the tier set |

Grammar 1.2 adds the tier **`unbound`** (DECISION.md §3) and redefines `not_discriminating`. Two
consequences in this file, and **both are logic, so a v3.4 CP-2 documentation pass left them**:

1. **`StandardEntry["tier"]` is a closed union that does not contain `"unbound"`**
   (`standards/compile.ts:50`). A 1.2 standard will not type-check against it.
2. **The string at `standards/compile.ts:232` describes the retired rule.** It reads:
   *"not_discriminating — the engine could run it; the **predicted** failure rate is outside 15-85%
   so the row would carry no information."* Under 1.2 `not_discriminating` **requires a measurement**
   — it is schema-rejected without a `measured_discrimination` whose verdict is `not_discriminating`
   — precisely because the predicted band was refuted: bands held **1 of 10** at n=100, every miss
   HIGH. The string states the exact reasoning the grammar removed.

⚠️ **The two are not independent, and the ordering matters.** `unbound` exists *because* correcting
the `not_discriminating` rule leaves five entries with no honest tier: they have no `binding`, so
they cannot be `executable`; no measurement, so they cannot be `not_discriminating`; and `advisory`
("public data cannot adjudicate it") and `blocked` ("the engine cannot yet") are each **false** for
at least three of them. Adding the tier without fixing the string, or the reverse, leaves the file
describing a grammar that does not exist in either direction.

⚠️ **Do not widen the union to `string`.** The closed union is what makes an unknown tier a type
error rather than a silent pass, and it is the same guarantee as the exhaustive `ReqKind` switch
this file's header describes. `unbound` should be added as a member — and, since an `unbound` entry
carries **no `binding` by construction**, `compileStandard` must skip it exactly as it skips
`blocked`, never attempt to compile it, and **report it as skipped with a reason** (G-10's rule: a
list that drops entries silently is worse than one that runs them all).

## P-06 · The narrowed GTIN descent — measured only against the set that failed the wide one

| | |
|---|---|
| **file** | `src/crawler/extract.ts` (`selectGtin`) |
| **change** | descend into `offers[]` / `hasVariant[]` / `isVariantOf[]` **only when exactly one distinct publishable GTIN is reachable across all of them**; otherwise report the product node's value, as today |
| **decides** | the owner of the engine |
| **status** | **NOT SHIPPED.** Proposed by the v3.5 adjudicator; withheld for the reason below |

**What it would buy, measured.** 32 of 338 captured real stores publish a check-digit-valid GTIN
only in a nested node and are told they publish no identifier at all. The adjudicated cases are
`G-03`, `G-06`, `R07` (a single offer or variant with one barcode) and `R09`–`R12`, `G-05`, `G-08`,
`G-10`, `R19`. The corpus pins four of them as open gaps in `ld-selection`.

**Why it is not shipped, and the reason is the method, not the rule.** The predicate was derived
from the same 78 adversarial cases that the wide descent failed. Validating a fix against the test
set that produced it is fitting; this project has been caught by that six times and wrote the rule
down after the fifth. The proposal is plausible and it is **unmeasured against anything it has not
already seen**.

**What it would have to clear before shipping.** The v3.5 CP-2 spec's own list, unchanged: a fresh
adversarial pass by attackers who did not author the predicate; mechanical A/B attribution against
the parent commit in full `git worktree` checkouts with a two-sided liveness canary; a natural-
frequency read of how many real merchants it newly passes and whether they are right; and a stated
answer to the question the wide rule got wrong — **what "exactly one distinct" means when the same
GTIN appears on four variants** (adjudicated `R08`, an attack the standard records as
`survived_unchanged`, so duplication must still pass) versus when three variants disagree
(`conflict_rules[1]`, which the standard declares blocked).

⚠️ **And a narrowing does not reach `R13`.** There the page publishes exactly ONE distinct nested
GTIN and it is the storefront's own product key. A uniqueness predicate passes it, names it as the
merchant's GTIN, and hands the merchant the exact value rule D rejects one field over. Whatever
ships must carry the P-11 value test as well, or it re-opens the class CP2b closed.

### ⚠️ THE THREE REGRESSIONS THAT SURVIVE THE REVERT, AND WHY THEY ARE THIS ROW'S PROBLEM

Re-running the 78-case bundle in **four** worktrees after the revert (`base af6d387` → `d151876` →
`1c0dc41` → `0f0317a`, 312 executions, `VERIFIED_CLEAN`, 0 drift on the three shared trees) leaves
**3 status regressions and 0 quote regressions**, down from 9 and 2. All three — `X-01`, `X-04`,
`R15` — are one page shape, and the shape is this row intersecting rule D:

| | |
|---|---|
| the page publishes | `mpn` = the storefront's own product key, and a valid GTIN in `offers[]` / `hasVariant[]` |
| `af6d387` answered | **pass**, ON THE MPN — right in status, and its rendered evidence named a string that resolves to nothing outside that one store |
| today | **not_proven** — rule D refuses the key (correctly), and the reverted selector cannot see the GTIN |

**Base was right for the wrong reason and the regression is a FALSE FAIL.** That is not a defence of
the current answer; a merchant publishing a real GTIN is told they publish no identifier. It is the
attribution: the status flip is caused by rule D removing a value that should never have carried the
row, and this gap is what used to hide it.

⚠️ **It is also the strongest argument for doing P-12 before P-06.** A node selection rule would let
these pages answer from the merchant's own markup. Re-widening the descent would answer them by
picking a variant — which is what produced the nine regressions this revert removed.

## P-07 · `selectGtin` returns the first NON-EMPTY key, not the first PUBLISHABLE one

| | |
|---|---|
| **file** | `src/crawler/extract.ts` (`selectGtin`) |
| **change** | on the product node only, return the first of the five keys whose value passes `isPublishableGtin`, falling back to the first non-empty one when none does |
| **decides** | the owner of the engine |

`{"gtin13": "4006381333930", "gtin12": "036000291452"}` reports the malformed `gtin13` and the row
answers *"your product structured data publishes no GTIN or MPN"* to a store publishing a valid
GTIN-12 on the same node. **No nested node is involved**, so this carries none of P-06's risk: the
value still comes from the product node, and the fallback keeps `product.gtin` exactly what it is
today whenever nothing validates.

⚠️ **It is separable from P-06 and should be decided separately.** CP2a bundled the two and the
bundle was reverted whole for byte-identity with `af6d387`, so this correction was lost to a
decision that was not about it. Pinned as an open gap at `ld-selection`'s
*"an INVALID gtin13 hides a VALID gtin12 on the SAME node"*.

⚠️ **Nobody has attacked it.** It appears in none of the 78 adversarial cases, so "carries none of
P-06's risk" is an argument from the shape of the change, not a measurement. It needs its own
adversarial pass, small as it looks.

## P-08 · The standard has no NORMALISATION rule, so a decorated key defeats a byte comparison

| | |
|---|---|
| **files** | `standards/coffee/…/standard.json` (`IDENT-001`), then `src/server/productTest.ts` (rule D) |
| **change** | state which decorated forms of a value count as the same value, then implement the stated rule |
| **decides** | the coffee standard's owner, THEN the engine owner — in that order |

Rule D compares `mpn` to `meta.product.id` byte for byte. Two adjudicated residuals sit on either
side of one gap:

| case | `meta.product.id` | published `mpn` | outcome |
|---|---|---|---|
| `EVA-03` | `8079462006899` | `gid://shopify/Product/8079462006899` | passes |
| `D-06` | `gid://shopify/Product/7215488761946` | `7215488761946` | passes |

In `EVA-03` the object rule D **already parsed** publishes `product.gid` carrying the very string in
the `mpn`. Nothing has to be guessed at; the engine has both forms in bytes it holds. But
"which decorations of a key are the key" is a rule about VALUES, and `IDENT-001` states none — its
`insufficient_evidence` clause says only "the value the storefront also uses as its own product or
variant key". A byte comparison is one reading of that; `gid://shopify/Product/<id>` being the same
key is another. **The engine must not invent the answer**, which is why this is filed against the
document first.

⚠️ **Scope it, or it becomes a fuzzy match.** The failure mode is the one this repo names elsewhere:
"byte-identical, not looks like". A normalisation rule that strips a *known, enumerated* Shopify
GID prefix is decidable; one that strips "any prefix ending in a slash" fails merchants whose real
part numbers contain slashes. Both directions need a corpus case.

## P-09 · v1.3's clause names the VARIANT key; rule D was scored on the PRODUCT key alone

| | |
|---|---|
| **file** | `src/server/productTest.ts` (rule D) |
| **change** | compare `mpn` against `meta.product.variants[].id` as well as `meta.product.id` |
| **decides** | the owner of the engine |

`ALS-COFFEE-1.3-IDENT-001`'s `insufficient_evidence` reads "its own product **or variant** key".
Rule D reads the product key. Adjudicated `D-05`, `EVA-13`, `EVA-14` — the last of which has no
`product.id` in the bootstrap at all, so the variant list is the only key on the page.

**The measurement that argued against shipping it, and it is a weak argument in one direction.**
Variant-key-in-`mpn` occurs **0 times in 338 captured real stores**, so widening rule D would ship
an unmeasured rule to close a class the corpus does not exhibit. That is a real reason to wait and
it is *not* evidence the class is rare — a 338-store sample containing zero instances bounds the
rate at roughly 1 in 113 (rule of three), which is not "never".

⚠️ **The negative control is load-bearing and must survive any widening.** The existing corpus case
*"the product key is read past `variants[]` that come FIRST"* exists because a bare regex over the
first `"id"` returns a VARIANT's key on a theme that reorders keys. If variant keys become
disqualifying, that case stops distinguishing a parser from a regex and a **replacement** control is
owed in the same commit.

## P-10 · Rule D reads ONE emitter in ONE shape, and `pass_means` promises "somewhere legible"

| | |
|---|---|
| **files** | `src/server/productTest.ts` (`shopifyMetaObject`, `shopifyStorefrontObjectId`) |
| **change** | strip HTML comments before the scan; recognise `window.ShopifyAnalytics.meta =`, `const`/`let meta =`, and a `JSON.parse("…")` wrapper; consider `data-product-id` |
| **decides** | the owner of the engine |

Nine adjudicated residuals, one sentence: the storefront's key is legible on the page and rule D
does not read it. Every one **fails open**, so the merchant keeps their pass — the recoverable
direction — but `pass_means` says the disqualification is decidable wherever the storefront
publishes its key "somewhere legible", and decidability is a property of the PAGE.

| class | cases | what the reader sees |
|---|---|---|
| the key is outside the bootstrap | `EVA-07`, `D-10` | no bootstrap, or a single-quoted JS object; the key sits in `data-product-id` and `rid` |
| the bootstrap is in another shape | `EVA-08`, `EVA-09`, `EVA-11`, `EVA-12` | `window.ShopifyAnalytics.meta =`, `const meta =`, a comment inside the literal, a `JSON.parse` wrapper |
| something shadows the bootstrap | `D-11`, `EVA-10`, `EVA-22` | an HTML comment, or **merchant-typed description text**, carrying an earlier `var meta = {` |

⚠️ **`D-11` is the one to read first, and it is not a fail-open case.** An HTML-commented theme demo
before the live bootstrap makes `shopifyStorefrontObjectId` return **`"DEMO-0001"`** — not null. The
engine is not undecided there; it is confidently wrong, and it fails open on a value it should never
have read. **Stripping HTML comments before the scan is the smallest change here and the only one
that fixes a wrong READ rather than a missing one**; it should be decided on its own.

⚠️ **`EVA-22` is a merchant steering the parser that judges them.** The JSON-LD `description` is
store-authored and precedes the analytics script, so `var meta = {}` inside a sentence about theme
installation decides what the engine reads about that store. Whether it is deliberate is beside the
point — this corpus has a named class for merchant-controlled text reaching a matcher, and this is
it, in the bootstrap reader.

⚠️ **Widening the reader widens the attack surface in the same motion.** Accepting more shapes means
accepting more places a page can put something that looks like a bootstrap. Any change here needs
the both-directions corpus rule: for every new shape ACCEPTED, a case where a lookalike must be
REFUSED.

## P-11 · Rule D is scoped to one FIELD, and the value moves — including a one-character bypass

| | |
|---|---|
| **files** | `standards/coffee/…/standard.json` (`IDENT-001`), then `src/server/productTest.ts` |
| **change** | make the internal-object-id disqualification a test on the VALUE in any identifier field, with a stated normalisation for zero-padded GTIN forms |
| **decides** | the coffee standard's owner, THEN the engine owner |

**⚠️ ESCALATED — `EVA-21` is a mechanical, decidable bypass, not a reach limit, and it is the only
one of the fifteen residuals that is.** Executed against the shipped engine:

```
meta.product.id  8079462006891
mpn              "8079462006891"    → rule D fires; the MPN is disqualified
gtin14           "08079462006891"   → ACCEPTED; the row passes and names it
rendered         "Your structured data publishes a GTIN (08079462006891)."
```

**Padding a valid GTIN-13 with a leading zero always yields a valid GTIN-14** — the check digit is
computed right-aligned, so a leading zero changes nothing. Therefore **any store whose object id
satisfies the GS1 check digit has a one-field, one-character bypass of rule D**, and the rendered
evidence names the padded key as the merchant's GTIN.

`EVA-15` is the same gap without the padding: the key published verbatim in `gtin13`, passing on the
arithmetic. `IDENT-001`'s own `why_not` for this clause says the reason "is field-agnostic: it is a
statement about the VALUE, not about which key carries it", and the neighbouring clause already
refuses an internal SKU in the GTIN field — so the document contains the logic and scopes it to the
MPN branch, which is precisely the defect v1.3 was issued to fix, one field over.

⚠️ **The adjudicator REJECTED `EVA-21` as an attacker claim, on normalisation grounds** — the padded
value is literally not the key, and no rule in v1.3 says it counts as the key. That ruling is about
the attacker's claim and is correct. **It is not a ruling about the mechanism**, which is real,
decidable, and recorded nowhere else in this repo. Both facts belong in the record.

⚠️ **This row and P-08 are the same missing thing seen twice**: the standard has no rule for when two
different strings are the same identifier. Decide that once.

## P-12 · The document owes a NODE SELECTION rule, and a correctly-marked-up merchant fails today

| | |
|---|---|
| **files** | `standards/coffee/…/standard.json` (`IDENT-001`), `src/crawler/extract.ts` (`extractProduct`) |
| **change** | state which JSON-LD node answers for the page when several are present, then implement it |
| **decides** | the coffee standard's owner, THEN the engine owner |
| **status** | PRE-EXISTING — present at `af6d387`, unchanged by CP2a, CP2b or CP2c |

`extractProduct` takes the FIRST node of type `Product` or `ProductGroup` in document order.
Adjudicated `G-09`: a merchant doing the schema.org `ProductGroup`/`hasVariant` split **correctly**
emits the group node first, it carries no GTIN, and the row answers `not_proven` to a store
publishing a check-digit-valid GTIN on the node that describes the item. `R19` is the same mechanism
through a recommendation rail.

`IDENT-001` is silent: `accepted_evidence` says "a GTIN in JSON-LD" and names no node.
`applicability.signal` says only "presence of a JSON-LD Product node". Every argument about whether
the engine may read a nested value (P-06) presumes an answer to *which node is the product*, and
there isn't one.

⚠️ **This is the gap P-06 keeps colliding with, and it is the one worth solving first.** A node
selection rule ("the node whose `@id`/`url` matches the canonical URL", say) would make several of
P-06's cases decidable *without* descending into variant lists at all — the merchant's own markup
would say which node answers, instead of the engine picking one and hedging in the copy.

### 🟡 THE SITE'S OWN WORKED EXAMPLE IS AN INSTANCE, found at v3.5 CP5

The "honest pass" row published on every standard page is `sputnikcoffeecompany.com`, and the page
now states what the engine read for it: *"Your structured data publishes an MPN (600160850004)."*
The fixture's own text, extracted from the captured bytes, says the same value is a **valid UPC-A
published as `gtin12`**. Both are true, and the reason is P-12. Read back from the snapshot:

```
node (root) @type=Product   mpn=600160850004,  sku=""      <- selected: first in document order
node (root) @type=Product   gtin12=600160850004, sku=null   <- not selected
```

Two top-level `Product` nodes, the same string in both, and `extractProduct` takes the first. The
verdict is right and the **stated basis is weaker than the merchant's markup**: the store publishes
a check-digit-valid GTIN and is told it publishes an MPN. Nothing was changed for this — the row is
correct, and rewriting the copy would paper over the gap rather than close it — but it belongs in
the record, because the example this project uses to *teach* identifier discipline understates the
one store in it that did everything right.

### 🔴 SIX NAMED REAL MERCHANTS — the strongest evidence in this register, and it is not flattering

Every other case above is constructed. These are stores, measured from their captured bytes
(`experiments/v3-5/ship_pivot.ts` — `DEFECTS_FOUND`, 23/23 rule-D losses examined, 0 snapshots
missing, two-sided canary passing; placement classified by
`experiments/v3-5/copyfix/classify_six.mjs` — `VERIFIED_CLEAN`).

**6 of the 23 real stores rule D newly fails publish a check-digit-valid GTIN in their own JSON-LD.**
All six were `pass_evidenced` at `af6d387` **and** at `d151876`, and are `not_proven` only at head —
so **rule D owns this flip, not the CP2a revert**, and the descent never reached these nodes either.

| store | selected node | distinct publishable GTINs | ≥1 on the OWN key of a Product node we do not select | reachable by descending from the SELECTED node |
|---|---|---|---|---|
| `flybyjing.com` | `Product` | 1 | ✓ | **no** |
| `nomatic.com` | `Product` | 1 | ✓ (inside a later block's `@graph`) | **no** |
| `yellowbirdsauce.com` | `ProductGroup` | 2 | — (only on `Offer`s under another Product) | **no** |
| `monos.com` | `ProductGroup` | 3 | ✓ | **no** |
| `wandpdesign.com` | `ProductGroup` | 4 | ✓ | **no** |
| `negativeunderwear.com` | `Product` | 6 | — (only on `Offer`s under another Product) | **no** |

**Say what happened in the right direction: the row went from right-for-the-wrong-reason to
wrong-for-a-stated-reason.** At base it passed, and it passed **on the `mpn`** — the storefront's own
product key, a string that resolves to nothing outside that one store — so its verdict was right and
its evidence named a value that identifies nothing. Rule D correctly refuses that value, and the
merchant is now told they publish no usable identifier while publishing between one and six real
GTINs. Per `conflict_rules[1]` the STATUS is what the published document licenses. That does not make
it a good answer; it makes it a stated one.

Three things this measurement settles that the constructed cases could not:

1. **P-06 CANNOT ANSWER ANY OF THEM — not wide, not narrowed.** On all six, *nothing publishable is
   reachable by descending `offers[]`/`hasVariant[]`/`isVariantOf[]` from the selected node*: the
   value always sits under a **different** Product node (`enclosing.mjs`, `VERIFIED_CLEAN`;
   `adjudicate_cp1.mjs` counts 0/23 for the descent and 6/23 for the graph). Corroborated by the
   engine itself rather than by a re-implementation: at `d151876`, **with the wide descent live**,
   all six rendered *"Your structured data publishes an MPN (…)"* — the descent named no GTIN on any
   of them. This gap alone answers all six; the register's own priority note ("P-12 before P-06") is
   now a measurement rather than a judgement call.
2. **Four of the six need nothing but the node choice.** `flybyjing`, `monos`, `nomatic` and
   `wandpdesign` carry a value in the own `gtin*` key of a Product node the extractor already
   flattened and merely did not pick. The other two carry theirs on `Offer`s belonging to that other
   Product node, so they need the node rule *and* one step.
3. `verdictOfLd` builds a page with **one** node, so a second, non-selected Product node was
   structurally unrepresentable in the corpus. It is now pinned as a rule-D page case
   (`SIX REAL STORES: the GTIN is on a Product node the extractor does not select`, `nomatic.com`'s
   real shape), `EXPECTED_OPEN_GAPS` 56 → 57 — **+1 case, 0 new defects.**

⚠️ **And CP-1's own account of where these values live was wrong, in the flattering direction.**
`experiments/v3-5/CP1_DECISION.md` states *"Of the 21 general defects, 12 publish a real GTIN
elsewhere — 6 in `offers[].gtin12` / `hasVariant[].gtin`, 6 only in the Shopify variant `barcode`."*
Re-executed: the first half is **0**, for the reason above. The second half is **not measurable from
these snapshots at all** — `pageSufficient` skips the `/products/{handle}.json` tier when the page's
JSON-LD is complete, so it was never fetched and never captured on **0 of 23** of these stores;
`adjudicate_cp1.mjs` reports it `null` and resolves `INCOMPLETE` rather than printing the zero.
The document CP-1 wrote to correct a prior session's whole-body-regex numbers made a scope error of
the same family two headings later.

**The copy defect it exposed, and what was done about it.** The rendered sentence said *"The only
identifier in your product structured data is an MPN (X) … so a machine buyer can't match this
product to a catalogue entry."* Both clauses are false for these six: there is another identifier,
and we never established that a buyer cannot match the product. Fixed at v3.5 CP3 — the sentence now
names where we read and what that excludes, and it is **byte-identical for both shapes**, because the
engine does not look below the product node and so cannot tell them apart. Proof that only the
sentence moved: 338 captured stores replayed before and after through the CP2 harness, **2,847 rows,
0 status changes, 0 quote changes, 23 detail changes and every one an identifier row**
(`experiments/v3-5/copyfix/cmp.mjs`, `VERIFIED_CLEAN`, two-sided canary computed from the data).

## P-15 · The GENERIC identifier sentence asserts the same absence, on 34 stores instead of 6

| | |
|---|---|
| **file** | `src/server/productTest.ts` (the `identifiers` row's final `not_proven` branch) |
| **change** | say what was read and where, as the rule-D branch now does — or fix P-12 and make the sentence true |
| **decides** | the engine owner |
| **status** | **OPEN, MEASURED, DELIBERATELY NOT FIXED at v3.5 CP3** |

The branch beside the one CP3 corrected still renders *"Your product structured data publishes no
GTIN or MPN, so a machine buyer can't match this product to a catalogue entry."* That is the same
claim shape — an absence asserted about the whole of a merchant's structured data from a read of one
node — and the population is larger. Measured over the same 338 captured stores
(`experiments/v3-5/copyfix/generic_branch.mjs`, `DEFECTS_FOUND`, 246 rows examined, 0 snapshots
unreadable, two-sided canary passing):

```
rows told "publishes no GTIN or MPN"          223
  …publishing a valid GTIN one node down       34   ← general 28, coffee44 4, coffee122 2
rows told the rule-D sentence                  23
  …publishing a valid GTIN one node down        6
```

`topodesigns.com` is told it publishes no identifier while publishing **60** distinct valid GTINs;
`paireyewear.com` 30, `baronfig.com` 29, `wildone.com` 24.

⚠️ **This 34 is not P-06's 32 renamed.** P-06's figure counts rows the CP2a *descent* flipped to a
pass, so it is bounded by the three keys that descent walked; this one counts a publishable GTIN on
any non-selected node, including sibling top-level `Product` nodes no descent would ever reach. They
overlap heavily and neither contains the other.

⚠️ **Why it was not fixed in the same commit.** The v3.5 CP3 brief scoped the change to the rule-D
sentence and required a before/after proof that no status moved; widening the edit would have
rewritten `detail` on 223 rows instead of 23 and put a measured, verified proof next to an unmeasured
one. This repo's own rule applies — *where work implies a change elsewhere, write it down as a
proposal rather than make it* (v3.4) — so here it is, with the number, rather than in a commit
message nobody greps.

## P-16 · The 338-snapshot corpus is 334 merchants, and nothing on disk says so

| | |
|---|---|
| **files** | `experiments/v2-9/snaps`, `experiments/v3-1/snaps_coffee`, `experiments/v3-2/snaps_coffee` (all gitignored); recorded in `standards/coffee/v1.3/fitness.json` under the coffee sample's `provenance.notes` |
| **change** | none to code. This row exists so the next bound computed over these snapshots knows before it counts |
| **decides** | whoever computes the next fitness bound |
| **status** | **MEASURED, NO PUBLISHED FIGURE AFFECTED** |

The three snapshot sets were captured in separate sessions and overlap. Counted mechanically at
v3.5 CP5:

```
files                                 338      (general 172 · coffee 44 · coffee 122)
distinct registrable domains          334
distinct product URLs                 335
```

- `onyxcoffeelab.com` and `vervecoffee.com` — the **same product URL** captured in both the general
  and the coffee-44 set.
- `deathwishcoffee.com` power-surge pods — captured **twice inside coffee-44**, at the apex host and
  at `www.`.

**Why it changes nothing today, checked rather than assumed.** Neither published sample pools across
sets, and each is internally clean: the general sample is 172 files / 172 registrable domains / 172
distinct URLs, and the coffee audit is 77 hosts / 77 domains / 77 URLs. The coffee run's own harness
(`experiments/v3-2/run_standard.ts`) collapses on registrable domain and reports what it collapsed —
which is where the `www.deathwishcoffee.com` copy went. **Before and after deduplication, every
figure in `fitness.json` is identical.**

⚠️ **Why it must be written down anyway.** The coffee sample's method note says the capture was
"deduplicated on registrable domain before capture", which is true *within* that set and false
*across the union*. A future bound computed over the union — the obvious way to get a bigger n — would
double-count without any instrument complaining. And the harm is worse than a duplicate row: two
files of one product are **perfectly correlated, not merely clustered**, so they inflate n while
contributing no information, and the cluster adjustment (which models within-store correlation at
ICC 0.2) would understate the design effect rather than correct for it. **Dedupe on registrable
domain AND on normalised product URL before computing any n over more than one set.**

## P-17 · The FETCH AND NORMALISATION layer has no adversarial corpus, and it holds the engine's largest measured defect class

| | |
|---|---|
| **files** | `src/server/productTest.ts` — `priceToUsd` (l. 834), the variant/price/availability assembly in `fetchPublicProduct` (l. ~1216-1252), and `evaluate`'s `price_under` branch |
| **change** | none proposed here. Four defect classes, measured, with the count each carries |
| **decides** | the engine owner |
| **status** | **v3.7: OPEN, MEASURED, FILED NOT FIXED. v3.8: THE CORPUS NOW EXISTS — see the update at the end of this section.** |

The first complete row-by-row audit of the general sample — 488 pass rows over 172 real stores,
every row adjudicated individually, every confirmed defect re-executed against the raw captured
bytes with a two-sided canary — found **18 confirmed false passes where the published figure
recorded zero**. `test/adversarialCorpus.test.ts` could be extended by **three**. The other four
classes are **upstream of the matcher that corpus probes**: they happen in `fetchPublicProduct`,
before any `Requirement` sees the product, and `PublicProduct` cannot express them.

```
class                                          confirmed   expressible in the corpus?
non-usd price rendered with a "$"                   5       NO — no currency field exists
$0.00 accepted as a readable price                  6       yes (pinned)
integer CENTS read as dollars                       2       NO — priceToUsd, pre-minPriceUsd
a MISSING `available` defaulted to purchasable      2       NO — resolved before evaluate
"lowest readable price" is the page's MAXIMUM       1       NO — the LD-offer fallback
LD InStock over the page's own available:false      1       yes (pinned)
a SIBLING product's size read as this product's     1       yes (pinned)
```

**1 · No code path in this engine reads a currency.** `minPriceUsd` is
`Math.min(...variant prices)`; a Shopify storefront serves those in the STORE's currency; the
generated label (`Price under $140`) and the rendered evidence (`Lowest readable price is $135.00.`)
both carry a US dollar sign. Every signal is on the page and none is consulted — `missoma.com`
publishes `priceCurrency: GBP` in JSON-LD, `Shopify.currency.active = "GBP"`, `Shopify.country =
"GB"` and `og:price:currency GBP`, and is told its £135 necklace is under $140. Also
`gardenerskit.com` (CAD), `mustardmade.com` (AUD), `organicbasics.com` (EUR), `hismileteeth.com`
(AUD).

**2 · `priceToUsd`'s cents guard has a floor AND an off-by-one, and it costs a factor of 100.**
`p > 1000 && Number.isInteger(p) ? p / 100 : p` — a guard for the `/products/{handle}.js` tier,
which serves integer **cents**. `levainbakery.com`'s `.js` price is `1000`; `1000 > 1000` is false,
so the $10.00 mug is published as **"Lowest readable price is $1000.00"** and asked *"Price under
$1005"*, while the store's own `.json` says `"price":"10.00"`. `richer-poorer.com`'s `300` becomes
`$300.00` against a true `"3.00"`. **Every product at or under $10.00 whose variants come from the
`.js` tier is rendered at 100× its price.** A strict `>` on the exact boundary and a threshold below
which the guard cannot fire.

**3 · `v.available !== false` turns a MISSING field into a purchasable one.** `kytebaby.com`
publishes six variants, none carrying an `available` boolean; `ldAvailability` is null; the `.js`
tier was never fetched. The merchant is told *"At least one variant is listed as purchasable"* and
*"A 'Gilmore Girls' variant is listed and purchasable"* — **two rows** — when no public surface says
anything at all about availability. The honest status is `requires_store_access`, which the branch
below it already returns when there are no variants.

**4 · "Lowest readable price" can be the page's MAXIMUM.** `fieldcompany.com`'s JSON-LD publishes a
single Offer at 135.0 USD with no `AggregateOffer` and no `lowPrice`, so `minPriceUsd` falls back to
it — while the analytics bootstrap on the same HTML lists variant prices of 7900 / 9400 / 13500
cents. The row says *"Lowest readable price is $135.00"* on a page publishing a $79.00 variant.

⚠️ **Why this is one row and not four.** They share a cause: **the normalisation layer has never
been attacked.** Every adversarial pass this project has run — v2.4's 959 probes, v3.2's 661
sentences, v3.5's 78 identifier cases — has probed `evaluate`, because that is where the interesting
language lives. Nothing has ever handed `fetchPublicProduct` a hostile `.js` payload. The three
pinned cases prove the point rather than close it: the corpus can only reach a defect once the
product has been assembled, and by then a missing availability flag and a stated one are the same
`true`.

⚠️ **And the reason the whole class was invisible until now.** `price_under` looks like a tautology
— the cap is generated by rounding the product's own price up, so the comparison always passes and
there appears to be nothing to audit. **165 of the sample's 488 pass rows are that kind, and 14 of
its 18 confirmed defects are in it.** This is the v3.2 quoteless-row lesson in a second shape: a row
whose evidence *is* rendered can still be un-auditable, if what is wrong about it is a currency
symbol or a decimal point rather than a sentence.

## P-13 · GS1 restricted-circulation (`2xx`) and coupon (`99xx`) prefixes are accepted as product GTINs

| | |
|---|---|
| **file** | `src/server/productTest.ts` (`isPublishableGtin`) — and `IDENT-001` first |
| **change** | state whether a GTIN in a reserved prefix range is acceptable evidence, then implement |
| **decides** | the coffee standard's owner, THEN the engine owner |

Adjudicated `R10` (restricted-circulation prefix) and `R11` (coupon EAN). Both were ruled **CLOSED —
correctly accepted** by the adjudicator, on the ground that the document names no prefix ranges at
all: `insufficient_evidence` lists placeholders, all-zeros, wrong check digits and internal SKUs, and
nothing else. So today they pass, and that is what the standard says.

**Whether they SHOULD pass is a different question and nobody has answered it.** GS1 reserves `02`
and `2xx` for restricted circulation within a company — an in-store weighed-item barcode, which
resolves to nothing in any external catalogue and is therefore in exactly the class the row's
question is about. `99xx` is a coupon, not a product.

⚠️ **Low priority, and stated so.** No captured real store publishes one; both cases are constructed.
It is filed because "the document names no ranges" is a reason the current behaviour is *correct*,
not a reason the question is *settled* — and the next person to notice a `2xx` GTIN should find this
row rather than re-derive it.

## P-14 · `offers[].mpn` is never read, in either direction

| | |
|---|---|
| **files** | `src/crawler/extract.ts` (`extractProduct`), `src/server/productTest.ts` (rule D) |
| **change** | decide whether an MPN published on an offer is acceptable evidence — and if it is, run rule D against it too |
| **decides** | the coffee standard's owner, THEN the engine owner |

`extractProduct` reads `mpn` from the product node only; there is no MPN equivalent of the GTIN key
ladder. Adjudicated `EVA-23`: a page publishing a real manufacturer part number only on its offer is
told it publishes no identifier.

⚠️ **The asymmetry is the point, and it cuts both ways.** CP2a widened where a GTIN is looked for and
never touched the MPN — so a widening argued on recall grounds was applied to one field and not the
other, with no stated reason. And if `offers[].mpn` ever becomes readable, **rule D must be extended
in the same commit**, or the widening re-opens exactly the class CP2b closed: a storefront key
published on an offer instead of the product node would walk straight past a guard that only reads
`info.mpn`.

---

## P-17 — UPDATE, 2026-07-28 (v3.8): the corpus was built, and 49 of 60 defects were unreachable by sampling

`experiments/v3-8/fetch_harness.ts` + `fetch_cases.json`, frozen in commit `234ee7b` **before any
fix code was written**, authored by six independent agents who wrote no bytes and no fix. Case specs
are SEMANTIC — a mechanical synthesizer turns them into real HTTP bodies fed through the REAL
`fetchPublicProduct` with only the transport swapped, so nothing about parsing, tier order, robots
or conversion is reimplemented. The harness validated itself against known reality before any
authored case ran: a `.js` price of exactly `1000` renders `$1000.00` (levainbakery) and a GBP store
renders `$135.00` (missoma).

```
cases                                       101, six clusters
wrong-NUMBER defects in the SHIPPED engine   60
  of which UNREACHABLE by a real-store sample  49   ← the headline
closed by v3.8's two fixes                   15
residual at HEAD                             45
NEWLY OPENED by either fix                    0
```

⚠️ **A FLAG IS NOT A DEFECT, and the distinction is load-bearing here.** Nine currency cases differ
from the engine only in PROMISE — their authors expected a non-USD store to receive a pass reporting
its own currency, and v3.8 shipped a refusal. Counted separately, never folded in, and filed as
**P-18**.

**What is now permanently expressible**: anything the `store` spec can describe — per-tier price
shape and magnitude, `available` present/absent/false, JSON-LD offer and currency, the analytics
bootstrap, per-tier HTTP status and content type, robots disallow. That covers all four of the
classes v3.7 recorded as inexpressible.

**What remains structurally inexpressible even now**, from the completeness critic: anything below
the response body — TLS/transport fingerprinting, connection resets mid-stream, and the byte cap
interacting with chunked transfer. The synthesizer hands the engine a complete recorded response, so
a body that never finishes arriving cannot be modelled by it.

**Residual classes nobody had named**, every one upstream of every matcher this project has ever
attacked, and every one found by chosen input rather than by sampling:

| shape | what happens |
|---|---|
| `p > 1000` is a **signed** comparison | no negative magnitude can ever satisfy it, so `-200000` — a credit or refund line — passes through unconverted |
| `toFixed` abandons fixed notation at 1e21 | the evidence sentence renders `$1.0000000000000001e+23` and the cap round-trips through the display string as `1` |
| **zero-decimal currencies** (JPY, KRW) | dividing `.js` by 100 is wrong: ¥1250 becomes ¥12.50 |
| **three-decimal currencies** (KWD, BHD, JOD, OMR) | subdivided into 1000, not 100, so the same division is wrong the other way |
| comma decimal separator | `"12,50"` → `replace(/[^0-9.]/g,"")` → `"1250"` → **×100** |
| European thousands separator | `"1.299,00"` parses as **1.299**, which INVERTS the minimum selection — a selection error, not a rendering one |
| a currency code in the price field | `Number("GBP".replace(/[^0-9.]/g,""))` is `Number("")` is **0**, and `Number.isFinite(0)` is true — so the row states a price of zero |
| `parseOffer` | commits to the FIRST offer object, never a minimum, with no `@type` check |

**⚠️ The recon also found a SECOND price producer nobody had connected to this gap.**
`src/server/authenticatedTest.ts` builds its own `PublicProduct` with `priceUsd: v.price` raw —
**no `priceToUsd`, no cents guard, no currency** — feeding the same `evaluate`. Filed as **P-18**.

---

## P-18 · What a price row should PROMISE for a non-USD store — and the authenticated path still says dollars

| | |
|---|---|
| **file** | `src/server/productTest.ts` (`price_under`, `declaredCurrency`) · `src/server/authenticatedTest.ts` · `src/catalog/*` |
| **change** | decide the SEMANTICS of a price row for a store that does not publish in USD, then implement — and give the authenticated path a currency at all |
| **decides** | the engine owner (the default requirement set owns `price_under`; coffee's `PRICE-001` is `unbound` per P-02a and binds nothing) |

**v3.8 shipped a REFUSAL, not an answer.** When a store's own bytes declare a non-USD currency the
`price_under` row now returns `not_proven` naming the currency and states no number. Measured: **38
of 349 deduped real stores** declare non-USD (GBP, CAD, AUD, EUR), 5 of them inside the published
general sample, and every one was previously told `Lowest readable price is $135.00.` about a
£135.00 product.

That removes a false statement. **It does not decide what the row should promise**, and three
distinct questions are open:

1. **Should a non-USD store get an ANSWER rather than a refusal?** `minPriceUsd` is a real number in
   a known currency, and `niceCap` over it is a valid cap in that same currency — so
   *"Price under £140 · Lowest readable price is £135.00"* is available, true, and useful. The six
   independent authors of the v3.8 fetch corpus **all expected exactly that**, and nine of their
   currency cases differ from the shipped engine only on this point. That is a documented
   disagreement between the corpus and the shipped decision, not a defect in either.
2. **The field is misnamed.** `PublicProduct.minPriceUsd` has never held USD; it holds the store's
   own currency. Renaming it touches every consumer and is why it was not done inside a price-fix
   commit.
3. **⚠️ THE AUTHENTICATED PATH STILL SAYS DOLLARS, and this is the sharp end.** `authenticatedTest.ts`
   builds its own `PublicProduct` from the synced catalog with `declaredCurrency: null`, because the
   catalog carries no currency field — so **a GBP merchant who INSTALLS the app is told a dollar
   figure by the very path that was supposed to know their store better than the public one.** The
   currency is available (`shop.currencyCode`), but wiring it is a catalog-sync change. The public
   path is where the 38 measured stores are and where v3.8's evidence is; the authenticated path is
   filed here rather than changed on no measurement.

**Also open, from the same measurement, and deliberately NOT taken:** an ABSENT currency declaration
is not a non-USD one. 1 store in 349 declares nothing at all, and the row still answers for it
exactly as before. Refusing on silence is a wider change than anything v3.8 measured.

⚠️ **And the precedence order has never been exercised against a contradiction.** JSON-LD
`priceCurrency` is read first (34 of the 38), then `Shopify.currency.active` (the other 4).
`Shopify.country` is deliberately NOT read — it contradicts the active currency on 8 stores because
it reflects the visitor's geo — and `og:price:currency` is not read because it disagrees with both
other signals on 3. **Zero captured stores have JSON-LD saying USD while the bootstrap disagrees**,
so the ordering is currently untested where it matters. A future store will supply that case.

---

## P-19 · The `$0.00` price and the "lowest readable price" that is not the page's lowest

| | |
|---|---|
| **file** | `src/server/productTest.ts` (`minPriceUsd`, `price_under`) |
| **change** | decide what a price row asserts when the only readable price is zero, and where "lowest" is read from |
| **decides** | the engine owner (default requirement set). Coffee's `PRICE-001` is `unbound` and binds nothing, so no published standard owns either question today |

Both are **promise questions**, which is why v3.8 measured them and shipped neither.

**`$0.00` IS TREATED AS A PRICE — 11 of 349 stores.** `knifewear.com` (a `Referral` product type),
`kosas.com` (a `GWP` with `template_suffix: "gwp"`), `partakefoods.com`, `studioneat.com` (whose
title is literally `SYDNEY TEST PRODUCT`), `tenthousand.cc` (a real garment with 18 GS1 barcodes and
a masked price), `branchbasics.com` (an `unsearchable` Amazon fulfillment stub), `dedcool.com`,
`colonnacoffee.com`, plus `puracy.com`/`supergoop.com`/`voluspa.com` — the last three being
deliberate free gifts the merchant's own title says so, and which v3.7 counted as passes. **The
question is not "is zero wrong"; it is whether a row that says `Price under $10 · Lowest readable
price is $0.00` is telling a merchant anything true.** A rule keyed on the number alone would
convict the genuine free gifts.

**"LOWEST READABLE PRICE" CAN BE ABOVE THE PAGE'S CHEAPEST — 9 of 349 stores**, and this figure was
a FLOOR until it was pushed. `minPriceUsd` falls back to `ld?.offer?.price` when no variant price
survives, and `parseOffer` takes **the first offer object in the array, never a minimum** — so
`fieldcompany.com` renders `$135.00` while the analytics bootstrap on the same HTML lists variants
at 7900/9400/13500 cents. v3.8's first pass measured this at **2** because the census read only the
`.json`/`.js` tiers; parsing the bootstrap raises it to **9**, of which **4 are genuinely distinct
from the cents mechanism** — `fieldcompany.com` ($135 rendered / $79 readable),
`deathwishcoffee.com` ($25 / $14.99), `templecoffee.com` ($29.50 / $23), `september.coffee`
($28.50 / $24). **No cents fix answers any of those four.**

⚠️ Related and confirmed by the v3.8 fetch corpus as a general rule rather than a store's bad luck:
`extract.ts:120` is `arr(raw).find(o => o && typeof o === "object")` — first offer, no minimum, no
`@type` check — and `extract.ts:67` keeps a leading `-`, so a negative JSON-LD price parses.

---

## P-20 · A re-run should distinguish REPAIR-drift from ordinary contract drift

| | |
|---|---|
| **file** | `src/server/buyerTests.ts` (`executeAuthenticatedRun`, the two 409 branches) |
| **change** | classify a contract change caused by a REPAIRED input separately from one caused by an edited requirement, and say which to the merchant |
| **decides** | the engine owner |

v3.8 bumped `ENGINE_VERSION` to `v2.1.0` and added `test/engineVersion.test.ts`, so a matcher change
can no longer ship without one. What it did **not** do is teach the re-run path *why* a contract
moved. Measured over 349 deduped real stores:

| | stores | `contractVersion` changes? | what a merchant re-running sees |
|---|---:|---|---|
| cents/tier fix (3a) | **6** | **yes** — `niceCap(minPriceUsd)` feeds `capUsd`, which is hashed | 409 *"this test's contract changed"* — **correct**: comparing "under $1005" to "under $15" is not a comparison |
| non-USD refusal (3b) | **38** | **no** — the cap is unmoved | **no 409**; only the row's answer flips `pass_evidenced → not_proven` |
| unaffected | **305** | no | nothing |

Both 409s are honest today, and the `ENGINE_VERSION` bump now catches the 38 as well. But the
message a merchant gets is the same sentence whether their contract moved because *they* edited a
requirement or because *we* repaired a price we had been reporting wrongly — and those deserve
different words. The second is the app admitting a defect, and *"save it as a new test to measure
from here"* reads as the merchant's problem.

⚠️ **Filed rather than built** because the brief scoped v3.8 to two fixes and this is a third
change, in a different file, on a path with no test coverage for the 409 branches. *Where work
implies a change elsewhere, write it down as a proposal rather than make it.*

### What the dead guard actually cost, measured rather than assumed

`ENGINE_VERSION` sat at `v2.0.0` from v2.0 through v3.7 while the matcher changed repeatedly, so the
comparability guard was inert for most of its life. Whether that COST anything is a separate
question from whether it was inert, and it is answerable:

```
buyer_tests      2 rows   (both v2walk.myshopify.com, the v2.1 CP3 walkthrough store)
buyer_test_runs  5 rows   all engine_version = v2.0.0
tests with >1 run: 1      (test #8, four runs)
run timestamps:   2026-07-24T23:53Z .. 2026-07-24T23:59Z   — a six-minute window
rule D (66a80a4): 2026-07-27
```

**No saved before/after straddles a matcher change.** Every run predates rule D by three days, and
all four runs of test #8 fall inside six minutes of one walkthrough session.

⚠️ **This is the LOCAL Supabase dev stack, not production.** Production's `buyer_tests` cannot be
inspected from here, so the honest statement is: *on inspectable data the dead guard cost nothing,
and production is unknown.* It is recorded this way rather than as "no harm done", which is the
claim the data does not support.

---

## P-21 · A REFUTER IS NEVER VERIFIED, AND THE UNVERIFIED SIDE FAILS FLATTERING

**Filed at v3.9 CP-1A. This is a measurement-instrument defect, not an engine defect, and it
affects every adjudicated figure this repo has published — including v3.8's `274`.**

### The asymmetry, stated precisely

This project's adjudication discipline is *parallel adjudicators → refuter → re-execute every
confirmed one against the bytes*. Read carefully, that verifies exactly one side:

| step | verified how | direction of an error |
|---|---|---|
| a **confirmation** | re-executed against the captured bytes | a wrong confirmation is caught |
| a **refutation** | **nothing** | a wrong refutation silently DELETES a real defect |

And the refuter is instructed to *"default to refuted=true when uncertain"*, which points the
unverified side at the flattering answer by construction.

### The measurement

v3.9 blind-re-examined **all 71** of its own kills. Suspect kills (from refuters at 0.85–0.92) and
control kills (0.20–0.29) were interleaved into the same batches so the re-examiner could not tell
them apart; exactly-once verified; 6 agents, 0 errors.

```
kills of DEFECT claims           48    41 reinstated   85.4%
  from SUSPECT refuters          26    21 reinstated   80.8%
  from CONTROL refuters          22    20 reinstated   90.9%
kills of HONEST-CARRIER flags    23     3 reinstated   13.0%
```

**The control refuters were wrong MORE often than the suspect ones.** So the diagnosis is not "harsh
refuters over-killed" — the error rate is uniform and high, and only the VOLUME of killing varied.
The heterogeneity that prompted the investigation (χ² = 23.55 on 4 df, p < 0.0001) was a **symptom
that led to the diagnosis, not the disease.**

The 13% on honest-carrier flags is the two-sided check: the same refuters were accurate on a
different question, which rules out "the re-examiner is simply more permissive than everyone".

v3.9's own counts moved **15 → 18** and **78 → 116** on the correction.

### What it does NOT move, and why that matters

Every pivot verdict was recomputed under three readings — strict, raw/unrefuted, and re-examined —
and **all three agree**. `letter_not_spirit` owns 0 defects alone in all three; `tense_modality` owns
0 in all three; `wrong_subject` owns 6/8/8. A conclusion that survives an 85% correction to its
inputs is load-bearing in a way a count is not. **Prefer verdicts that rest on structure (sole
attribution) over verdicts that rest on a count.**

### Exposure

**v3.8's `274` was produced under the same pattern**, recorded `refutedAway: 55`, and has never been
re-examined. `ADJUDICATED_V38` in `standards/__tests__/g14.table.test.ts` is therefore very likely an
undercount of unknown size. It is left EXACTLY as v3.8 recorded it — a frozen record is not edited on
an inference — with the exposure noted in its docblock. Re-examining those 55 is the obvious follow-up
and is not done here.

### Protocol change, from the user at Pause 1

1. **Sample refuted findings for re-execution**, weighted toward high-kill refuters, every campaign.
2. **Seed blind gold cases into every refuter batch** (the v3.2 calibration pattern) so a refuter's
   accuracy is measured rather than assumed.
3. **Emit per-refuter kill rates and the heterogeneity statistic as standard campaign output**, beside
   the finding count.
4. **NOT paired refuters.** Two refuters averaging their bias hides it; the point is to MEASURE it.
5. Every adjudicated figure is published as a **soft floor** and said to be one.

⚠️ **And one procedural trap, recorded because it nearly destroyed this measurement.** The blinding
was built by interleaving suspect/control and assigning by `i % N`. The interleave has period 2, and
2 divides 6, so every even slot landed in an odd batch: **batches 1/3/5 came out 100% suspect.** Three
re-examiners would have judged nothing but suspect kills while the design claimed they were blinded.
Caught by printing the per-batch composition rather than by reading the code. Assign each origin group
round-robin independently; never rely on a stride being coprime by luck.

---

## P-27 · A COFFEE STANDARD v1.4 CANDIDATE — put the referent limitation in `residual_risk`, where citing agencies read

**Filed at v4.0 CP-4. FILED, NOT DONE** — a reissue is a version bump, a hash, a corpus pin
and a supersession chain, and this session was scoped to publishing the site-level block.

The capability × frequency block now publishes the referent limitation at
`/standards/coffee/1.3#capability-frequency`, in the site's own voice. **That is not where a
citing agency reads.** An agency writing *"your product pages fail
`ALS-COFFEE-1.3-CLAIM-00x`"* resolves the ENTRY page and reads that entry's
`residual_risk` — the field `IDENT-001` already uses for exactly this purpose, carrying the
honesty clause *"a stock code that is neither a placeholder nor the storefront's key is
outside this clause"*.

**The proposal:** every `claim`-kind entry in a v1.4 reissue gains a `residual_risk` entry
in `IDENT-001`'s pattern — the term's presence on a product surface is what a pass
establishes; where the term's governing noun phrase denotes a supplier, a farm, a region or a
bundled item, the pass does not establish that the claim was asserted of the product, and the
rendered evidence sentence is what a reader must check. **Measured, so the clause carries a
number rather than a hedge:** the shape occurs in 11 of 71 passing claim rows, and 8 of those
are attributable to it alone.

**Why a reissue rather than an edit:** `standard_hash` covers `standard.json`'s bytes and
every citation resolves through it, so adding the clause to v1.3 would invalidate every
citation made against it. v1.0 → v1.3 already demonstrate the pattern: a new version, the old
one byte-frozen and still served, `supersedes` walked by the entry-id router.

**Who decides:** the standard's owner. It is a content change to a published document, not a
renderer change.

---

## P-23 · The `unscented` → `fragrance_free` equivalence, and the SPLIT that would resolve it

**Filed at v4.0 CP-1a.** Adjudicated by 4 independent agents + 3 refuters with 2 blind gold
cases (gold 4/4). The panel split **1-1-1-1** and the synthesis landed on **KEEP-PENDING**.

`unscented` is carried as a supporting term for `fragrance_free`, whose merchant-visible label
is literally `"Fragrance-free / unscented"`. The cosmetics industry distinguishes them:
*unscented* means no perceptible smell, routinely achieved by **adding** a masking fragrance;
*fragrance-free* means no fragrance ingredient was added. Neither is FDA-defined, and contact
dermatitis to masking fragrance in products labelled unscented is documented clinical
practice. Under EU Regulation 1223/2009 a masking fragrance is still `Parfum` on the INCI list.

**Why it was NOT removed, in the order that decided it:**
1. **The only live row is not a false pass.** `dropps.com`'s *"UltraWash Dishwasher Detergent
   Case, Unscented"* publishes a complete ten-ingredient, variant-scoped formulation with zero
   fragrance material — `masking`/`parfum`/`perfume`/`essential oil` return **0 across all
   952,130 captured bytes**.
2. **Bare removal with the label unchanged would be a false statement about a real store,
   self-refuting on its own line.** The miss path renders *"Checked structured data, product
   title and page description — no statement an AI buyer could verify"* — naming the product
   title as a surface it read, while that title says *Unscented* and the second word of the
   row's own label is *unscented*. Strictly worse than the v3.5 identifiers defect: there the
   engine had not looked; here it looked, matched, and had the match removed from the
   dictionary.
3. **The corpus is SILENT, not reassuring.** n=1, in the wrong product category. `unscented`
   occurs in 1 evidence sentence of 4,426 and 6 stores of 349 — a general DTC sample, not a
   cosmetics one.

⚠️ **RELABELLING ALONE, WITH THE TERM KEPT, IS WORSE THAN DOING NOTHING** — the pass row would
read *"Fragrance-free — Stated in your product title"* quoting *"Unscented"*, taking the
residual from half-disclosed by the slash to entirely undisclosed.

**The proposal: SPLIT, not narrow.** `fragrance_free` keeps
`[fragrance-free, fragrance free, no added fragrance, no fragrance]` with label
`"Fragrance-free"`; a NEW key `unscented` takes `[unscented]` with label `"Unscented"`. It is
a **14th claim key**, and that has costs nobody has priced: `ENGINE_CLAIM_KEYS` moves, so
`compile.ts` refuses a standard binding any key outside the literal 13 — the published-contract
surface; it produces new G-14 cells with no adjudicated record to derive them from; and it adds
a third claim row to the largest `CATEGORY_CLAIMS` branch, whose discrimination is unmeasured.

**Also required if the term is ever removed:** `CLAIM_LABEL.fragrance_free` must move in the
same commit, `requirementFromLabel` needs a legacy-label entry (it reverse-maps a saved label
string, and `contractVersion` does **not** hash the label, so the rename is silent on that
path), plus the mirrors in `vocabulary.engine.test.ts`, `ENGINE_CONTRACT.md` and
`suite2.json`, plus a suite-2.0 re-derivation for `hc-11`.

**THE MEASUREMENT THAT DECIDES IT, named so it is not re-litigated by argument:** over a
**cosmetics-routed capture**, (a) how often is `unscented` the SOLE matched term for
`fragrance_free`, and (b) do those same stores publish a retained term anywhere on a product
surface? If (a) is near zero, plain REMOVE is correct. If (a) is material, the SPLIT is.

**Who decides:** the owner of the claim dictionary. Not a term-list session.

---

## P-24 · `lab tested` inside `third_party_tested`, and the prioritisation objection

**Filed at v4.0 CP-1a**, raised by a refuter and unanswered by anyone. `ENGINE_GAPS` already
names `lab tested` in `third_party_tested`'s supporting list as the highest-value
letter-versus-spirit hazard in the set — **an in-house lab satisfies a THIRD-PARTY
requirement** — and it sits unfixed while v4.0 acted on the two equivalences a collision author
happened to file. **That is prioritisation by what got written down rather than by what got
measured.** The adversarial pass independently reached the same shape from the other side,
classifying *"Independently tested suppliers provide every input."* as a residual: the SUPPLIER
is tested, not the product. Not fixed here; named so the next dictionary session starts from
the measured worst rather than the most recently filed.

---

## P-25 · The raw/normalised index alignment is asserted in a COMMENT, and `toLowerCase` is not length-preserving

**Filed at v4.0 CP-3**, found by the adversarial pass against a guard that has since been
reverted — **the defect is independent of that guard's fate and is live today.**

`testEvidence.ts` documents that `normalize(s)` and `s.replace(/\s+/g," ").trim()` have equal
length and identical index alignment, and CP-1b's windowed quote relies on it. The invariant is
asserted over a fixture set in `test/productTest.test.ts`, **not enforced at runtime**. But
`String.prototype.toLowerCase` is not length-preserving in general: U+0130 (Latin capital I
with dot above) lowercases to **two** UTF-16 units, so a single such character anywhere earlier
in a sentence desynchronises `raw` from `n` for everything after it.

Today the consequence is a quote window cut a character or two off. `referentVeto` was the
first consumer to make a **decision** out of that alignment (its proper-name test read `raw` at
an index computed against `n`), which is how the hazard surfaced. **The fix is a runtime length
check that DECLINES rather than mis-reads** — same discipline as every other instrument here:
an unreadable input is not a readable one.

---

## P-26 · The 17 reinstated capability groups are `comparative` and `review_quote`, not referent

**Filed at v4.0 CP-2.** Suite 2.0's `v4_capability_target` lists 17 groups / 73 false passes as
a secondary target for a referent guard. **They are not a referent class, and three judges
measured this independently and agreed: a referent guard closes 0 of 17, structurally.**

Every one of the 14 generated `wrong_subject` templates uses the literal head noun `product` —
*"Better value than a typical Aluminum-Free product."*, *"The best Single Origin product I have
ever tried." — Sarah M.* — and `product` is the one noun that can never enter a supply-chain
entity list, because *"vegan product"* is what an honest merchant writes about the thing they
are selling. These belong to `subject.ts`'s existing `COMPARATIVE` and `REVIEW_VOICE`, which
under-cover them.

**Their real-copy frequency is near zero**: `comparative` is 34 sentences over 18 stores and
`review_quote` **3 sentences over 3 stores**, in 3,349 sentences across 335 stores — among the
rarest shapes v3.6 measured, and `review_quote` is one v3.6 already declined a guard for on
frequency. **Stop scoring referent designs against them; a design that reports moving them has
miscounted its own target.**

---

## P-22 · THE RENDERED QUOTE CAN OMIT THE TERM IT PROVES — 🟢 **APPLIED at v4.0 CP-1b (`9f9ace3`)**

> **CLOSED.** `presentableQuote(sentence, mustInclude?)` slides a 180-character window onto the
> matched span instead of always cutting from character 0 — the WINDOW, not the cut, because
> lengthening the cut trades one defect for a wall of text and still fails on the next longer
> sentence. With no span, or a span already inside the head window, the output is
> **byte-identical**, so the blast radius is exactly the broken rows. `findSupport` and
> `findViolation` pass the span they already computed; `findAttributeSupport` and
> `findTimingSupport` delegate to `findSupport`, so one fix covers claim, attribute and delivery
> rows.
>
> ⚠️ **THE FOOTPRINT WAS 5× WHAT THIS ROW FILED.** The measurement below is claim rows only —
> 2 of 69. Measured over all asked rows on the same corpus: **10 rows over 8 stores**, including a
> *"Measurements are stated"* row whose quote ended `…fully loft to 2.75…`, a delivery row cut at
> `allow two (2) to…`, and a materials row cut at `80%…`. 349-store A/B: **0 status changes, 0
> detail changes, 10 quote changes; `contractVersion` moved for 0 of 349.**
>
> Also fixed one tier over: `semanticTier` rendered a head cut that need not contain the model's
> own verified `exactQuote`. Replay cannot exercise it (`PRODUCT_TEST_SEMANTIC=0`), so it is
> covered by construction and a unit test, not by measurement — stated rather than glossed.
>
> `ENGINE_VERSION` v2.2.0 → v2.3.0. The v4.0 brief predicted the tripwire would stay quiet on the
> grounds that this is "renderer surface, not matcher"; it was wrong about the mechanism — the pin
> is a content hash over whole files and `testEvidence.ts` is one of them.

**Filed at v3.9 CP-3, found while building acceptance suite 2.0 — not by looking for it.**

`evaluate` matches against the full evidence text and renders a quote **truncated at ~180
characters**. When the matched term sits beyond the cut, the merchant and any AI shopping agent are
shown a green row whose quoted proof does not contain the claimed term.

```
quoted claim rows examined                  69
  truncated at all                          16
  quote does NOT contain the proving term    2
    of those, rows a merchant is shown       1   (pilgrimscoffee.com, single_origin)
```

The second is `thursdayboots.com` / `organic`, where the tail cut was `…80% Organic Cotton`.

**This is v3.2's finding one step worse.** There it was *"a row that renders NO QUOTE is invisible to
a human audit"*. Here the row renders a quote, and the quote argues for nothing — which reads as
**more** credible than a quoteless row, not less. An auditor scanning rendered evidence sees a
sentence, checks that a sentence is present, and moves on.

It also has a second cost, paid immediately: such a row **cannot be used as a sentence-level test
case**, because its own text cannot reproduce its own verdict. `hc-08` was dropped from suite 2.0 for
exactly this reason, with the reason recorded in the artifact.

**Not fixed here.** The obvious repair — extend the quote window until it contains the match, or
centre the window on the match — is a rendering change on a path with its own linting, and this
session's matcher budget was spent on CP-4. *Where work implies a change elsewhere, write it down as
a proposal rather than make it.*

⚠️ **Do not "fix" this by suppressing the row.** The row is TRUE; only its evidence display is
broken. Suppressing it would trade a presentation defect for a false negative.

---

## G-14 — STATUS UPDATE, 2026-07-28 (v3.9): step 1 and the collisions are BOTH measured

**Date:** 2026-07-28 · **SHA:** `3dbef7c` (base) → this branch · **Table:**
`standards/__tests__/g14.table.test.ts`, asserted on every `npm test`.

| | v3.8 | v3.9 |
|---|---|---|
| sentences executed | 3,681 | **3,913** |
| `adjacent_vocabulary` RAW | 3/100 | **181/332** |
| `adjacent_vocabulary` adjudicated | 0/100 — *never run* | **116 confirmed false passes** |

**Step 2 is done.** The 36 authored domain collisions were never lost: they sat in
`experiments/v3-8/out/g14_adjudications.json` under a `domains` key that `g14_merge.mjs` and
`g14_table.mjs` never reference. The key was loaded into memory and dropped on the floor, so
`adjacent_vocabulary` read as fragment-probes-only and looked *attacked and clean*. They now live at
`standards/attack/contexts/generic-collisions.json`, which the generator reaches.

122 authored strings execute as **232 rows** — `generate.ts:177` emits one per *(term, sentence)*
pair, so a domain colliding with several terms of one key contributes its sentences once per term.

Confirmed false passes by key: `organic` 23 · `single_origin` 20 · `vegan` 20 ·
`third_party_tested` 18 · `fair_trade` 14 · `baking_soda_free` 11 · `fragrance_free` 7 ·
`cruelty_free` 3 · **`aluminum_free` 0 · `bpa_free` 0 · `sulfate_free` 0**. The three zeros are the
keys whose collisions are chemical or regulatory rather than semantic; the engine reads those right.

**`EXPECTED_OPEN_GAPS` moves by +0 for G-14.** The 274 groups and this session's 116 are recorded as
per-cell constants in a standing suite that fails when any cell moves — not pinned individually into
the adversarial corpus's register, which means *a debt with a receipt*. Merging the two would destroy
the register's meaning. The arithmetic is asserted in a `[gaps]` test that states this reason.

### Two term-list defects that no matcher change can fix

Recorded here because they were found by the collision author and would otherwise die with a
gitignored file:

1. **The vocabulary imports two of its own collisions.** `plant-based` / `plant based` are listed as
   SUPPORTING terms for `vegan`; `unscented` is supporting for `fragrance_free`. Both equivalences
   are false in the industries that own the terms. These are **term-list defects, not matcher
   defects** — no narrowing reaches them.
2. **Bare unframed violating terms fire CONTRADICTED on honest, compliant copy** — `with aluminum`,
   `contains wheat`, `contains parabens`, `added fragrance`, `tested on animals`. 52 of the 232
   collision rows execute to `contradicted`, consistent with the author's own count.

---

## G-15 — PRECONDITION STATUS, 2026-07-28 (v3.9)

G-15's stated precondition was: *"suite 1.0 cannot serve as the gate. It needs a **1.1** derived from
the adjudicated real instances… and the session that builds the guard must not be the session that
authors it."*

⚠️ **Naming: this section says 1.1; the v3.9 brief said 2.0. The artifact ships as
`suite2.json`, `suite_version: "2.0"`.** Same thing, and the version number is now the artifact's,
not this paragraph's.

| precondition | status |
|---|---|
| a suite derived from adjudicated REAL instances | ✅ **MET** — `standards/acceptance/subject-tense/suite2.json`, 25 cases, every one a sentence a real merchant wrote, with host, URL and adjudication unit |
| expected outcome = the recorded adjudication | ✅ MET |
| provenance per case | ✅ MET |
| additive to a byte-frozen 1.0 | ✅ MET — 1.0 verified unmodified; its gate re-measured **hostile 4/37, must-not-regress 19/19** |
| authored by a session that will not build the guard | ✅ MET — the 13 adjudicators, 13 refuters, 6 re-examiners and the v3.9 orchestrator are all named in the artifact as excluded |
| a pinned matched-term per case with a dictionary-hash tripwire | ⚠️ **PARTIAL** — terms are carried per claim key, lifted from the engine's source bytes, but the drift tripwire is stated in the artifact and **not yet asserted in `acceptance.test.ts`**. That assertion is owed. |
| a frequency read on the axes | ✅ **MET, and it changed the target** — see below |

### The frequency read narrowed G-15's target from three axes to one

| axis | attacks on chosen input | owns defects ALONE | verdict |
|---|---|---|---|
| `letter_not_spirit` | 260/280 = 92.9% | **0** | DESCOPE |
| `tense_modality` | 439/621 = 70.7% | **0** | DESCOPE |
| `wrong_subject` | 368/914 = 40.3% | **8**, over 7 stores | **GUARD-WORTHY** |

Stable across strict, raw/unrefuted and re-examined readings. `wrong_subject` **is** G-15's referent
axis, so the read licenses G-15 and closes the other two by measurement.

⚠️ **The cost side did not improve, and is the reason this is still the highest-risk item on the
page.** The referent axis costs **2.13 true rows per defect only it closes** on the strict reading and
**5.13** on the raw one. The upper end is within reach of the arithmetic that removed `origin`
(17 lost, 0 gained). 17 honest carriers are pinned in suite 2.0, **15 of them carrying markers for
more than one axis** — those are the cases a referent guard will break collaterally, and they are
where it will be decided.

### What remains before a v4.0 guard session is fully licensed

1. **The dictionary-hash tripwire for suite 2.0** asserted in `acceptance.test.ts` (above).
2. **P-21's exposure on suite 2.0's own inputs.** Its 8 hostile cases survived an 85%-error
   refutation step *and* a blinded re-examination, which is stronger than any prior suite's
   provenance — but the 17 kills the re-examination could not reach stay dead, so the case set is a
   **floor**.
3. **Nothing else.** The frequency read, the standing gate and the derived suite are the three
   preconditions this file named, and two are met outright.

---

## P-29 · THE TIER'S RECALL IS REAL, ITS OUTPUT IS NON-DETERMINISTIC, AND ITS HEADER CLAIMS A PARAMETER IT NEVER SETS

**Filed at v4.4, from a measurement. CLOSED for the public path — the tier is pinned off on
both public routes, first for durability (P-28 item 4) and then confirmed by the variance
measurement below. OPEN as a question about whether it can ever return.** Full record:
`experiments/v4-4/REPORT.md` and `experiments/v4-4/FULL_RUN.md`.

### THE HEADLINE, from the full corpus — 269 distinct stores, $0.39

**On two identical runs, minutes apart, on the same commit and the same captured bytes, the
tier answers differently on 11.0% of the claim rows it is asked about.**

| | |
|---|---|
| distinct stores where the tier ran | 114 |
| claim rows asked | 163 |
| **claim rows answering differently across two identical runs** | **18 — 11.0%** |
| stores whose model output differed | 31 of 114 — **27.2%** |
| stores where a merchant would see a different row | 18 of 114 — **15.8%** |
| promotions that reproduced | **36 of 53 — 67.9%** |

Flip directions: 14 `not_proven → pass_evidenced`, 9 `pass_evidenced → not_proven`, **5
quote-only** — rows a status diff, a pass count and a merchant reading a green row all see as
identical. v3.5's rule, earning itself again.

⚠️ **The seeded known-positive is the cleanest demonstration.** `klatchcoffee.com` granted in
run C and **not** in run B, on the same capture. The harness resolved `INCOMPLETE` because its
canary assumed that grant was a stable property of the capture; it is not, and the run proves
it rather than merely failing on it.

**70 of 71 promotions across the whole corpus are on ONE requirement, `Single-origin`.** The
tier's entire real-world footprint is a single claim key.

**Precision on the stable set is decent and it does not decide anything.** Most stable grants
are genuine recall no term list reaches (*"traces back to just one farm in West Arsi"*; a
product title reading *"Honduras Finca El Jardin"*). The false ones share one shape — a
sentence about a **place** that is not a statement about **this product**
(`blackbeardroasters.com`: *"The Yirgacheffe region is located in the southern part of
Ethiopia."*; `highrisecoffeeroasters.com`: a store-level page description reading *"single
origins and blends"*). That is the same class the coffee sample already carries and that no
guard addresses — **the tier does not close it, it manufactures new instances of it.**

**DECISION: "precise but unstable does not ship."** The tier stays out of the public path
regardless of precision. Returning it anywhere requires hardening to determinism first, and
**variance re-verified at ≈0** — never assumed from a parameter being present.

⚠️ **`semantic.granted` OVERCOUNTS merchant-visible grants.** Run B recorded 76 grants in its
stats and produced 60 row changes: `judgeClaims` sets `stats.granted = grants.length`, and
`applySemanticTier` then drops any grant whose attribute is not in `unresolved`. The direction
is safe — the v4.4 disclosure detector keys on `granted > 0` and so over-flags — but it means
"4 affected production results" is a **ceiling** on merchant-visible damage, not a floor.

---

### The pilot, kept because it is what the decision was taken against

### What P-28 asked for, and what came back

P-28 asked for a frequency read, a precision read, a decision that is not "turn it off", and
a determinism decision for published artifacts. Three of the four are answered.

**Frequency and precision, 20 stores, 3 runs each** (`experiments/v4-4/tier_measure.ts`; store
bytes replayed, model call live and unswapped; comparisons over status AND detail AND quote
AND surface):

| | |
|---|---|
| stores where the tier was called | 10 of 20 |
| claim rows asked | 16 |
| grants | **3 — 18.75% of rows asked** |
| adjudicated **false** | 1 (klatchcoffee.com, the seeded known-positive) |
| adjudicated **true — real recall no term list matches** | **2** (`bluebeardcoffee.com`: a named farmer group, district and four producer villages; `mikava.coffee`: `Farm: Finca Bella Vista`) |

**n=3 states no rate.** The full-corpus run is `PILOT_N=338`, projected $0.50, and it is the
one thing gating the P-28 decision. But 2 of 3 grants being genuine is why the tier was not
killed: it is doing the paraphrase job it was built for, on real stores.

### The determinism half, and it is the finding

| | |
|---|---|
| stores where the tier ran | 10 |
| stores where the **model's output** differed on two identical runs | **2** |
| stores where a **merchant-visible row** differed | **0** |

`mikava.coffee` returned granted/vetoed/discarded `1/1/0` then `1/0/1`; `firebellytea.com`
returned `0/0/0` then `0/0/4`. **The model is non-deterministic on identical input.** On this
sample the verbatim-quote gate absorbed all of it — it discarded 6 candidates against 3 grants
and withdrew 7 lexical matches — so the gate is load-bearing rather than decorative. Zero row
variance at n=10 is not evidence of stability; it is evidence the gate caught *this* sample's
variance.

⚠️ **AND THE MECHANISM IS NAMED IN THE MODULE AND ABSENT FROM THE CODE.**
`semanticTier.ts:20` says the tier runs at *"temperature 0"*. `defaultComplete` sends `model`,
`messages`, `response_format` and `max_completion_tokens` — **no `temperature`** — so it has
always run at the API default. *A rule stated only in a comment is not a rule*, one more time,
and this instance is the direct mechanical explanation of the variance above and of v4.3's
boot-to-boot 5-proven / 6-proven incident.

**Deliberately not fixed.** The measurement runs as-prod-configured; improving the
configuration mid-measurement measures something production has never run. It is the first
thing to change if the tier goes back anywhere, and the variance must then be **re-verified at
≈0**, never assumed from the parameter being present.

### What the tier already cost, permanently

Four stored results at permanent citable URLs carried a tier-granted pass; three publish a
claim the quoted sentence does not support, one of them a **standard-layer result citing
Coffee Standard v1.3**. Remediated by render-time notice (`src/server/resultNotices.ts`),
never by editing or deleting — results are append-only, and the remediation IS the
disclosure. `ENGINE_VERSION` v2.4.0 → v2.5.0.

⚠️ **The engine-version tripwire could not have caught this.** It is a content hash over
matcher files, and no matcher logic moved — the change is a route-level dep. Had the version
literal not happened to live inside `productTest.ts`, the hash would have been identical while
live verdicts changed. **The hash is a floor, not a ceiling.**

## P-28 · THE SEMANTIC TIER IS LIVE ON EVERY PUBLIC RUN, IT IS SAMPLED, AND IT PRODUCED A FALSE PASS ON OUR OWN PROOF SURFACE

**Filed at v4.3 (the landing-page session), from a measurement, not a review. Not fixed —
the scope of that session was one page, and the fix this needs is a measurement first.**

### What was measured

The v4.3 landing page renders the pinned `/demo` result (`runDemo()`, the frozen
klatchcoffee.com capture replayed through the real engine). Two server boots, identical
commit, identical capture:

| boot | result |
|---|---|
| 1 | **5 proven · 5 not proven** |
| 2 | **6 proven · 4 not proven** |

Six requests within a single boot are stable (`experiments/v4-3/probe_determinism.mjs`,
6/6 identical) because the module caches its run; six *fresh processes* are also stable at
5/5 (`experiments/v4-3/probe_boots.mjs`, `VERIFIED_CLEAN`). The variance is **across server
boots**, and the discriminator is measured: `ENV.keys.openai` is unset in a bare `npx tsx`
process here and set in the server, which is the only gate on the tier
(`experiments/v4-3/probe_semantic.ts`).

### The mechanism

`judgeClaims` (`src/server/semanticTier.ts`) runs whenever `ENV.keys.openai` exists and
`PRODUCT_TEST_SEMANTIC !== "0"`. Both are true in production. It makes a live, sampled
model call, and its grants flip `claim` rows from `not_proven` to `pass_evidenced`.

### The serious half — a FALSE PASS, on the one page whose gate forbids it

On boot 2 the sixth pass was `ALS-COFFEE-1.3-SOURCE-001` — *"Is this coffee from one place,
or is it a blend?"* — rendered `pass_evidenced` with the evidence quote:

> "Discover Ethiopia Yirgacheffe Supernatural; bursting with flavor notes"

That sentence names the product. It states nothing about origin. The verbatim-quote safety
gate did its job — the quote really is in the page — and the tier still granted a claim the
sentence does not make, which is exactly the failure a verbatim gate cannot catch: it
constrains the QUOTE, not the INFERENCE.

`single-origin` read into a sentence that does not state it is a defect class this project
has already confirmed twice in the coffee sample ("**`single-origin` inside a sentence
describing a BLEND (2) — a class no guard addresses**"). The semantic tier does not merely
fail to close it; it manufactures new instances of it.

### Why it stayed invisible

`test/buyerTestDemo.test.ts` **already asserted the broken invariant** —
`audited === d.counts.pass`, every proven row is an adjudicated row. It was green
throughout, because the suite runs without an OpenAI key, so the tier returns empty and
the extra pass never appears in CI. **An assertion that cannot fire in the environment it
runs in is not a guard**, and this is the second time this exact property has been recorded
about this tier: v2.5 CP2 already noted that `judgeClaims` returns empty offline, so a
semantic gate "could close no corpus case and could not be reached by the mutation proof".
That was written as a reason not to *use* the tier for aboutness. It is also a reason
nothing can *test* the tier that is already shipping.

### What v4.3 did and did not do

**Did:** pinned the tier off at one call site — `runDemo`'s deps now carry
`semantic: { disabled: true }` — restoring the Example test to an actual replay whose every
pass is one the v3.2 audit adjudicated. No matcher moved; `ENGINE_VERSION` did not move.
Added a source-level assertion for the mechanism, because the outcome assertion is
unreachable offline.

**Did not:** touch `/test`, `runStandardTest`, the authenticated path, or the tier itself.
Every one of those still makes a sampled call on every live run.

### What this needs before anyone changes it

1. **A frequency read.** How often does the tier grant at all, over the 338-store corpus?
   The corpus replays offline, so this needs a run with a key and a recorded transport —
   and the grants must be captured, not just counted.
2. **A precision read on those grants.** Each one adjudicated individually against the
   store's full evidence, the same discipline as every published bound. The
   klatchcoffee.com instance is n=1 and proves only that the rate is not zero.
3. **A decision that is not "turn it off".** The tier exists for PARAPHRASE — recovering
   true statements no term list can match — which is a real recall problem. Killing it
   without measuring the recall it buys would repeat the `origin` mistake in reverse.
4. **A determinism decision for published artifacts regardless of the above.** A citable
   result cannot be a sample. Even at perfect precision, `/demo` and any stored result must
   pin the tier, or two readers of the same URL can see different verdicts.

⚠️ **Do not treat the landing-page pin as the fix.** It closes one page. The tier is live
on the surface a stranger actually pastes a URL into.
