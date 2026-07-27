# v2.9 — close the two, then measure to a bound

**Date:** 2026-07-26 · **Branch:** `feat/v2-9-bound` · **Base:** `96ceacd`
**De-identified: stores are named by category, never by domain.**

---

## 0. The one-paragraph version

The two false positives v2.8 measured are closed, and neither was the one-line fix the
brief expected. The policy one needed the recognition that a **document** was being handed
to matchers written for **sentences** — and an independent map found four more defects on
the same path while proving that the obvious fix would have broken the delivery row. The
quantity one needed a positional guard, because the engine's apparent defence turned out
to be a vocabulary accident: of the negatives it got right, 80% were right only because no
term happened to match.

The larger deliverable is **CP3**: the fitness measurement now takes seconds instead of 76
minutes, validated at **99.6% row agreement** against the production run it replaces. That
is what makes the bound in §5 repeatable after every future change, rather than a thing
that gets deferred.

---

## 1. What the independent pass found before any fix was written

Rule 3 of the brief — never trust a self-written probe set — was applied by writing every
probe set BEFORE the corresponding fix, in agents that did not write the fix. It paid
immediately. The two hypothesised mechanisms were both real, and were not the whole story:

| # | defect | status |
|---|---|---|
| 1 | claim rows search `shipping_policy`; attribute rows filter it | hypothesised, **confirmed** |
| 2 | the policy fold-in carries page chrome | hypothesised, **confirmed** |
| 3 | **`no_subscription` also reads unfiltered evidence**, and has no lint pre-filter | **new** |
| 4 | **the presentable-quote gate does not fail closed** — a pass renders with no quote | **new** |
| 5 | **`extractFaqs` accepts any `FAQPage` JSON-LD on the page**, not tied to the Product | **new** |
| 6 | **`delivery`/`no_subscription` skip the lint pre-filter**, so one policy sentence saying "guaranteed" returns the WHOLE report as `unreachable` | **new** |
| 7 | `textSurfaces` omits `shipping_policy`, so a row searched a surface it never disclosed | **new** |

`htmlToText` was measured to be a **tag** stripper, not a chrome stripper: it drops
`<script>`/`<style>` and the angle brackets, and keeps the *text* of `<title>`, `<nav>`,
`<header>` and `<footer>` verbatim. The comment above the call site claimed the opposite.
Only the 20,000-character cap was real.

**The mechanism that made it dangerous** was the newline collapse. With no newlines,
`splitSentences` has only `.!?` to cut on and navigation carries no sentence punctuation,
so head + nav + banner **fused with the first real sentence** into one ~1000-character
"sentence". That single fact defeated three guards at once — `presentableQuote` rejected
the blob so the row passed with **no quote**, `nonProductSubject` read a subject span that
was a thousand characters of menu, and which of those happened depended on the length of
the store's menu.

That is also why a chrome blocklist was the wrong instrument: on a real store the first
delivery statement often sits *inside* the fused blob, so sentence-blacklisting would have
deleted real delivery windows along with the navigation.

---

## 2. CP1 — the two fixes, measured

### FP2 — policy chrome

`htmlToBlockText` drops `<head>` and the containers that are chrome by definition
(`nav`/`header`/`footer`/`aside`/`noscript`/`template`/`select`/`svg`/`form`/`dialog`), and
turns block-level boundaries into newlines so the matchers finally receive sentences.
Claim rows and `no_subscription` now apply the product-surface filter that attribute rows
always had; `delivery` deliberately still reads the policy.

Measured on an independently-written **390-negative / 69-positive / 28-delivery-control**
chrome set, written before the fix existed:

| | before | after |
|---|---|---|
| false passes on the `shipping_policy` surface | **182 / 182** | **0 / 182** |
| delivery controls still passing | 23/28 | 23/28 (the 5 are a pre-existing `COMPARATIVE` defect, diagnosed below) |

Blast radius was measured before the change, not assumed: all 13 claim keys that passed off
policy text also pass identically from `product_description`, and no claim class was found
whose evidence legitimately lives only in a document about orders.

### FP1 — a quantity of something inside the product

The label is "Measurements are stated" — size, capacity, weight or fit. `nonProductQuantity`
judges **every measurement occurrence in its own window** rather than testing the sentence.
That is deliberate: whole-sentence testing is exactly what let `"Case dimensions match every
4-G and Wi-Fi tablet."` pass in v2.8, and `"Each 12 oz bag contains 8 g of protein."` states
a real size **and** a nutrient and must still pass.

Measured on an independently-written **412-probe** set:

| | before | after |
|---|---|---|
| false passes (clear negatives) | 112 / 258 — **43.4%** | 21 / 258 — **8.1%** |
| recall (positives) | 0.881 | **0.881 — unchanged** |

Closed outright: nutrition-per-serving (24→0), external-substance quantity (20→0),
logistics quantity (12→0), energy/electrical (5→0), dosage/usage (15→0 after adding the
dose noun and verb inflections), density (GSM).

**Left open deliberately, and pinned**: bundled-component capacity (15) and ingredient
concentration (6). The second is structurally identical to the canonical-true `"Each tin
contains 250 g of loose leaf tea."` — same frame, same `<n> <unit> of <noun>` shape,
opposite answer — and the only thing separating them is whether the noun *is* the product.
That is a head-noun judgement, the class `origin` was removed for failing three times.

### A fix of my own that measurement killed

I also made claim rows **fail closed** when no quote can be cut, on the strength of
`testEvidence.ts`'s stated contract. It was wrong, and my own measurement caught it before
an independent pass had to: **zero** of the 195 surviving chrome false passes were
quote-less, so it closed nothing — and it cost four real positives plus a canonical corpus
case, because `presentableQuote` rejects anything under three words and `"Certified
gluten-free."` is two. Replaced with **disclosure**: the row passes and says it cannot
quote cleanly.

---

## 3. CP2 — the OWED anchor is closed

Removing `origin` in v2.8 deleted the only corpus case that failed when `termMatches`'s
longest-match-first sort was reverted, so the mutation proof reported that guard DEAD while
it remained load-bearing. The replacement is natural rather than constructed: a
combinatorial sweep of **198,744 rank-flipping term pairs found 78,472 status divergences**.

The clearest is a packaging sentence carrying two composition terms at different positions.
Longest-first selects the earlier one, whose short prefix puts the packaging subject inside
`SUBJECT_BEFORE_VETO`'s 48-character reach, and the row is correctly vetoed; with the sort
removed the later term is selected, the prefix is 81 characters, the veto cannot reach, and
a sentence entirely about packaging passes as the product's materials.

**Mutation proof: 24/26 applied mutations load-bearing** (was 21/24). All three new guards
are load-bearing. The policy-segmentation guard needed a new home — the adversarial corpus
hands evidence in as ready-made strings and therefore never exercises `attachShippingPolicy`
at all, which is precisely how the defect survived every corpus case about policy text. The
mutation runner now consults `test/productTest.test.ts` as well.

---

## 4. CP3 — the infrastructure win

**The measurement now takes seconds instead of 76 minutes.** That is the change that stops
measurement being the thing that gets deferred.

### What is captured, and why it is the raw bytes

`capture.ts` stores **the raw HTTP responses**, not a parsed product. That is load-bearing: a
parsed snapshot bakes in whatever the extraction and segmentation code did on capture day, so
the moment this session changed how policy HTML is segmented, every earlier snapshot would
have become incomparable — and a run mixing old and new snapshots would silently average two
engines. Storing bytes means the product is rebuilt through the CURRENT code every time.

`replay.ts` then calls **`runProductTest` itself** with the transport swapped for a replay.
It does not reproduce the requirement library, the evaluation order, the
`requires_store_access` de-duplication, the input floor or the claim-linter gate — building a
second engine that could drift from the real one is the mistake this project has already
documented elsewhere. Everything downstream of the socket is production code.

### The fidelity gap, stated precisely

1. **The semantic tier is off** (`PRODUCT_TEST_SEMANTIC=0`). It can only understate claim-row
   pass counts; it cannot manufacture a lexical false pass, so it does not flatter the rate.
2. No network, so no throttle or negative cache. Tier *selection* is unaffected — a tier that
   429'd on capture day replays as a 429.
3. The store is frozen at capture time.
4. A URL that was not recorded is a HARD ERROR, never a synthesised 404: a missing response
   must never look like a store that answered. **Replay misses across 172 snapshots: 0.**

### Validation — the stated tolerance, set before the number was read

Tolerance: **≥90% row-status agreement** against the v2.8 production run, engine held constant
at `96ceacd` so harness fidelity is not confounded with this session's intended changes.

```
comparable hosts   : 35
ok/failed verdict  : 35/35   (100.0%)
row statuses       : 270/271 (99.6%)
row-set differences: 0
```

**VALIDATED at 99.6%.** The single disagreement is a variant-option row on a store whose
product sold out in the four hours between the production run and the capture — the `.js`
tier was recorded and replayed faithfully, the inventory simply changed.

### A measured correction to the brief's premise

The brief said dev-machine discovery was "throttled … pacing artifact". Capturing through the
engine's own `safeFetch` yielded **11 usable of 20**, every drop `rate_limited`. A controlled
comparison on the same host seconds apart isolated the cause, and it is **not** pacing and not
the headers:

```
coffee host A /products.json              coffee host B /products.json
  200  raw fetch + sample UA                200  raw fetch + sample UA
  200  raw fetch + bot UA                   200  raw fetch + bot UA
  200  raw fetch + bot UA + identity        200  raw fetch + bot UA + identity
  429  safeFetch                            429  safeFetch
```

It is `safeFetch`'s **transport**: `node:https` with the socket pinned to a vetted IP for
DNS-rebinding safety, which forces HTTP/1.1 and presents a different TLS fingerprint.
Cloudflare-fronted stores score that as a bot from this IP. Capturing over it would not have
sampled stores — it would have sampled "stores that tolerate our transport from a laptop",
dropping exactly the large CDN-fronted merchants and flattering the result.

**This is a finding about the product, not just the harness.** Production is not refused
today, which is why v2.8 got 35/35 there — but the throttle rate this project tracks as an
escalation signal is partly a property of our transport rather than of the stores.

### The sample

208 targets (the 35 already sampled + 173 new across 50 categories, every previously-fetched
host excluded). **172 usable**, against a target of 100. Attrition, all logged: 26
`not_shopify`, 3 robots-unreadable, 3 `rate_limited`, 1 robots 503, 1 malformed JSON, 1 HTTP 500.

---

## 5. CP4 — the measurement and the bound

**172 stores · 507 pass rows · every row audited individually.**

| | |
|---|---|
| snapshots evaluated | 172 / 172 |
| replay misses / hard errors | 0 / 0 |
| structural rows (price, stock, identifier, variant) | 393 — **0 inconsistencies** |
| text-evidenced rows | 114 — **1 confirmed false positive** |

### The one false positive

A cookware store was told **"Care or use instructions are stated"** on:

> *"If you follow our easy care instructions, we'll help out if anything goes wrong within
> three years from your date of purchase."*

The sentence **refers to** care instructions; it states none. A buyer asking how to look after
the pan learns nothing. Mechanism: `care` is the only attribute with **no `valueGuard`** —
`materials` requires a MATERIAL_NOUN and `dimensions` requires a real measurement, but the care
terms match their own name, so a warranty sentence containing the phrase passes.

**Pinned, not fixed.** A fix without an independent adversarial pass is how the last three
sessions each shipped a regression, and there was not runway for another full pass. The fix is
a valueGuard demanding an actual instruction (an imperative, a temperature, a cycle).

### Two things that looked like false positives and are not

- A toothpaste store's materials row quotes *"…the mineral your enamel is mostly made of,
  together with…"*. The sentence **does** list the product's actives (Nano-Hydroxyapatite,
  Hydrated Silica, Xylitol, Zinc Gluconate); the quote is simply **cut at 180 characters**
  before the part that justifies it. Truncation class, not a false pass.
- Four rows render no quote. All four are genuine and disclose honestly ("in a specification
  block rather than a sentence we can quote") — e.g. `"0.75 oz jar"` and a full
  `Dimensions: 11.42W x 18.9H x 5.51D" … Capacity: 20 L Weight: 3.13 lbs` spec block.

### Truncation class, counted separately as the brief asked

**19 of 507 rows (3.7%)** render a quote cut at 180 characters. The cut is taken from the start
of the sentence rather than around the match, so on stores that publish one long unsplit body
the merchant can see a quote that does not visibly contain the thing being cited. Not a false
pass; a presentation defect that costs credibility.

### Depth

| metric | v2.9 (n=172) | pre-change engine, SAME 172 | v2.3 baseline (n=15) |
|---|---|---|---|
| median genuine findings | 3 | **3** | 4 |
| thin rate (≤1 finding) | 7.6% | **7.6%** | 0% |
| distinct failing sets | 56 | 57 | 12 across 15 |
| `requires_store_access` | 4.4% | 4.4% | — |
| near-empty results | 1 | 1 | — |

**The drop from the v2.3 baseline is sample composition, not this session's changes** — the
pre-change engine scores identically on the identical snapshots. v2.3's median of 4 came from
15 hand-picked stores; this is 172 discovered ones.

### The engine delta on real copy

Replaying both engines over the same 172 stores isolates exactly what changed:

```
PASS -> not pass : 4      not pass -> PASS : 2      quote changed : 18
```

- **3 of the 4 losses are the defects being closed**: the tea store's quote-less `Organic`
  from policy chrome (the original FP2), the snacks store's protein sentence (the original
  FP1), and a quote-less delivery pass on a fused chrome blob.
- **1 is arguable**: a spices store whose only timing sentence sits in a cart-drawer `<form>`,
  which `htmlToBlockText` drops. The quote it replaces was visibly cart chrome
  (*"Add a gift note Subtotal You Saved Usually ships within 24 to 48 hours"*).
- **Both gains are genuine** delivery windows that were previously buried inside fused chrome.
- **All 18 quote changes are improvements** — navigation and cart text stripped from the
  citation. Every one of the 55 delivery quotes in the final run is clean policy prose.

One regression was found this way and fixed before shipping: a bare `case` in `PACK_SUBJECT`
vetoed *"With its case measuring a classic 39mm"* on a real watch store. `case` now has to be
counted (`each case`, `a case of 12`, `case pack`). **That is the harness earning its cost on
the day it was built.**

### The bound

```
stores (clusters)          172
pass rows (trials)         507        rows per store 2.95
confirmed false positives  1

naive 95% upper bound              0.93%   (rule of three — assumes independent rows)
cluster-adjusted, ICC 0.1          1.12%
cluster-adjusted, ICC 0.2          1.30%   <- the honest headline
cluster-adjusted, ICC 0.3          1.48%
per-STORE upper bound              2.76%   (the unit a merchant experiences)
```

**Why more than one number.** The rule of three assumes independent trials. Pass rows are
clustered inside stores — rows from one store share its copy conventions, theme and category —
so treating 507 rows from 172 stores as 507 independent trials understates the uncertainty.
The naive figure is reported because the brief asked for it; the cluster-adjusted figure is
the one to publish. The per-store rate is reported because one wrong row means one wrong
report, however many rows that store had.

---

## 6. CP5 — the exit verdict

### Hardening continues. The criterion was stated in advance and was not met.

The rule: *zero false positives with an upper bound at or below ~1% ends hardening; any false
positive, or a bound above ~1%, continues it.* **One false positive was found, and the
cluster-adjusted bound is 1.30%.** Both halves of the test fail, so the verdict is unambiguous.

It is worth being precise about how much better this is than v2.8 even so. The measured rate
went from **2 in 100 (2.0%)** to **1 in 507 (0.20%)**, the sample went from 35 stores to 172,
and the two defects that produced the v2.8 rate are gone from real copy. The bound is now
close enough to the target that one more fix plausibly reaches it — which is a different
situation from v2.8, where the remaining work was unknown.

### What is next, in order

1. **A `valueGuard` for `care`** — the one confirmed false positive, and the only attribute
   with no value guard at all. Small, well-understood, needs its own adversarial pass.
2. **Quote truncation around the match** rather than from the start of the sentence. 19 rows
   in this sample; purely presentational and cheap.
3. **The `<form>` drop** in `htmlToBlockText` — the one arguable real-store loss. Either keep
   dropping it (a cart drawer is chrome) or drop only forms with no prose; measure both.
4. **Chrome on non-policy surfaces** (`product_title`, `meta_description`, `structured_data`),
   which this session did not attempt: the independent set puts it at 195 of 390 negatives.
   It is the largest remaining known class.
5. **`extractFaqs` accepting any `FAQPage` node** on the page, not tied to the Product.

### What NOT to do

Not the category standard — still gated. Not another term-list widening: every defect this
session touched came from a term list, and every one was found by an independent pass rather
than by its author. And **re-run the offline measurement after each fix** — it now costs
seconds, which was the entire point of building it.

---

## 7. Corrections to the brief

1. **"reportedly a one-line fix" (FP2).** It was not. Aligning the surface filter closed 182
   of 182 policy-surface false passes but left the chrome mechanism untouched, and the
   independent map proved that a chrome blocklist would have deleted real delivery windows.
   The repair needed document segmentation.
2. **"the dev-machine discovery throttle was a pacing artifact, not a hard block."** Half
   right. `robots.txt` is pacing-sensitive; the product-tier 429s are a **transport
   fingerprint** and no amount of spacing fixes them. Measured in §4.
3. **"100 hosts should produce roughly 280–300 pass rows."** 172 hosts produced 507 — about
   2.95 rows per store, not the ~2.9 per 100 the estimate implied. The estimate was low
   because structural rows (price, stock, identifiers, variants) dominate the pass set.
4. **The brief's bound arithmetic assumed independent rows.** Pass rows are clustered by
   store; the cluster-adjusted bound is ~40% wider at ICC 0.2. The `3/n` form is also only
   the x=0 case of the Poisson bound — with one event the numerator is 4.74, not 3.
5. **The v2.3 depth baseline (median 4, thin 0%) is not comparable to a discovered sample.**
   The pre-change engine scores median 3 / thin 7.6% on these 172 stores, identically to v2.9.
   A future session should treat 3/7.6% as the baseline for discovered samples.
6. **Line numbers `productTest.ts:1205` and `:1093` were both accurate** — the one factual
   claim in this brief that checking confirmed rather than corrected.
