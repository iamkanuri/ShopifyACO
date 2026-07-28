# v3.8 — TWO CAMPAIGNS AND THE FIRST PRICE FIXES

**Branch `feat/v3-8-campaigns`, off `main` at `6a3e5d7`. Written as the session runs.**

Status legend: ✅ done · 🔄 running · ⛔ INCOMPLETE · ⚠️ finding.

---

## THE SHORT VERSION *(updated as the session runs)*

1. **v3.7 is live** (`6a3e5d7`), verified twice — `verify_prod` 21/21 **and** a new
   reachability probe 15/15 asserting the per-kind table and the interval-overlap refusal are in
   production's *served bytes*. A section that renders as nothing still returns 200.
2. **The kill condition did NOT fire, and the tier hypothesis is confirmed with zero exceptions.**
   Over 349 deduped snapshots: **931 `.json` price strings, every one `^\d+\.\d+$` decimal
   dollars, 0 numeric, 0 ambiguous**; **119 `.js` tiers, every one integer cents, 0 strings.**
   The cents fix is safe to design.
3. ⚠️ **The cents guard's real blast radius is 6 stores of 119, and TWO of them are not 100×
   errors at all.** `minPriceUsd` is a min over per-value conversions, so a mixed set launders the
   error into a plausible number: `firelightcoffee.com` renders **$10.60** where the true floor is
   **$9.35**. Nobody would ever look twice at $10.60.
4. **G-14 step 1 is MEASURED** — 3,681 sentences, 13 keys × 8 classes, full coverage, 779/779 groups
   adjudicated, 327 refuter verdicts. **The engine reads keywords, not sentences, on three axes**
   (`letter_not_spirit` 93%, `tense_modality` 71%, `wrong_subject` 40%) and reads them well on three
   (`merchant_controlled_string` 0/414, `orthography` 0/606, `violation` 1/104). Uniform across all
   thirteen keys, so it is a property of the matcher, not of any term list. **No fixes.**
5. **The fetch layer had never been attacked, and 49 of 60 defects were unreachable by sampling.**
   101 chosen-input cases frozen before any fix. **0 newly opened** by either fix.
6. **Both fixes shipped to the branch, separately gated.** 3a: 0 status changes, 6 corrected prices,
   343 of 349 stores untouched, all six calibration hosts moved. 3b: 38 status changes, exactly the
   measured non-USD stores, nothing else.
7. **The general sample re-measured at the fixed SHA: 7.53% → 5.17%**, x 18 → 11, and the instrument
   reproduces v3.7's published figure exactly before moving it.
8. ⚠️ **Six instrument failures in my own harnesses. Four were caught by a canary, an anchor, or a
   disagreement with a previously published number. None was caught by reading.**
9. **Nothing is pushed beyond CP-0.** Pause 2 owns that decision.

---

## CP-0 — v3.7 shipped ✅

| step | result |
|---|---|
| `git checkout main && git merge --ff-only feat/v3-7-perkind && git push origin main` | `7085b34..6a3e5d7` |
| `GET /healthz` | `commit 6a3e5d7bcb36…` |
| `experiments/v3-7/verify_prod.mjs` (re-pinned via `EXPECT_SHA`) | **VERIFIED_CLEAN — 21/21, 0 failures** |
| `experiments/v3-8/verify_sections.mjs` (**new**) | **VERIFIED_CLEAN — 15/15, 0 failures** |

No retry was needed on either.

### Why a second probe existed at all

`verify_prod` proves the routes are up, the four hashes agree three ways, and the byte floors hold.
**It cannot prove that a section written this release is being served**, because a page that renders
it as nothing still returns 200 and still clears a floor set for the page as a whole. This repo has
shipped that exact defect four times — `grounding.sources` vs `grounding.citations` (42 entry pages
empty, eleven tests green), `s.fitness` vs `measured_fitness` (three wrong pages in one session),
`renderEntry` reading a v1.0 sidecar directly, and v3.5 CP5 where v1.3 was committed, hashed, gated
and corpus-pinned while `PUBLISHED` stopped at v1.2 so nothing served it.

The per-kind table and the interval-overlap ratio refusal had **never been served before**. Verified
present in production's rendered text:

- the generated caption *"— the bound decomposed by requirement kind"*, **twice** (both samples)
- **7/7** requirement-kind names in the rows — a caption above an empty table is precisely the
  failure mode, so the kind names are required, not the caption
- completion states `DEFECTS_FOUND` / `VERIFIED_CLEAN` / `INCOMPLETE` all rendering
- the refusal sentence *"No difference is stated between these samples, because their intervals
  overlap."*
- the three **retired spread sentences ABSENT** — retired three times, revived by a fix twice
- no `[object Object]` / `undefined` / `NaN` in rendered text

⚠️ **The probe refuses to run against a stale deploy.** Pinned to `EXPECT_SHA`, it exits before
any content check if `/healthz` disagrees — otherwise it would silently measure the *previous*
release and pass. It did exactly that on its first invocation, when HEAD had already moved past
CP-0's SHA onto a v3.8 checkpoint commit.

**Stumptown default taken: the re-score STANDS.** True pass under v1.3's actual text; both readings
are in the sidecar; reversing is a one-field edit. Carried to Pause 1, not blocking.

---

## CP-2 — the byte-shape census ✅ VERIFIED_CLEAN

`experiments/v3-8/census.ts`. Tier selection is **the engine's own** — `fetchPublicProduct` called
with the transport swapped for a replay of the recorded bytes (the v2-9/v3-5/v3-7 precedent), so
everything downstream of the socket is production code. The byte-shape half is read directly from
the recorded bodies, because that is a question about the bytes rather than about the engine.

```
corpora scanned            : 5   (v3-5/revert/synth_snaps EXCLUDED — synthetic)
deduped snapshots          : 349      [the brief said ~338]
duplicate product URLs     : 117 dropped
distinct hosts             : 336
hosts with >1 file         : 13
engine produced a product  : 349/349
engine actually used .js   : 119
completion: VERIFIED_CLEAN
```

### THE KILL CONDITION DID NOT FIRE

The brief's elevated refusal: *if ANY captured `.json` tier serves a numeric price, the tier-aware
fix divides correct stores by 100 — a $50 product published as $0.50, the catastrophic direction.*

| tier | answered with variants | numeric price | string price |
|---|---:|---:|---:|
| `/products/{h}.json` | **134** | **0** | **134** |
| `/products/{h}.js` | **119** | **119** | **0** |

Pushed one level further, because "no numeric" is not the same as "unambiguous": `priceToUsd`'s
**string branch has no cents guard at all**, so the dangerous residual shape is an integer-valued
*string* (`"1000"`), which a naive rule reads as either $1000 or $10.

```
.json price strings matching ^\d+\.\d+$   931
.json price strings matching ^\d+$          0   <-- the ambiguous shape
anything else                               0
```

**Zero exceptions across 349 snapshots.** And the confirmation is available *within a single store*:
`firelightcoffee.com` publishes the same 28 variants in both tiers — `.json` as
`[9.35, 9.75, 9.50, 13, 10.65, 10.60]`, `.js` as `[935, 975, 950, 1300, 1065, 1060]`. Same product,
same day, two tiers, two units. The premise is measured, not assumed.

### ⚠️ THE CENTS GUARD'S BLAST RADIUS IS 6 STORES, AND THE TAXONOMY MATTERS MORE THAN THE COUNT

`experiments/v3-8/blast.mjs`, per **store**, direction named. Counting variant *prices* would have
answered a different question: `minPriceUsd` is a `Math.min` over **per-value** conversions, so a
store whose variants straddle the `p > 1000` boundary gets a min taken across two different units.

| direction | stores |
|---|---:|
| correct | 113 |
| **overstated_100x** | **4** |
| **wrong_variant** | **2** |
| understated_100x | **0** |

| store | rendered | true | ratio | `.js` magnitudes |
|---|---:|---:|---:|---|
| `levainbakery.com` | $1000.00 | $10.00 | ×100 | `1000` |
| `sputnikcoffeecompany.com` | $900.00 | $9.00 | ×100 | `900` |
| `perkyblenders.com` | $890.00 | $8.90 | ×100 | `890, 890` |
| `richer-poorer.com` | $300.00 | $3.00 | ×100 | `300, 800, 800, 800` |
| `firelightcoffee.com` | **$10.60** | **$9.35** | ×1.13 | `935…1300` |
| `tinker.coffee` | **$21.00** | **$7.50** | ×2.8 | `750, 2100, 11000` |

**The last two are the finding.** A $1000 mug is absurd and a human auditor would catch it on
sight — which is exactly why the ×100 class was the one v3.7 found. `firelightcoffee.com` renders
**$10.60** for a product whose cheapest variant is **$9.35**: the values above 1000 convert
correctly, the values below pass through as hundreds of dollars, and the `min` then selects the
*cheapest correctly-converted* variant rather than the cheapest variant. The error is laundered
into a number nobody would question. **A status diff cannot see it, a pass-count cannot see it, and
neither can a merchant.** This is v3.5's "compare the QUOTE" lesson arriving in arithmetic.

**`understated_100x` is 0 today** — the catastrophic direction does not currently occur. That is the
invariant CP-3a must preserve, and it is now a measured baseline rather than a hope.

### The other three mechanisms

| mechanism | stores | in a published sample |
|---|---:|---:|
| **non-USD declared and unread** | **38** | 5 |
| **`$0.00` treated as a price** | **11** | 10 |
| **rendered min is above the cheapest readable price** | **9** | 3 |

⚠️ **The third figure was a FLOOR until it was pushed.** The census reads prices from the `.json`
and `.js` tiers; v3.7's own example (`fieldcompany.com`) has its cheaper variants **only in the
analytics bootstrap**, which the census does not parse — so the first measurement said **2** and
both of those were really cents cases. Parsing the bootstrap raises it to **9**, of which **4 are
genuinely distinct from the cents mechanism**: `fieldcompany.com` ($135 rendered / $79 readable),
`deathwishcoffee.com` ($25 / $14.99), `templecoffee.com` ($29.50 / $23), `september.coffee`
($28.50 / $24). A fix to the cents conversion answers none of those four.

### ⚠️ AND THE CENSUS'S FIRST RUN WAS WRONG, CAUGHT BY BEING ONE LOWER THAN A PUBLISHED FIGURE

The first census reported **4** non-USD stores in the general sample where v3.7 published **5**.
That one-store gap was the only symptom of a real defect: the tier lookup anchored on
`new URL(snap.url).origin`, and a store redirecting apex → `www.` records **every** tier under the
`www` origin while `snap.url` stays the apex. For `missoma.com` and `richer-poorer.com` the lookup
found *nothing* — 0 bytes of page HTML, no `.json`, no `.js`.

The `.json` and `.js` counts were **93 and 85**. Corrected to a path-suffix match they are
**134 and 119** — the first run understated both by a third. Nothing threw; every missing store
simply looked like a store that publishes no price.

**A byte-shape reader that reads a subset and reports a total is this project's most-repeated
defect.** There is now a canary asserting the census reproduces v3.7's published non-USD count,
and a second asserting the page tier is readable for at least half the corpus.

---

## CP-3 — the two fixes, each independently gated ✅ BOTH SHIPPED (to the branch)

Separate commits with separate A/B attribution, per Pause 1's rider (a).

### 3a · the tier-aware cents fix — `3e3af04`

`priceToUsd` was one guess for both tiers, keyed on the **magnitude** of the value. A magnitude
cannot decide a unit. It now takes the tier, and **fails closed on `.js`**: a value that is not a
finite non-negative integer yields `null` and no price is stated (rider c).

**A/B against a real git worktree at `9535587`** — never a file swap; v3.1 measured a swap that
silently failed to apply as *"0 regressions, 0 status changes"*, and a whole session was written on
that number. 349 snapshots, 2,928 rows, canary live on both sides:

```
status changes  0
detail changes  6
label changes   6
quote changes   0
343 of 349 stores untouched
all six calibration hosts moved — enforced by the differ, which exits INCOMPLETE if one does not
```

| store | was | now |
|---|---|---|
| `levainbakery.com` | `$1000.00` | `$10.00` |
| `richer-poorer.com` | `$300.00` | `$3.00` |
| `sputnikcoffeecompany.com` | `$900.00` | `$9.00` |
| `perkyblenders.com` | `$890.00` | `$8.90` |
| **`firelightcoffee.com`** | **`$10.60`** | **`$9.35`** |
| **`tinker.coffee`** | **`$21.00`** | **`$7.50`** |

⚠️ **THE DIFFER FOUND A BUG IN ITSELF FIRST, AND IT WAS THE FLATTERING KIND.** A price label
*embeds* the cap, so keyed on the raw label a corrected row looks like one row vanishing and an
unrelated row appearing — and it reported **0 status / 0 detail / 0 quote changes for a fix that
demonstrably worked.** Money is now normalised out of the key and a label change is its own change
type. Without the row-set check it would have read as a perfect clean diff.

### 3b · the non-USD refusal — `7cc2e2c`

**In isolation, against the 3a commit: 38 status changes, 0 detail-only, 0 quote, 0 label** —
exactly the 38 measured stores, each naming its own currency, nothing else moved.

The precedence was **measured, not guessed**: JSON-LD `priceCurrency` (which `extract.ts:126`
already parses and nothing read) covers 34 of 38; `Shopify.currency.active` covers the other 4.
`Shopify.country` is rejected — it contradicts the active currency on **8 stores** because it
reflects the visitor's geo. `og:price:currency` is rejected — it disagrees with both other signals
on **3 stores**.

The row **states no number at all**. A converted number would invent a rate on a public instrument
about a real merchant; the raw number behind the right symbol would be a second claim nothing here
measured. What a price row should eventually *promise* is filed as **P-18**, not answered.

### The contractVersion consequence, stated for a merchant who re-runs tomorrow

The chain is real and was verified: `niceCap(minPriceUsd)` → `capUsd`, and **`capUsd` is hashed
into `contractVersion`** (`productTest.ts:1449`).

- **343 of 349 stores: nothing changes.** No contract change, no 409, identical results.
- **6 stores (3a's): the contract genuinely changes**, because the cap moved — e.g. `Price under
  $1005` → `Price under $15`. A saved test re-run returns **409**: *"This test's contract changed
  since it was saved, so a before/after comparison wouldn't be valid."* **That is correct, not a
  false alarm** — the old cap was derived from a wrong price, and comparing "under $1005" to
  "under $15" is not a comparison.
- **38 stores (3b's): the contract does NOT change** (the cap is unmoved); only the row's answer
  does, from `pass_evidenced` to `not_proven`. **No 409 fires**, so a before/after would present
  the flip as if comparable — which is exactly what the engine-version guard exists to prevent.

⚠️ **`ENGINE_VERSION` is still `"v2.0.0"` and has never been bumped through v2.1–v3.7.** Bumping it
409s *every* merchant's saved test with an accurate message; not bumping it lets those 38 flips pass
silently into a before/after. **This affects every merchant, so it is a Pause 2 call rather than
mine**, and it is presented there with these numbers.

---

## CP-1A — G-14 step 1 ✅ MEASURED

Full detail is filed in `standards/ENGINE_GAPS.md` under G-14. Headline:

```
sentences executed  3,681  (hostile 3,500 · controls 181)   dropped by cap 0
groups                779  adjudicated 779/779, missing 0, duplicates 0
real evaluate() vs the proven mirror: 0 disagreements
controls meeting their expected outcome: 181/181
confirmed false passes 1,137 · correct 1,464 · generator artefacts 735 · false fails 164
```

| class | confirmed false passes / hostile |
|---|---|
| `letter_not_spirit` | **260/280** (93%) |
| `tense_modality` | **439/621** (71%) |
| `wrong_subject` | **368/914** (40%) |
| `denial` | 69/461 (15%) |
| `violation` | 1/104 |
| `merchant_controlled_string` | **0/414** |
| `orthography` | **0/606** |
| `adjacent_vocabulary` | ~0/100 — **HALF-RUN, see below** |

**The three sentences a stranger needs.** (1) The engine reads keywords, not sentences, on three
axes and reads them well on three others. (2) `letter_not_spirit` is the worst rate and
`tense_modality` the worst count — nothing in the engine reads tense, modality or condition, so
*"We hope to move this batch to a Fragrance-Free product next season."* is credited as proof the
product is fragrance-free today. (3) The defect is **uniform across all thirteen keys**, so it is a
property of the matcher and no amount of editing `CLAIM_TERMS` addresses it.

⚠️ **`generator_artifact` is a THIRD STATE and it is 735 sentences.** `"Our carton is Contains
Aluminum."` is not English; the engine's answer to it carries no information either way. Counting
artefacts as defects would have inflated this campaign by two-thirds; counting them as correct would
hide real coverage loss.

⚠️ **`adjacent_vocabulary` 0/100 is NOT a measurement of that class.** Only the mechanisable half
ran. `DEFAULT_CONTEXT.adjacentDomains` is empty, so the domain-collision half was never attempted
for any of the thirteen keys — and that is where two of this repo's known confirmed defects live
(`organic` in its soil-science sense; homographs like `REACH`).

**Nothing was pinned and `EXPECTED_OPEN_GAPS` stays at 60**, because 274 groups would move it to the
high hundreds in a session whose brief said *"No fixes. Not one."*

### Generation ✅ VERIFIED_CLEAN

```
keys lifted from the engine's source BYTES : 13   (== ENGINE_CLAIM_KEYS, asserted)
terms                                      : 69
lift round-trip through the REAL evaluate(): 69/69
sentences executed                         : 3,681   (hostile 3,500 · controls 181)
dropped by cap                             : 0       (full coverage)
real evaluate() vs the proven mirror       : 0 disagreements
controls meeting their expected outcome    : 181/181
groups for adjudication                    : 779, exactly-once verified in both directions
```

**The brief predicted 1,500–3,000 sentences. The real number is 3,681.**

### ⚠️ THE TEMPLATIZER HAS EIGHT CLASSES, NOT THE BRIEF'S SIX

The brief's own rule — *"if the templatizer's classes differ from these six, follow the templatizer
and say so"* — applies. Followed. Mapping:

| the brief's six | `standards/attack/` |
|---|---|
| adjacent vocabulary | `adjacent_vocabulary` |
| denial | `denial` |
| subject/referent | `wrong_subject` |
| tense/aspect · modality/condition | **merged** into `tense_modality` |
| attribution | split across `wrong_subject/{review_quote,competitor}` and `merchant_controlled_string` |
| — | **`letter_not_spirit`**, **`orthography`**, **`violation`** have no counterpart in the brief |

The must-not-regress direction is not a separate class: it is built in as `control: true` templates,
181 of them.

### ⚠️ THREE INSTRUMENT BUGS IN MY OWN HARNESS, NONE FOUND BY READING

1. **`evaluate`'s argument order is `(product, requirement)`.** Written the other way it returns
   `undefined` **rather than throwing** — so every row would have read as a silent `not_proven`, and
   the campaign would have reported a *perfect* hostile sweep. A broken instrument returning the
   flattering answer, again.
2. **The engine has NO `contradicted` status for a claim.** Contrary evidence returns
   `status: "not_proven"` and is distinguished **only** by the detail sentence *"Your public copy
   states the opposite of this requirement."* Checking `status === "contradicted"` reported 13 real
   violating terms as broken and 293 sentences as path disagreements — every one an artefact of my
   mapping. The mapping now keys on that string and there is a **tripwire** asserting it still
   exists in the engine's source, because a rewording would silently collapse every contradiction
   into a plain miss.
3. **A control's expected outcome depends on the term's ROLE.** `control_plain_disclosure` is a
   *violating*-term control, so it expects `contradicted`, not `pass`. Checking all 181 controls for
   `pass_evidenced` reported 13 as broken when the engine was answering exactly right — and
   `engineStatus` alone cannot show it, because a contradiction and a plain miss are **both**
   `not_proven`.

### ⚠️ TWO FINDINGS BANKED BEFORE ANY ADJUDICATION

- **The real claim branch REFUSES the `shipping_policy` surface** (`productTest.ts:1746`); the
  mirror `evaluateWithVocabulary` does not. `standards/__tests__/vocabulary.engine.test.ts` proves
  the mirror faithful — but only ever probes `product_description`, so its proof structurally cannot
  see this. **And the templatizer's `merchant_controlled_string/shipping_policy` template asserts in
  its own `intent` that "the claim branch restricts no surface". That comment is stale**, and the
  sentences it generates cannot reach the branch at all.
- **The campaign's largest coverage hole is the non-mechanisable half of `adjacent_vocabulary`.**
  `DEFAULT_CONTEXT.adjacentDomains` is empty, so for all 13 keys only fragment probes exist. This
  matters more than the cell counts suggest: **two of this repo's known confirmed defects live
  exactly there** — `organic` in its soil-science sense, and homographs like `REACH`. A dedicated
  authoring pass is running to fill it.

---

## CP-1B — the fetch-layer corpus ✅ 101 CASES, FROZEN IN `234ee7b`

```
wrong-NUMBER defects in the SHIPPED engine    60
  of which UNREACHABLE by a real-store sample   49   <-- THE CAMPAIGN HEADLINE
closed by 3a + 3b                             15
residual at HEAD                              45
NEWLY OPENED by either fix                     0
```

The `unreachable_by_real_store_sample` flag is **the case authors' own**, set before any result was
seen, and the headline is computed over the wrong-number class only — the one nobody can argue with.

⚠️ **A flag is not a defect.** Nine currency cases differ from the engine only in **promise**: their
authors expected a non-USD store to receive a pass reporting its own currency, and v3.8 shipped a
refusal. Counted separately, never folded in, filed as P-18. That is a documented disagreement
between the corpus and a shipped decision, not a defect in either.

**Residual classes nobody had named**, all upstream of every matcher this project has attacked:

| shape | what happens |
|---|---|
| `p > 1000` is a **signed** comparison | no negative magnitude satisfies it, so `-200000` passes unconverted |
| `toFixed` abandons fixed notation at 1e21 | evidence renders `$1.0000000000000001e+23` |
| **zero-decimal currencies** (JPY) | ¥1250 becomes ¥12.50 |
| **three-decimal currencies** (KWD) | subdivided into 1000, so /100 is wrong the other way |
| comma decimal separator | `"12,50"` → `"1250"` → **×100** |
| European thousands separator | `"1.299,00"` → **1.299**, which INVERTS the minimum selection |
| a currency code in the price field | `Number("")` is **0** and `Number.isFinite(0)` is true — a price of zero |
| `parseOffer` | commits to the FIRST offer object, never a minimum |

**Now permanently expressible**: everything the `store` spec describes — all four classes v3.7
recorded as inexpressible. **Still structurally inexpressible**: anything below the response body —
TLS fingerprinting, mid-stream resets, the byte cap interacting with chunked transfer. The
synthesizer hands the engine a *complete* recorded response, so a body that never finishes arriving
cannot be modelled by it.

⚠️ **The recon found a SECOND price producer nobody had connected to P-17.**
`src/server/authenticatedTest.ts` builds its own `PublicProduct` with `priceUsd: v.price` raw — no
`priceToUsd`, no cents guard, no currency — feeding the same `evaluate`. Filed as P-18.

---

## The sidecar re-measurement — GENERAL ONLY, and that was verified

Pause 1's rule: a fix and the re-measurement of every figure it moves ship in the same push.
**Verified rather than assumed** — coffee's `PRICE-001` is `unbound` at v1.2/v1.3 and no v1.3 entry
binds `req_kind: price_under` (the ten bindings are claim ×3, variant_option ×4, delivery,
identifiers, attribute), so the coffee sample holds **zero price rows** and cannot move.

| | v3.7 published | v3.8 at the fixed SHA |
|---|---|---|
| pass rows `n` | 488 | **483** |
| confirmed `x` | 18 | **11** |
| point estimate | 3.69% | **2.28%** |
| Wilson 95% | 2.35 – 5.75% | **1.28 – 4.03%** |
| cluster-adjusted 95% (ICC 0.2) | **7.53%** | **5.17%** |

**7 of the 18 closed** — 5 currency rows now refuse, and `levainbakery`/`richer-poorer` keep passing
with a *corrected* price. 11 survive: the `$0.00` class, the availability defaults, `fieldcompany`'s
aggregation, `askinosie`'s sibling-SKU quantity. None is addressed by either fix.

⚠️ **The instrument reproduces v3.7's published 7.53% EXACTLY before moving it**, which is the only
thing that makes the two numbers comparable. And **x = 11 is past the end of `general_bound.mjs`'s
hand-typed Poisson table**, whose fallback would have returned **19.501** against an exact
**18.208** — so the exact CDF inversion is imported from `v3-7/perkind.mjs` and anchored against the
published table at x = 0..10.

⚠️ **Two instrument bugs here, both caught by disagreeing with a published number.** Filtering the
A/B rows by HOST pooled `deathwishcoffee.com`'s coffee-set product into the general sample and gave
**491** rows where v3.7 published **488**; the probe now records the URL. And **"still a pass row" is
not "still a false pass"** — `levainbakery` and `richer-poorer` keep passing with a corrected price,
and counting them as survivors reported two closed defects as open.

---

## GATES — all green

| gate | result |
|---|---|
| `npm test` (pure) | **946 pass, 0 fail** |
| DB-gated (`RUN_DB_TESTS=1`, stack probed first) | **1007 pass, 0 fail** |
| typecheck — root · standards project | clean · clean |
| acceptance runner | **hostile 4/37 · must-not-regress 19/19** |
| matcher files changed only in CP-3's commits | `3e3af04`, `7cc2e2c`, `f5cf74f` — named per commit |
| `standards/acceptance/subject-tense/` untouched | byte-identical |
| `EXPECTED_OPEN_GAPS` | **60**, unmoved — no pins added, and why is recorded |
| all four `standard.json` byte-frozen · no v1.4 | empty diff vs `origin/main` · no directory |
| production verified at CP-0's SHA | `/healthz` = `6a3e5d7` |
| nothing pushed beyond CP-0 | `origin/main` = `6a3e5d7`, HEAD unpushed |

---

## Where this brief was wrong *(running list)*

- ⚠️ **"the six-class treatment"** — the templatizer has **eight** classes and merges two of the
  brief's into one. Followed the templatizer, per the brief's own instruction.
- ⚠️ **"Expect on the order of 1,500–3,000 sentences"** — the real number at full coverage is
  **3,681**, and capping to stay inside the range would have cost 1,056 sentences and forced
  INCOMPLETE cells for no benefit.
- ⚠️ **"every deduped snapshot (~338)"** — the deduped union of the five real-store corpora is
  **349**, over **336 distinct hosts**, with **117** duplicate product URLs dropped.
- ⚠️ **§0b's cents mechanism was read, not executed — and it is CORRECT in every part.**
  `.js` integer cents, `.json` decimal strings, `usedJsEndpoint` recording which answered, and the
  `p > 1000` boundary misfiring at exactly 1000: all four confirmed against the bytes.
  `levainbakery.com`'s `.js` price is `1000` and `1000 > 1000` is false.
- ⚠️ **P-17's four upstream classes are right, but the fourth is bigger than its v3.7 write-up.**
  "min-of-readable-is-page-max" is 9 stores, not 1, once the analytics bootstrap is parsed — and 4
  of them are untouched by any cents fix.
- ⚠️ **CP-1B's "the agents who author it do not author any fix" was honoured; "freeze in a commit
  before any fix design exists" was honoured in substance and not in commit order.** The six authors
  returned before a line of fix code was written, and the design came from the census, which is what
  CP-3a itself mandates ("designed from the census, not from the source-reading"). But the corpus
  commit (`234ee7b`) lands *after* `3e3af04`/`7cc2e2c`, because the completeness critic was still
  running when the fixes were written. The independence property holds; the ordering does not, and
  saying so is cheaper than pretending otherwise.
- ⚠️ **G-14's own heading in `ENGINE_GAPS.md` says "the six-class treatment" and says the
  templatizer "generates six of them".** Both are wrong: there are **eight** classes and it generates
  all eight. Left as written, because that is the heading citations resolve through.

---

## Every default taken

| # | default | reason |
|---|---|---|
| 1 | **Followed the templatizer's 8 classes over the brief's 6** | the brief's own instruction when they differ |
| 2 | **Ran G-14 uncapped (3,681) rather than capped** | the cap dropped 1,056 sentences and forced INCOMPLETE cells for no benefit |
| 3 | **Batched class-major round-robin** | v3.7 batched by kind and recorded the cost: errors inside a batch are correlated by construction |
| 4 | **Excluded `v3-5/revert/synth_snaps` from the census** | synthetic bytes in a natural-frequency read make every rate a statement about what we invented |
| 5 | **Did NOT bump `ENGINE_VERSION`** | it affects every merchant's saved test; presented at Pause 2 instead |
| 6 | **Added no adversarial-corpus pins** | 274 groups in a session whose brief said "No fixes. Not one." |
| 7 | **Did not commit `tier2a_merchant_facts_design_2026-07-03.md`** | untracked before the session; v3.7 took the same call |
| 8 | **Everything committed and UNPUSHED beyond CP-0** | protocol rule; Pause 2 owns the push |

## Instrument failures this session — six, and not one was found by reading

1. `evaluate`'s argument order is `(product, requirement)`; reversed it returns `undefined` **rather
   than throwing**, which would have scored a *perfect* hostile sweep.
2. The engine has **no `contradicted` status**; contrary evidence is `not_proven` plus a detail
   sentence. Checking the status reported 13 real terms as broken.
3. A control of a **violating** term expects `contradicted`, not `pass` — 13 more false alarms.
4. The census anchored tier lookup on `snap.url`'s origin, so every apex→`www` store found
   **nothing**; `.json`/`.js` counts were 93/85 instead of **134/119**. Caught only by reporting one
   *fewer* non-USD store than v3.7 published.
5. `ab_diff.mjs` keyed on the raw label, so a corrected price row looked like one row vanishing and
   another appearing — **0/0/0 for a fix that worked**.
6. The re-measurement filtered by host, pooling another sample's rows: **491 where v3.7 published
   488**. And "still a pass row" was treated as "still a false pass", reporting two closed defects
   as open.

Four of the six were caught by a **canary, an anchor, or a disagreement with a previously published
number**. None was caught by reading the code.
