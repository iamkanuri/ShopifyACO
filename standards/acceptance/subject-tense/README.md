# SUBJECT & TENSE — the acceptance target

**The sentences no term list can close, turned into a pass/fail target for a future engine
session.**

This directory is a **specification**, not a description. It says what the engine *should* do.
It does not say what the engine *does*, except in one clearly-labelled observation block below.

---

## 0. Why this exists

Four independent attackers threw 40 hostile sentences at a worked vocabulary
(`coffee/v1.0/vocabulary/decaf-method.json`). Narrowing the term list closed **every class a
term list can close** — adjacent vocabulary 7/7, denial 5/5 — and **zero** of the rest:

> `"Our Ethiopian decaf uses the Swiss Water Process."` — a sibling product
> `"Until 2024 we used the Swiss Water Process."` — past tense
> `"Blue Bottle's decaf is decaffeinated with methylene chloride."` — a competitor
> `"The gift set that goes with this bag contains a Swiss Water decaf."` — a bundled item

Closing the claim dictionary is **necessary and not sufficient**. The binding constraint is the
engine's subject and tense handling, and that constraint is **category-blind**: it applies to
every claim in every category the standard will ever cover. Which is why this suite is worth
more than another category would have been.

---

## 1. What is here

| file | what it is |
|---|---|
| [`suite.json`](suite.json) | the machine-readable form: 56 cases, stratified, each with the outcome the engine **should** produce and why |
| [`run.ts`](run.ts) | the runner. Reports **per stratum**, never as a single number, and resolves to a completion state |
| this file | what the suite measures, what it does not, and the one observation |

```bash
node --import tsx standards/acceptance/subject-tense/run.ts
```

Exit `0` every case met its expectation · `1` defects · `2` **the run did not complete**, which
is not a small number of defects. `failedCount` is `number | null` and is `null` on incomplete —
the rule from `src/measure/completion.ts`, applied here because a suite that could not run must
never render like a suite that passed.

---

## 2. Both directions, and this is the half that makes it honest

**37 hostile cases** across 15 strata — sibling product, packaging, shipment, bundled item,
competitor, industry-generic, review quote, site-wide, subscription, cross-sell, comparative,
past tense, future/conditional, modal, enquiry/evaluation.

**19 must-not-regress cases** across 6 strata. A fix is judged on **both directions or it will
ship the way v2.6 shipped**: v2.6 built a full negation-scope rewrite, measured 16/16 denials and
12/12 truths on its own set, and an independent pass then measured it as a **net regression** — 7
false passes v2.5 caught and it did not, plus 46 false fails.

The guard half contains two things a one-directional suite would miss:

- **`temporal_but_current`** — `"This decaf still uses the Swiss Water Process, as it always
  has."` and `"We have used the Swiss Water Process since 2019."` Both carry past-tense
  vocabulary and both are current claims. A rule keyed on `used` + a year refuses these *and*
  refuses `pst-01`, and cannot tell them apart.
- **`already_refused`** — four hostile shapes the engine closes **today** (negation, the review
  veto, `no longer`, interrogatives). A fix that closes the new classes by unwiring an old guard
  has traded one class for another, and only these cases can see it.

Three pairs are deliberately near-identical across the two directions, because the whole
difficulty lives in the difference:

| must pass | must be refused |
|---|---|
| `We use the Swiss Water Process for every lot we sell.` | `All of our decafs use the Swiss Water Process.` |
| `Every bag we sell is a Swiss Water Decaf.` | `Every decaf we stock is a Mountain Water Decaf.` |
| `This lot went through the Swiss Water Process before roasting.` | `Until 2024 we used the Swiss Water Process for this lot.` |

**If a fix cannot separate those, it has not solved the problem — it has moved it.**

---

## 3. ⚠️ THIS SUITE MEASURES CAPABILITY, NOT VALUE

Stated here, in `suite.json`, and printed by the runner on every green run, because it is the
thing most likely to be skipped.

**Not one sentence here has been measured against real merchant copy.** A fix that passes every
case has been shown to be **possible**, not shown to be **worth shipping**.

The precedent is the `origin` tombstone, and it is unambiguous. A narrowing that closed every
false pass in hand-built sets was measured against **5,322 real product descriptions**: it cost
**17 true statements for 0 false passes gained**, and the class it closed had **zero instances**
across all 5,322 products. The term was removed. A hand-built set could not have arbitrated
that — and this is a hand-built set.

So before any fix derived from this suite ships, a **natural-frequency read** is required, in
both directions:

1. how often does each hostile stratum actually occur in real product copy? A stratum with no
   natural instances is not worth a guard, however satisfying the guard is;
2. how many **true** statements does the fix cost per false pass it closes?

**A green run here is a licence to measure, never a licence to ship.**

Two further limits, recorded rather than left to be discovered:

- The strata are **not equally weighted and the suite does not weight them**, because weighting
  without frequency data would be inventing the very number the caveat says is missing.
- `sit-02` (`"Every decaf we stock is a Mountain Water Decaf."`) is the **weakest hostile case
  in the suite** — a true universal entails the claim about this unit. It is kept, marked, and
  left for the adjudicator, because deleting the inconvenient case is how a suite becomes
  flattering.

---

## 4. This directory deliberately does NOT design the solution

No parser recommendation, no heuristic sketch, no term list. The precedent is v2.6 again: a
plausible design measured **worse** than the naive code it replaced. The next session gets a
target it can measure against and chooses its own approach.

Two things it will want, and neither is a design:

- `CLAUSE_BOUNDARY` is a known open defect serving two incompatible jobs (`CLAUDE.md`), and
  several strata here sit on top of it. That is context, not a recommendation.
- The engine's `nonProductSubject` already **fails open** on an unrecognised subject **by
  design**, because vetoing on "unknown" would suppress the subject-less copy that fills a
  Shopify description. The `spec_block` and `trade_form` guard strata exist to keep that
  property honest: **eleven of the nineteen must-not-regress cases have no readable subject at
  all.** Any rule that requires one fails them.

---

## 5. OBSERVATION — not an expectation

Recorded at commit **`e9ec942`**, on this worktree, which is pinned. A concurrent session is
changing `src/`, so **this is a snapshot of one commit and not a claim about the engine
generally.** It is here for contrast, so a future session can see the target is real and can
tell movement from noise.

```
DEFECTS FOUND — 33 of 56 cases did not meet their EXPECTED outcome.
                hostile 4/37, must-not-regress 19/19.
```

| direction | stratum | met / total at `e9ec942` |
|---|---|---|
| hostile | packaging | 2 / 3 |
| hostile | shipment | 1 / 2 |
| hostile | bundled_item | 1 / 3 |
| hostile | sibling_product · competitor · industry_generic · review_quote · site_wide · subscription · cross_sell · comparative · past_tense · future_conditional · modal · enquiry_evaluation | **0** of 2–4 each |
| must_not_regress | plain_present · spec_block · first_person · trade_form · temporal_but_current · already_refused | **19 / 19** |

Three things this snapshot says, and one it does not:

- **The four hostile cases that already pass are all closed by an existing guard**, not by luck:
  two by the packaging/subject rules, one by the shipment subject, one by `kit includes` in the
  related-product veto. They are in the hostile set on purpose — a stratum with no already-closed
  member cannot show a future fix *unwiring* one.
- **The guard half is 19/19 today.** That is what makes it useful: every future regression is
  visible against a clean baseline rather than against an already-mixed one.
- **`hostile 4/37` is the size of the gap**, and it is consistent with the decaf review's finding
  that narrowing closed zero of this class.
- It does **not** say the engine is bad at 33 things. It says this suite contains 33 sentences
  the engine gets wrong, chosen because they are hard. That is what a target is.

---

## 6. The pinned term list, and the tripwire on it

`suite.terms.support` is **pinned in this file rather than loaded from a vocabulary**, and that
is deliberate. Subject and tense handling is a property of the **engine**. If the suite loaded
`decaf-method.json`, a future narrowing of that vocabulary would silently change what the suite
measures, and a fix could appear to pass because a *term* moved.

Seven terms, covering all four term shapes the attack templatizer distinguishes, with the source
vocabulary and its content hash recorded. `standards/__tests__/acceptance.test.ts` asserts every
pinned term is still a supporting term in that source.

> **If that assertion ever fails, the vocabulary was narrowed and this suite must be
> RE-DERIVED. It is not a licence to edit the assertion.**
