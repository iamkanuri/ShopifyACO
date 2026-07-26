# v2.8 — the fitness measurement, and the end of a phase

**Date:** 2026-07-26 · **Branch:** `feat/v2-8-fitness` → merged to `main` · **Production: `651af64`**
**Suite:** 557/557 with all three gates, 0 skipped · **`EXPECTED_OPEN_GAPS` 31 → 31** · **Measured cost: $0.06**

De-identified: stores are named by category and index, never by domain.

---

## 0. The one-paragraph version

Three changes were built. **One shipped** (`fl` adjacency), **one was withdrawn mid-session**
after an independent pass found 183 false passes in it (the hyphen branch), and **one requirement
was deleted from the product** (`origin`). The exit measurement ran over 35 real Shopify stores
across 24 categories. The headline number and the verdict are in §5–§6.

The most reusable output is not any of those. It is `src/measure/completion.ts`: every measurement
in this repo now resolves to `VERIFIED_CLEAN`, `DEFECTS_FOUND` or **`INCOMPLETE`**, and an
incomplete run reports `confirmedCount: null` rather than `0`. It justified itself within the hour.

---

## 1. CP0 — making "didn't run" impossible to read as "clean"

Three times in four sessions an instrument in this project failed in the flattering direction, and
each time the failure was arithmetically identical to a clean result: a workflow returned
`confirmed: 0` because its verifiers had died holding 24 candidates; an `xargs`-piped sweep reported
CLEAN over a real leak; `python -c` emitted nothing and exited 0.

`aggregate()` forces `INCOMPLETE` on any of: a unit that did not return; candidates no verifier
adjudicated; attackers scheduled with no verifier behind them; nothing scheduled at all; or
`confirmed > adjudicated`. A dead verifier makes even a `DEFECTS_FOUND` run non-decisive, because a
partial verification reports a floor of unknown depth. `sweepAggregate()` applies the same rule to
file sweeps. 15 tests, each a real prior-session failure replayed as the numbers that harness
actually reported.

**It paid for itself three times in this session alone:**

1. **Two attacker agents died** mid-run on API errors. Under the old reading their absence would
   have contributed zeros to a defect count. They were resumed; both later returned findings that
   changed what shipped.
2. **My own dev-machine probe was failing open on `robots.txt`.** It defaulted `allow = true` when
   the policy could not be read — and 3 of the first 3 hosts returned 429 on `robots.txt`, so it
   would have fetched three stores whose policy it never saw, printing a line indistinguishable
   from a permitted read.
3. The hygiene sweep now distinguishes "swept 358/358 files, 0 unreadable" from "the sweep did not
   complete". v2.4's version silently `continue`d past an unreadable file.

---

## 2. CP1 — `fl` adjacency shipped; the hyphen branch withdrawn

### What shipped

`MEASUREMENT` now tolerates an intervening `fl` between number and unit, so `12 fl oz` reads as a
measurement. **1 of 5 pinned recall gaps closes — not the 3 the brief predicted.** (`12-oz` needed
the hyphen branch, which was withdrawn; `6 ft` and `2 L` need `ft`/`l` in the term vocabulary, which
stays deliberately closed after v2.7 measured six false-pass mechanisms from exactly that.)

### What was withdrawn, and why it matters more

I built the hyphen branch the brief asked for. My own 1,274-probe set scored it clean: controls
unchanged, negatives 76/76, hyphen recall 10% → 90%. Three independent attackers then ran 2,096
probes plus a 3.5-million-string regex differential and found **183 new false passes, 0
pre-existing**. Two of them broke my reasoning rather than merely my code:

**`"Midi length, 3 flounces, side pockets."` → `pass_evidenced`.** The `FL` group had no word
boundary, so `\d+\s?fl` + `ounces?` matched *inside* `flounce` — and `flinch` via `fl`+`inch`.
`flounce` is routine apparel copy. I had argued this half was **provably** safe, citing a
differential proving it only widens strings containing `fl`. That proof is correct. It also includes
"flounce". The proof was right and my inference from it was wrong.

**`"Case dimensions match every 4-G and Wi-Fi tablet."` → `pass_evidenced`.** My code comment
claimed `l`/`ft`/`g` were safe inside `MEASUREMENT` because "a term must match first". True of the
**term**, false of the **location**: `MEASUREMENT` is tested against the *whole sentence*, so the
matched term and the matched measurement need not be the same span. This is the shape the corpus
already pinned as `"Lightweight frame, 5 ft of reach."` — I had the counter-example in front of me
and wrote the wrong general rule anyway.

Two more, both from the hyphen branch: an all-caps style code whose unit ends the token
(`"Style 16-OZ is the black colourway."`) slipped both guards and **displaced the evidence quote** —
given a colourway sentence followed by a real weight, the row still passed but quoted the colourway;
and a thousands separator satisfied the lookbehind, so `"A 1,200-lb rated ceiling hook."` matched on
`200-lb`.

The guards could not be tightened without also refusing `"A 12-inch-tall vase"`, the commonest
compound-adjective form of a real dimension. So the branch was removed and `12-oz` is pinned open
with the full mechanism recorded.

**After narrowing, re-run on all three independently-written sets: 0 new false passes, 0 regressions,
15 recall gains.** The mutation proof confirms the new `\b` is load-bearing against exactly the
`flounce` case.

---

## 3. CP2 — `origin` removed from the shipped library

Deferred four times. This is a decision.

Two independent measurers wrote their own sets; a third agent was instructed to **refute** the first.
One measurer built its sets from a natural-frequency read of **5,322 real product descriptions**
pulled from 20 live Shopify stores.

| set | shipped recall | shipped specificity | narrowed recall | narrowed specificity |
|---|---|---|---|---|
| A | 76.1% (105/138) | 88.8% (119/134) | 63.8% (88/138) | 94.0% (126/134) |
| B | 73.8% (104/141) | 95.4% (124/130) | 50.4% (71/141) | **100.0%** (130/130) |
| V (verifier) | 29.7% (30/101) | 14.9% (14/94) | 5.0% (5/101) | **17.0%** (16/94) |

### The fixed rule did not discriminate

The rule set in advance — *keep iff specificity ≥95% **and** recall ≥40%* — produced a split verdict
(94.0% fails, 100.0% passes). **Three independently-written negative sets scored the same matcher at
100.0%, 94.0% and 17.0%.** That spread is not noise about the code; it is a property of the set
author. Set V's negatives were deliberately written *inside the accept envelope* (accepted frame +
gazetteer place + legal terminator, where the place simply isn't this product's), which is the
worst case; set A's were 73.1% structurally incapable of false-passing a place-gated matcher at all.

A rule whose output moves 83 points on set composition cannot arbitrate. Recording that is more
useful than picking whichever number suited me.

### What actually decided it

**The narrowing must not ship.** On 369 naturally-occurring origin sentences held out from the
hand-built sets, it is **17 true statements lost, 0 false passes gained**. The single class it
closes — a gazetteer word in its ordinary sense (`Georgia pine`, `Turkey red`, `Jordan almonds`) —
has **zero observed instances across all 5,322 real products**. It makes the product wrong more
often, to fix something that does not occur in the field.

**And the shipped form could not stay,** because it is wrong in the other direction at scale. All of
these return *"no stated country of origin"* against copy that plainly states one, in **both** forms:

```
"Made in the U.S.A."        the clause splitter cuts on the abbreviation's own dots
"Handcrafted in Nepal."     "Grown in Panama."   "Milled in Japan."   (frames)
"Made in Los Angeles."      "Made in Barcelona."  (the gazetteer holds no cities)
"Origin — Italy"            (only `:` was accepted as a label separator)
```

Telling a merchant whose page says *"Handcrafted in Nepal."* that they publish no origin is a false
statement about a store we read perfectly well. That is precisely the class the `warranty`
requirement was dropped for in v2.3.

The verifier then found three false-pass mechanisms **neither measurer probed**:

- **`origin:` matched as a substring — 15/15 false-passed.** `Shipping origin: Germany`,
  `Design origin: Denmark`, `Fabric origin: Italy`. This is the shipping-origin-vs-manufacturing-origin
  confusion, created by the narrowed rule's own term.
- **`made` as an ordinary verb — 12/12.** `The decision was made in Washington, and it changed our
  supply chain.` `A donation is made in Kenya for every order placed.`
- **Temporal — 8/8.** `Until 2019 this style was made in Germany; production has since moved.`

And it cost little to lose: in the v2.3 production sample the row appeared in **11 of 17 stores** and
returned `not_proven` in **10 of those 11** — the documented 0.91 fail rate. A row that is wrong in
both directions and uninformative in 91% of cases does not earn a label asserting a fact about a
merchant's store. **Losing one row of depth costs less than one false statement.**

### The measured path back

The two halves of the narrowing are separable and only one did any work. The **terminator** rule
closed every false pass; the **frame** narrowing closed none and caused 32 of 33 lost positives.
Shipped frames + terminator projects to 73.0% recall at 100% specificity — **a projection, never
measured, and it must be measured before it is believed.** Three pre-existing mechanical bugs are
cheaper and should come first: protect dotted abbreviations before the clause split; the gazetteer
has no cities while `AMBIGUOUS_PLACE` listed `sydney`, `columbia`, `victoria`, `jersey` and `york`,
none of which were in `PLACES` (dead entries that could never fire); and accept `-`/`—` as label
separators.

### One coverage hole this session created and did not close

The mutation proof measured `termMatches` longest-match-first ordering **load-bearing before the
removal and DEAD after it**. Its only corpus anchor was an origin case. The guard is not redundant;
it is now uncovered. Recorded as OWED in the corpus rather than absorbed into a clean-looking count.

---

## 4. CP3 — the discovery route, and a premise that turned out to be wrong

`POST /api/admin/discover` ships: double-gated (`requireAdmin` + `DISCOVERY_ENABLED`), SSRF-hardened,
robots-respecting, bound by the same per-host and egress budgets as the buyer test, honest typed
errors, stores nothing, returns the **first** product in the store's own ordering (choosing the
richest description would bias a fitness sample toward stores that already look good to this engine).
10 tests, all injecting their transport. One caught a real bug: prefixing `https://` whenever the
input lacked `http(s)://` turned `file:///etc/passwd` into host `file`, so the SSRF check never saw
the scheme it was meant to refuse.

**But it was not used, for two reasons worth recording.**

First, the production `ADMIN_PASSWORD` is in neither `.env` nor `.env.prod.bak`, so the route cannot
be driven from this environment. Second — and this corrects the brief's premise — **the throttle
that motivated it was a pacing artefact.** At 8s spacing `robots.txt` returned 429 for 3 of 3 hosts;
at 45s it returns 200 for 3 of 4. The sample was therefore assembled from this machine, *more*
politely than the product itself behaves: fail-closed on robots (no readable policy, no fetch —
where the product treats a non-200 `robots.txt` as permissive), 45s between hosts, no retries, no PII.

### Sample assembly, with its attrition

48 candidates spanning categories the v2.3 sample did not cover, filtered against **691 previously
seen hosts** (built by a direct walker, not ripgrep — `experiments/` is gitignored, so a repo-wide
search silently returns nothing over exactly the artefacts that hold the host history).

```
kept            34 / 48
dropped         14      11 not_shopify · 1 robots 429 · 1 robots 403 · 1 rate_limited
```

Merged with the 17 retained hosts and **capped at 35** for wall-clock. The 16 capped-out hosts are
named in the log rather than silently dropped.

**Final sample: 35 hosts, 24 categories** — above the brief's minimum of 30.

---

## 5. CP4 — the fitness measurement

35 URLs through production at 130s spacing, full bodies captured, every request sent with
`force: true` so the 7-day result cache could not return output from an older deployed engine.

```
COMPLETION   VERIFIED CLEAN — 35/35 recorded, 0 unreachable, 0 transport failures
OUTCOMES     35 ok, 0 failed, 0 degraded, 0 rate_limited, 0 near-empty
```

**One caveat, caught by the harness rather than assumed away.** One row was served from cache: my
own pre-run verification call minutes earlier consumed that URL's once-per-hour forced-rerun
allowance. It was produced by the *same* deployed commit, so it is not stale-engine output — but the
audit flags it rather than letting it pass silently.

### Depth, against the v2.3 production baseline

| metric | v2.8 (n=35) | v2.3 baseline (n=15) |
|---|---|---|
| median genuine findings | **4** | 4 |
| thin rate (≤1 finding) | **0.0%** (0/35) | 0% |
| distinct failing sets | **17 across 35** | 12 across 15 |
| `requires_store_access` rate | 3.0% | — |
| degraded / near-empty | 0 / 0 | — |

Depth held on a sample more than twice the size and spanning 24 categories rather than 12. No store
produced a near-empty or degraded result, so the floor never had to fire.

### The audit — all 100 `pass_evidenced` rows, individually

| group | rows | result |
|---|---|---|
| structural (price 34, stock 30, variant 11, identifier 5) | 82 | 0 inconsistencies — every price under its cap, every option named, every identifier real |
| text-matched (delivery 11, materials 3, measurements 3, care 1) | 18 | **1 false positive** |
| claim rows (organic, gluten-free) | 2 | **1 false positive** |

**FP1 — a nutrition quantity read as the product's measurement.** A snacks store was told
*"Measurements are stated"* on the strength of *"…has 11-14 grams of high quality protein…"*. Grams
of a nutrient measured **inside** the product is not the product's size, capacity, weight or fit.
Mechanism: `grams` is a `dimensions` term and `MEASUREMENT` is satisfied by any number bound to a
unit. **Corresponds to a pinned corpus gap** (the `usage-quantity` class, previously anchored only
by *"Steep in 8 oz of hot water for 3 minutes."*) — but the real-world shape is wider than the
pinned case showed, so a new case was added.

**FP2 — a product claim proven from the shipping policy.** A tea store was told *"Organic — stated
in your shipping policy"*, **with no quote at all**. The word appears in that policy page only inside
the store's own SEO page title (*"…: Organic Loose Leaf Teas, Tea Bags & Tea Gift"*) — nav chrome.
Two mechanisms compound:

1. Attribute rows filter `shipping_policy` out of their evidence (`productTest.ts:1205`); **claim
   rows do not** (`:1093`). The asymmetry is unintentional — a claim about the product can be proven
   from a document about orders.
2. The policy fold-in carries nav/SEO chrome, which is exactly what the product-surface rule exists
   to exclude. `presentableQuote` then rejected the chrome it had matched on, so the row rendered
   with no quote.

**NEW — does not correspond to any pinned gap.**

**Both reproduce byte-identically at `44fd4e0`.** Neither was introduced by this session's deploy;
the measurement simply reached shapes no prior audit had.

### One quality defect, not a false positive

A footwear store publishes its entire product body as a single unsplit run-on. Three separate rows
(materials, care, delivery) all quote the same first 180 characters, and **the quote is truncated
before the evidence it is citing.** I verified against the store's own copy that the care claim is
true — *"Care Instructions: Machine wash warm… Do not bleach."* sits past the cut. The label is
correct and the quote does not show why. Two other delivery quotes carry cart chrome
(*"Add a gift note Subtotal You Saved Usually ships within 24 to 48 hours"*) for the same reason.

---

## 6. CP5 — the exit verdict

### Hardening continues. The exit criterion was not met.

The rule was fixed in advance: zero false positives ends the phase; any false positive continues it.
**Two were found.** They are the first defects this project has ever found by measuring real
merchant copy — v2.3 audited 37 rows and v2.5 audited 18, both reporting zero, and both were simply
too small to reach these shapes. 35 stores and 100 pass rows were enough.

That is the finding that matters most, and it cuts against the brief's framing. The brief proposed
that the corpus measures worst case on hostile input while real-merchant audits had found nothing,
and that the fitness measurement would decide which governs. It decided: **the earlier audits were
underpowered, not reassuring.** "Zero false positives across 55 rows" was not evidence of fitness;
it was evidence of a small sample.

### What must be fixed next, in priority order

1. **FP2 — claim rows must exclude `shipping_policy`.** One line, mirroring what attribute rows
   already do. This is the higher-severity of the two: it produces a quote-less assertion about the
   product sourced from a document about orders, and it is the same class as the original live
   regression this whole evidence layer was built for. Needs its own adversarial pass — the fix is
   trivial, the risk is that some legitimate claim evidence lives only in policy text.
2. **Policy-page chrome.** Even with (1), the fold-in carries nav and SEO text into the evidence
   index for `delivery`. The product page has a surface allowlist; the policy page has none.
3. **FP1 — a quantity of something inside the product is not the product's measurement.** Harder:
   it needs the distinction between "12 grams of protein" and "12 grams net weight", which is a head
   noun, not a unit. Do not attempt it as another term-list edit.
4. **Quote truncation must not cut before the matched evidence.** `presentableQuote` truncates at a
   fixed 180 chars from the start of the sentence rather than around the match. On stores that
   publish one long unsplit body, the merchant sees a quote that does not contain the thing being
   cited. Cheap and purely presentational.
5. **The owed mutation anchor** for `termMatches` longest-match-first ordering (see §3).

### What the next session should NOT do

Not the category standard — it was gated on this verdict. Not another term-list widening: five of
the seven defects this session touched came from term lists, and every one was found by an
independent pass rather than by its author. And not a third `origin` attempt; that requirement is
gone by decision, with the measured path back written down.

---

## 7. Corrections to the brief

1. **"Expect roughly 3 of the 5 pinned recall gaps to close."** Two would have closed with the full
   adjacency change; **one** closed with what actually shipped.
2. **"the adjacency half survived cleanly … no attributed false pass"** (carried from v2.7). It did
   not. The `fl` half false-passed on `flounce`/`flinch`, and the hyphen half contributed four
   further mechanisms. v2.7's conclusion was drawn from a probe set that contained neither shape.
3. **"Discovery … is throttled from the dev machine and has no production endpoint."** The throttle
   is pacing-dependent, not absolute — 45s spacing reads `robots.txt` fine on most hosts.
4. **The decision rule assumed adversarial-set specificity measures merchant impact.** Three
   independent sets put the same matcher at 17.0%, 94.0% and 100.0%. The rule could not arbitrate,
   and the natural-frequency read had to.
