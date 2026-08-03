# v4.5 — REPORT

Branch `feat/v4-5-runway`, base `6bac24a` (`main` = `origin/main` = `/healthz`, both probes
green at start).

---

## §0 — THE TWO ACCOUNTS, SETTLED BY EXECUTION

**Verdict: the fixes are present. The stale account was wrong on every substantive claim.**
Proceeded to Phase A as the brief directs.

Each claim of the prior planning pass, adjudicated by running something:

| stale claim | verdict | how it was established |
|---|---|---|
| "no currency is ever read" | **FALSE** | `declaredCurrency` is assembled at `productTest.ts:1431` with a measured 2-source precedence; `evaluate`'s `price_under` refuses on a non-USD declaration before rendering any number. Executed: fetch-corpus case `cur-01` renders *"Your store publishes prices in GBP … we can't answer it from your public data."* |
| "the cents guard publishes $10.00 as $1000.00" | **FALSE** | `priceToUsd` is tier-aware (`.json` = decimal dollars, `.js` = integer cents) and fails closed on both tiers. `cents_boundary` flags 3 of 14 corpus cases, none of them the boundary case. |
| "missoma's £135 renders as under-$140" | **FALSE** | that is the case the refusal was built for; it now refuses. |
| "there is no fetch corpus" | **FALSE** | `experiments/v3-8/fetch_cases.json` — 101 cases, six clusters, frozen at `234ee7b` before any fix code. It runs green at HEAD (canary LIVE, 101/101 executed). The proposal quoted this corpus's own headline number while claiming it did not exist. |
| "P-17's register entry describes the pre-v3.8 world" | **PARTLY TRUE — and this is the real finding** | the BODY carries a full v3.8 UPDATE and the status field says so. The **heading** still reads *"The FETCH AND NORMALISATION layer **has no adversarial corpus**"* — present tense, false since v3.8. A planner scanning section titles reads the heading. Fixed. |
| "5.17% is not the current figure" | **FALSE** | `standards/coffee/v1.3/fitness.json` records the general sample at 483 rows / 11 confirmed / **5.17%** cluster-adjusted, with the denominator arithmetic. |

**What the stale account named that WAS a real residual:** P-19, both halves — `$0.00`
treated as a price, and "lowest readable price" that is not the lowest. Both genuinely open,
both promise questions, both deliberately deferred by v3.8. That became Phase A2.

---

## A1 — THE STORED-RESULTS PRICE SWEEP

`experiments/v4-5/price_sweep.mjs` (D1/D2, from the blob) + `price_sweep_currency.ts` (D3,
from the stores' bytes) + `adjudicate_hits.mjs`.

Canary live on all three. 94 stored results, **88 carrying a rendered price row** — so the
zeros below are proven on real data, not just on seeds.

| detector | result |
|---|---|
| D1 — a rendered `$0.00` | **1** — `tenthousand.cc`, `t_dcd9b617cfa726661c11` |
| D2 — a price ≥100× or ≤1/100 a corroborating figure in the same blob | **0** |
| D3 — a non-USD store rendered with `$` | **4** — `gardenerskit.com`, four tokens |

**5 permanent results carry a false price statement.** Both classes pre-date their fix:
gardenerskit's four were minted 2026-07-25/26, the non-USD refusal shipped 2026-07-28
(v3.8); tenthousand's is P-19's class, open until this session.

The gardenerskit sentence was false when published, established rather than assumed:
the product is **C$75.00** today in both signals (`priceCurrency` and
`Shopify.currency.active`), and the numeral is *unchanged*, which rules out a USD→CAD
switch — Shopify re-prices on a currency change and would not land on the identical 75.00.
The verdict (`Price under $80`) was accidentally right (C$75 ≈ US$55); the stated price
was not.

⚠️ **D3's first run reported a clean zero over a broken extractor**, and only the two-sided
canary caught it: the probe read `extractPage(html).offer`, but `offer` hangs off the
Product node (`extractPage(html).product.offer`). Every store answered `null`, which is
indistinguishable from "no store declares a non-USD currency". Fifth instance of the
`grounding.sources` shape in this repo.

---

## A2 — P-19, DECIDED AND CLOSED

### The brief's two defaults: one taken, one refused by measurement

The brief offered two promise decisions "unless discovery contradicts". Discovery
contradicted the second.

**Decision 1 — `$0.00` is not a price. TAKEN.** Scored before writing the rule
(`p19_population.mjs`, 335 deduped stores): 11 stores have a zero minimum, 10 render
`Lowest readable price is $0.00.`, and **all 10 are `pass_evidenced`** — a false pass on
every one. Collateral: **zero** — not one store in the corpus has a zero minimum beside a
non-zero variant, so refusing on the minimum cannot refuse a merchant who does publish a
real price.

**Decision 2 as written — "derive the price from the census-authoritative `.json`/`.js`
tiers, never from the page-readable set" — REFUSED, with numbers.**

| | |
|---|---|
| stores whose price comes from the JSON-LD offer fallback | **196 of 335 (58%)** |
| currently-passing rows that would stop stating a price | **169** |
| P-19 defects that would close | 9 at most, 4 genuinely distinct |

That is **19–42 true rows lost per defect closed** — the shape v4.0's G-15 referent guard
was built and killed for (19.8). And the premise is wrong: those 196 stores are not broken.
`pageSufficient` **skips** the `.json` tier when the page's JSON-LD is complete, so the
"fallback" is the ORDINARY path. Forcing the variant tiers would spend the request the tier
order exists to avoid (v3.2 measured `.json` returning 429 while HTML on the same hosts
returned 200) **and would invalidate every captured snapshot**, because replay serves only
URLs that were actually recorded. *A fix that invalidates the corpus it must be measured on
is not a fix.*

**Decision 2′, shipped instead — fix the true cause.** The defect is not which source; it is
that `parseOffer` read the FIRST offer object. `readablePrices` now takes the minimum over
every readable price on every offer object (`price`, `lowPrice`, `priceSpecification.price`),
which closes the offers-array and the AggregateOffer shapes together with no `@type` check.
Scoped deliberately: only the price moves; currency, availability, shipping and returns still
come from the first offer, because re-selecting those would move three other requirement
kinds that nothing here measured.

### The gate

**Real-store A/B**, 335 deduped stores, quote-level (`p19_probe.ts` → `p19_ab.mjs`):

| | |
|---|---|
| price rows dropped | **11** (10 were false `$0.00` passes; 1 was already refusing on currency) |
| prices corrected downward | **2** — `templecoffee.com` $29.50 → **$23.00**, `balancecoffee.co.uk` (answer unchanged, still the GBP refusal) |
| rows of any OTHER kind changed | **0** |
| rows unchanged | **2804** |

**Frozen fetch corpus**, attribution isolated in a worktree at unmodified `main`:
**10 cases closed, 0 newly opened** (`mm-01 mm-02 mm-15 znn-01 znn-02 znn-03 znn-04 znn-13
znn-15 znn-16`).

⚠️ **The corpus caught a regression this change introduced, and no real-store replay could
have.** The first `zeroAwareMin` refused when *any* readable price was zero, so a $45 serum
with a "Free gift with purchase" variant stopped reporting a price at all. Its own comment
said "every readable price was zero"; the code said "any". The 335-store corpus contains
**zero** stores with that shape — measured before the rule was written, which is exactly
what made the bug invisible to replay. `znn-02` caught it on the first run. Ninth instance
of the standing rule: *sampling real stores catches artefacts; only chosen input catches
logic.* `test/zeroPrice.test.ts` now pins the `all` vs `any` distinction first.

⚠️ **`znn-01` also rejected the first honest sentence.** It had the right STATUS and quoted
the zero back at the merchant — and `must_not_render` forbids both `$0.00` and "free". The
corpus is blunt on purpose: a merchant skimming a row does not parse the disclaimer around
a number, they read the number. Reworded rather than the gate weakened.

⚠️ **THE HARNESS SYNTHESIZER WAS SILENTLY FLATTENING THREE CASES.** `fetch_harness.ts`
ignored `offers_shape` and `offers`, building one plain `Offer` from the scalar price — so
`mm-01` ("offers is an ARRAY and parseOffer commits to the first object"), `mm-02` and
`mm-13` never presented the shape they are named for. They were **vacuous**, failing for a
generic reason rather than the authored one, and they flagged identically before and after a
change that demonstrably fixes that shape on real stores. Same family as v3.4's `[publish]`
mutations. Repaired; with it repaired, base flags **63** rather than 62 — the repair alone
exposed `mm-13`, which had been passing while testing nothing.

### The bound moved, and it is re-measured in the same push

`experiments/v4-5/remeasure.mjs`, method carried verbatim from `v3-8/remeasure.mjs`
(key by product URL not host; money-normalised label; three outcomes with `changed`
re-adjudicated explicitly; two-sided canary). It reproduces v3.8's baseline exactly —
483 rows, 11 confirmed — which is the cross-check that validates the instrument.

**6 of the 11 surviving general defects close**, all of them the `$0.00` class, matching
the sidecar's own `defect_classes` count of 6: `branchbasics`, `knifewear`, `kosas`,
`partakefoods`, `studioneat`, `tenthousand`.

```
denominator   483 − 10 + 0 = 473      (10 pass rows left; 0 entered)
confirmed     11 → 5
point         2.28% → 1.06%
Wilson 95%    [1.28, 4.03] → [0.45, 2.45]
cluster 95%   5.17% → 3.05%           (ICC 0.2, rows/store 2.87, DEFF 1.37)
```

⚠️ **10 rows left the pass set but only 6 were defects.** The other four — `dedcool`,
`puracy`, `supergoop`, `voluspa` — are the deliberate free gifts the merchant's own title
names, which the audit counted as **true** passes. So the honest cost of decision 1 is not
"6 false statements removed"; it is **6 false statements removed and 4 true ones no longer
stated**. That trade is the decision the brief asked for, taken knowingly: a free item is a
different claim from a price bound, and public bytes do not separate a giveaway from a
withheld price.

⚠️ **Coffee cannot move, and the script CHECKS it rather than asserting it**: read from
`standards/coffee/v1.3/standard.json`, 10 bound entries, **0** with `req_kind: price_under`.
The coffee sample holds no price rows. **9.99% is unchanged.**

⚠️ **THIS CAME WITHIN 0.31 PERCENTAGE POINTS OF REVIVING THE RETIRED SPREAD SENTENCE.**
`renderComparison` refuses a ratio when the samples' 95% intervals overlap. Coffee is
[2.14, 8.75]; general is now [0.45, **2.45**]. They still overlap — by 0.31pp. Had the
general upper fallen below 2.14, the renderer would have started drawing a ratio and
publishing *"the number that matters to a merchant is the one measured on their own
category"* — retired three times, revived by a fix twice. A fix that improves a number can
re-arm that sentence, and nothing currently fails loudly when it is about to.

---

## A3 — THE HYGIENE ITEMS

### The card shown twice — DONE

Hero truncates to 3 rows below 700px (5 above) with an explicit
**"Showing 3 of 10 rows, in the standard's order"**; hero loses its internal CTA; the
§example card gains one line naming its job. Both count labels ship in the markup and CSS
chooses, so the JS-off document matches what it renders.

Verified by RENDERING (`card_probe.mjs`, system Chromium at 375 and 1280), because
`responsive.mjs` passes 4/4 and **cannot see this change** — it asserts overflow, tap
targets, headline wrap and column counts. Its canary is that the two widths must
**disagree**; identical readings would mean the media query never applied. Measured: 3 vs 5
visible rows, labels agreeing with their lists and with the section card's total of 10,
hero CTA absent, job line present at both widths. `responsive.mjs` still 4/4 VERIFIED_CLEAN.

### The four harnesses that could spend — DONE

Exactly the four the v4.4 handoff named: `v4-3/probe_demo.ts`, `v4-3/probe_peers.ts`,
`v4-2/seed_general.ts`, `v4-2/seed_reference.ts`. A nullish-coalescing default, so a
deliberate opt-in still works (which is what `v4-4/tier_measure.ts` needs).

⚠️ `spend_audit.mjs`'s first run reported **59** exposed files against a handoff that said
four, because past sessions vendored whole copies of `src/` into `experiments/` for worktree
A/Bs — and `productTest.ts` naturally names `runProductTest` and naturally pins no env var.
Those are the engine, not something that runs it. Excluded by path, with the exclusion
stated in the script rather than applied silently.

### The raw-HTML leak — MEASURED

Real, on 3 stored results across 2 stores, in two shapes:
`assertions[].evidenceQuote` carrying `<p>` / `</p>` (magicspoon.com) and `task` /
`productName` carrying `&amp;` (greatjonesgoods.com, 2 tokens). `esc()` already blocks
injection, so these are display defects — an agency reads a literal `</p>` in a published
evidence quote.

⚠️ **The first detector returned 0 tag hits over 94 results**, because it scanned a curated
field list — `detail`, `quote`, `evidenceSurface`, `label` — and the field is called
`evidenceQuote`. A closed list used as the detector fails open in the flattering direction.
Only a separate raw substring scan over the whole blob found it. The detector now walks
every string and lets the data name the fields.
