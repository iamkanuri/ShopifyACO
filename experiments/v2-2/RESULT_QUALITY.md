# CP3 — is the free Buyer Test's output good enough to earn an install?

**Date:** 2026-07-25 · **Sample:** 14 real Shopify storefronts, never seeded, one product each,
run through production `POST /api/product-test` (one request per host, ≥130 s apart).
**Measured cost:** **$0.021** total semantic-tier spend across the sample (≈ $0.0016/test,
range $0.00029–$0.00297).
**Hosts are de-identified as A–N throughout.** The raw bodies live in the untracked
`cp3_full_results.jsonl`; nothing in this file names a store.

> **Why this exists.** The same 14 stores were run in v2.1 CP2 and read only as a *throttle
> measurement* — that run recorded per-state counts and threw the bodies away. They are also the
> largest real-world sample of this product's actual output that exists. This re-run captured
> the **whole response body** (the lesson v2.1's own method doc ended on) so the output could be
> judged as product rather than as network telemetry.

---

## 1. Headline

**One line in the engine was generating half of everything we called a finding.**

`inferClaims` fell through to a hardcoded `["cruelty_free"]` for any product whose category it
did not recognise. `CATEGORY_CLAIMS` covers personal care, food and drinkware — so **every one
of the 13 completed stores** (pet supplies, bags, stationery, candles, cookware, cycling,
camping, gardening) hit that default. "Cruelty-free" was asked of a dog harness, a backpack, a
notebook, a bike part and a garden tool. It failed **13/13**, and because a claim
always scores highest in `adjudicability`, it sat at the **top of every table**.

Every report opened with the same sentence: *"Find this {noun}, confirm it's cruelty-free,
purchasable one-time with fast US shipping."*

It was not a *false* claim — the row correctly said the store does not **state** the attribute in
machine-verifiable form, which was true. It was worse than false: **irrelevant, identical across
unrelated merchants, and it made a specific diagnosis read like a template.** A merchant who
sees "Cruelty-free — Not proven" on a graphite pencil stops reading, and is right to.

**Fixed in this session** (`src/server/productTest.ts` — return `[]` instead of the default;
regression tests in `test/productTest.test.ts`). The numbers below are reported **both ways** so
the fix's effect on the product story is visible rather than assumed.

---

## 2. What the sample produced

13 completed, 1 failed (`unreachable`). Requirement counts are 4–6 as designed.

| Store | Category | Tier | Reqs | Proven | No-blocking | Not proven | Requires access |
|---|---|---|---|---|---|---|---|
| A | pet supplies | page | 5 | 2 | 1 | 2 | 0 |
| B | pet supplies | page | 5 | 2 | 1 | 2 | 0 |
| C | pet supplies | json | 6 | 1 | 1 | 4 | 0 |
| D | bags/luggage | page | 6 | 4 | 1 | 1 | 0 |
| E | bags/luggage | page | 5 | 1 | 1 | 2 | 1 |
| F | stationery | page | 6 | 3 | 1 | 2 | 0 |
| G | stationery | page | 5 | 2 | 1 | 2 | 0 |
| H | stationery | json | 5 | 2 | 1 | 2 | 0 |
| I | candles | page | 5 | 2 | 1 | 1 | 1 |
| J | kitchen/cookware | — | 4 | 0 | 1 | 2 | 1 |
| K | — | — | — | — | — | — | *failed: unreachable* |
| L | cycling | page | 6 | 3 | 1 | 2 | 0 |
| M | outdoor/camping | page | 6 | 4 | 1 | 1 | 0 |
| N | gardening | page | 5 | 2 | 1 | 2 | 0 |

## 3. Depth distribution

**As shipped (with the cruelty-free row):**

| not-proven rows | stores |
|---|---|
| 1 | 3 |
| 2 | 9 |
| 4 | 1 |

Zero stores with none. Median 2.

**With the artefact removed — the honest picture:**

| genuine not-proven rows | stores |
|---|---|
| 0 | **3** |
| 1 | **9** |
| 3 | **1** |

Median **1**. This is the number that matters, and it is materially worse than the raw table
suggests: the modal store has **exactly one** real finding.

## 4. Thin-result rate

**The ceiling on the free test's conversion power, measured for the first time.**

- As shipped: **0 / 13 (0%)** produced nothing actionable.
- Artefact removed: **3 / 13 (23%)** produce nothing a merchant could act on.

So roughly **one store in four gets a clean bill of health** and has no reason to install. That is
not a failure — a passing test is a true result — but it means the free test cannot be the only
conversion surface, and "every store has a problem" was never true; it was the default claim
talking.

## 5. Which requirements actually fail

| Requirement | Tested | Failed | Rate | Access-gated |
|---|---|---|---|---|
| ~~Cruelty-free (artefact)~~ | 13 | 13 | ~~1.00~~ | 0 |
| **Delivery window stated** | 13 | **9** | **0.69** | 2 |
| In stock and purchasable | 13 | 2 | 0.15 | 1 |
| *{variant}* option available | 5 | 1 | 0.20 | 0 |
| Price under cap | 12 | 0 | 0.00 | 0 |
| One-time purchase available | 13 | 0 | 0.00 | 0 |

**Once the artefact is removed there is exactly one dominant real finding: stores do not state a
delivery window in a machine-readable form (9/13, 69%).** Everything else is nearly always fine.

**Does failure cluster by category?** On this wider, unseeded sample — **no.** The Stage 5/6
observation (deodorant converged on one gap, coffee produced 2–3) does not reproduce. The
delivery gap is uniform across pet supplies, stationery, cycling, camping and gardening; it is a
**platform-wide** gap, not a category signature. Two consequences: the finding generalises, so
one message works across categories; and it is *not* differentiating, so a report whose only
content is "state your shipping timeframe" will read as generic no matter which store gets it.

## 6. Requires-store-access rate

**3 rows out of 69 (4.3%)**, across 3 of 13 stores — all of them the delivery requirement, where
the shipping policy page was not publicly readable. The tool is rarely blind on public data.

That is an argument *against* leaning harder on the "what authenticated testing adds" block as a
conversion lever for the public test: on this sample there is very little the public test could
not see. Authenticated testing's value is the **loop** (confirm → fix → re-run → regression test),
not extra visibility.

## 7. Evidence-quality audit — every `proven` row

**28 proven rows inspected individually. No false positives.** 26 are structural facts and 2 are
text-quoted.

- **26 structural** (price under cap, in stock, variant option). These carry no quote and should
  not: they are read from structured data, and each states its basis explicitly — *"Lowest
  readable price is $48.00."*, *"Your structured data marks this product in stock."* Spot-checked
  against the source values; all correct.
- **2 text-quoted**, both the delivery requirement:
  - **D** — *"Processing Times Orders typically ship within 1–3 business days."* The row is
    "Ships in the US within a week". Plainly supported.
  - **M** — *"Please allow 3-5 business days for processing on all orders (including expedited
    shipping options) before your order ships."* **The one borderline row in the sample.** The
    quote is about *processing* time; the row's label says *Ships … within a week*. 3–5 business
    days is ~5–7 calendar days, so the label is defensible, and the row's own detail — *"Delivery
    timing is stated in your shipping policy"* — is exactly right and correctly scoped to
    evidence availability. But the **label overreaches its quote**, and a careful merchant would
    notice. Not a false pass; a labelling imprecision. Logged, not fixed here.

**Nothing in this audit takes priority over the rest of the session** — which is the outcome CP3
was written to check for.

## 8. Two smaller quality observations

- **The task noun reads badly on real data.** The summary is built from the merchant's own
  `product_type`: the sample produced *"Find this **walk**"*, *"Find this **products**"*,
  *"Find this **confidant**"*. That is their data, not our bug, but it is the first line the
  merchant reads and it undermines the tool's authority. Worth a fallback when `product_type`
  isn't a sensible noun. **Not fixed** — out of scope here.
- **Store J answered with `fetchTier: null` and only 1 surface checked**, producing 0 proven
  rows. The test ran and returned `ok: true` on almost nothing. A near-empty result is arguably
  worse than an honest failure; worth a floor below which we say so.

---

## 9. Conclusion — is the output compelling enough to earn an install?

**Honestly: it is thinner than it looked, and it is now honest about that.**

- Before this session, every store produced ≥1 finding — but for 13 of 13 that count was inflated
  by a defaulted claim row that applied to none of them.
- With it removed, the modal store has **one** real finding, **23% have none**, and that one
  finding is **the same finding** — "state a delivery window" — for 69% of stores.

So the free public test, on this evidence, is **a credible qualifier, not a persuasive argument**.
It proves the tool works and is honest; it rarely produces a *surprising* result. The strongest
thing it currently says to a merchant is uniform across the category, which is exactly what makes
a report feel templated.

**What this changes about what to build next** (recorded, not acted on here):

1. **Depth per store is the constraint, not traffic.** Adding requirements that public data can
   actually adjudicate would move the modal store from 1 finding to several. That is a bigger
   lever than any funnel change.
2. **The delivery gap is the wedge.** It is real, it is verifiable, it is 69% of stores, and it
   has a one-line fix. It deserves to be the headline, not row 5.
3. **A clean pass needs its own outcome.** 23% of stores will pass everything; telling them
   "nothing to fix" and stopping is the honest move, and it needs to be designed rather than
   fallen into.
4. **This is now measured continuously.** CP2's `funnel_events` records the result-state
   distribution on every run, so the numbers above stop being a one-off — including
   `actionableRate` (share of tests with ≥1 not-proven row), the direct successor to the
   thin-result rate measured here.

## 10. Limits

n=13 completed, one product per store, one run each. No repeats, so run-to-run variance is
unmeasured. Stores were DNS-verified as Shopify, which **excludes Cloudflare-fronted storefronts**
— the same selection bias the egress measurement carries. Product choice per store was arbitrary
(one listed product), not the store's best or worst. Read these as **direction, not precision**.
