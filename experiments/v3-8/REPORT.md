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
4. **G-14 step 1: 3,681 sentences over 13 keys × 8 classes, full coverage, 0 dropped.**
   Adjudication running.
5. ⚠️ **Three instrument bugs in my own harnesses, every one caught by an assertion or a canary,
   none by reading** — and one of them was found only because my count was *one lower* than a
   figure v3.7 had already published.

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

## CP-1A — G-14 step 1 🔄

Generation ✅ **VERIFIED_CLEAN**; adjudication running.

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

## CP-1B — the fetch-layer corpus 🔄

Running. Recon over the real path → six authors (currency · cents boundary · zero/null/negative ·
tier disagreement · malformed money · transport/truncation) → completeness critic. Authors return
**semantic case specs**, not bytes; a mechanical synthesizer turns them into real HTTP bodies, so no
agent writes HTML and no agent touches `src/`. **The corpus is frozen in a commit before any fix
design exists, and its authors author no fix** — the brief's structural answer to the
corpus-author/fix-author tension.

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
