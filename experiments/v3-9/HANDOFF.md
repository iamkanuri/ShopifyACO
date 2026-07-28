# v3.9 — HANDOFF

**Written for a reader who has read NOTHING else except `V3_9_WORTH.md` (the brief).**
Kept current at every checkpoint commit. If the context window filled, resume from the brief plus
this file with zero loss.

Session date: 2026-07-28. Branch: **`feat/v3-9-worth`**, off `main` at `3dbef7c`.

---

## STATE OF THE WORLD

| thing | value |
|---|---|
| production SHA | **`3dbef7c`** (docs follow-up atop v3.8's `80504ee`) |
| `main` == `origin/main` == production | all three `3dbef7c`, confirmed at CP-0 |
| working branch | `feat/v3-9-worth` |
| pushed? | **NO** — and must not be, without Pause 2 |
| both production probes | `verify_prod` **21/21**, `verify_sections` **15/15**, both VERIFIED_CLEAN |

---

## PHASE STATUS

| CP | what | state |
|---|---|---|
| CP-0 | base confirmation | ✅ **DONE** |
| CP-1A | frequency × consequence × honest-carrier | 🔄 occurrence DONE, adjudication RUNNING |
| CP-1B | execute the 36 domain collisions | 🔄 execution DONE, adjudication RUNNING |
| CP-2 | the G-14 standing gate | ⏳ not started |
| CP-3 | suite 2.0 (conditional on CP-1A) | ⏳ blocked on CP-1A |
| CP-4 | the currency-code parse fix | ⏳ not started |
| CP-5 | stage capability × frequency | ⏳ not started |
| CP-6 | filings | ⏳ written as the session runs |

Adjudication workflow: **`wf_2a19827b-bd2`** — 13 adjudicators (5×CP-1A, 8×CP-1B) → per-batch
refuter → completeness critic.

---

## THE POPULATION, AND THE RECONCILIATION THE BRIEF ASKED FOR

`experiments/v3-9/reconcile.mjs` → `out/reconcile.json`. **The two instruments agree exactly.**

|  | v3.6 `freq/pass_rows.json` | v3.8 `out/ab_after_3b.jsonl` |
|---|---|---|
| rows | **71** | **34** |
| `asked: true` subset | **34** | — |
| per-claim, asked-true | single_origin 16 · organic 14 · gluten_free 2 · paraben_free 1 · bpa_free 1 | **identical** |
| set intersection | 34 in both · **0** only-v3.8 · **0** only-v3.6-asked | |

The apparent 71-vs-34 disagreement is **entirely the `asked` flag**: v3.6 FORCED all 13 claims at
every store; 37 of its rows are claims `CATEGORY_CLAIMS` never selects (vegan 10, fair_trade 6,
cruelty_free 2, and thinner tails). **There is no instrument disagreement to report.**

Two denominators, never conflated:
- **ASKED (34 rows / 32 stores)** — what the engine renders today.
- **FORCED (71 rows / 54 stores)** — a guard's blast radius if any future category selects those
  claims. This is also the denominator G-15's "17 false passes in 71 live claim rows" is stated over.

⚠️ **Correction to the brief: there are 21 strata, not 15.** 15 hostile + 6 must-not-regress.
The brief's "fifteen" is the hostile count.

⚠️ **`274` IS verified.** `g14_merged.json` → `confirmedCount: 274`, `confirmed.length: 274`,
unique groupIds 274. Use it. Two side-findings on that artifact:
- its `tally` sums to **834 over 779 groups**, and the 55 overcount is **exactly `refutedAway`** —
  a presentation double-count (a refuted group is counted in its original bucket *and* in
  `refutedAway`). The confirmed set is unaffected.
- **272 of 274** confirmed groups were refuter-seen; **2 were not**.

---

## CP-1A — OCCURRENCE IS MEASURED. CONSEQUENCE IS NOT (YET).

`experiments/v3-9/axes.ts` → `out/axes.json`. v3.6's 21 detectors imported, not rebuilt.

**FORCED (71 rows / 54 stores):**

| axis | G-14 capability (chosen input) | occurrence in real proof sentences | honest carriers |
|---|---|---|---|
| `letter_not_spirit` | 260/280 = **92.9%** | **3/71 = 4.23%** (2 stores) | 35/71 |
| `tense_modality` | 439/621 = **70.7%** | **0/71 = 0.00%** | 46/71 |
| `wrong_subject` | 368/914 = **40.3%** | **11/71 = 15.49%** (9 stores) | 55/71, **5 rows are both** |

**ASKED (34 rows / 32 stores):** `letter_not_spirit` 2/34 · `tense_modality` 0/34 · `wrong_subject`
(see `out/axes.json`).

Per-stratum, FORCED: `enquiry_evaluation` **0** · `comparative` **0** · `subscription` 1 ·
`cross_sell` 2 · `past_tense` **0** · `future_conditional` **0** · `modal` **0** ·
`competitor` 6 · `packaging` 3 · `bundled_item` 2 · `sibling_product` 1 · `site_wide` 1 ·
`shipment` 0 · `review_quote` 0 · `industry_generic` 0.

### ⚠️ THE ZERO IS REAL, AND IT IS PROVED RATHER THAN ASSERTED

`experiments/v3-9/liveness.ts` → `out/liveness.json`. **All 21 detectors reproduce v3.6's own
published per-stratum sentence counts EXACTLY, 21/21, over the full 3,349-sentence corpus** —
`past_tense` 103/103, `future_conditional` 14/14, `modal` 18/18, `competitor` 251/251, and so on.
Zero disagreements.

So the three `tense_modality` detectors fire **103 + 14 + 18 = 135 times at corpus scale and 0
times in the 71 sentences the engine cites as proof.** That is a fact about where those shapes
land, not a dead instrument. The only dead detector is `enquiry_evaluation`, and **v3.6 published
that zero itself** — it is that session's own finding reproduced, not a new hole.

`consequence_rows` is **`null`** everywhere with `consequence_state: PENDING_ADJUDICATION`. It is
never `0`.

---

## CP-1B — EXECUTED. 36 COLLISIONS WERE NEVER LOST, THEY HAD NO CONSUMER.

The 36 authored collisions were in `experiments/v3-8/out/g14_adjudications.json` under a top-level
`domains` key. **`g14_merge.mjs` and `g14_table.mjs` never reference `src.domains`** — the key was
loaded into memory and dropped, so `adjacent_vocabulary` has read as fragment-probes-only ever
since, which is the "attacked and found nothing" illusion. Nothing was broken; the data had no
reader.

Chain of custody now closed:
1. `experiments/v3-9/extract_collisions.mjs` lifts them → **`standards/attack/contexts/generic-collisions.json`**
   (36 domains · 122 sentences · all 13 keys · **0 malformed**). This is the "wire into the standing
   corpus" step — a real context file the generator can reach, not a scratch blob.
2. `experiments/v3-8/g14_generate.ts` gained `CONTEXT_FILE` + `OUT_FILE` env overrides (3 small
   edits; absent them its behaviour is byte-identical to v3.8's). `parseContext` problems are
   **fatal**, because a silently-dropped collision reduces coverage while looking exactly like a
   key that has none.
3. Executed: **3,913 sentences vs v3.8's 3,681 — delta exactly 232 = the domain_collision rows.**
   v3.8's `g14_sentences.json` verified **byte-identical** before and after (SHA-256 compared).

**122 authored strings → 232 executed rows.** `generate.ts:177` emits one row per *(term, sentence)*
pair where `collidesWith.includes(term)`, so a domain colliding with several terms of the same key
contributes its sentences once per term. 122 distinct texts, 232 rows, `delta_check: true`.

Outcomes: **178 pass · 52 contradicted · 2 not_proven**. The 178 are the adjudication candidates.
Per key, `pass/total`: organic 27/27 · single_origin 22/22 · vegan 26/33 · cruelty_free 17/19 ·
fragrance_free 19/22 · fair_trade 14/14 · baking_soda_free 12/12 · aluminum_free 10/29 ·
sulfate_free 3/9 · **paraben_free 0/4** · (gluten_free, third_party_tested, bpa_free in
`out/collide_report.json`).

### Two findings the collision author recorded that die with that file unless carried

1. **The vocabulary imports two of its own collisions.** `plant-based`/`plant based` are listed as
   SUPPORTING terms for `vegan`, and `unscented` as supporting for `fragrance_free`. Both
   equivalences are false in the industries that own the terms. **No matcher narrowing can fix
   these — they are term-list defects.**
2. **Bare unframed violating terms fire CONTRADICTED on honest compliant copy** — `with aluminum`,
   `contains wheat`, `contains parabens`, `added fragrance`, `tested on animals`. 22 of the
   author's sentences execute to CONTRADICTED. Consistent with the 52 contradicted rows here.

---

## FILES

| file | what |
|---|---|
| `experiments/v3-9/recon*.mjs` | artifact location + shape, by execution |
| `experiments/v3-9/reconcile.mjs` | v3.6 ↔ v3.8 population reconciliation |
| `experiments/v3-9/axes.ts` | **the axis map + occurrence read**; `AXIS_MAP` is the G-14→strata mapping |
| `experiments/v3-9/liveness.ts` | per-detector liveness against v3.6's published counts |
| `experiments/v3-9/extract_collisions.mjs` | 36 collisions → a real context file |
| `experiments/v3-9/collide_report.mjs` | collision outcomes + the 122→232 arithmetic |
| `experiments/v3-9/batch.mjs` | class-major round-robin batching, exactly-once both directions |
| `standards/attack/contexts/generic-collisions.json` | **the standing artifact** |

Re-run order: `recon*.mjs` → `reconcile.mjs` → `axes.ts` → `liveness.ts` →
`extract_collisions.mjs` → (generator with `CONTEXT_FILE`/`OUT_FILE`) → `collide_report.mjs` →
`batch.mjs`.

---

## GATES OWED

- matcher files changed ONLY in CP-4's commit, named; ENGINE_VERSION bumped iff a matcher file
  changed (the tripwire asserts it — do not weaken it).
  **So far: no matcher file touched.** `standards/attack/contexts/generic-collisions.json` is
  attack-corpus data, not a matcher; `experiments/v3-8/g14_generate.ts` is a harness.
- suite 1.0 byte-frozen, runner still `hostile 4/37, must-not-regress 19/19`
- the G-14 standing suite green at its expected table; INCOMPLETE cells unreadable as passes
- all four standard hashes frozen (`334389c4eb61` · `f8ec2780f60c` · `fe199a864d3d` · `ba2050578ed0`)
- `EXPECTED_OPEN_GAPS` arithmetic stated per step — **base is 60**, from v3.7
- production untouched until Pause 2; both probes after any push

---

## OPEN / NOT YET DONE

- adjudication verdicts (workflow `wf_2a19827b-bd2`)
- my own re-execution of every confirmed defect against the bytes
- CP-2, CP-3, CP-4, CP-5, CP-6
- Pause 1 has not been reached yet
