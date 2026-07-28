# v3.9 CP-5 — THE CAPABILITY × FREQUENCY BLOCK. COMPLETE, PINNED, AND HELD.

> ⛔ **HELD AT PAUSE 2. Not published.** The render slot exists and is **dark** — publishing
> later is a flag flip (`STANDARDS_SHOW_CAPABILITY_BLOCK=1`), not a rebuild. The decision is
> to be re-presented **at the close of v4.0**.
>
> **Pinned to:** engine `v2.2.0` · commit recorded in `render.json` · measured 2026-07-28.

---

## WHY IT IS HELD — two reasons, and the second is the operative one

**1. It would need editing the moment v4.0 lands.** A v4.0 guard session is opening on
`wrong_subject`. A page describing an open defect class while the fix is mid-flight goes stale
on contact.

**2. THE `wrong_subject` ROW IS A BYPASS RECIPE FOR AN UNGUARDED WEAKNESS.** It states that a
named attack shape succeeds against the live matcher 40% of the time on chosen input, and
that 6–8 confirmed false passes exist on real stores right now. Published before the patch,
that is a working recipe for making this engine certify a claim about a product that does not
hold it — against a product whose entire purpose is to be the thing an agent trusts.

**Publication follows the patch or the pin, security-disclosure style.** This is the operative
reason, and it survives even if reason 1 goes away.

## ⚠️ AND SELECTIVE DISCLOSURE IS REJECTED, EXPLICITLY

A third option was on the table: publish the two DESCOPED rows now — they are settled and will
not change — and hold only the `wrong_subject` row.

**Rejected.** Publishing the flattering rows while withholding the row that describes a live
weakness is the exact pattern this product exists to oppose. The site's own posture is that a
measurement is published with its limits attached; a table showing two axes at *"attacks well,
occurs never"* and silently omitting the third would read as a clean bill of health and would
be one. **The block ships whole or not at all.**

---

## THE BLOCK, COMPLETE

### How often the questions we ask can be gamed, and how often that happens

We attack our own claim matcher with sentences written to break it. That measures
**capability** — what an adversary could do — and is deliberately not a measurement of what
merchants write. Beside each capability figure we publish how often the same shape occurs in
the sentences the engine actually renders as evidence on real stores.

| attack shape | succeeds on sentences written to defeat it | occurs in real evidence sentences | status |
|---|---|---|---|
| the term is present but not asserted of this product | **93%** (260/280) | **4%** (3/71) | closed by measurement |
| the term is asserted, but not of the present product state | **71%** (439/621) | **0%** (0/71) | closed by measurement |
| the term is asserted of something that is not this product | **40%** (368/914) | **16%** (11/71) | **open** |

**Denominators, because a percentage without one is not a measurement.** Capability is over
sentences we wrote. Occurrence is over the **71 passing claim rows** across **54 stores** in a
335-store sample, every one read individually. Occurrence is a **floor**: detector recall is
unmeasured, and adjudication found defects at nearly **4× the rate the detectors flagged**.

### Why two of the three are closed, and what closed them

Neither was closed by a fix. Both were closed by measuring that a guard would cost more than
it bought — the same arithmetic, and the same precedent, in both cases.

- **"present but not asserted"** attacks best of all three and owns **zero** defects that a
  guard for it alone would close. Every instance we confirmed is also an instance of the third
  shape, so the third shape's guard subsumes it. Its nearest real-copy pattern — a merchant
  inviting you to *ask* about a property rather than stating it — occurs **0 times in 3,349
  sentences across 335 stores**.
- **"not of the present state"** does not occur at all in the sentences we cite as proof: 0 of
  71, with all three detectors proven live (they fire 135 times across the wider corpus).
  Guarding it would put **13 true statements at risk for no measured gain.**

**The precedent, and it is ours.** We once carried a `country of origin` check. A narrowing
that closed every false pass in hand-built tests was measured against 5,322 real product
descriptions and found to cost **17 true statements for zero false passes gained**; the class
it closed had **zero instances** across all 5,322. We removed the check rather than ship it.
Descoping on measured frequency is how this engine is maintained, not an exception made once.

### What this table does and does not bound

It bounds the **shape's frequency**, not the error rate. A sentence carrying a shape is not
automatically a wrong answer. The published error bounds — **9.99%** on the coffee sample and
**7.53%** on the general one — remain the figures describing how often a row is wrong. This
table exists to explain why an attack succeeding nine times in ten is **not** an error rate.

---

## ⚠️ FOUR THINGS THIS BLOCK MUST NEVER BE ALLOWED TO SAY

1. **Not "the engine is 96% accurate on this axis."** Occurrence is not accuracy, and the
   complement of a floor is a ceiling — the flattering direction.
2. **Not a ratio between the two columns.** Different denominators, different populations, one
   adversarial by construction. The renderer already refuses ratios on overlapping intervals
   for this family of reason.
3. **Not "tense and modality are solved."** `0/71` says the shape does not occur in the
   sentences we cite on this sample. The capability column says the opposite about what would
   happen if it did, at 71%.
4. **Not "two of three classes are fixed."** Nothing was fixed. Two were **descoped on
   measured cost**, which is a different claim and a weaker one.

## Provenance — everything pinned, so publishing later fills in one fate

| field | value |
|---|---|
| engine version | **v2.2.0** |
| measured | **2026-07-28** |
| capability | `experiments/v3-8/out/g14_merged.json` — 779 groups, 274 confirmed, adjudicated + refuted |
| occurrence | `experiments/v3-9/out/axes.json` over v3.6 `freq/pass_rows.json` |
| detector liveness | `experiments/v3-9/out/liveness.json` — 21/21 reproduce v3.6's published counts |
| consequence | `experiments/v3-9/out/corrected.json` — adjudicated, refuted, blind-re-examined |
| descope precedent | the `origin` tombstone (`experiments/v2-8/FITNESS.md`) + v3.6's declined guards |

**The only field this block still needs is the third row's `status`**, which becomes
`closed by <fix>` or `pinned as a known limitation` when v4.0 settles. Everything else is
final.
