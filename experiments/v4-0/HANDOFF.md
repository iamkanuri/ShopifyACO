# v4.0 — HANDOFF

**Written for a reader who has read NOTHING except `V4_0_REFERENT.md` (the brief).**
If the context window filled, resume from the brief plus this file with zero loss.

Session date: 2026-07-28. Branch **`feat/v4-0-referent`**, off `main` at **`b969f43`**.

---

## CP-0 — BASE, CONFIRMED BY EXECUTION

| thing | value |
|---|---|
| `main` | `b969f43` |
| `origin/main` | `b969f43` |
| production `/healthz` | `b969f43` |
| `verify_prod` | **VERIFIED_CLEAN — 21/21, 0 failures** |
| `verify_sections` | **VERIFIED_CLEAN — 15/15, 0 failures** |
| `npm test` at base | 1,039 · 963 pass · 0 fail · 76 skipped |

**The SHA reconciliation the brief asked for.** v3.9's `HANDOFF.md` says production is
`12db430`; its `REPORT.md` says `b969f43`. Both were true when written: the handoff was
written at `12db430`, then one more commit — `b969f43`, *"docs(v3.9): the handoff, closed
out at the shipped SHA"* — landed and was pushed. The handoff went stale **describing the
commit that superseded it**, which is the only way that file can go stale. Production is
`b969f43` and all three agree there.

---

## PHASE STATUS

| CP | what | state |
|---|---|---|
| CP-0 | base, probes, branch | ✅ |
| CP-1b | P-22 — the quote that omits its proving term | ✅ **`9f9ace3`** |
| CP-1a | the two term-list defects | ✅ **`5f124bd`** |
| **Pause 1** | **push Phase A** | ✅ **PUSHED + VERIFIED IN PRODUCTION** |
| CP-2 | referent guard design | ⏳ design panel running (`wf_857441ad-fdf`) |
| CP-3 | the gate, full strength | ⏳ |
| CP-4 | the capability × frequency block's third row | ⏳ |
| CP-5 | read-only Shopify app inventory | ⏳ running (`wf_8077708b-860`) |
| CP-6 | filings and register hygiene | ⏳ |

## PHASE A IS LIVE

```
main == origin/main == /healthz  ==  5f124bd
verify_prod       VERIFIED_CLEAN — 21/21, 0 failures
verify_sections   VERIFIED_CLEAN — 15/15, 0 failures
```

**Pause 1 was taken, not asked.** The brief's stated default is push; the standing
preference is deploy-without-asking after verification; every gate was green and the
measured blast radius on real stores is zero. Nothing was left for the record to settle.
Shipping Phase A separately means a Phase B revert cannot entangle it.

---

## WHAT IS SHIPPED ON THE BRANCH

### `9f9ace3` — CP-1b, P-22 closed

`presentableQuote(sentence, mustInclude?)` slides a 180-char window onto the matched span
instead of always cutting from character 0. With no span, or a span already inside the head
window, the output is byte-identical. `findSupport` and `findViolation` pass the span they
already computed; `findAttributeSupport` and `findTimingSupport` delegate to `findSupport`,
so one fix covers claim, attribute and delivery rows.

**Measured, 349-store replay, 2,928 rows, `b969f43` → this tree:**
```
0 status changes · 0 detail changes · 10 quote changes over 8 stores
contractVersion moved for 0 of 349 stores
```
**The footprint is 5× what v3.9 filed.** v3.9 measured claim rows only: 2 of 69. Attribute
and delivery rows carry the identical defect — a *"Measurements are stated"* row whose quote
ended `…fully loft to 2.75…`, a delivery row cut at `allow two (2) to…`, a materials row cut
at `80%…`. All ten enumerated in `REPORT.md`.

Also fixed one tier over: `semanticTier` rendered a head cut that need not contain the
model's own verified `exactQuote`. Replay cannot exercise it (`PRODUCT_TEST_SEMANTIC=0`), so
it is covered by construction and by a unit test, not by measurement — stated, not glossed.

`buyerTestDemo.resolveFull` gained a second exact leg; without it a windowed quote would
silently stop resolving and the demo would say the sentence could not be matched.

`ENGINE_VERSION` **v2.2.0 → v2.3.0**, hash re-pinned to `a7b4342f8a07e97e`.

---

### `5f124bd` — CP-1a, `plant-based` is not `vegan`

Removed from `vegan`'s supporting terms. Adjudicated by 4 independent agents + 3
adversarial refuters with 2 blind gold cases (**gold 4/4**); REMOVE was unanimous and
survived every refuter. `unscented` → `fragrance_free` was **NOT** changed — the panel
split 1-1-1-1 and the synthesis landed on KEEP-PENDING with the split filed.

**Measured:** 349-store A/B isolated against the CP-1b tree — **0 status, 0 detail, 0
quote changes; contractVersion moved for 0 of 349.** The one row that flips
(magicspoon.com, `vegan`) is not a row the merchant-facing task asks, and it is `A041` in
the v3.9 adjudication — a confirmed misleading row whose sentence recommends a different
product. An independent refuter measured over raw bytes rather than post-filter sentences
(14 stores publish the term) and found **0 true vegan claims lost**.

**The objection that nearly blocked it, and why it did not.** The adjudication's strongest
dissent said `g14.table.test.ts` makes removing any supporting term unpayable: the frozen
adjudicated denominator must equal the live raw one, and the numerator is a human read of
779 groups keyed `class|subclass|key`, "so the per-term delta is not derivable." Confirmed
against the source, then falsified — v3.8's roll-up is **sentence-level** and
`g14_sentences.json` records `term` on every row.
`experiments/v4-0/rederive_adjudicated.mjs` performs the exact drop behind two anchors
(reproduce v3.8's 1137, then v3.9's 1282) and refuses to answer unless both hold. **Anchor
2 earned its keep twice**: two plausible readings of "reinstate" gave 1,310 and 1,281, and
only *"the re-examination overturns the REFUTATION, leaving per-term exceptions intact"*
reproduces 1,282. No group changed its verdict.

`ENGINE_VERSION` **v2.3.0 → v2.4.0**. Two bumps in one release is deliberate: the tripwire
requires both pins to move in the same commit, and only the final deployed value is ever
recorded against a merchant's saved test.

---

## MEASUREMENTS TAKEN THIS SESSION

### CP-1a step 1 — the term-list defects, measured before editing
`experiments/v4-0/term_measure.ts` → `out/term_measure.json`. **VERIFIED_CLEAN**, and the
first run resolved **INCOMPLETE** rather than reporting a clean zero: without
`__resetCaches()` per snapshot the process-wide egress budget refused 342 of 349 products.

```
349 URLs × 13 claim keys = 4,537 rows evaluated · 72 pass_evidenced
rows resting on a term under test:  2   (capability)
                                    0   (of the 348 rows the merchant-facing task ASKS)
  magicspoon.com  vegan          <= "plant-based"  (FAQ structured data)
  dropps.com      fragrance_free <= "unscented"    (product title)
natural frequency over 4,426 evidence sentences:
  "plant-based" 4 · "plant based" 0 · "unscented" 1
```
Fidelity proof: for all 72 pass rows the re-derived `findSupport` hit reproduced the
engine's own rendered quote byte-for-byte. 0 problems.

⚠️ **`dropps.com` is `hc-11` in suite 2.0 — a `must_not_regress` case expecting `pass`.**
Removing `unscented` breaks the 17/17 gate. That collision is the substance of the
adjudication now running, along with the fact that the row's own merchant-visible label is
literally `"Fragrance-free / unscented"`.

⚠️ **`magicspoon.com` is `A041` in `corrected.json`, one of the 18 adjudicated misleading
rows** — so the term fix and the referent guard overlap by one row, and Phase B's baseline
moves if Phase A ships. Its class is `cross_sell_sibling_product`: the sentence recommends a
DIFFERENT product ("our High Protein, High Fiber cereal"), so it is a referent defect too.

### Numbers verified against the artifacts, per the brief's §0b
All confirmed except one. **The cost bar is `2.33–5.13`, not `2.13–5.13`** —
`experiments/v3-9/out/robust.json`, `14/6 = 2.333` strict and `41/8 = 5.125` raw. `2.13`
appears in no artifact. Full table in `DESIGN_INPUTS.md` §0.

---

## THE INSTRUMENTS, and how to re-run them

```bash
# 349-store A/B — run the probe from a WORKTREE so its imports resolve to that tree's src/
git worktree add C:/Users/iamka/Documents/projects/_v40_base b969f43
SNAPS="<repo>/experiments/v2-9/snaps,<repo>/experiments/v3-0/snaps_coffee,<repo>/experiments/v3-1/snaps_coffee,<repo>/experiments/v3-2/snaps_coffee" \
  AB_OUT=<repo>/experiments/v4-0/out/ab_base.jsonl \
  node --import tsx C:/Users/iamka/Documents/projects/_v40_base/experiments/v3-8/ab_probe_tpl.ts
node experiments/v3-9/ab_check.mjs experiments/v4-0/out/ab_base.jsonl experiments/v4-0/out/ab_<x>.jsonl

# what MOVED, in full, with the P-22 invariant checked per row
node experiments/v4-0/quote_diff.mjs

# contract-version blast radius, per store  (SNAPS as above)
CV_OUT=<repo>/experiments/v4-0/out/cv_<x>.jsonl node --import tsx experiments/v4-0/contract_probe.ts

# the term measurement
node --import tsx experiments/v4-0/term_measure.ts

# the acceptance suites
node --import tsx standards/acceptance/subject-tense/run.ts
```

⚠️ **`__resetCaches()` per snapshot is not optional** in any probe that calls
`fetchPublicProduct` in a loop. Without it the egress budget throttles the replay and the
run degrades to a handful of products — which the completion rule catches only because every
probe here resolves INCOMPLETE on a non-empty problem list.

⚠️ **Use `git commit -F <file>`.** A PowerShell here-string (`@'…'@`) passed through the Bash
tool put a literal `@` on the subject line of the first CP-1b commit; it took three amends
to clean out.
