# v2.2 — adversarial review of this session's own diff

**Date:** 2026-07-25 · **Method:** five independent review lenses (correctness, dead-telemetry,
privacy, honesty-spine, security) over `git diff 87ffcb3...HEAD`, each finding then handed to a
separate agent instructed to **refute** it.

> Why this is recorded rather than just acted on: the instrumentation built in CP2 exists to
> replace guesses with numbers. Instrumentation that produces *plausible-looking wrong numbers*
> is worse than none, because it is trusted. Most of what the review found was exactly that —
> not crashes, but metrics that would have read fine and meant nothing.

**Caveat on completeness:** the run hit the session's usage limit partway through the verify
phase. Two findings completed adversarial verification (both CONFIRMED); the rest are recorded
with the reviewer's reasoning and my own independent check, and are marked accordingly. The
review is therefore **not exhaustive** — `review:correctness` never returned.

---

## Fixed in this session

### 1. `toDomain` stored bare IP literals ✅ CONFIRMED → fixed
`registrableDomain` deliberately passes IPs through (for citation analysis, merging distinct IPs
would be wrong). Here that put an IP in the `domain` column while migration 0028 states no
column can hold one. Verified by running it: `http://198.51.100.23/products/tee` → stored as
`198.51.100.23`.

Low severity — it is a tested **store's** host, never a visitor's IP, so it was not visitor PII.
But the documented guarantee was stronger than the code, and here an overclaimed guarantee is
the defect. Now null for IPv4, bracketed IPv6 and the IPv4-mapped `[::ffff:…]` form.

**My test was the reason this survived**: it asserted the guarantee by checking *column names*,
which is the wrong question entirely.

### 2. `domain` was an unbounded free-text column ✅ CONFIRMED → fixed
`test_requested` is emitted **before** the route's 400-char URL check and before the per-IP
limiter — deliberately, so the denominator counts real arrivals rather than only requests that
got past a gate. But nothing bounded the value: measured, a 200 kB host (well under the 256 kB
body cap) was stored **verbatim, twice per request**, at 120 req/min/IP, into a table with no
retention job. Node's URL parser does not enforce DNS length limits.

Fixed at the boundary rather than by reordering the gates, so the intended ordering survives:
`toDomain` now rejects input over 2048 chars, results over 253 chars, and any label over 63.

### 3. Throttle rate's **denominator** was diluted ✅ CONFIRMED → fixed
`throttleRate = upstream / (completed + failed)` counted **every** `test_failed` row — including
`http_400` (malformed paste), `http_429` (our own limiter) and `exception`, none of which ever
issued a request to a store. And filtering by error kind alone was not enough either:
`our_budget` and `our_cooldown` report `errorKind: "rate_limited"` while refusing *before*
touching the store.

The failure mode is precisely inverted from what it looks like: the metric **dilutes hardest
under load**, when our own limiter fires most — so the escalation trigger EGRESS_DECISION.md
depends on would go quiet at exactly the moment it should fire. A day with 200 bot-driven
`http_400`s and 5 real tests all refused upstream would have reported **2.4%** instead of
**100%**.

The denominator is now "tests that actually reached a store", the count is exposed as
`throttleAttempted`, and the renderer never prints the rate without it. Mutation-verified:
restoring the old denominator fails the new test.

### 4. `referrer_class: "hosted_case"` was structurally impossible ✅ fixed
Self-inflicted, and the kind of bug that would never have surfaced as an error. I set
`Referrer-Policy: no-referrer` on the case page *and* wrote a classifier that keys on the
Referer from that page. A Referrer-Policy governs requests the document **originates**, so every
recipient clicking through from `/c/:token` would have arrived with no Referer and been recorded
as `direct` — silently zeroing the one number the hosted-case route exists to produce.

Now `same-origin`: the referrer reaches us, third parties still learn nothing.

### 5. `install_clicked` fired from six places, five of them not funnel steps ✅ fixed
`ConnectShopify` renders in the global header nav, the landing hero, and **three surfaces inside
`/app`** — which are only ever seen by merchants who have already installed. So
`installClickRate = clicks / completed tests` was a ratio between two unrelated populations and
could exceed 1. Now opt-in per call site (`countAsFunnelStep`), and only the post-test CTA opts
in — matching CP2's definition, "install_clicked | originating test id".

### 6. Cache hits skewed the duration percentiles ✅ fixed
A cached result returns in ~1 ms (before any fetch), so including cache hits measured the
cache-hit ratio rather than how long a test takes — and would drag the median down as the cache
warmed. Percentiles now exclude cached rows; the **result-state sums deliberately still include
them**, because a visitor saw those states either way.

### 7. `uniqueDomains` collapsed every `*.myshopify.com` store into one ✅ fixed
`registrableDomain("coolbrand.myshopify.com")` → `"myshopify.com"`, identically for every store
on the platform. Keeping the un-reduced form is not an option — that **is** a shop domain, which
this table must never hold — so `toDomain` returns null. The bucket is dropped rather than
counted as one fake unique host.

---

## Recorded, not fixed

| Finding | Why not now |
|---|---|
| `install_completed.reconciled` ignores the OAuth-token path, which is the path that actually works today | Real, but the token path is not the one a real merchant takes (App Store rule 2.3.1 forces managed install). Fixing it properly is part of F1 in `FIRST_RUN_AUDIT.md`. |
| `callbackHandler` re-emits `install_completed` on a repeat OAuth callback; `tokenExchangeHandler` guards but it does not | Inflates the install count on re-auth. One-line guard, but it belongs with the F1 install work rather than bolted on at the end of a session. |
| `case_viewed` counts link scanners and previewers | Real, and it means outreach "opens" will read high. Needs a UA filter and per-IP-hash dedupe. The number is directional either way and is labelled as such. |
| A claim-linter block spends the semantic-tier money and then reports the run as `unreachable` with `$0` cost | Rare (the linter blocking is itself the alarm), but it does under-report spend. Worth folding into the linter-block path. |
| `POST /api/funnel/install-click` is unauthenticated and accepts an arbitrary domain | Bounded by the `/api` limiter (120/min/IP) and, after fix #2, by length. The written value is a public registrable domain. Acceptable for now; a per-route limit would be better. |

## What this says about the tests I wrote

Six of the seven fixes above were in code I had already written tests for, and the tests passed.
They passed because they asserted the *mechanism* (a row is written; a column is not named
`ip`) rather than the *claim* (the number this produces is the number we say it is). The
mutation testing in CP2 was real and caught real breakage — but a mutation test only proves the
test notices when the code stops doing what it does, not that what it does is right.

The throttle-denominator bug is the clearest example: every test passed, the emit path was
mutation-verified, and the metric was still wrong in the direction that mattered.
