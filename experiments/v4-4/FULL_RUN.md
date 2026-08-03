# v4.4 — THE FULL-CORPUS RUN, AND THE DECISION

User go given after the pilot. `PILOT_N=338 MEASURE_OUT=full.jsonl npx tsx
experiments/v4-4/tier_measure.ts`. Spend **$0.38758**, against $0.50 projected.

Continues `REPORT.md`. Read that first for §1, §2 and the pilot.

---

## ⚠️ FIRST, AN INSTRUMENT DEFECT IN MY OWN SELECTOR, FOUND BY READING THE OUTPUT

`pick()` selects by stride with `(i * step) % arr.length`. Asked for 338 from corpora of 100
and 172, **it wraps and re-picks**: 338 rows written over **269 distinct hosts**, 67 hosts
appearing more than once, one of them three times. "338 stores evaluated" was false, and it
was false in the flattering direction — a bigger n.

Re-derived on distinct hosts (first occurrence per host), the **rates barely move** and the
**counts do**, which is exactly what perfectly-correlated duplicates predict — P-16's rule
again, this time inside my own harness rather than in the corpus:

| | 338 picks | **269 distinct hosts** |
|---|---|---|
| stores where the tier ran | 174 | **114** |
| claim rows asked | 257 | **163** |
| grants, run B / run C | 76 / 80 | **49 / 53** |
| stores whose MODEL OUTPUT varied | 26.4% | **27.2%** |
| stores whose MERCHANT-VISIBLE ROW varied | 16.1% | **15.8%** |
| claim rows flipping B vs C | 10.9% | **11.0%** |

**Every rate below is the deduped one.** No published bound is touched by any of this — but a
count stated as "338 stores" would have been wrong in a report.

---

## THE CANARY FIRED, AND ITS FAILURE IS THE FINDING

```
completion: INCOMPLETE
  reason: the seeded klatchcoffee.com grant did not reappear
```

It did not reappear **in run B**. It appeared **in run C** — the same capture, the same
commit, minutes apart:

```
klatchcoffee.com   B  {granted:0, vetoed:0, discarded:1}
                   C  {granted:1, vetoed:0, discarded:0}
                   flip: not_proven -> pass_evidenced   "Single-origin"
```

Canary 1's premise — *the seeded grant is a stable property of that capture* — is itself
false, and the run **proves** that rather than merely failing on it. This is v4.3's
boot-to-boot 5-proven / 6-proven incident, reproduced at corpus scale and on demand.

**The run is DECISIVE for variance and INCOMPLETE for any single-run precision rate**, because
a precision figure computed over run B's grant set is a figure about that run, not about the
tier. The completion status is left as `INCOMPLETE` rather than reasoned away: the harness
asserted something that turned out not to hold, and that is the result.

---

## THE VARIANCE MEASUREMENT — the number this session was missing

| | |
|---|---|
| distinct stores where the tier ran | 114 |
| claim rows asked | 163 |
| **claim rows answering DIFFERENTLY on two identical runs** | **18 — 11.0%** |
| stores whose model output differed | 31 of 114 — **27.2%** |
| stores where a merchant would see a different row | 18 of 114 — **15.8%** |

Direction, over the 338-pick run: **14 `not_proven -> pass_evidenced`, 9
`pass_evidenced -> not_proven`, 5 quote-only.** The quote-only flips are rows a status diff, a
pass count, and a merchant reading a green row all see as identical — v3.5's rule earning
itself again, and the reason every comparison here is over `(status, detail, quote, surface)`.

**Of every promotion the tier ever made, 36 of 53 reproduced — 67.9%. Nearly a third of its
grants do not survive being asked the same question twice.** `klatchcoffee.com` is one of the
seventeen that did not; the full list is in `promotions.json`.

---

## PRECISION, ON THE STABLE SET ONLY

Adjudicating run B's set would adjudicate one sample of a distribution, so precision is read
over the **36 promotions that reproduced in both runs**, each against its store's evidence.

**70 of 71 promotions across the whole corpus are on ONE requirement — `Single-origin`** (the
71st is `Organic`). The tier's entire real-world footprint is a single claim key, which is
worth knowing before anyone weighs its recall against its cost.

Most are genuine recall the lexical pass cannot reach, and no term list would:

- `getprodigal.com` — *"Nensebo G1 is special because it traces back to just one farm in West Arsi."*
- `rabbitholeroasters.com` — *"Farm: La Torre ( 2 hectares ) Farmer(s): Marleny Imbachi"*
- `bluebeardcoffee.com` — *"Mandomashe is a farmer group in the southern highlands of Tanzania, Mbozi district, serving four producer villages…"*
- `tinyarms.co` — a product **title** reading *"Honduras Finca El Jardin"*
- `dancinggoats.com` — copy explicitly distinguishing 100% Kona from a 10% Kona blend

This is the paraphrase problem the tier exists for, and it is real. §0 was right that opening
by killing it would have repeated the `origin` mistake in reverse.

The clear false passes are a minority and share one shape — **a sentence about a place that is
not a statement about this product**:

| store | granted on | why it is wrong |
|---|---|---|
| `blackbeardroasters.com` | *"The Yirgacheffe region is located in the southern part of Ethiopia."* | a geography fact |
| `highrisecoffeeroasters.com` | *"Fresh Coffee whole sale and retail single origins and blends."* | a **store-level page description** that names blends in the same breath |
| `myalmacoffee.com` | *"a celebration of coffee's birthplace: Ethiopia, where generations of farmers have cultivated unique heirloom varietals…"* | lyrical brand copy |
| `www.dogwoodcoffee.com` | *"This Wush Wush Natural stands out as an exceptionally unique … variety…"* | about a **variety**, not an origin |

⚠️ **This is the same class as the three production false passes, and the same class the
coffee sample already carries** — *"`single-origin` inside a sentence describing a BLEND — a
class no guard addresses"*. The tier does not close that class; it manufactures new instances
of it.

⚠️ **The adjudication above is mine, by reading each quote against the entry's question.** It
is not an independent pass, and this repo's own rule is that the gate is an adversarial pass
by someone who did not write the change. It is enough to establish that precision is neither
~0 nor ~1. **It is not enough to publish a precision rate, and none is published.**

---

## ⚠️ `semantic.granted` OVERCOUNTS WHAT A MERCHANT SEES

Run B recorded **76** grants in its stats and produced **60** row changes. `judgeClaims` sets
`stats.granted = grants.length`; `applySemanticTier` then drops any grant whose attribute is
not in `unresolved` (`if (!target) continue`), so a grant landing on an already-passing row is
counted and changes nothing.

**The direction is safe.** The v4.4 disclosure detector keys on `granted > 0`, so it
over-flags rather than under-flags a stored result, and it reports unnamed rows honestly
instead of inventing one. Filed rather than fixed — but it means "4 affected production
results" is a **ceiling** on merchant-visible damage, not a floor.

---

# §4 — THE DECISION

**Outcome 1 is falsified.** The tier grants on ~30% of claim rows asked. It is not inert.

**Outcome 2 is refused at its own sub-clause (b), which was written for exactly this.**

> *"Nonzero variance means: harden to determinism (pinned model, temperature 0, re-verify
> variance ≈ 0) or keep it out of the public path regardless of precision and record why.
> 'Precise but unstable' does not ship."*

Variance is **11.0% of claim rows asked** and **15.8% of stores**. Precision on the stable set
is decent. **It does not matter**: the tier stays out of the public path, which is where v4.4
already put it for the independent durability reason.

The determinism route is available and its first step is already identified — §1.4, the module
claims `temperature 0` and sets none. Hardening is a change and this session measures, so it
is filed as the precondition for any future return, **with variance to be re-verified at ≈0
rather than assumed from the parameter being present**. Setting a parameter and declaring the
problem solved is the same move as writing the rule in a comment.

**The bounds do not move, and no sidecar note is written.** 9.99% (coffee) and 5.17% (general)
were measured tier-off; as of v4.4 both public routes run tier-off. **The harness setting and
the deployed configuration now agree** — a stronger position than any sidecar note would have
described. Outcome 2's "re-measure the bounds WITH it" is moot: the tier is not in the path the
bounds describe, and re-measuring against a component that answers differently 11% of the time
would produce a bound with no reproducible value.

**What the tier gets instead of deletion:** it stays in the tree, unreferenced by any public
route, with `ENGINE_GAPS` P-29 recording that it buys real recall on a real problem and cannot
be trusted to buy it twice. §0's `origin` precedent is respected in both directions — nothing
was deleted on a hunch, and nothing was kept on one either.
