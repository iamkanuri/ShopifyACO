# v4.0 — THE REFERENT GUARD, WITH THE CERTAIN WINS BANKED FIRST

Session 2026-07-28. Branch `feat/v4-0-referent`, off `main` at **`b969f43`**.

---

## 4. THE SHOPIFY APP INVENTORY — read this section first

> The brief asked for this as a standalone section the user can read before anything else.
> **Report only. Zero edits were made to any app surface.** Produced by four parallel
> read-only surveys, a quote-verifier that re-checked every claimed string against the
> bytes, and a coverage-verifier that hunted for surfaces the surveys missed.

### The headline

Opened from the Shopify admin, the app **leads with the current product**: the default
screen is **Tests**, listing Buyer Tests with per-requirement verdicts (Proven / No
blocking evidence / Not proven / Requires store access). It is the one screen that
*structurally refuses* to show sample data — the rule is stated in its own code, because a
fake test would be a lie with the merchant's own storefront name on it.

**Everything around that screen is still the retired product.** Four of eleven sidebar
items (Measure, Experiments, Monitoring, Overview) are the AI-visibility instrument,
presented as peers of Tests. The banner every unconnected viewer sees — including a
Shopify reviewer — ends *"to see your real AI visibility"*. The first sentence a freshly
installed store reads is *"Store connected. Run your first benchmark to see your AI
visibility."*

### The single largest gap, and it is not a stale string

**The app never names a published buying standard.** No file under `viewer/src/app/`
references a standard, a version, a hash, `/standards`, or Coffee Standard. The only
provenance a merchant is shown is `contract {contractVersion}` — an opaque fingerprint of
*generated* requirements, not a pinned standard identity. `compileStandard` is imported in
exactly **one** place in the whole server, and it is the **public demo page**. An installed
merchant cannot run Coffee Standard v1.3 against their own catalogue.

So the product the live site publishes — versioned, content-hashed, citable standards — is
not reachable from inside the app that is supposed to deliver it.

### Listing and approval state

**What the repo proves.** `shopify.app.toml` declares four scopes
(`read_products`, `read_customer_events`, `write_pixels`, `write_products`),
`embedded = true`, `application_url = https://lens.thirdocular.com/app`, api_version
2026-01, and the three mandatory GDPR compliance topics — all implemented server-side.
Every declared scope is exercised by real code; none is declared-but-unused or
used-but-undeclared. **A submission demonstrably happened**: commit `90b137b` (2026-07-11)
decodes a real reviewer kickback under App Store requirement 2.1.4 and fixes it, and an
external audit dated 2026-06-28 recommends keeping the submission active.

**What the repo says about itself that is FALSE TODAY.**
- `CLAUDE.md`'s most-read status block still says the App Store listing submission is
  *"genuinely NOT yet shipped"* — and in the same sentence calls `write_products` live
  write-back unshipped, which `CLAUDE.md` itself contradicts 200 lines later.
- `LAUNCH_CHECKLIST.md` still carries *"Submit the app for Shopify review"* and *"Create a
  Partner account + a public app"* as unchecked boxes, with a committed `client_id` in the
  manifest.
- `IMPLEMENTATION_STATUS.md` still lists legal/support/data-deletion URLs as a locked
  external blocker; all four are shipped routes.
- `TODO.md` — which `CLAUDE.md` names as the single source of truth for deferred work —
  still lists Shopify OAuth as not-started and the API secret as un-rotated.
- `LAUNCH_CHECKLIST` §10 instructs setting four env vars **no code reads**, and misses
  `CONTACT_EMAIL`, the one that matters.

**The listing copy is 100% the retired product**, untouched since 2026-06-25. Its intro is
*"Are AI assistants recommending your store, or your competitors? Measure it, then fix
it."*; its title block reads *"AisleLens — AI shopping visibility"*. It also declares that
in-app paid plans *"would require building the Shopify Billing API"* — Shopify Managed
Pricing is already built and wired, so that clause is **false today**. All three
screenshots miss Shopify's 1600×900 spec (1903×889, 1501×784, 1507×633).

**Configuration hazards that degrade silently.** If `SHOPIFY_SCOPES` is unset on the
server the runtime falls back to `read_products` **only** — Fix Studio apply and pixel
activation would degrade to "missing scope" with nothing visibly broken.
`SHOPIFY_APP_STORE_URL` and `SHOPIFY_APP_HANDLE` are read by `env.ts` and documented in no
`.env.example`; without the first, the *"Get it on the Shopify App Store"* CTA (six call
sites) silently becomes an App Store **search**.

### Two findings that are worse than off-message

1. **The retired frame is written into DURABLE MERCHANT DATA.** Monitoring alert titles are
   generated server-side, persisted to the `alerts` table, rendered on two screens, and
   used verbatim as notification subject lines: *"AI visibility dropped: …"*,
   *"{competitor} overtook you in share of voice"*. That last one is a **claim-linter
   violation persisted to the database**.
2. **One string is factually false one of two ways.** Measure's demo error reads *"Open the
   app from the Shopify admin (Apps → AI Visibility) to run against your store."* The
   manifest name is AisleLens. Either the instruction names a title that does not appear in
   the merchant's admin, or the deployed Partner app is still called "AI Visibility" and
   the manifest has drifted. **Which one is wrong is a Partner-dashboard fact.**

### Billing sells the retired product

The three usage meters are **Benchmark runs**, **Monitoring schedules** and **Product
feeds**. Nothing meters or mentions Buyer Tests, requirements or standards runs. *"Pro
unlocks unlimited live benchmarks, Fix Studio apply, experiments and monitoring."* — four
retired-era capabilities, no test or standard capability. **The thing the app now says is
the product is not the thing being sold or counted.**

### The authenticated buyer-test path, and where P-18 bites

The path runs end to end at the current engine: a connected merchant gets the public
contract re-run with metafields and the SEO description added as readable surfaces, plus a
confirmation ladder and Fix Studio proposals. **P-18 bites at the price row.** On the
authenticated path the app prints a dollar sign and a dollar amount for a merchant whose
store sells in pounds, euros or Canadian dollars — and then scores the difference as an
improvement *caused by connecting the store*. The public path gained a non-USD refusal at
v3.8; the authenticated one did not.

### What the repo cannot answer

Draft vs in-review vs approved vs published vs withdrawn; what copy and which assets are
actually in the Partner dashboard; whether the currently-**released** app version carries
these scopes, the embedded flag, the compliance subscriptions or the pixel extension; and
whether there was a second kickback. **There is no document in the repo recording a
submission date, a review verdict, a resubmission or an approval.** Repo history since
2026-07-11 touches the standards engine, not the app.

---

## 0. BASE, AND THE SHA THE BRIEF ASKED US TO RECONCILE

| | |
|---|---|
| `main` = `origin/main` = production `/healthz` | **`b969f43`** |
| `verify_prod` | VERIFIED_CLEAN — 21/21, 0 failures |
| `verify_sections` | VERIFIED_CLEAN — 15/15, 0 failures |
| `npm test` at base | 1,039 · 963 pass · 0 fail · 76 skipped |

v3.9's `HANDOFF.md` says production is `12db430`; its `REPORT.md` says `b969f43`. Both were
true when written: the handoff was written at `12db430`, then one more commit — `b969f43`,
*"docs(v3.9): the handoff, closed out at the shipped SHA"* — landed and was pushed. **The
handoff went stale describing the commit that superseded it**, which is the only way that
file can go stale.

---

## 1. PHASE A — THE CERTAIN WINS. Shipped and live at `5f124bd`.

### CP-1a — the two term-list defects

**Step 1, measured before editing anything.** `experiments/v4-0/term_measure.ts`, over the
349-URL replay corpus, all 13 claim keys:

```
4,537 rows evaluated · 72 pass_evidenced
resting on a term under test:  2 capability · 0 of the 348 rows a merchant is ASKED
  magicspoon.com  vegan          <= "plant-based"   (FAQ structured data)
  dropps.com      fragrance_free <= "unscented"     (product title)
natural frequency, 4,426 evidence sentences:  plant-based 4 · plant based 0 · unscented 1
```

Every one of the 72 pass rows carries a **fidelity proof**: the re-derived `findSupport`
hit reproduced the engine's own rendered quote byte-for-byte. 0 problems.

⚠️ **The first run of that probe resolved `INCOMPLETE`, not "0 defects".** Without
`__resetCaches()` per snapshot the process-wide egress budget refused 342 of 349 products.
A silent probe would have reported two rows out of seven products as if it had read 349.

#### Per-row adjudication

Four independent adjudicators (regulatory, merchant-consequence, software-correctness,
skeptic-by-default), three adversarial refuters with distinct lenses (industry-truth,
both-directions-of-falsity, repo-precedent), **two blind gold cases seeded per P-21**.
**Gold 4/4 on both — no verdict is discounted on calibration grounds.**

| row | verdict |
|---|---|
| `magicspoon.com` / `vegan` / "plant-based" | **FALSE PASS**, and doubly so — the sentence recommends a *different* product (*"check out our High Protein, High Fiber cereal"*). It is `A041` in the v3.9 adjudication, class `cross_sell_sibling_product`. |
| `dropps.com` / `fragrance_free` / "unscented" | **NOT a false pass, 3-1.** The synthesis verified from the captured bytes: dropps publishes a complete ten-ingredient, variant-scoped formulation with zero fragrance material, and `masking`/`parfum`/`perfume`/`essential oil` return **0 across all 952,130 bytes**. The one dissenting adjudicator declined to run that grep in a snapshot they cited by path. |

**Q1 — `plant-based` / `plant based` → `vegan`: REMOVE.** Unanimous 4/4, survived all three
refuters. The equivalence is false in both industries that own the term: a dietary
predominance in food (no legal definition in the US, UK or EU; routinely applied to
products containing honey, whey, dairy and gelatin) and a **carbon-feedstock** claim in
materials chemistry (biobased content under ASTM D6866, which says nothing about lanolin,
beeswax or shellac elsewhere in the article). `vegan` is an animal-exclusion rule; the
entailment runs one way and the engine drew the unsound direction.

⚠️ **The warrant I first used was an artefact, and a refuter caught it.** "1 pass row rests
on plant-based" measures how often the word reaches an *evidence sentence* — a property of
the surface filter, not of the vocabulary. Re-measured over raw bytes: **14 stores publish
the term, senses enumerated, and 0 true vegan claims are lost.** Both readings are
published because they answer different questions; the raw one is the better warrant and it
is the refuter's, not mine.

**Q2 — `unscented` → `fragrance_free`: KEEP-PENDING, and the SPLIT filed as a proposal.**
The panel split 1-1-1-1. Three grounds decided it, and the second is the one that matters:

1. The dropps row is not a false pass (above).
2. **Bare removal with the label left at `"Fragrance-free / unscented"` would be a false
   statement about a real store, self-refuting on its own line.** The miss path renders
   *"Checked structured data, product title and page description — no statement an AI buyer
   could verify"* — naming the product title as a surface it read, while that title reads
   *"UltraWash Dishwasher Detergent Case, Unscented"* and the second word of the row's own
   label is *unscented*. A universal negative over a named surface, falsified by the surface
   it names. Strictly worse than the v3.5 identifiers defect: there the engine had not
   looked; here it looked, matched, and had the match removed from the dictionary.
3. The corpus is **SILENT, not reassuring** — n=1, in the wrong product category. The
   deciding measurement is named in the filing: over a cosmetics-routed capture, how often
   is `unscented` the *sole* matched term, and do those stores publish a retained term
   anywhere?

⚠️ **`relabelling alone, with the term kept, is worse than doing nothing`** — the pass row
would then read *"Fragrance-free — Stated in your product title"* quoting *"Unscented"*,
taking the residual from half-disclosed by the slash to entirely undisclosed.

#### The objection that nearly blocked CP-1a, and why it did not

The adjudication's strongest dissent — raised by one refuter, tested by nobody — said
removing *any* supporting term is blocked: `g14.table.test.ts` requires the **frozen**
adjudicated denominator to equal the live raw one, and the numerator is a human read of 779
groups keyed `class|subclass|key`, *"so the per-term delta is not derivable, and the only
exits are to destroy the record, re-run the campaign, or not remove the term."*

Confirmed against the source, then **falsified**. v3.8's roll-up is **sentence-level** and
`g14_sentences.json` records `term` on every row, with per-term `exceptions` overriding the
group verdict. `experiments/v4-0/rederive_adjudicated.mjs` performs the exact drop and
refuses to answer unless two anchors reproduce first:

```
ANCHOR 1  the untouched trail reproduces v3.8 exactly   (260/280 · 368/914 · sum 1137)  PASS
ANCHOR 2  v3.9's 42 overturns reproduce the correction  (441/914 · 8/104 · sum 1282)    PASS
```

**Anchor 2 earned its keep twice.** Two plausible formulations of "reinstate" gave **1,310**
and **1,281**; only *"the re-examination overturns the REFUTATION, leaving per-term
exceptions intact"* reproduces 1,282. Either wrong number would have looked like a
measurement. **No group changed its verdict** — the corpus lost 115 sentences and the
adjudication still describes every sentence that remains.

**Cross-check from an independent instrument:** the live generation
(`experiments/v4-0/emit_g14.ts`) and the frozen v3.8 trail agree on all seven comparable
denominators after the change — 270 · 886 · 402 · 591 · 104 · 603 · 445.

#### Blast radius and the same-push invariant

```
349-store A/B, 2,928 rows, isolated against the CP-1b tree:
  0 status changes · 0 detail changes · 0 quote changes
  contractVersion moved for 0 of 349 stores
G-14: only `vegan` moves, every cell exactly halved on the supporting side
  hostile 3,732 -> 3,617 (-115) · controls 181 -> 175 (-6)
  ADJUDICATED_V38 numerators -42, sum 1,282 -> 1,240
```

**Same-push invariant: NO.** Explicitly checked rather than assumed — none of the 483
general or 162 coffee adjudicated pass rows rests on `plant-based`, `plant based` or
`unscented`. **No sidecar is edited and no published bound moves.**

### CP-1b — P-22, the quote that omits its proving term

`presentableQuote(sentence, mustInclude?)` now slides a 180-char window onto the matched
span instead of always cutting from character 0. With no span, or a span already inside the
head window, the output is **byte-identical**. `findSupport` and `findViolation` pass the
span they already computed; `findAttributeSupport` and `findTimingSupport` delegate to
`findSupport`, so one fix covers claim, attribute and delivery rows.

```
349-store A/B, 2,928 rows:
  0 status changes · 0 detail changes · 10 quote changes over 8 stores
  contractVersion moved for 0 of 349
```

**The footprint is 5× what v3.9 filed.** v3.9 measured claim rows only and found 2 of 69.
All ten, in full:

| store | row | before | after |
|---|---|---|---|
| hyperlitemountaingear.com | Measurements are stated | *…fully loft to 2.75…* | *…loft to 2.75 **inches** for efficient heat retention…* |
| monos.com | Measurements are stated | a features list, no measurement | *…**Weight: 0.43 lb / 0.19 kg** See our exterior measurements guide…* |
| thursdayboots.com | Materials are stated | *…Sodello Brand 80%…* | *…**80% Organic Cotton, 18% Nylon, 2% Elastane**…* |
| thursdayboots.com | Care or use instructions are stated | no care instruction | *…**Care Instructions: Machine wash warm**…* |
| bluebeardcoffee.com | Delivery timing is stated | *…allow two (2) to…* | *…allow **two (2) to eight (8) business days**…* |
| www.verenastreet.com ×2 | Delivery timing is stated | *…within 1 to 5…* | *…within **1 to 5 business days**…* |
| mikava.coffee | Measurements are stated | no weight | *…**Weight: 250g/8.8oz or 2 lb bag*** |
| oslocoffee.com | Delivery timing is stated | *…allow five (5) to…* | *…**five (5) to eight (8) business days**…* |
| pilgrimscoffee.com | Single-origin | no "single origin" | *…**a single origin** natural process coffee…* |

Also fixed one tier over: `semanticTier` rendered a head cut that need not contain the
model's own verified `exactQuote`. **Replay cannot exercise it** (`PRODUCT_TEST_SEMANTIC=0`),
so it is covered by construction and a unit test, not by measurement — stated, not glossed.

`buyerTestDemo.resolveFull` gained a second exact leg. Without it a windowed quote would
silently stop resolving and the demo would say the sentence could not be matched — a
degradation that looks like an honest "not available".

⚠️ **The brief predicted the ENGINE_VERSION tripwire would stay quiet here, and it was
wrong about the mechanism.** The pin is a content hash over whole files and
`testEvidence.ts` is one of them, so any edit fires it. It is also right to bump on the
merits: ten rows changed the sentence a merchant is shown.

### Pause 1 — taken, not asked

The brief's stated default is push; the standing preference is deploy-after-verification;
every gate was green; the measured blast radius on real stores is zero. Nothing was left
for the record to settle.

```
main == origin/main == /healthz == 5f124bd
verify_prod       VERIFIED_CLEAN — 21/21
verify_sections   VERIFIED_CLEAN — 15/15
```

---

---

## 2. PHASE B — THE REFERENT GUARD. Built, measured, **REVERTED AND PINNED**.

Revert-and-pin was an explicit, pre-authorised success for this phase. It is the outcome.

### CP-2 — the design

Four independent designs from four different starting hypotheses (attachment-head veto,
frame-not-noun, product-anchor-positive, minimal-and-skeptical); three judges with distinct
lenses (carrier-cost, does-it-actually-close, repo-precedent); one synthesis.
**All three judges answered `any_design_shippable: false` for every design as submitted.**
What was implemented is the synthesis's graft, **G-15-R**.

Two judge catches were load-bearing and both went in: adding `referent.ts` to the
`ENGINE_VERSION` watched list (without it the whole predicate is editable without tripping
the wire), and building the head-position test as a **closed continuation vocabulary**
rather than a function-word list — the latter fails *closed* on omission and would have
reintroduced the protector-list failure the `origin` tombstone is named for.

### CP-3 — every instrument the author could run said SHIP

```
349-store A/B, 2,928 rows:  4 status changes, ALL pass→not_proven, ALL on rows the v3.9
                            adjudication confirms MISLEADING · 0 true rows lost
                            1 detail change: ozonecoffee.co.uk stays GREEN and its quote
                            moves from a region-generality sentence to the merchant's own
                            title "Peru Tasting Pack (Organic)" — v3.2's audit note on that
                            exact row read "the verdict is right and the evidence is wrong"
suite 1.0    hostile 4/37 → 5/37 · must-not-regress 19/19
suite 2.0    hostile 0/8  → 6/8  · must-not-regress 17/17
G-14         13 cells moved, one per key, ALL wrong_subject, ALL down (−54)
             seven class totals delta 0, including tense_modality and denial
npm test     1,057 · 981 pass · 0 fail
```

A fourth attacker separately measured **0 occurrences of the blocking frame across 319
snapshots**, and 4 flips in 11,791 sentence × key executions, all correct.

### And the gate killed it

Four independent attackers — who authored neither the guard nor suite 2.0 — executing
**chosen input** against the frozen commit `deb0fe1`, 805 probes, every canary live:

| | |
|---|---|
| claimed regressions | **126** |
| confirmed by a refuter who re-executed every one | **119** |
| refuted | 2 · **unresolved 5** (counted against the guard) |
| defects closed | 6 of its own 8 |
| **ratio** | **19.8 true rows lost per defect closed, against a bar of 2.33** |

**8.5× over. No defensible discounting reaches the bar** — the least-contestable subset
alone is 7.5:1.

### The finding is a DIRECTION ERROR, not a list hole — which is why no dial-down answers it

Rule 1 reads only **forward** and never checks whether the term is already predicated of the
product **behind** it. Rule 2 computes exactly that predicate and spends it on the partitive
branch alone. So the bridge crosses a bare `and` — which `CLAUSE_SPLIT` does not cut on,
because it requires a comma — walks out of the clause carrying the claim, and vetoes on the
subject of the **next independent clause**.

**Re-executed by me rather than read from the refuter's prose** (`verify_kill.ts`,
three-legged canary, guard-off vs guard-on in one process): **13 of 13 lost.**

> *"The beans are organic and farmers in Huila are paid above the C price."* → `not_proven`
> *"The granola is gluten free and family farms in Montana grow the oats."* → `not_proven`
> *"The bottle is BPA-free and local growers are paid within seven days."* → `not_proven`
> *"This coffee comes from an organic farm in Antioquia."* → `not_proven`

The second is an **allergen** row; the third has no agricultural reading at all. **The class
is not confined to the claims the guard was aimed at.**

⚠️ **One comma flips the verdict.** *"The bar is vegan and small farmers are paid a
premium."* → `not_proven`; the same sentence with a comma before `and` → `pass_evidenced`.
Two merchants who wrote the same claim get opposite verdicts on punctuation whose
significance they cannot see.

⚠️ **The pre-priced dial-down was FALSE as measured.** The design priced dropping
`LANDHOLDING` as *"removes every farm-direct hazard"*. Measured two ways on the frozen tree:
**4 of 17** and **54 of 119** — under half, and it touches none of the copula class. **A
dial-down priced against the author's own corpus was priced against the instrument that
cannot see the class.**

### What the attempt bought

6 of 8 targets closed · **0 of 18 honest carriers lost** · the corpus instrument clean · the
finite-verb gate holding under 13 direct title/option probes. **The design is sound where it
is measurable and unmeasurable exactly where it is wrong.** Full pin, with the successor's
five prerequisites, in `standards/ENGINE_GAPS.md` under G-15.

**Tenth instance of "a real-store replay is a REGRESSION check, never an acceptance gate" —
and the second time the gate ran BEFORE ship rather than as an autopsy. It paid for itself
again.**

---

## 3. THE CAPABILITY × FREQUENCY BLOCK'S THIRD ROW

Filled from the artifacts:

> **`pinned as a known limitation at 19.8 true rows lost per defect closed`** — G-15-R
> attempted at v4.0, reverted at 119 confirmed true-row losses against 6 real-copy defects
> closed, measured by four independent attackers against a bar of 2.33.

**The publish decision is re-presented at Pause 2 and NOT taken here.** The brief's default
was PUBLISH once the security-disclosure condition (patch **or** pin) was met, and the pin
now meets it by construction. But the revert **materially changed what would be published**:
the third row now reads *"pinned as a known limitation"* rather than *"closed by a fix"*, so
the page would disclose an open defect class with no patch behind it. That is an
outward-facing decision about what to say publicly, and it is the user's to take.

---

## 5. EVERY DEFAULT TAKEN, AND EVERY PLACE THE BRIEF WAS WRONG

### Defaults taken without asking, and why the record settled them
- **Pause 1 — pushed Phase A.** Brief default was push; standing preference is
  deploy-after-verification; gates green; blast radius zero.
- **`unscented` KEEP-PENDING.** The adjudication produced it; the split is filed as P-23.
- **Two ENGINE_VERSION bumps inside one release** (v2.3.0 for CP-1b, v2.4.0 for CP-1a). The
  tripwire's rule is that both pins move in the same commit and re-pinning the hash alone is
  worse than deleting the test. Only the final deployed value is ever recorded against a
  merchant's saved test, so the intermediate costs nothing.
- **CP-5 reported only, zero edits**, as scoped.

### Where the brief was wrong
1. **The cost bar is `2.33–5.13`, not `2.13–5.13`.** `robust.json`: `14/6 = 2.333` strict,
   `41/8 = 5.125` raw. `2.13` appears in no artifact.
2. **"The tripwire should stay quiet" for CP-1b was wrong about the mechanism.** The pin is a
   content hash over whole files and `testEvidence.ts` is one of them, so any edit fires it.
   It is also right to bump on the merits: ten rows changed the sentence a merchant sees.
3. **"8 sole-attributed defects over 7 stores" is the RAW/corrected reading.** The strict
   reading is 6 over 6. The brief did not say which; both are now stated.
4. **P-22's filed size was a floor.** 2 of 69 claim rows became **10 asked rows over 8
   stores** once attribute and delivery rows were counted.
5. **The 17 capability groups are not a referent target at all** — three judges measured 0 of
   17, structurally, because every template's head noun is `product`. Filed as P-26 with the
   instruction to stop scoring referent designs against them.
6. **The SHA reconciliation** resolved as the brief suspected: production is `b969f43`, and
   v3.9's handoff went stale describing the commit that superseded it.

### Instruments that caught themselves this session
- `term_measure.ts` resolved **INCOMPLETE** on its first run rather than reporting 2 rows out
  of 7 products as if it had read 349 — the egress budget had throttled the replay.
- The same probe's **fidelity check** then refused on 2 rows after CP-1b landed, because it
  was reproducing the pre-P-22 head cut while the engine rendered a window. The probe caught
  its own staleness rather than mis-attributing.
- `rederive_adjudicated.mjs`'s **ANCHOR 2** killed two plausible-but-wrong formulations
  (1,310 and 1,281) before either could be published as a measurement.

