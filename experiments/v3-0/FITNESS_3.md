# v3.0 — THE BRIDGE. Fitness record and exit verdict.

## 0. The one-paragraph version

Four engine gaps closed, a published standard executed against real stores for the first
time, and the false-positive bound re-measured. On the 172-store general sample the exit
criterion is **met**: zero confirmed false positives across 506 pass rows, cluster-adjusted
95% upper bound **0.83%** against a ~1% target. **The verdict is still that hardening
continues**, and the reason is the most important thing this session learned: a
**category-scoped** sample of 25 coffee stores found **two** false positives that the
172-store general sample cannot see. The general-sample bound is a floor, not an estimate,
and meeting a criterion measured by an instrument that has just been shown to miss real
defects is not the same as being done.

---

## 1. What shipped

| CP | gap | outcome |
|---|---|---|
| CP0 | — | Standards merged. Contract did **not** drift. |
| CP1 | the `care` value guard | Closed the one v2.9 false positive. 0 regressions. |
| CP2 | G-08 | `delivery` lint pre-filter. One sentence could refuse a whole report. |
| CP3 | G-07 | `identifiers` resolves for a connected store. Proven on the dev store. |
| CP4 | G-09 | A standard can be executed against a public URL. |
| CP5 | — | Coffee Standard v1.0 run against 25 real stores. |
| CP6 | — | Bound re-measured; exit verdict below. |

---

## 2. CP0 — the merge protected nothing, which was the finding

The contract survived: `standards/compile.ts` imports the engine's real `Requirement` and
`ReqKind` and typechecks clean against v2.9's rewritten `productTest.ts` — 192 files, zero
errors, 59/59 standards tests green in 451ms, pure and offline.

But the stated point of merging — *"any engine change that breaks a standard is caught the
moment it is made"* — **was false**. `npm test` globbed `test/*.test.ts` only, so the 59
tests never ran; `npm run typecheck` includes `src/**/*.ts` only, so it saw zero standards
files. Both gates would have stayed green while every standard was broken.

Both are wired now, and the wiring is **proved rather than assumed**: renaming the engine's
exported `ReqKind` is accepted by root `tsc` (exit 0, no diagnostics) and caught by the
second half of `npm run typecheck` with the exact call site named.

---

## 3. CP1 — the guard, and what an independent pass actually established

**The fix.** `care` was the only attribute with no `valueGuard`. Exactly one of its terms —
`care instructions` — names the category without giving a member of it, and all three
recorded defects run through it: a pointer, a placeholder, and a warranty condition. The
guard is scoped to that term.

The guard **reads the whole sentence, not `matchedTerm`**, because `termMatches` sorts
longest-first: in *"Care instructions: machine wash cold."* the term handed to the guard is
the meta one, and a guard branching on it would have deleted a canonical true positive.

**The independent pass.** 4 attackers on distinct lenses, **1,145 probes**, 53 unique
claims, each re-executed by a **separate refuter**. First run returned `INCOMPLETE` with
`confirmedCount: null` — two refuters died mid-run — which is the CP0 completion primitive
doing exactly its job. Resumed from cache: `DEFECTS_FOUND`, 53/53 adjudicated, 27 confirmed.

**Attribution was decided mechanically, not by reading refuter prose.** A regex over
reasoning text is not evidence. `experiments/v3-0/attribute_ab.mjs` runs all 53 attacker
sentences through `b8a1fff^` (pre-guard) and `HEAD` and diffs:

```
regressions 0      closed 0      residual 35      pre-existing 18
```

**Zero status changes across all 53.** So the guard caused no regression, and none of the
18 false *fails* the attackers found are its doing — every one fails identically without
it. What the pass established is that the guard is **incomplete, not wrong**.

**The residual, pinned with its receipt.** `CARE_DIRECTIVE`'s `-ing`/`-s` inflections are
precisely the deverbal nouns English uses to *name* a topic rather than give an instruction,
so the guard can fire on the category name it exists to reject:
*"Washing and care instructions are on the label."* passes. An attacker measured **46 of 70**
pointer phrasings leaking this way.

**Deliberately not narrowed, on the v2.8 `origin` precedent.** The narrowing that closes it
costs real positives (*"Care instructions: we recommend hand washing."*) to close a class
with **zero occurrences across 8,046 real product descriptions plus every body in the
172-store capture** — 58,237 sentences, 12 carrying the meta term at all. Losing true
statements to fix something that does not occur is the exact trade v2.8 measured and refused.

> **The rule that earned its keep.** A comment claimed the bare sentence *"Store in a cool
> dry place away from sunlight."* still passes. It does not and never did — it carries no
> `CARE_TERMS` entry, so it is `not_proven` before the guard is reached. Writing the corpus
> case the comment owed is what killed the claim. That is CLAUDE.md's "a comment saying
> *must still pass* owes a corpus case in the same commit" working on its first outing.

> **And the mutation proof found a corpus hole, again.** The whole-sentence instructive read
> first measured **DECORATIVE** — every case written for it also passed via `CARE_DIRECTIVE`.
> It is not decorative: without it, `CARE_REFERENCE` fires first on *"Care instructions are
> printed on the tag: machine wash cold, tumble dry low."* and deletes a merchant's genuine
> instructions. Same shape as v2.4, where 4 of 12 guards read decorative for this reason.

**Mutation proof, refreshed.** 15/16 applied mutations load-bearing, **0 skipped**. Two
pre-existing measurement defects fixed, both silent no-ops of the `attr:warranty` kind: the
`dimensions` valueGuard anchor has been stale (**unmeasured, not proven**) since v2.9 renamed
it, and the `wholeWord` bounding anchor since `containsTerm` was folded into `termMatches`.
Both now measured, both load-bearing. The one remaining decorative guard (`isNegated` inside
`passesAboutness`) is a **pre-existing** corpus hole, recorded not fixed.

---

## 4. CP2 / CP3 / CP4 — the plumbing

**G-08** was reproduced before it was fixed: a coffee store whose shipping policy says
*"Delivery guaranteed within 3 business days"* had its **entire 10-row report refused**
(`errorKind: unreachable`), while the same store saying *"arrive within 3 business days"*
reported normally. Fail-closed per row now; the row is an honest `not_proven`, not a silent
pass. **Two corrections to `ENGINE_GAPS.md`:** `no_subscription` was **already fixed** by
v2.9's policy-surface work before the gap was written up — only `delivery` was exposed — and
the cited line numbers are from `96ceacd` and have moved.

**G-07** was proven on the **real dev store**, read-only, shop identity asserted from the
API's own answer first: 17/17 products moved off `requires_store_access`, and
`diffAssertions` scores 17 `resolved` / 0 `unchanged` (previously 0 / 17). ⚠️ **Honest
limit:** all 17 dev-store products carry **zero barcodes**, so the dev store proves the
*move* and not the `pass_evidenced` path; that is covered by unit tests with a real GTIN-13
plus placeholder, all-zeros and bad-check-digit rejections.

**G-09**, the gap that made the others academic, plus one hazard the brief did not name: the
result cache is keyed on the normalised URL alone, so a standard-pinned result would have
been served to the public funnel for the same product. Pinned runs now bypass the cache in
both directions. The four decisions the brief asked to be stated are in the commit message
and pinned by tests.

---

## 5. CP6 — the bound

**172 stores · 506 pass rows · the v2.9 audit inherited plus a targeted re-audit.**

Constructed honestly rather than flatteringly: v2.9 audited all 507 rows from these same
snapshots individually and cleared 506. v3.0 changed **exactly one row** across all 172
stores (the false positive, closed) with **0 quote changes and 0 rows lost**, so those 506
are byte-identical and their audit carries over. On top of that, every text-evidenced row was
re-screened for the two shapes CP5 newly proved defective.

> ⚠️ **The first version of that screen flagged 3 rows and all 3 were its own artefacts** —
> `\bbusiness day\b` does not match "business days" (the trailing `s` blocks the word
> boundary), and a bare `recipe` matched the brand name *"Glow Recipe"*. A keyword filter over
> prose is exactly the instrument this project distrusts, and it failed in the direction that
> manufactures findings. Corrected; **0 of 113 text rows flagged**.

```
stores (clusters)          172        stores with >=1 pass  169
pass rows (trials)         506        rows per store        2.99
  structural               393        (numbers/enums; cannot carry a prose false pass)
  text-evidenced           113
confirmed false positives    0

naive 95% upper bound              0.59%   (rule of three — assumes independent rows)
cluster-adjusted, ICC 0.1          0.71%
cluster-adjusted, ICC 0.2          0.83%   <- the honest headline
cluster-adjusted, ICC 0.3          0.95%
per-STORE upper bound              1.78%   (the unit a merchant experiences)
```

### Depth, against the discovered-sample baseline (median 3 / thin 7.6%)

| metric | v2.9 shipped (n=172) | v3.0 final (same 172) |
|---|---|---|
| median genuine findings | 3 | **3** |
| thin rate (≤1 finding) | 7.6% | **7.0%** |
| distinct failing sets | 56 | **57** |
| `requires_store_access` | 4.4% | **4.4%** |
| near-empty results | 0 | **0** |

No depth was traded for the false-positive fix. The thin rate improves by one store because
closing a false *pass* converts it into a genuine finding.

---

## 6. THE EXIT VERDICT

### Hardening continues — and for a better reason than last time.

The stated criterion: *zero false positives with a cluster-adjusted bound at or below ~1%
ends hardening.* On the general sample **both halves are met** — 0 confirmed false positives,
0.83% cluster-adjusted. This is the first time that has happened.

**It should not be called done, and the reason is a measurement, not caution.** In the same
session, **25 coffee stores produced 2 confirmed false positives** in 43 pass rows. Neither
shape appears anywhere in the 172-store general sample. The two samples are not measuring the
same thing:

- The general sample is **broad and shallow** — one arbitrary product from each of 172
  stores across ~40 categories. It is excellent at finding defects that fire on *any* copy.
- A category sample is **narrow and deep** — 25 stores that all sell the same thing, write
  with the same conventions, and therefore all reach for the same phrasings. It finds defects
  that fire on *one category's* copy, which the general sample dilutes to invisibility.

**So the ~1% general-sample bound is a floor.** v2.8 already recorded the lesson in the
weaker form — *"zero across 55 rows was a statement about sample size"* — and this is the
sharper version: **zero across 506 rows of a broad sample is a statement about sample
shape.**

### What is next, in order

1. **Fix the two CP5 false positives**, each with its own independent adversarial pass. Both
   are pinned in the corpus with minimal pairs. `delivery` needs a value guard — it is the
   last digit-bearing requirement without one.
2. **Re-measure on 2–3 more category samples** (25–30 stores each) before claiming a bound.
   The prediction this makes, which a future session should test: *each new category sample
   will surface 1–3 defects the general sample missed, and the rate will fall as the
   category-specific term lists get hardened.* If a category sample comes back clean, that
   is the first real evidence the engine is category-robust.
3. **Build G-10.** `STANDARD_RUN_1.md §1` — without applicability gating, a category-scoped
   standard's measured discrimination is dominated by off-category products.
4. Only then re-open the exit question.

### The number to quote

**0 confirmed false positives in 506 pass rows across 172 stores; cluster-adjusted 95% upper
bound 0.83%** — and always with the qualifier that a 25-store category sample run in the same
session found two defects this measurement cannot see.
