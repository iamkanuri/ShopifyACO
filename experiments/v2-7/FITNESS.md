# v2.7 — three cheap wins attempted, all three reverted, and why

**Date:** 2026-07-26 · **Branch:** `feat/v2-7-exit` · **Outcome: nothing engine-side shipped.**
**Production unchanged at `44fd4e0`** (engine `988eea1`). `EXPECTED_OPEN_GAPS` back to **31**.

## The headline

All three changes passed their own measurement and were then contradicted by an independent
adversarial pass. One of them — `origin` — I had measured at 100%/100% myself, on a set I chose.
The independent pass measured 23% recall.

**The exit criterion (CP5) was not reached.** That is not a verdict of "unfit"; it is that the
measurement was never taken. Reporting it as a pass would be the worst available outcome.

## What was built and what killed it

### CP1 — `dimensions` recall (5 gaps closed, then reverted)
Widened MEASUREMENT to accept a hyphen and an intervening `fl` (`12-oz`, `12 fl oz`), and added
`measures`, `ft`, `feet`, `foot`, `l`, `liter` to the term list. 19/19 on my own probe including
10 negative controls; corpus 31 → 26.

**196 independent probes found six false-pass mechanisms attributable to the change.** The
damage landed exactly where the brief warned: `l` and `ft` are letters before they are units.

> `"Only 2 L left in stock."` → **pass_evidenced**, quoting a stock message as a measurement.

Also: `ft.` as "featuring", `ft` in altitude copy, `feet` as a count ("4 rubber feet"), and the
hyphen rule fusing adjacent spec fields. The attacker's own control discipline reclassified two
of its findings as pre-existing rather than caused by this change — that is the discipline
working.

**What survived, measured:** all five recall fixes held and no canonical control regressed
(`"Ø 8 cm at the rim."`, `"Net wt. 8 oz."`, `"Weighs 1 lb 4 oz."`, `"20cm x 30cm"`, two-line spec
blocks). The hyphen change correctly refused every range, date and count thrown at it. **The
adjacency half of this fix looks sound; the vocabulary half does not.** A future attempt should
take the hyphen/`fl` change and leave `l` and `ft` alone.

### CP4 — `origin` head-noun test (1 gap closed, then reverted)
After a gazetteer place matched, a bare lowercase following word rejected the match, on the
theory that `"made in Georgia pine"` uses the place attributively.

**I measured specificity 32% → 100% and recall 63% → 100%.** An independent pass over 270 probes
measured **recall 23% (59 false fails), specificity 59%**.

Both my numbers were real *inside my own 40-sentence set* — which I partly assembled from cases I
already knew. That is the exact failure the corpus exists to prevent, committed by me, in the
session whose job was to avoid it. Every origin positive in my set and in the corpus either ended
its clause or was followed by one of five words already on the allow-list.

**56 of 59 false fails were causally isolated**: the identical sentence with a comma inserted
after the place passes, because the comma ends the clause so the head-noun test sees no follower.

The pair that explains the whole class:

```
"Made in Vermont studio."   -> not_proven
"Made in Vermont Studio."   -> pass_evidenced
```

It is a **case test on the following word**. It cannot separate `"Georgia pine"` (a material) from
`"Vermont studio"` (a facility) — both are place + lowercase noun — and it does not touch
`"Georgia Pine"`, which is the defect it was written to close.

Merchant-facing consequence: a store whose copy reads *"Made in Italy exclusively for us."* is
told **"Checked product copy — no stated country of origin."** That is a false statement about a
store we read perfectly well — the class the v2.3 `warranty` row was dropped for.

**`origin` is therefore deferred a fourth time, against the brief's instruction not to.** The
brief was right that deferring again is unsatisfying; it is still better than shipping a matcher
that deletes three-quarters of real origin statements. Of the brief's three options, the evidence
now points at **option 3 — remove `origin` from the shipped library** — because two attempts at
option 1 have produced 32% and 59% specificity respectively, and option 2 (structured-label forms
only) has never been measured. Either is a decision for a session that can measure it.

### CP2 — fronted-subordinator boundary (built, never measured)
Closed three false fails (`"Although we do not use plastic, the body is made from stainless
steel."` and siblings). The other four items the brief listed were measured and found **already
satisfied by v2.6's revert** — all eight negator words live, trailing adjuncts correct, `NEGATOR`
referenced twice and therefore live with an accurate comment (Rule 7 satisfied without a change).

**Its adversarial agent died on a session limit, so this change has no independent measurement at
all.** Rule 4 says no fix ships without one. It doesn't ship.

## The process failure worth carrying forward

The workflow returned `confirmed: 0, falsePassCount: 0`. **That was an artefact: all three
verifier agents failed on a session limit, so verification never ran.** Read carelessly it says
"no defects found" — the opposite of the truth, since the two attackers that did finish returned
24 candidate defects between them.

An aggregate that counts confirmations is silently wrong when the confirming step dies. Any
future harness must distinguish *"verified clean"* from *"verification did not run"*, and treat
the second as a blocker rather than a pass. This is the third distinct instance in four sessions
of a measurement that reads as clean because the instrument failed rather than because the code
is good — after the `xargs`-piped hygiene sweep and the silent `python -c`.

## Where this leaves the hardening phase

Gaps have gone 65 → 31 → 31 → 31. Three consecutive sessions have now had their headline change
reverted by the adversarial pass. That is the process working — none of those regressions reached
a merchant — but it is also the signal that **the remaining defects are not cheap wins.** The
ones left need constituency parsing (negation scope, aboutness), real gazetteer semantics
(origin), or a decision to drop a requirement rather than fix it.

**Recommendation for the next session, in order:**
1. Take **only** the `dimensions` adjacency fix (hyphen + `fl`), with `l`/`ft`/`feet`/`foot` left
   out. It closes 3 of the 5 recall gaps with no attributed false pass. Small, verifiable.
2. Decide `origin` by **removal or structured-label-only** — do not attempt a third head-noun rule.
3. Then run the fitness measurement (CP5) that this session did not reach, and let it decide the
   exit rather than any further matcher work.
