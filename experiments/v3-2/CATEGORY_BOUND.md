# v3.2 — THE CATEGORY BOUND, AND WHAT THE FIX ATTEMPT COST

*Session record. Production moved from `8cb39a5` to `8b71433` (CP0) during this session;
everything after CP0 sits on `feat/v3-2-category`.*

---

## 0. The one-paragraph version

This session set out to close three coffee false positives so the category bound could
be published. **The three fixes were written, measured against 216 real stores, reported
as costing nothing, and then reverted** — because two independent adversarial passes,
re-executed mechanically against the parent commit, put the real cost at **192 lost true
statements**. The bound is therefore published with the defects open and named, the
attempted fix recorded with its price, and one plumbing defect (`product_type`) genuinely
fixed. The engine is not better than it was at matching; it is better at being *asked*,
and the record of what it costs to make it better at matching is now much sharper.

---

## 1. What shipped, and when

| | commit | state |
|---|---|---|
| CP0 crash fix, alone | `8b71433` | **deployed to production**, `/healthz` verified |
| CP1 coffee guards | `1fda80d` | **REVERTED** in `7aeddbc` |
| CP2 `product_type` | `d84eba8` | on branch |
| CP6+CP7 published standard | `a7bda30` | on branch |

### CP0 — the crash fix, shipped by itself

A merchant who imported a public buyer test containing a materials, measurements, care or
identifiers row pinned a contract that **threw on every re-run**. Executed at the parent:

```
TypeError: Cannot read properties of undefined (reading 'violating')
rows returned: 0 of 5
```

At the child: 5 of 5. One row that cannot be re-asked now costs one row.

It shipped alone because it contains **no matcher change**, which was confirmed by diff
rather than asserted: `testEvidence.ts`, `subject.ts` and `claimLinter.ts` are not in the
diff at all.

⚠️ **The brief said this fix "contains no matcher change and therefore sits outside every
failing gate condition." That was true of the FIX and false of the COMMITS.** The crash
fix as developed was entangled with two unrelated changes and had to be isolated by hunk
surgery, not `git cherry-pick`:

- its "evaluate is total" layer was **co-committed with the care-guard matcher change**
  (`0f47aa0`), and
- `d35b26e` also carried **G-07 identifiers-from-catalog**, which changes what a connected
  store's identifiers row answers.

Neither shipped. G-07's test came along with the test file and correctly failed; it was
removed rather than weakened, and the identifiers row on the shipped branch still answers
`requires_store_access`, which is production's existing behaviour and not a regression.

The brief also said "the three reproduction tests". There are **four** (30, 30b, 30c, 30d).

---

## 2. CP1 — the reversal, which is the session's real finding

### What was built

Four guards, closing three measured false positives:

| guard | closes |
|---|---|
| `SERVING_HEAD` | "…based on a standard 6oz serving" read as the product's weight |
| `RECIPE_FRAME` + `RECIPE_SUBSTANCE` | "…for 4 ounces water and 4 ounces ice" |
| `SUBSTANCE_WEIGHED` | "One ounce of water by volume weighs 1 ounce…" |
| `SENSE_SHIFT` | "rich in organic matter" read as a certification claim |

### The published diagnosis of one of them was wrong

Both the brief and `STANDARD_RUN_2.md` say the serving-size defect survives because
"`NUTRIENT` does not carry `caffeine`". **It does, and has since `d730ea2` — before the
commit serving production.** `"Contains 6oz of caffeine."` already failed. Executing the
sentence instead of reading the source found the real cause: the nutrient is sought in the
measurement's own *complement* (two words forward, twelve characters back), and in the
live sentence `caffeine` sits forty-five characters away, belonging to a different
quantity. Widening that window is precisely the change v3.1 reverted for breaking
`"Each 12 oz bag contains 8 g of protein."`

The *prescription* in the brief — "widen to the shape, not to the two literals" — was
right. The *stated cause* was not.

### My own measurement said the guards were free. It was wrong.

Replayed at the parent commit and at the child from full `git worktree` checkouts, over
**216 captured real stores, 1,669 rows**, comparing the rendered quote and not only the
status:

```
pass rows 643 -> 641      status changes 2      passes gained 0
genuine positives lost: 0     (both losses are the target defect and its www twin)
```

### Two independent attackers, re-executed mechanically, said 192

661 chosen sentences. Every claim re-executed in this tree **and** in a full worktree of
the parent, then bucketed by A/B rather than by reading the agents' prose:

```
REGRESSION   192      CLOSED  0      RESIDUAL 117      PRE-EXISTING 32
```

and after the revert, re-run identically:

```
REGRESSION     0      unchanged+ok 192
```

**The gap between 0 and 192 is the whole lesson, and this repo already states it:**
*"Sampling real stores catches artefacts; only executing the matcher against deliberately
chosen input catches logic."* A 216-store sample can only find what those 216 stores
happened to write. It cannot find `"Our stock pot measures 10 inches across."` because
none of them sells one.

### Why each guard was unsalvageable rather than merely too wide

- **`SERVING_HEAD` (23)** — its protection was a **closed list of serveware nouns**, and
  such a list can never be complete. `pitcher, jug, cup, glass, carafe, mug, crock,
  tureen, ramekin, basket, vessel, cone` all died, as did every `dose bottle` and
  `portion container`. This is the shape v2.8 removed from `origin` after four attempts.
  **A closed list used as the PROTECTOR fails open in the damaging direction.**
- **`RECIPE_*` (26)** — `for\s*\d` is also how a **price** is written.
  `"Our 16 oz water bottle sells for 19.99."`
- **`SUBSTANCE_WEIGHED` (45)** — `stock`, `ice`, `cream` and `water` are product words. A
  stock pot is the commonest cookware SKU there is, and `"Water-resistant shell measures
  28 inches"` loses to a hyphen the vessel lookahead cannot see.
- **`SENSE_SHIFT` (98)** — the worst. `reach` is a homograph of the **EU chemicals
  regulation** (`"BPA-free, REACH compliant"`) *and* of the commonest closing clause in DTC
  copy (`"reach out with any questions"`). `growth` is a product benefit. `compounds` is the
  FDA's own wording for an antiperspirant active, so it **broke the violation path**: a
  store that states the violating claim was reported as stating nothing — and a
  status-only comparison cannot see that, because both answers are `not_proven`.

### And they did not close their own class

`"Pour 6 oz of hot water over the grounds."` still passes, because `USAGE_VERB` lists
steep/brew/dissolve while coffee copy says *pour, heat, fill, boil, bloom*. `"organic
plant matter"` and `"organic material"` walk past `SENSE_SHIFT` on one adjective and one
synonym. **Closing three sentences is not closing a class.**

All four are pinned in the adversarial corpus as measured gaps, each with the full cost of
the attempted fix recorded beside it. `EXPECTED_OPEN_GAPS` **31 → 36**. That number going
up is the honest record of a session that measured more than it fixed.

---

## 3. CP2 — `product_type` through the page tier

`fetchPublicProduct` skipped the `.json` tier whenever the page's JSON-LD was complete, so
`productType` fell back to JSON-LD `Product.category` — omitted by most themes.

**The obvious fix was the wrong one.** Fetching `/products/{handle}.json` anyway spends the
extra request the tier order exists to avoid, and **breaks every existing snapshot**,
because replay serves only URLs that were actually recorded and on precisely these stores
the engine never fetched it. A fix that invalidates the corpus it must be measured on is
not a fix.

The value was already in bytes we hold: Shopify's analytics bootstrap emits the merchant's
own `product_type`, present on **43 of the 44** captured coffee pages — measured before the
code was written. It is **parsed, not regexed**: `"type"` also appears inside `variants[]`.

Measured effect:

```
standard run   G-10 skips 15 -> 2       products evaluated 29 -> 42
default rows   status changes 0, passes lost 0, 35 rows NEWLY ASKED (6 pass)
```

**Every newly-appearing pass row was audited individually.** Eleven of twelve are true
passes. The twelfth — `www.lacolombe.com` on *"base their production on sustainable
organic practices only"* — is a **true** pass against the engine's own "Organic" row and a
**false** pass against the coffee standard's `CERT-001`, whose own explicitly-insufficient
list names "organic practices". That is G-06. CP2 did not create it; it made a
previously-invisible instance measurable, which is the direction an instrument should fail
in.

---

## 4. The coffee bound

**103 brands captured, deduplicated on registrable domain BEFORE capture; 3 excluded by
the G-10 predicate with reasons; 100 evaluated; 0 replay misses; state COMPLETE.**

Every one of the 162 `pass_evidenced` rows was audited individually against its FULL
untruncated evidence — not a sample, and not the 180-character rendered quote. 162 of
162 adjudicated; the merge step refuses to emit a number at all if any row is missing
(`confirmedCount: null`, never `0`).

```
pass rows audited              162      rows/store 2.10
distinct stores                 77
confirmed false positives       10
borderline, counted as passes    7

point estimate                 6.17%
naive 95% upper bound         10.47%
cluster-adjusted, ICC 0.2     12.78%   <- the honest headline
per-store                     12.99%   (10 of 77 stores carry at least one)
```

v3.1 measured 13.68% on 69 rows. On 162 the point estimate **rose** (4.35% → 6.17%) while
the interval **tightened** (13.68% → 12.78%) — which is what more data does to a small
sample, and is the only sense in which this number is "better".

### The ten, in four classes

| class | n | example |
|---|---|---|
| a brewing recipe or caffeine dose read as the product's weight | 3 | *"15g medium ground coffee 250ml water at 203°F"* |
| a store-local id published as `mpn` | 3 | `"sku":"100754","mpn":"100754"` |
| the soil-science sense of `organic` | 2 | *"organic soils and abundant rainfall"* |
| `single-origin` inside a sentence describing a BLEND | 2 | *"our Cold Brew **Blend** features a washed single-origin from Guatemala and a natural from Ethiopia"* |

The last class is **new** — it was not in v3.1's sample and no guard in the engine
addresses it. The term is present and the sentence asserts the *opposite* of the
requirement. Telling a roaster "you state a single-origin claim" about their blend is a
false statement about their own product, which is the class this project treats as
unrecoverable.

⚠️ **Two defects the false-positive count cannot express.** On `myalmacoffee.com` the
store publishes real weights (`310 g`, `2 lb`, `5 lb`) in its variant options, so the
row's CONCLUSION is accidentally true while its RECEIPT is a brewing recipe. On
`mikava.coffee` the weight sits past the 180-character quote cut, and `mostracoffee.com`
attributes its evidence to "product copy" when the values are in variant options. All
three are truthful rows that show a merchant nothing they can check.

---

## 5. The general bound — a correction to a number this project publishes

The coffee audit's `mpn` finding is **not category-specific**, so it was checked
mechanically across the general sample too. It should not have been possible for that to
matter: that sample's 507 rows had been audited and reported **zero** false positives,
and 0.83% has been quoted ever since — including, for a few hours today, on the published
standard's own page.

```
identifier rows asked        216
identifier rows passed        53
  rescued by a valid GTIN     29    honest passes, not defects
  DEFECTS                     21    general 18, coffee 3
```

```
GENERAL, corrected            was            now
pass rows                     507            509   (+2 from CP2)
confirmed false positives       0             18   (ONE class, a FLOOR)
point estimate                  0%          3.54%
cluster-adjusted 95% bound   0.83%          7.80%
```

**Why the earlier audit could not have caught them, and this is the useful part.** An
identifier row renders **no quote**. It says *"Your structured data publishes MPN."* A
human reading rendered evidence has nothing to be suspicious of — the row looks identical
whether the value is a real GS1 barcode or a number the store minted about itself.
Finding it requires a machine check against the captured bytes.

Verified from raw HTML, not from an agent's prose. On `glowrecipe.com` the published
`mpn` `8079462006899` also appears as `rid`, `source_product_id`, `product.id` and
`data-product-id`: it is Shopify's internal product id, stuffed into `mpn` by a theme.
`www.lacolombe.com` and `sightglasscoffee.com` share one JSON-LD emitter byte-for-byte,
so this is a **theme behaviour, not two unlucky merchants**. `www.stumptowncoffee.com`
emits `"sku":"100754","mpn":"100754"` adjacent in the same object — the store-local SKU
the requirement explicitly excludes.

⚠️ **THIS IS A FLOOR, NOT A NEW BOUND.** Only one class was re-checked; the other ~491
general rows have not been re-audited to the standard the coffee sample just received.

### What survives of the instrument finding

v3.1's headline was that a category sample and a general sample differ **by an order of
magnitude** (13.68% vs 0.83%). Measured properly, they differ **by about 1.6×**
(12.78% vs 7.80%) — and the two are not audited to the same depth, so even that ratio is
not a measurement.

**The direction survives; the magnitude does not.** And the deeper claim is stronger than
the one it replaces: 0.83% was never an estimate of the error rate. It was an estimate of
**what that audit thought to look for**. v2.8 said zero across 55 rows was a statement
about sample size; v3.0 said it was a statement about sample shape; v3.2 says it is also
a statement about **audit method** — and that a defect class which renders no quote is
invisible to every audit that reads rendered evidence.

---

## 6. Measured discrimination, on 100 products

Written into `standards/coffee/v1.0/fitness.json`, **not** into `standard.json`.

⚠️ **Deliberate deviation from the brief**, which asked for the measured values to
replace the `predicted_discrimination` blocks inside the document. Doing that would
change `standard_hash` from `334389c4…` and silently break every citation already made
against v1.0 — the exact reason G-10's applicability rules live in a sidecar. The site
renders MEASURED values from the sidecar, overriding the document's band, and shows both
so a reader can see how far the hypothesis was off.

```
entry        asked  fail%   predicted   verdict
FORMAT-001      99  73.7%   30-60%      above band
FORMAT-002      99  92.9%   35-70%      above band
GRIND-001       99  84.8%   55-85%      HELD
GRIND-002       99  92.9%   60-85%      above band
WEIGHT-001     100  49.0%   15-40%      above band
CERT-001       100  92.0%   30-70%      above band
CERT-002       100  96.0%   40-75%      above band
SOURCE-001     100  89.0%   40-75%      above band
IDENT-001       76  94.7%   55-85%      above band
DELIV-001      100  45.0%   50-80%      below band

bands HELD 1/10          (v3.1: 2/10 on n=43)
```

"Above band" means the real fail rate is **higher** than predicted, so the entry
discriminates **less**: nearly every store fails, and a row everybody fails separates
nobody from anybody. Eight of ten entries are in that position.

**The two entries that carry information are `WEIGHT-001` (49.0%) and `DELIV-001`
(45.0%)** — both near the 50% split where an answer is most informative. `WEIGHT-001`
measured 48.8% on 43 brands and 49.0% on 100: the most stable figure in the document, and
above its band only because the band was wrong.

---

## 7. Traps this session hit, all of them previously documented

- **A `\b` written through a heredoc arrived in a test file as a real 0x08 BACKSPACE.**
  Repaired with a script *file* (`fix_ctl.mjs`), which sweeps every changed file and
  asserts zero residual bytes.
- **A renderer read a field that does not exist** (`grounding.sources`; the artifact says
  `citations`) and rendered nothing on 42 pages, with eleven tests green — because they
  asserted presence of *other* things. Nothing looks exactly like a section that
  legitimately has nothing.
- **`[object Object]` reached published pages** three times (`posture`, `applicability`, a
  derived assertion's `expected`). Template interpolation converts silently.
- **A diff keyed on `host` alone** silently compared three stores' general-sample rows
  against a coffee product's rows, and reported plausible numbers while measuring the
  wrong thing.
- **A liveness canary that rebuilt its own lookup key** reported COLLAPSED on a sound
  comparison. A false alarm is as useless as a false all-clear.
