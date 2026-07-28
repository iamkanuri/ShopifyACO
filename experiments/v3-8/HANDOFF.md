# v3.8 — HANDOFF

**Written for a reader who has read NOTHING else except `V3_8_LONGRUN.md` (the brief).**
Kept current at every checkpoint commit. If the context window filled, resume from the brief plus
this file with zero loss.

Session date: 2026-07-28. Branch: **`feat/v3-8-campaigns`** (created at CP-1A; before that, `main`).

---

## STATE OF THE WORLD

| thing | value |
|---|---|
| production SHA | **`6a3e5d7`** — shipped and verified this session (CP-0) |
| `main` == `origin/main` | `6a3e5d7` |
| working branch | `feat/v3-8-campaigns`, off `main` at `6a3e5d7` |
| pushed beyond CP-0? | **NO** — and must not be, without Pause 2 |
| local Supabase stack | not yet probed (needed only for the DB-gated gate) |

---

## PHASE STATUS

| CP | what | state | landed in |
|---|---|---|---|
| CP-0 | ship v3.7 + deep verify | ✅ **DONE** | pushed `7085b34..6a3e5d7` |
| CP-1A | G-14 step 1, the 13 claim keys | 🔄 generation DONE, adjudication RUNNING | (checkpoint below) |
| CP-1B | fetch-layer corpus (P-17) | 🔄 authoring workflow RUNNING | — |
| CP-2 | byte-shape census + kill condition | ⏳ not started | — |
| CP-3 | at most two price fixes | ⏳ blocked on CP-2 + Pause 1 | — |
| CP-4 | filings + gaps arithmetic + REPORT | ⏳ written as the session runs | — |

---

## CP-0 — DONE

```
git checkout main && git merge --ff-only feat/v3-7-perkind && git push origin main
  -> 7085b34..6a3e5d7
```

`/healthz` reports `6a3e5d7`. `EXPECT_SHA=$(git rev-parse HEAD) node experiments/v3-7/verify_prod.mjs`
→ **VERIFIED_CLEAN, 21/21 checks, 0 failures**. All four standard hashes agree three ways
(`334389c4eb61` · `f8ec2780f60c` · `fe199a864d3d` · `ba2050578ed0`); `llms.txt` names v1.3 current;
landing page links v1.3.

**STILL OWED at CP-0** (the brief asks for more than `verify_prod` checks): assert the *new* page
sections — the per-kind table and the interval-overlap ratio refusal — are present in **production's
served bytes**. They have never been served before. `experiments/v3-8/verify_sections.mjs` is the
place for it. Not yet written.

**Stumptown default taken:** the re-score STANDS (true pass under v1.3's text). Both readings are in
`standards/coffee/v1.3/fitness.json`; reversing is a one-field edit. Flagged for Pause 1, not blocking.

---

## CP-1A — G-14 step 1

### What exists on disk

| file | what |
|---|---|
| `experiments/v3-8/g14_generate.ts` | generation + execution. **Run it, don't re-derive it.** |
| `experiments/v3-8/out/g14_sentences.json` | 3,681 executed sentences, full detail |
| `experiments/v3-8/g14_batch.mjs` | groups + splits into adjudication batches |
| `experiments/v3-8/batches/g14_b{1..10}.json` | the batches |
| `experiments/v3-8/batches/g14_manifest.json` | counts, exactly-once proof |

Re-run: `GIT_SHA=$(git rev-parse HEAD) PER_CELL=999 node --import tsx experiments/v3-8/g14_generate.ts`
then `node experiments/v3-8/g14_batch.mjs 10`.

### The measurement, as it stands

```
keys lifted from source bytes : 13   (== ENGINE_CLAIM_KEYS, asserted)
terms                         : 69
lift round-trip               : 69/69 through the REAL evaluate()
sentences executed            : 3,681   (hostile 3,500 · controls 181)
dropped by cap                : 0      (PER_CELL=999 → FULL coverage, no INCOMPLETE cells)
real evaluate() vs mirror     : 0 disagreements
controls meeting expectation  : 181/181
completion                    : VERIFIED_CLEAN
groups for adjudication       : 779, in 10 batches, exactly-once verified both directions
```

**NO ADJUDICATION HAS HAPPENED YET.** The table of `pass_evidenced` counts is a CANDIDATE list.
An engine answer is not a verdict.

### Decisions taken, with reasons

1. **The templatizer has EIGHT classes, not the brief's six.** Brief §CP-1A says "if the
   templatizer's classes differ from these six, follow the templatizer and say so." Followed.
   The eight: `letter_not_spirit`, `adjacent_vocabulary`, `wrong_subject`,
   `merchant_controlled_string`, `orthography`, `violation`, `tense_modality`, `denial`.
   Mapping to the brief's six: *adjacent vocabulary*→`adjacent_vocabulary`; *denial*→`denial`;
   *subject/referent*→`wrong_subject`; *tense/aspect* **and** *modality/condition* are MERGED into
   the single `tense_modality`; *attribution* is split across `wrong_subject/{review_quote,
   competitor}` and `merchant_controlled_string`. Three classes have no counterpart in the brief at
   all: `letter_not_spirit`, `orthography`, `violation`. The must-not-regress direction is built in
   as `control: true` templates (181 of them).
2. **Uncapped (PER_CELL=999) rather than capped.** At the default cap of 6, 1,056 sentences were
   dropped and cells would have had to be marked INCOMPLETE. Full coverage is strictly better and
   3,681 is tractable. The brief predicted 1,500–3,000; **the real number is 3,681.**
3. **Dictionaries enumerated by lifting the `CLAIM_TERMS` literal out of the engine's source
   bytes and evaluating it**, then round-tripping every term through the real `evaluate()`.
   `CLAIM_TERMS` has no `export`. A regex would also match the copy in
   `standards/__tests__/vocabulary.engine.test.ts` and could not tell them apart, so the lift is
   brace-balanced and anchored on the typed declaration. Key set cross-checked against
   `ENGINE_CLAIM_KEYS`.
4. **Both paths executed per sentence** — the real `evaluate()` and the mirror
   `evaluateWithVocabulary` — and required to agree.
5. **Batched CLASS-MAJOR round-robin**, so no adjudicator owns a whole attack class. v3.7 batched
   by kind and recorded the cost (errors inside a batch are correlated by construction).

### ⚠️ THREE INSTRUMENT BUGS IN MY OWN HARNESS, ALL CAUGHT BY AN ASSERTION, NONE BY READING

1. **`evaluate`'s argument order is `(product, requirement)`.** Written `(req, product)` it returns
   `undefined` **rather than throwing**, and every row would have read as a silent `not_proven` —
   a broken instrument scoring a perfect hostile sweep.
2. **The engine has NO `contradicted` status for a claim.** Contrary evidence returns
   `status: "not_proven"` and is distinguished ONLY by the detail sentence
   `"Your public copy states the opposite of this requirement."` (`productTest.ts:1758-1764`).
   Checking `status === "contradicted"` reported 13 real violating terms as broken and 293 sentences
   as path disagreements — all artefacts of my mapping. There is now a **tripwire** asserting that
   detail string still exists in the engine's source, because the mapping keys on it.
3. **A control's expected outcome depends on the term's ROLE.** `control_plain_disclosure` is a
   VIOLATING-term control, so its expected outcome is `contradicted`, not `pass`. Checking every
   control for `pass_evidenced` reported all 13 as broken when the engine was answering exactly
   right — and `engineStatus` alone cannot show it, because a contradiction and a plain miss are
   BOTH `not_proven`.

### ⚠️ FINDINGS ALREADY BANKED (independent of adjudication)

- **The real claim branch REFUSES the `shipping_policy` surface** (`productTest.ts:1746`) and the
  mirror `evaluateWithVocabulary` does not. `standards/__tests__/vocabulary.engine.test.ts` only ever
  probes `product_description`, so its fidelity proof structurally cannot see this. **And the
  templatizer's `merchant_controlled_string/shipping_policy` template says in its own `intent` that
  "the claim branch restricts no surface" — that comment is STALE.** Recorded in
  `out/g14_sentences.json` as `surface_refusal_diffs` + `surface_refusal_note`.
- **The biggest coverage hole is the non-mechanisable half of `adjacent_vocabulary`.**
  `DEFAULT_CONTEXT.adjacentDomains` is empty, so only fragment probes exist for that class and the
  domain-collision half is untested for all 13 keys. This matters more than the count suggests:
  two of this repo's known real defects live exactly there (`organic` in its soil-science sense;
  `REACH`/`compounds` homographs). **Needs human-authored domain collisions** — scheduled as its own
  authoring pass.

---

## CP-1B — fetch-layer corpus

Workflow `wf_4d850e6a-19d` running: 1 recon agent over the real fetch→extract→tier→price path,
then 6 authors (currency · cents_boundary · zero_null_negative · tier_disagreement ·
malformed_money · transport_truncation), then a completeness critic. Authors return **semantic case
specs**, not bytes — a mechanical synthesizer turns them into real HTTP bodies, so no agent writes
HTML and no agent touches `src/`.

**The brief requires the corpus be FROZEN in a commit before any fix design exists**, and the
authors must not author any fix. Both honoured by construction.

Not yet written: the synthesizer + execution harness. It must inject at the `fetchUrl` seam that
`fetchPublicProduct` already accepts (the same seam the v2-9/v3-5/v3-7 replay harnesses use) —
nothing about parsing may be reimplemented.

---

## GATES OWED AT THE END (from the brief)

- matcher files changed ONLY in CP-3's commits, named per commit; nothing under
  `standards/acceptance/subject-tense/`
- acceptance runner still `hostile 4/37, must-not-regress 19/19`
- `EXPECTED_OPEN_GAPS` moved only by pins, arithmetic stated per step (**base is 60**, from v3.7)
- CP-1B harness's own expected-gaps constant asserted if created
- all four standard hashes byte-frozen; no v1.4
- both campaign tables carry per-cell completion states; INCOMPLETE never sums as clean
- production verified at CP-0's SHA; nothing further pushed without Pause 2

---

## PAUSE 1 — HELD, AND ITS OUTCOMES ARE BINDING

| call | outcome |
|---|---|
| ship list | **BOTH** — 3a cents/tier fix + 3b non-USD refusal |
| sidecar | **re-measure tonight, but only AFTER the gates settle** |
| stumptown | **re-score STANDS** |

**Riders on the ship list, from the user, all binding:**
1. **3a and 3b are SEPARATE COMMITS with SEPARATE A/B attribution** — the v3.5 2a/2b precedent.
2. **`firelightcoffee.com` and `tinker.coffee` are the cents fix's CALIBRATION CASES.** The pass
   must flip *exactly* those. `ab_diff.mjs --expect-hosts=` enforces it and exits INCOMPLETE if a
   named host did not move.
3. **The cents fix FAILS CLOSED**: a `.js` value that does not parse as an integer → refuse to
   state a price. **Never divide.**

**Riders on the sidecar:**
- The re-measurement is a **NEW measurement block pinned to the fixed SHA**. v3.7's 7.53% stays
  **frozen beside it, never edited** — the same rule as v1.0's fitness.
- **Standing invariant going forward: a matcher fix and the re-measurement of every published
  figure it moves ship in the SAME push**, so Pause 2 presents one self-consistent unit. If both
  fixes revert, nothing moves and nothing goes stale.
- ✅ **VERIFIED, and it is general-only.** Coffee's `PRICE-001` is `unbound` at v1.2 and v1.3, and
  **no v1.3 entry binds `req_kind: price_under`** (the ten bindings are claim ×3, variant_option
  ×4, delivery, identifiers, attribute). The coffee sample contains **zero price rows**, so neither
  fix can move a coffee figure.

**Rider on stumptown:** record in the sidecar that reversing would score coffee under a rule
(`mpn === sku`) the general sample was explicitly scored *without* — cross-sample consistency is
the point, per v3.7's audit-depth finding. The reseller residual is covered by v1.3's honesty
clause; nothing further to file.

---

## CP-3 INFRASTRUCTURE — BUILT AND VALIDATED, BEFORE ANY FIX EXISTS

| file | what |
|---|---|
| `experiments/v3-8/ab_probe_tpl.ts` | copied INTO a worktree and run there, so imports resolve to *that* tree's `src/`. Two-sided liveness canary; records status **and detail and quote**. |
| `experiments/v3-8/ab_diff.mjs` | mechanical A/B. Fails if the row sets differ, and fails if a named calibration host did NOT move. |
| `experiments/v3-8/fetch_harness.ts` | CP-1B's synthesizer + executor. Semantic case spec → real HTTP bodies → the REAL fetch path. |
| `.v38-pre/` | git **worktree** at `9535587` (never a file swap — v3.1 measured a swap that silently failed to apply as "0 regressions"). |
| `experiments/v3-8/out/ab_before.jsonl` | the baseline: **349 snapshots, 2,928 rows**, canary live. |

The fetch harness is validated by reproducing two REAL defects from chosen input: a `.js` price of
exactly `1000` renders `$1000.00` (levainbakery), and a GBP store renders `$135.00` (missoma).

---

## EXACT NEXT STEP

1. Freeze the CP-1B corpus in a commit — **before any fix code is written** (brief's structural
   rule; its authors author no fix).
2. Write 3a (cents/tier) and 3b (non-USD) as **separate commits**, each with its own gate:
   independent attackers vs a frozen worktree + the frozen CP-1B corpus as a regression floor →
   independent refuter → I re-execute every claim at both commits → mechanical A/B with the
   calibration hosts named → natural-frequency read → contractVersion consequence stated.
3. Merge + refute CP-1A's adjudications; re-execute every confirmed defect myself.
4. Re-measure the general sidecar at the fixed SHA as a NEW block (only for fixes that survived).
5. CP-4 filings + `EXPECTED_OPEN_GAPS` arithmetic per step (base **60**).
6. **Pause 2** before pushing anything beyond CP-0's `6a3e5d7`.
