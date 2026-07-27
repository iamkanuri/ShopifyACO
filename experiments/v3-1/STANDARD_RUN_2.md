# STANDARD RUN 2 — Coffee Standard v1.0 on a sample the standard actually applies to

Run 1 measured the standard **and** the harness, and the harness lost: the capture took
each store's first product handle, roasters lead with merchandise, and a large share of the
"coffee" sample was t-shirts and mugs. Run 2 fixes the sampling and enforces the
applicability predicate (G-10), so this is the first trustworthy test of the standard's own
predictions.

De-identified where it matters: raw hostnames stay in the gitignored capture index and
audit dump. Hosts are named in this document only where a *specific* false positive has to
be reproducible.

---

## 0. What was run

| | run 1 | **run 2** |
|---|---|---|
| standard | `ALS-COFFEE` v1.0, hash `334389c4…` | **identical** |
| executable entries compiled | 10 / 10, 0 errors | **10 / 10, 0 errors** |
| product selection | first handle in store order | **first handle the standard APPLIES to** |
| applicability enforced | **no** — every entry on every product | **yes** (G-10, `standards/applicability.ts`) |
| targets attempted | 48 | **81** |
| products captured | 25 | **44** (43 distinct brands) |
| gated out by G-10 | n/a | **1** |
| stores evaluated | 25 | **42** |
| replay misses · hard errors | 0 · 0 | **0 · 0** |
| completion state | COMPLETE | **COMPLETE** |
| cost | $0 | **$0** (offline replay, semantic tier off) |

Capture attrition, all 81 logged with cause:
`robots_error_fetch failed` 17 · `not_shopify` 11 · `error_unterminated_json` 3 ·
`robots_unreadable_403/503` 2 · `not_found` 1 · `robots_disallowed` 1 ·
`robots_error_aborted` 1 · **`no_classifiable_product` 1**.

That last one is the honest yield finding the brief asked for: **exactly one roaster in 81
publishes a catalogue in which nothing classified as coffee.** Selection scans the full
`/products.json?limit=250` page (median catalogue 74 products, max 250) rather than the
default 30, because a roaster with a large merch line can push every coffee product past
the first page — a store dropped for that would be an artefact of page size, not a fact
about its catalogue.

⚠️ **One sampling defect, corrected rather than absorbed.** The expanded target list
contained both `deathwishcoffee.com` and `www.deathwishcoffee.com`, which are one brand.
They produced the same product and therefore the same false positive twice. The duplicate
is removed from every denominator and from the confirmed count below. Leaving it in would
have inflated both — and inflating the denominator flatters the bound.

---

## 1. What the applicability gate did, measured on run 1's own snapshots

Before capturing anything new, the shipped predicate was run over **run 1's exact 25
snapshots**. That isolates the gate from the re-capture:

| classification | n | what they are |
|---|---|---|
| in category | 9 | actual coffee |
| **out of category** | **13** | `Merch`, `Merchandise`, `Home`, `Gifts`, `Food & Snacks`, `Espresso Machine`; a cocktail shaker, a Fellow mug, a tote bag, three t-shirts, a hat |
| **unknown** | **3** | no `product_type`, and a title that decides nothing ("Net Wrecker", "Daybreak Glass") |

**16 of 25 of run 1's products should never have been asked.** Run 1 reported 11; the
shipped predicate is stricter than that hand count, because it also refuses the three it
cannot classify rather than guessing. Run 1's headline conclusion is not merely confirmed,
it is understated.

With the applicability-aware capture, the same gate excludes **1 of 44** — a store whose
`product_type` is the uninformative `"Products"`.

### Entries excluded on stores that DID run

A conformance list that quietly drops entries is worse than one that runs them all, so
these are reported per entry:

| entry | excluded | reason |
|---|---|---|
| IDENT-001 | 9 | `no_product_schema` — the page publishes no readable Product markup, which the standard's own text calls an access limit rather than an absence |
| FORMAT-001/002, GRIND-001/002 | 2 each | `preportioned_format` — pods and capsules, where the state is inherent to the format |

WEIGHT-001 deliberately **keeps** the pod products, because its own `applies_when` says
"coffee sold by mass, **including pod packs that also declare a net weight**". Over-applying
an envelope exclusion is as wrong as not applying it.

---

## 2. Predicted versus measured discrimination — the first trustworthy test

The bands in `standard.json` were authored as explicit hypotheses, every one flagged
`measured: false`. Fail rates are over **adjudicated** rows (`requires_store_access` is not
a fail — we could not look); coverage is **asked** over the run.

| entry | asked | adjud | fail | measured | predicted | verdict |
|---|---|---|---|---|---|---|
| FORMAT-001 whole-bean | 41 | 41 | 31 | 75.6% | 30–60% | MISSED high 15.6pp |
| FORMAT-002 ground | 41 | 41 | 39 | 95.1% | 35–70% | MISSED high 25.1pp |
| GRIND-001 espresso | 41 | 41 | 34 | 82.9% | 55–85% | **HELD** |
| GRIND-002 filter | 41 | 41 | 36 | 87.8% | 60–85% | MISSED high 2.8pp |
| WEIGHT-001 | 43 | 43 | 21 | 48.8% | 15–40% | MISSED high 8.8pp |
| CERT-001 organic | 43 | 43 | 41 | 95.3% | 30–70% | MISSED high 25.3pp |
| CERT-002 fair-trade | 43 | 43 | 42 | 97.7% | 40–75% | MISSED high 22.7pp |
| SOURCE-001 single-origin | 43 | 43 | 38 | 88.4% | 40–75% | MISSED high 13.4pp |
| IDENT-001 identifiers | 34 | 34 | 31 | 91.2% | 55–85% | MISSED high 6.2pp |
| DELIV-001 delivery | 43 | 32 | 19 | 59.4% | 50–80% | **HELD** |

**HELD 2/10. And every one of the eight misses is HIGH.**

Run 1 observed "7 of 8 misses high" on a confounded sample and read it as the author
over-estimating how much coffee stores publish. On a valid sample it is **8 of 8**. That
conclusion does not merely survive — the one counter-example disappears. `DELIV-001`, which
run 1 measured as MISSED *low* by 33.3pp on n=6, lands inside its band at n=32.

### Entries carrying ~no information (outside 15–85%)

`FORMAT-002` · `GRIND-002` · `CERT-001` · `CERT-002` · `SOURCE-001` · `IDENT-001` — **six of
ten**, the same count run 1 reported on its coffee-only subset but **not the same six**:

- **`WEIGHT-001` is rescued.** Run 1 (n=9) measured 11.1% and flagged it
  `not_discriminating`; run 2 measures **48.8%** on n=43 — the best-discriminating entry in
  the standard after delivery. Reclassifying it would have deleted a genuinely informative
  assertion on the strength of nine products.
- **`GRIND-002` newly fails.** 87.8%, 2.8pp over the line — a marginal call that a third
  run could move back.
- **`DELIV-001` is rescued**, from MISSED-low-by-33pp to HELD.

Three of run 1's ten verdicts were artefacts of n=9. **Two of ten is the honest count of
bands this standard predicted correctly**, and the standard's `predicted_discrimination`
blocks should be updated with the measured values rather than the guesses.

---

## 3. The certification result, re-checked

Run 1's most quotable line was that `organic` appeared in **zero of 25 stores' evidence** —
measured partly on merchandise, so worth nothing until re-checked.

Re-checked: **41 of 43 coffee products fail CERT-001**, and of the two that pass, **one is a
false positive** (§4). So the honest statement is that **one of 43 coffee product pages
carries a readable organic claim, and even that one is a claim about farming practices
rather than a certification.** Fair-trade is the same shape: 42 of 43 fail.

The conclusion survives the valid sample and is now measured rather than suggested. The
standard's own framing is worth keeping in view: an assertion that ~every store fails
carries as little information as one every store passes, which is why both CERT entries sit
outside the discriminating band.

---

## 4. Every `pass_evidenced` row audited individually

**69 pass rows across 42 stores** (27 structural, 42 text-evidenced), each read with its
**full untruncated evidence sentence** rather than the 180-character rendered quote — the
v2.8 audit nearly mis-classified a real row because the supporting text sat past the cut.

### Confirmed false positives: 3

**1. A serving size read as the product's weight — NEW.**
`deathwishcoffee.com`, WEIGHT-001:
> "CAFFEINE CONTENT: Power Surge Single-Serve Pods contain approximately 210mg of caffeine
> (20% more than our Dark Roast) based on a standard **6oz serving** when brewed following
> package instructions."

A caffeine dose and a brewing serving size, rendered as proof that the product's own weight
is stated. This is the v2.8 nutrition-quantity class in a form the existing guard cannot
see: `PER_SERVING` looks for `per serving`, and this sentence writes *a standard 6oz
serving*. `NUTRIENT` does not carry `caffeine`.

**2. A brewing recipe read as the bag's mass — PRE-EXISTING, disclosed unfixed.**
`groundsforchange.com`, WEIGHT-001. Found by v3.0 CP5, pinned in the adversarial corpus,
and deliberately **not** fixed here: it is outside the four defects this session was scoped
to, and `dimensions` is the row whose last over-tight guard cost four real positives. Fixing
it needs its own measurement, not a fifth regex.

**3. `organic matter` read as an organic claim — NEW.**
`hydrangea.coffee`, CERT-001:
> "The farm's volcanic soils are described as rich in **organic matter**, while narrow
> canyons channel warm winds through the surrounding landscape…"

`organic` is matched whole-word, which is what stops `inorganic` — and nothing stops
`organic matter`, `organic compounds` or `organic growth`. A soil-science sentence rendered
as a certification claim.

### Borderline, counted as passes, named so the call can be disputed: 2

- `www.lacolombe.com` CERT-001 — *"base their production on sustainable organic practices
  only"*. A statement about how this coffee is produced, which is what the entry asks. A
  reader who takes the entry to mean a **certification** would count this against.
- `reanimatorcoffee.com` SOURCE-001 — *"choose Single Origin - Roaster's Choice"*.
  Single-origin is one selectable option on a bulk subscription, not an assertion about a
  fixed product. A stricter reading makes it a false pass.

Both are recorded rather than silently adjudicated, because an audit whose judgement calls
are invisible cannot be checked.

### The bound

```
pass rows                     69      rows per store 2.09
confirmed false positives      3      point estimate 4.35%
naive 95% upper bound              11.23%
cluster-adjusted, ICC 0.2          13.68%   <- the honest headline
per-store                           7.1%   (3 of 42 stores carry at least one)
```

---

## 5. Which of run 1's conclusions survive

| run 1 conclusion | verdict on a valid sample |
|---|---|
| G-10 is a precondition, not a nicety | **SURVIVES, understated** — 16 of 25, not 11 |
| the bands were systematically over-estimated | **SURVIVES, strengthened** — 8 of 8 misses high, not 7 of 8 |
| `organic` appears in ~no store's evidence | **SURVIVES** — 1 of 43, and that one is a practices claim |
| six of ten entries are `not_discriminating` | **the COUNT survives, the SET does not** — WEIGHT-001 and DELIV-001 were artefacts of n=9; GRIND-002 replaces one of them |
| a category sample finds defects a general sample cannot | **SURVIVES, and is now a number** — see §6 |

---

## 6. The instrument finding, now quantified

| | general sample | **coffee sample** |
|---|---|---|
| stores | 172 | 42 |
| pass rows audited | 506 | 69 |
| confirmed false positives | **0** | **3** |
| point estimate | 0% | **4.35%** |
| cluster-adjusted 95% upper bound | **0.83%** | **13.68%** |

The two samples were measured by the same engine, on the same day, with the same audit
discipline. The general sample says the exit criterion is met with room to spare. The
category sample says the false-positive rate is at least an order of magnitude higher than
that, and the reason is not chance: **two of the three defects fire on vocabulary a coffee
page contains and a general DTC page does not** — a brewing recipe, a caffeine dose per
serving, soil described as rich in organic matter.

v2.8 said *"zero across 55 rows was a statement about sample size."* v3.0 sharpened it to
*"zero across 506 rows of a broad sample is a statement about sample SHAPE."* Run 2 makes
that measurable rather than rhetorical: **the general-sample bound is not an estimate of the
error rate, it is an estimate of the error rate on copy that looks like the average of every
category at once — which is copy no individual merchant writes.**

The operational consequence is a rule, not an observation: **a category standard must be
fitness-measured on that category before it is published.** The bound that matters to a
coffee roaster is 13.68%, not 0.83%.

---

## 7. What this run did NOT establish

- **The semantic tier was off** (offline, $0). It can only understate claim-row passes, so
  it cannot flatter a false-positive rate downward — but it CAN overstate a fail rate, and
  CERT/SOURCE are exactly the claim rows it would resolve. Their 88–98% fail rates are
  therefore an **upper** bound on the true fail rate.
- **n=42 is a directional sample.** A 13.68% upper bound at n=69 rows is wide. The point
  estimate is 4.35% and the true rate could be well under it.
- **One product per store.** A roaster's first *applicable* product is not their typical
  product, and nothing here measures within-store variation.
- **`fetchPublicProduct` drops `product_type`** whenever the page tier answers, so **15 of
  44 products would have been unclassifiable** using only what the engine itself exposes.
  This run classifies from the merchant's `product_type` as published by `/products.json` —
  public data from a public endpoint, and the signal the standard's own `category_signals`
  names first. **That gap is a production defect, not a harness detail**: the same null flows
  into `CATEGORY_CLAIMS` and `AttributeSpec.onlyFor`, so category inference silently degrades
  to the title alone on roughly a third of stores. Not fixed here; recorded as the next
  engine gap.
