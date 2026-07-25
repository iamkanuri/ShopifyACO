# CP4 — did depth actually move?

**Date:** 2026-07-25 · **Method:** the v2.2 sample re-measured against the v2.3 requirement
library. **Hosts are de-identified throughout**; raw bodies live in untracked files.

> This document exists to answer one question with numbers rather than confidence:
> **is the free Buyer Test's output now compelling enough to earn an install?**

---

## 0. The baseline, corrected

`RESULT_QUALITY.md` (v2.2) reported **14 stores, 13 completed**. Re-deriving from its own
raw `cp3_full_results.jsonl` gives **16 rows / 15 unique hosts, 14 completed, 1 failed**
(the file contains a duplicate row for one host, which is the likely cause of the
undercount). The conclusions are unchanged, but the denominators move:

| | v2.2 as published | v2.2 re-derived |
|---|---|---|
| completed stores | 13 | **14** |
| median genuine findings | 1 | **1** |
| thin-result rate | 3/13 = 23% | **3/14 = 21%** |
| delivery-window failures | 9/13 = 69% | **10/14 = 71%** |

**The re-derived column is the baseline used below.**

## 1. Method, and why it is not the method the brief specified

The brief said to re-run the sample through production. Doing so turned out to be the *only*
option, and that is a measured finding rather than a preference.

Capturing each store's public snapshot locally (so the library could be tuned and pruned
offline at $0, with no repeat load on third-party stores) was tried first and **failed on
the network, not on the idea**: 8 of 15 retained hosts returned `rate_limited`. Raising our
own egress budget from 20/min to **200/min** changed nothing — a follow-up probe of 14
hosts returned **13 × HTTP 429**, including hosts production had served minutes earlier,
and including hosts never touched before. The throttle is **upstream and per-egress-IP**.

Consequences, recorded because they constrain everything below:
- **7 of 15 retained hosts** yielded a local snapshot. Those 7 are the offline sample.
- **New-category expansion was capped at 2 of the intended 6.** Of 18 candidate stores
  probed across skincare, supplements, footwear, jewellery, bedding, tech accessories,
  eyewear and snacks, only 2 were reachable and exposed `/products.json`.
- The like-for-like comparison (**same hosts, same products, v2.2 library vs v2.3
  library**) is therefore the load-bearing measurement, and it is a properly controlled
  one. The new-category cohort is too small to carry weight and is reported separately.

## 2. Offline measurement (n=7 captured storefronts, $0)

Evaluated by running the real `buildBuyerTask` + `evaluate` over captured `PublicProduct`
snapshots — the same code paths production runs, with the network removed.

| | v2.2 baseline | v2.3 |
|---|---|---|
| median genuine findings / store | **1** | **3** |
| thin-result rate (0 findings) | **21%** | **0/7 = 0%** |
| requirements per store | 4–6 | 8–10 |
| **distinct failing SETS** | — | **7 of 7** |

The last row is the one that matters. v2.2's problem was not that it found too little; it
was that what it found was **the same thing for everyone** — "state a delivery window" for
71% of stores. Depth that produced a new uniform finding would have been no better. On this
sample **every store's failing set is different from every other store's.**

### Per-requirement discrimination

A requirement's value is its **discrimination**, not its failure rate: cruelty-free failed
100% and carried zero information; price fails 0% and carries zero information.

| Requirement | tested | failed | rate | in 15–85% band |
|---|---|---|---|---|
| Product identifier (GTIN or MPN) is published | 7 | 5 | 0.71 | ✅ |
| Care or use instructions are stated | 7 | 5 | 0.71 | ✅ |
| Size, capacity or weight is stated | 7 | 4 | 0.57 | ✅ |
| Country of origin is stated | 7 | 4 | 0.57 | ✅ |
| Delivery timing is stated | 7 | 3 | 0.43 | ✅ |
| Materials are stated | 7 | 3 | 0.43 | ✅ |
| In stock and purchasable | 7 | 1 | 0.14 | ❌ (pre-existing) |
| Available as a one-time purchase | 7 | 0 | 0.00 | ❌ (pre-existing) |

**Every requirement added in v2.3 is inside the band.** The two outside it are pre-existing
and were **not** pruned: at n=7 the estimate is far too weak to justify removing a core
buyer constraint, and both are cheap structural reads that never produce a false pass. They
are flagged for a decision at larger n, not acted on.

## 3. What measuring caught that reasoning did not

Two defects, both found by running the library against real stores rather than fixtures.

### 3.1 A false PASS — the unrecoverable failure mode

*"Size, capacity or weight is stated"* **passed** a real store on:

> *"If an order exceeds 150 lbs, it will be delivered via freight."*

That sentence is from the **shipping policy** and is about **orders**. It says nothing about
the product's weight. The row was a false pass on a store that states no dimensions at all.

Cause: attribute matching read `p.evidence`, which includes the shipping-policy surface
once it has been attached. Fixed — attribute rows now read **product surfaces only**;
`delivery` keeps the policy, because there the subject genuinely *is* the policy. Pinned by
a regression test that uses the exact sentence.

### 3.2 A requirement that could destroy the whole report

`warranty` measured **in-band (0.71)** and was **dropped anyway**. Its terms ("guarantee",
"guaranteed", "satisfaction guarantee") collide head-on with the claim linter's `guarantee`
rule — and the linter runs over `evidenceQuote`. A store whose copy says *"30-day
money-back guarantee"* would have had its **entire report blocked** and returned as
`errorKind: "unreachable"` — a flatly false statement about a store we read perfectly well.

A requirement that can annihilate the result to add one row is not worth its discrimination.
Additionally, evidence sentences are now pre-filtered through the linter, so no merchant's
own wording can trigger that path via any requirement.

## 3.3 What the 7-store audit did NOT catch — and why that matters most

The §3.1 and §3.2 fixes came from measuring. An **adversarial correctness review** run
afterwards, which EXECUTED the matcher rather than reading it, found **six more defects** —
all of them false passes or a false-fail of the same origin, and **none** of them visible in
the 7-store audit.

The reason is the important part: **the sample was the test, and the sample was lucky.** None
of those 7 storefronts happened to contain the trigger sentences. Every one of the triggers is
among the commonest copy in the exact categories this tool targets:

| Sentence | Read as | Verdict before |
|---|---|---|
| *"Made with love in small batches."* | materials stated | pass |
| *"Roasted in small batches every Tuesday."* | country of origin stated | pass |
| *"Available in 3 colors with a relaxed length."* | dimensions stated | pass |
| *"Our packaging is made from 100% recycled cardboard."* | product materials | pass |
| `mpn: "N/A"` | identifier published | pass |
| *"16oz bottle of cold brew."* | dimensions **not** stated | **false fail** |

Root causes, all now fixed and pinned by regression tests using those exact strings:
- A **term occurring is not the attribute being stated.** Each spec now requires a real VALUE
  — a material noun, a place, a number bound to a unit. `requireDigit` had only asked that
  *some* digit existed somewhere in the sentence.
- The non-product subject can sit **before** the frame. The shared aboutness guard only
  inspects the noun *after* the term, so composition and origin frames defeated it
  structurally. §3.1's fix — excluding the shipping-policy *surface* — does nothing when the
  merchant inlines the same sentence in the product body, which is common.
- For a **measurement**, a container IS the product. Vetoing bottle/bag/container told every
  beverage, coffee and pantry store it publishes no size while its copy said so literally.
- **Structural is not the same as safe.** A comment here claimed the identifier row "cannot
  produce a false pass"; placeholder values disproved it.
- A missing `` in category gating meant `pan` matched *Company* and *Japanese*, `pot`
  matched *Potato*, `rug` matched *Arugula* — so every brand named "… Company" got a care
  row, which is precisely the irrelevant-uniform-row failure CP2 exists to remove.

**And the one that could destroy a whole report:** the CP3 task-noun fix piped the merchant's
raw product TITLE into the linted summary. *"Lifetime Guarantee Leather Belt"* and *"Rank
Higher: The SEO Workbook"* therefore returned `unreachable` for stores read perfectly —
deterministically, so retry never helps. This is the *same* hazard that got `warranty` dropped
in §3.2, reintroduced in the first line of the page by a change made to improve it. All
merchant-supplied text is now filtered before it can reach any rendered string.

**The methodological conclusion, which outlives these specific bugs:** a 7-store audit is
evidence about 7 stores. It cannot tell you what a matcher does on copy those 7 stores did not
happen to write. Measuring the output caught the artefacts; only executing the matcher against
adversarially chosen input caught the logic.

One further defect worth recording because it is invisible to review: a `` written through a
scripted patch landed as a literal **0x08 byte**, so `SHIPMENT_CONTEXT` was
`/<BS>(shipping|…)<BS>/i` and matched nothing — while rendering as correct source in every
diff, editor view and `grep`. It was caught only because the regression disagreed with the
code, then `cat -A` showed `^H`. All sources are now swept for control bytes.

## 4. Evidence audit — every passing row

**19 pass_evidenced rows audited individually after ALL hardening. Zero false positives.**

- **Structural passes** carry no quote by design and state their basis instead
  (*"Your structured data publishes MPN."*). Correct.
- **Text-quoted passes**, each verified against the merchant's own sentence:
  - *"Each box contains 12 firm and smooth premium graphite pencils, crafted from Genuine
    Incense-cedar."* → materials. Plainly supported.
  - *"Our scented soy candles are handmade with 100% domestically-grown soy wax, fine
    fragrance oils, and a pure cotton core wick."* → materials. Plainly supported.
  - *"…Wood Type: Incense-cedar … Country of Origin: Japan"* → origin. Supported verbatim,
    though the quote is a specification block rather than prose.
- **One quality issue, fixed rather than accepted:** a store stating
  *"Dimensions: 11.42W x 18.9H x 5.51D" / 26W x 48H x 14D cm Capacity: 20 L Weight: 3.13
  lbs."* passed with **no quote at all** — `presentableQuote` correctly rejects a spec block
  as symbol soup, so the row passed with a silently empty evidence slot. It now says where
  it found the statement and why there is nothing quotable, rather than showing nothing.

## 5. Limits

n=7 for the offline measurement. One product per store, one run each, no repeats, so
run-to-run variance is unmeasured. The sample is biased to stores that our egress IP could
reach, which is the same selection bias v2.1/v2.2 carry and is now known to be **large**:
13 of 14 probed hosts refused us. Read these as **direction, not precision** — the
direction (1 → 3 findings, uniform → differentiated) is much larger than the noise, but the
exact rates are not to be quoted as precise.

## 6. Verdict

**Is the output now compelling enough to earn an install?**

**Materially more so, and for the right reason.** The modal store went from **one** finding
to **three**, no store in the sample now produces nothing, and — the part that actually
changes the argument — **the failing set differs for every store**. v2.2's report could be
guessed before running it. v2.3's cannot.

What is still missing, stated plainly: every finding is still about **the merchant's own
store data**, and store-side gaps are structurally similar across merchants even when the
specific set differs. The report now says *"you are missing these four specific things"*
instead of *"you are missing the one thing everyone is missing"* — which is a real
improvement in specificity, but it is not yet *competitive* information.

## 7. The next lever, and the evidence for it

Three cures exist for thinness; this session tested one.

1. **More requirements per product** (this session) — **worked**, and is now largely spent.
   The library covers claim, price, variant, purchase terms, logistics, composition,
   dimensions, provenance, usage and machine-readability. Further additions face a harder
   admission test and a readability ceiling of ~10 rows.
2. **More products per store** (catalog-wide batch) — untested. Mostly loops around code
   that already exists. Uniformity is a weakness per product and a **strength** at catalog
   scale: *"2,700 of your 4,000 products publish no GTIN"* is a budget line in a way that
   one product's row is not.
3. **Per-store specificity from outside the catalog** (the competitive-signal layer) —
   untested here, but **the strongest existing evidence in the repo points at it.** The
   twelve pre-rendered outreach cases (audited in CP0 of this session) open with *"We asked
   AI assistants 90 shopping questions in your category. Your store appeared in 3.
   [Competitor] was recommended 43 times."* That is specific to each merchant **by
   construction**, and it is the one thing the free test still cannot say.

**Recommendation: (3), then (2).** The reasoning is that (1) succeeded at making the report
*differentiated* but not at making it *surprising* — a merchant can predict "we don't
publish GTINs" in a way they cannot predict "you appeared in 3 of 90 answers". The
architectural note that makes (3) affordable: category batteries can be run **once and
cached per category**, so marginal cost per store approaches zero.

If that reading is wrong, the number that would show it is the install rate on reports with
3+ differentiated findings — which `funnel_events` now records, and which nothing in this
session could measure because it needs live traffic.
