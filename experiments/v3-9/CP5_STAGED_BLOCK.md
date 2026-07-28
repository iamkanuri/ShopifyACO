# v3.9 CP-5 — STAGED, NOT PUBLISHED

> ⛔ **THIS IS RENDERED NOWHERE.** No route serves it, no test asserts it, no artifact
> contains it. It exists so that the publish/don't-publish decision is made on a real
> draft rather than on an intention. **The Pause 2 default is DON'T.**
>
> **Why the default is don't:** the axes' fates are not settled. Publishing a block that
> describes an open defect class while a fix session is mid-flight advertises a hole we are
> in the middle of closing, and the page would then need editing the moment v4.0 lands. It
> waits until guard-vs-descope is decided per axis.

---

## The reason this block cannot be G-14's raw table alone

G-14's table says `letter_not_spirit` succeeds on **260 of 280** chosen sentences. Printed
without a second number that reads as *"92.9% of this engine's claim rows are wrong"*,
which is false by two orders of magnitude and is the single most damaging misreading
available. The 280 sentences were **written to break it**. They are not merchant copy, and
nothing about their success rate is a statement about merchants.

The honest form needs both halves in one sentence:

> *This attack class succeeds on X% of sentences written to defeat it, and its shape occurs
> in Y% of the sentences we actually cite as proof on real stores — so real-world exposure
> is bounded by Z.*

---

## The draft

### How often the questions we ask can be gamed, and how often that happens

We attack our own claim matcher with sentences written to break it. That measures
**capability** — what an adversary could do — and it is deliberately not a measurement of
what merchants write. Beside each capability figure we publish how often the same shape
occurs in the sentences the engine actually renders as evidence on real stores.

| attack shape | succeeds on sentences written to defeat it | occurs in real evidence sentences |
|---|---|---|
| the term is present but not asserted of this product | 93% (260/280) | **4%** (3/71) |
| the term is asserted, but not of the present product state | 71% (439/621) | **0%** (0/71) |
| the term is asserted of something that is not this product | 40% (368/914) | **16%** (11/71) |

**Denominators, because a percentage without one is not a measurement.** Capability is over
sentences we wrote. Occurrence is over the **71 passing claim rows** across **54 stores**
in a 335-store sample — every one read individually. Occurrence is a **floor**: the
detectors' recall is unmeasured outside their own control set.

**What this does and does not bound.** It bounds the *shape*'s frequency, not the defect
rate. A sentence carrying the shape is not automatically a wrong answer, and the published
error bounds — 9.99% coffee, 7.53% general — remain the figures that describe how often a
row is wrong. This table explains why an attack that succeeds nine times in ten is not an
error rate.

---

## ⚠️ Three things this draft must not be allowed to say

1. **Not "the engine is 96% accurate on this axis."** Occurrence is not accuracy, and the
   complement of a floor is a ceiling, which is the flattering direction.
2. **Not a comparison between the two columns as though they measure one thing.** They have
   different denominators, different populations, and one is adversarial by construction. A
   ratio between them is meaningless, and the renderer already refuses to draw ratios on
   overlapping intervals for exactly this family of reason.
3. **Not "tense and modality are solved."** `0/71` says the shape does not occur in the
   sentences we cite on this sample. It does not say the matcher would answer correctly if
   it did — the capability column says the opposite, at 71%.

## Provenance, if it is ever published

Capability: `experiments/v3-8/out/g14_merged.json`, 779 groups, 274 confirmed, adjudicated
and refuted. Occurrence: `experiments/v3-9/out/axes.json` over v3.6's `freq/pass_rows.json`,
with all 21 detectors reproducing v3.6's published counts 21/21
(`experiments/v3-9/out/liveness.json`). Both pinned to `3dbef7c`.
