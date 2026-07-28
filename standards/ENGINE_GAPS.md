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
