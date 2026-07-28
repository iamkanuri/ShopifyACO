# v3.9 — HANDOFF

**Written for a reader who has read NOTHING else except `V3_9_WORTH.md` (the brief).**
If the context window filled, resume from the brief plus this file with zero loss.

Session date: 2026-07-28. Branch: **`feat/v3-9-worth`**, off `main` at `3dbef7c`.

---

## STATE OF THE WORLD

| thing | value |
|---|---|
| production SHA | **`3dbef7c`** — untouched all session |
| `main` == `origin/main` == `/healthz` | all `3dbef7c`, confirmed at CP-0 |
| working branch | `feat/v3-9-worth` |
| pushed? | **NO** — and must not be, without Pause 2 |
| both production probes at CP-0 | `verify_prod` **21/21**, `verify_sections` **15/15** |

---

## PHASE STATUS — ALL COMPLETE

| CP | what | state |
|---|---|---|
| CP-0 | base confirmation | ✅ |
| CP-1A | frequency × consequence × honest-carrier | ✅ |
| CP-1B | the 36 domain collisions | ✅ |
| CP-2 | the G-14 standing gate | ✅ |
| CP-3 | acceptance suite 2.0 | ✅ |
| CP-4 | the parse fix + `ENGINE_VERSION` v2.2.0 | ✅ |
| CP-5 | the staged block (rendered nowhere) | ✅ |
| CP-6 | filings | ✅ |
| **Pause 2** | **the push decision — OPEN** | ⏳ |

---

## THE ANSWER TO THE SESSION'S QUESTION

| axis | attacks on chosen input | occurs in real proof | owns defects ALONE | verdict |
|---|---|---|---|---|
| `letter_not_spirit` | 260/280 = 92.9% | 3/71 | **0** | **DESCOPE** |
| `tense_modality` | 439/621 = 70.7% | **0/71** | **0** | **DESCOPE** |
| `wrong_subject` | 368/914 = 40.3% | 11/71 | **8** over 7 stores | **GUARD-WORTHY** |

Stable under **three independent readings** — strict, raw/unrefuted, and after an 85%
correction to the refutation step. `wrong_subject` **is** G-15's referent axis.

**v4.0 is licensed to build one guard, not three.**

---

## THE THREE FINDINGS THAT OUTLIVE THIS SESSION

1. **P-21 — a refuter is never verified, and the unverified side fails flattering.**
   Blind re-examination of all 71 kills: **41 of 48 defect-claim kills were wrong (85.4%)**,
   and control refuters were wrong MORE often (90.9%) than suspect ones (80.8%). The error
   rate is uniform; only the volume of killing varied. Every adjudicated figure this repo
   publishes is a soft floor — **including v3.8's 274**, which has never been re-examined.
2. **P-22 — the rendered quote can omit the term it proves.** The engine matches on full
   text and renders a quote truncated at ~180 chars. 2 of 69 quoted rows show a merchant a
   green row whose proof does not contain the claimed term.
3. **`letter_not_spirit` attacks best and is worth least.** 92.9% on chosen input, zero
   defects it alone would close. Capability and value are not the same axis.

---

## WHAT SHIPPED (all on `feat/v3-9-worth`, UNPUSHED)

| commit | what |
|---|---|
| `25a63b6` | CP-1A occurrence + CP-1B collisions executed |
| `916cded` | CP-2 — the G-14 standing gate, 104 cells |
| `b02bc8a` | CP-4 measured before designing |
| `fa520c9` | A/B baseline + the diff key that fabricated 26 regressions |
| `ffdead9` | CP-5 staged block |
| `f9b2bf6` | CP-1A/1B adjudicated |
| `8822d9f` | the re-examination correction |
| `efe691d` | CP-3 — acceptance suite 2.0 |
| *(this)* | CP-6 filings + report |

**Files a reviewer should read first:** `experiments/v3-9/REPORT.md`, then
`standards/__tests__/g14.table.test.ts` (the gate), then
`standards/acceptance/subject-tense/suite2.json` (the suite).

---

## GATES, ALL GREEN

```
npm test            1,039 tests · 963 pass · 0 fail · 76 skipped   (957 + 6)
npm run typecheck   clean
suite 1.0           hostile 4/37 · must-not-regress 19/19   (byte-frozen)
suite 2.0           hostile 0/8 · must-not-regress 17/17    (baseline, not a target)
G-14 gate           104 cells green · mutation-proved 7/7
suite 2.0 guards    mutation-proved 9/9
ENGINE_VERSION      v2.1.0 -> v2.2.0, tripwire fired first, hash re-pinned
standard hashes     all four frozen — no change under standards/coffee/
EXPECTED_OPEN_GAPS  60, unchanged, +0 per step with reasons
production          untouched
```

---

## PAUSE 2 — THE OPEN DECISION

**Push `feat/v3-9-worth` to `main`?** It carries one matcher change (`priceToUsd` fails
closed on the `.json` tier) and an `ENGINE_VERSION` bump to `v2.2.0`.

What the push costs and buys:
- **Costs:** the bump 409s every merchant's saved test. `contractVersion` moves for
  **nobody** (0 of 349 caps changed), so any 409 is unambiguously repair-drift.
- **Buys:** the engine stops stating `$0.00` for twelve garbage inputs, `$5.00` for a
  negative, `$15.00` for `1e5`. 5 frozen corpus cases closed outright and 6 more moved from
  a stated wrong number to a refusal.
- **Blast radius on real stores: zero.** 2,928/2,928 A/B rows identical.

**The second Pause 2 item: publish the capability × frequency block?**
`experiments/v3-9/CP5_STAGED_BLOCK.md`, rendered nowhere. **Default: DON'T** — the axes'
fates are now settled, but a v4.0 guard session is about to open on `wrong_subject`, and a
page describing an open class while a fix is mid-flight needs editing the moment it lands.

### If the answer is "push"

```bash
git checkout main && git merge --ff-only feat/v3-9-worth && git push origin main
```
Then, once Railway has built:
```bash
EXPECT_SHA=$(git rev-parse HEAD) node experiments/v3-7/verify_prod.mjs
EXPECT_SHA=$(git rev-parse HEAD) node experiments/v3-8/verify_sections.mjs
```
⚠️ Both probes refuse to run against a stale deploy, by design.

⚠️ **No published figure moves.** CP-4's rider-1 check confirmed none of the 11 surviving
general defects is this class, so the same-push re-measurement invariant does NOT fire and
no sidecar needs editing.

---

## FILED, NOT FIXED

- **P-21** — refuter verification asymmetry + the protocol change (sampled re-execution,
  blind gold cases, per-refuter rates published; explicitly NOT paired refuters).
- **P-22** — the truncated quote that omits its own proving term.
- **Re-examining v3.8's 55 refutedAway groups** under P-21's finding. Not done here.
- **The two term-list defects** the collision author found: `plant-based`/`unscented` are
  carried as SUPPORTING terms for `vegan`/`fragrance_free` and both equivalences are false.
  No matcher change reaches these.
- **The 17 unresolved kills** the re-examination could not reach. They stay dead, so every
  corrected count is a floor.
