# v3.9 — WHAT THE OPEN AXES ARE WORTH

**Session date:** 2026-07-28 · **Branch:** `feat/v3-9-worth` · **Base:** `3dbef7c`
(= `main` = `origin/main` = production, all three confirmed at CP-0).

---

## 0. THE HEADLINE

G-14 measured how often three attack classes **succeed on chosen input**. This session
measured how often their shapes **occur in the sentences the engine actually renders as
proof on real stores**. The two numbers are not close, and the gap is the deliverable.

| axis | succeeds on chosen input | occurs in real proof sentences | honest carriers a guard would break |
|---|---|---|---|
| `letter_not_spirit` | 260/280 = **92.9%** | **3/71 = 4.2%** (2 stores) | 35/71 |
| `tense_modality` | 439/621 = **70.7%** | **0/71 = 0.0%** | 46/71 |
| `wrong_subject` | 368/914 = **40.3%** | **11/71 = 15.5%** (9 stores) | 55/71, 5 rows both |

**The axis that attacks best is the axis that occurs least.** `letter_not_spirit` succeeds
on 92.9% of chosen sentences and its principal real-copy stratum, `enquiry_evaluation`, has
**zero instances in 3,349 sentences across 335 stores**. `tense_modality` succeeds on 70.7%
and does not occur in the passing population at all.

---

## 1. CP-0 — base confirmation

| probe | result |
|---|---|
| `main` == `origin/main` == `/healthz` | all `3dbef7c` |
| `verify_prod.mjs` | **VERIFIED_CLEAN — 21/21, 0 failures** |
| `verify_sections.mjs` | **VERIFIED_CLEAN — 15/15, 0 failures** |

All four standard hashes agree three ways: `334389c4eb61` · `f8ec2780f60c` ·
`fe199a864d3d` · `ba2050578ed0`.

---

## 2. CP-1A — the population, and a disagreement that turned out not to exist

The brief warned that where v3.6's and v3.8's numbers disagree, the disagreement is a
finding about an instrument. They appeared to disagree by a factor of two — v3.6 records
**71** live claim rows, v3.8's A/B dump at the fixed tree yields **34**.

**They agree exactly.** `experiments/v3-9/reconcile.mjs`:

| | v3.6 `pass_rows.json` | v3.8 `ab_after_3b.jsonl` |
|---|---|---|
| rows | 71 | 34 |
| `asked: true` subset | **34** | — |
| per claim | single_origin 16 · organic 14 · gluten_free 2 · paraben_free 1 · bpa_free 1 | **identical** |
| set comparison | **34 in both · 0 only-v3.8 · 0 only-v3.6-asked** | |

v3.6 **forced all 13 claims at every store**; 37 of its rows are claims `CATEGORY_CLAIMS`
never selects. Two denominators are carried throughout and never conflated:

- **ASKED — 34 rows / 32 stores.** What the engine renders today.
- **FORCED — 71 rows / 54 stores.** A guard's blast radius if a future category selects
  those claims. This is also the denominator G-15's *"17 false passes in 71 live claim
  rows"* is stated over.

### ⚠️ The zero is PROVED, not asserted

A zero occurrence is the flattering answer and this repo has shipped a dead instrument as
a clean result four times. `experiments/v3-9/liveness.ts` re-runs v3.6's own 21 detectors
over the full 3,349-sentence corpus and requires them to reproduce v3.6's published
per-stratum counts:

**21/21 reproduce exactly. Zero disagreements.** `past_tense` 103/103 ·
`future_conditional` 14/14 · `modal` 18/18 · `competitor` 251/251 · `trade_form` 1584/1584.

So `tense_modality`'s three detectors fire **135 times at corpus scale and 0 times in the
71 sentences the engine cites as proof.** That is a fact about where those shapes land.

The only dead detector is `enquiry_evaluation`, and **v3.6 published that zero itself** —
it is that session's finding reproduced, not a new hole.

### Corroboration from an independent instrument

G-15's own filing records, over the same 17 confirmed false passes:

> **TIME hostile (the property is not asserted as holding now) — 0 / 17**

Two instruments, built in different sessions for different questions, both put the
tense/modality axis at **zero on real copy**.

### Per-stratum occurrence, FORCED (71)

| stratum | rows | | stratum | rows |
|---|---|---|---|---|
| `competitor` | 6 | | `past_tense` | **0** |
| `packaging` | 3 | | `future_conditional` | **0** |
| `bundled_item` | 2 | | `modal` | **0** |
| `cross_sell` | 2 | | `enquiry_evaluation` | **0** |
| `sibling_product` | 1 | | `comparative` | **0** |
| `site_wide` | 1 | | `shipment` | **0** |
| `subscription` | 1 | | `review_quote` · `industry_generic` | **0** |

⚠️ **Correction to the brief: there are 21 strata, not 15.** 15 hostile + 6
must-not-regress. The brief's "fifteen" is the hostile count.

---

## 3. CP-1B — the 36 collisions were never lost; they had no consumer

The brief said 36 domain collisions were "authored in v3.8 and never executed". Both halves
are right, and the reason is worth recording because it is a new failure shape.

They were in `experiments/v3-8/out/g14_adjudications.json` under a top-level `domains` key.
**`g14_merge.mjs` and `g14_table.mjs` never reference `src.domains`** — the key was loaded
into memory and dropped on the floor. Nothing was broken. No test could fail. The data
simply had no reader, and `adjacent_vocabulary` has read as fragment-probes-only ever
since, which is the "attacked and found nothing" illusion v3.8 flagged in its own table.

Chain of custody, now closed:

1. Lifted into **`standards/attack/contexts/generic-collisions.json`** — a real context
   file the generator can reach. 36 domains · 122 sentences · all 13 keys · **0 malformed**.
2. `experiments/v3-8/g14_generate.ts` gained `CONTEXT_FILE` / `OUT_FILE` overrides. Absent
   them its behaviour is byte-identical to v3.8's. `parseContext` problems are **fatal**,
   because a silently-dropped collision reduces coverage while looking exactly like a key
   that has none.
3. v3.8's frozen `g14_sentences.json` verified **byte-identical (SHA-256) before and after**.

```
sentences executed   3,913   (v3.8: 3,681 — delta exactly 232)
domain_collision       232   across 122 distinct texts
outcomes               178 pass · 52 contradicted · 2 not_proven
```

**122 authored strings → 232 executed rows** because `generate.ts:177` emits one row per
*(term, sentence)* pair where `collidesWith.includes(term)`, so a domain colliding with
several terms of one key contributes its sentences once per term. `delta_check: true`.

`adjacent_vocabulary` raw goes **3/100 → 181/332**.

### Two findings the collision author recorded that would have died with that file

1. **The vocabulary imports two of its own collisions.** `plant-based` / `plant based` are
   SUPPORTING terms for `vegan`; `unscented` is supporting for `fragrance_free`. Both
   equivalences are false in the industries that own the terms. **No matcher narrowing can
   fix these — they are term-list defects.**
2. **Bare unframed violating terms fire CONTRADICTED on honest, compliant copy** —
   `with aluminum`, `contains wheat`, `contains parabens`, `added fragrance`,
   `tested on animals`. Consistent with the 52 contradicted rows measured here.

---

## 4. CP-2 — the standing gate

`standards/__tests__/g14.table.test.ts`. 7 tests, **104 cells asserted exactly**, running
the full 3,913-sentence corpus in **0.53s** including process start — so there is **no
env-flag gating and no fast subset**; every cell runs on every `npm test`.

`npm test`: **1,033 tests · 957 pass · 0 fail · 76 skipped** (950 + 7). `typecheck` clean.

Mutation-proved both directions (`experiments/v3-9/mutate_gate.mjs`): baseline green 7/7,
**all 7 mutations killed, 0 anchors drifted**.

### ⚠️ TWO TABLES, AND THEY ARE NOT THE SAME QUANTITY — I got this wrong first

I compared the brief's four cited figures against the RAW engine-answer table and got
**0/4 matches**, which reads as "the brief is wrong". It is not. `g14_table.mjs` renders
**confirmed false passes after adjudication**; I had computed **`pass_evidenced`**. Against
the adjudicated table all four match **exactly**.

| class | RAW (asserted by the gate) | ADJUDICATED (frozen provenance) |
|---|---|---|
| `letter_not_spirit` | 280/280 | **260/280** |
| `adjacent_vocabulary` | **181/332** | 0/100 ← the illusion |
| `wrong_subject` | 616/914 | **368/914** |
| `merchant_controlled_string` | 280/414 | **0/414** |
| `orthography` | 266/606 | 0/606 |
| `violation` | 11/104 | 1/104 |
| `tense_modality` | 448/621 | **439/621** |
| `denial` | 280/461 | 69/461 |

The gate asserts the **RAW** table, because that is the one a matcher change moves and the
only one `npm test` can reproduce without humans. The adjudicated counts sit beside it as
frozen provenance, with a test asserting the two have not been copied into each other.

**`EXPECTED_OPEN_GAPS` moves by +0 for G-14**, asserted in a `[gaps]` test that states the
reason: the register means *a debt with a receipt, individually pinned*; the gate means *a
measured table that cannot drift*. Merging them would destroy the register's meaning.

### `274` is verified

`g14_merged.json` → `confirmedCount: 274`, `confirmed.length: 274`, unique groupIds 274.
Two side-findings on that artifact:
- its `tally` sums to **834 over 779 groups**, and the 55 overcount is **exactly
  `refutedAway`** — a presentation double-count. The confirmed set is unaffected.
- **272 of 274** confirmed groups were refuter-seen; **2 were not**.

---

## 5. CP-4 — the parse fix

Full record: `experiments/v3-9/CP4_DECISION.md`.

**Mechanism confirmed by execution, and wider than the brief claimed.** Twelve inputs
produce a stated `$0.00`. Two more are wrong differently: `"-5.00"` → **$5.00** (sign
stripped) and `"1e5"` → **$15.00** (exponent eaten). Those two are *differently-wrong
prices*, which is precisely what the 3a invariant forbids.

**Natural frequency: 0 offenders in 1,925 real variant price fields** across 363 snapshot
files, two-sided canary live.

**Rider 1: NO.** None of the 11 surviving general defects is this class — 5 are P-19's
real-zero class, 2 have no variant price field at all. The same-push re-measurement
invariant does **not** fire.

**Rider 2 was already satisfied by v3.8:** the frozen fetch corpus already contains this
class (`mm-17`, `znn-05/06/08`, `mm-06`, `mm-08`, `cur-06`), committed at `234ee7b` before
any fix existed.

---

## 6. CP-1A — CONSEQUENCE, AND THE PIVOT VERDICTS

27 agents, 0 errors, 0 empty returns. **71/71 and 178/178 adjudicated, exactly-once verified
in both directions, 0 missing, 0 duplicates.**

**All 15 confirmed defects were re-executed by me against the captured bytes** through the
real `runProductTest` with a pinned contract (the G-09 seam, so FORCED claims are asked
too). Two-sided canary live. **15/15 REPRODUCED** — every one still `pass_evidenced` with
the adjudicated sentence as its quote. 0 do-not-reproduce, 0 incomplete.

### ⚠️ OCCURRENCE UNDERCOUNTS CONSEQUENCE BY ALMOST 4×, and that overturns the easy reading

**11 of the 15 confirmed defects fired NO v3.6 hostile detector at all.** Only 4 did.

So the occurrence column is not just "a floor" in the abstract sense v3.6 warned about — it
is a *low* floor, and **a descope argued from occurrence alone would be arguing from the
smaller number.** This is why the verdicts below rest on adjudicated consequence, not on
marker frequency. It also independently reproduces G-15's *"9 of 17 are unreachable by any
subject frame."*

### The decisive cut is SOLE attribution, not attribution

A defect co-attributed to two axes would be closed by *either* axis's guard. Only a defect
an axis owns **alone** is evidence that a guard for that axis buys anything. (G-15 makes the
same cut with its *"REF the SOLE hostile dimension — 14/17"* row.)

| axis | capability | occurrence | defects (any) | **defects SOLE** | honest carriers | verdict |
|---|---|---|---|---|---|---|
| `letter_not_spirit` | 92.9% | 3/71 | 9 | **0** | 7 | **DESCOPE** |
| `tense_modality` | 70.7% | 0/71 | 1 | **0** | 11 | **DESCOPE** |
| `wrong_subject` | 40.3% | 11/71 | 14 | **6** over 6 stores | 14 | **GUARD-WORTHY** |

Defect attribution shape over the 15: `wrong_subject` alone **6** ·
`letter_not_spirit + wrong_subject` **8** · `letter_not_spirit + tense_modality` **1** ·
unattributed **0**.

- **`letter_not_spirit` — DESCOPE WITH PRECEDENT.** It attacks best of the three (92.9%) and
  owns **not one defect alone**: all 9 of its attributions are shared with `wrong_subject`
  (8) or `tense_modality` (1). A guard for it closes nothing another axis does not already
  close, and costs honest carriers. Its principal real-copy stratum `enquiry_evaluation` has
  **0 instances in 3,349 sentences**. Precedent: the `origin` tombstone, and v3.6's declined
  guards for `enquiry_evaluation` and `review_quote` on measured zero instances.
- **`tense_modality` — DESCOPE WITH PRECEDENT.** Zero occurrence, zero sole defects, **11
  honest carriers**. Its one attribution is a co-attribution on a `letter_not_spirit`
  defect. This is the `origin` arithmetic exactly: true statements lost for zero gain. And
  it is corroborated by a second instrument — G-15's own **TIME hostile 0/17**.
- **`wrong_subject` — GUARD-WORTHY, and it is G-15.** 6 defects it alone closes, over 6
  named stores: `littlewaves.coffee` (supplier attribute) · `trafficcoffee.com` (third-party
  subject) · `equator.ca` (company-level generality) · `unionroasted.com` (regional
  generality) · `necessaire.com` (bundled component) · `ozonecoffee.co.uk` (region/industry
  generality).

**The net: v4.0 is licensed to work on ONE axis, and it is the referent axis G-15 already
scopes. Two of the three open axes are closed by measurement rather than by a guard.**

### The calibration the brief demanded — it passes

The known defects fall out of this read without being looked for:
`blossomcoffeeroasters.com` *"our Cold Brew Blend features a washed single-origin from
Guatemala"* — the exact sentence G-15 names. `equator.ca` *"Equator Coffee Roasters
specializes in roasting and delivering fresh organic coffee"* — the exact company-level case
G-15 names. `hydrangea.coffee` and `brashcoffee.com` — the soil-science sense of `organic`,
v3.2's confirmed coffee defect. `thewestbean.com` *"Composed of three single-origin, estate
grown beans"* — single-origin-in-a-blend.

### ⚠️ THE COMPLETENESS CRITIC FOUND A REAL INSTRUMENT DEFECT, AND I TESTED IT RATHER THAN ACCEPTING IT

Its headline ("no verdicts exist on disk") was **true when it ran and is now stale** — it
executed concurrently with the merge. Three findings did not depend on that:

1. **Quoteless units — warranted, and the instrument behaved.** `A029` (`glowrecipe.com`)
   and `A036` (`kosas.com`) carry `sentence: null`; an adjudicator was asked whether a proof
   sentence misleads and handed none. **Both returned `indeterminate`/`not_applicable` and
   neither is counted in the 15.** Two independent passes have now found exactly 2 such
   rows — G-15 records *"2 not adjudicable because the row renders no quote."*
2. **Refuter scoping — refuted.** The critic read the varying coverage as "no recorded
   rule". There is one and **it holds in all 13 batches**: refuter-seen (193) equals
   adjudicator-flagged (193), exactly. The 56 unseen units are precisely those no
   adjudicator flagged. The rule was implicit in the workflow script rather than documented,
   which is why it was not visible to a reader.
3. **Refutation-rate heterogeneity — CONFIRMED, and it is the real finding.** CP-1A
   χ² = 23.55 on 4 df (p < 0.0001); CP-1B χ² = 23.07 on 7 df. Kill rates run **0.20 (A1, A4)
   to 0.917 (A5)** on compositionally matched batches. **At the pooled rate, 30 rows would
   survive where 15 did.** The confirmed count is sensitive to refuter assignment at roughly
   2×, and that is a property of the instrument, not of the stores.

   **So I recomputed every verdict under both bounds** — STRICT (refutation applied, 15
   defects) and RAW (adjudicator verdicts only, 19 defects). **All three verdicts agree
   under both.** `letter_not_spirit` 0 sole either way; `tense_modality` 0 sole either way;
   `wrong_subject` 6 sole (strict) / 8 sole (raw). The heterogeneity moves the counts and
   **not the conclusions**.

   ⚠️ It does move the cost ratio, and this belongs in any v4.0 brief: `wrong_subject` costs
   **2.33 true rows per sole defect closed under the strict reading and 5.13 under the raw
   one.** The upper end is within reach of the arithmetic that removed `origin`.

## 7. CP-1B — the collisions adjudicated

**78 confirmed false passes** of 178 candidates (47 correct, 52 refuted away, 1
indeterminate).

| key | n | false pass | | key | n | false pass |
|---|---|---|---|---|---|---|
| `organic` | 27 | **18** | | `third_party_tested` | 22 | **11** |
| `vegan` | 26 | **17** | | `fair_trade` | 14 | **10** |
| `single_origin` | 22 | **12** | | `baking_soda_free` | 12 | **5** |
| `cruelty_free` | 17 | 3 | | `fragrance_free` | 19 | 2 |
| `aluminum_free` | 10 | **0** | | `bpa_free` | 6 | **0** |
| `sulfate_free` | 3 | **0** | | | | |

The three keys with zero false passes are the ones whose collisions are chemical/regulatory
rather than semantic — the engine reads them correctly. The four worst (`organic`, `vegan`,
`single_origin`, `fair_trade`) are the terms with genuine established senses in other
domains, which is exactly what the class was authored to probe.

---

*Sections 8 (the staged block), 9 (filings and arithmetic) follow.*
