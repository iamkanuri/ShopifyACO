# CP2 — production egress measurement: method, ready to run on deploy

Written during CP1 so the measurement can start the moment production is live. **Not yet run.**

## The endpoint

`POST /api/product-test` — body `{ "url": "<product url>", "force": true }`.
`force: true` is the documented cache bypass (`runProductTest(url, { force: body.force === true })`,
`src/server/index.ts:529`), which is what the brief requires. The semantic tier is not on this path
at all — it is a $0 deterministic public-data test with **no model calls** — so "semantic tier
disabled" is satisfied structurally. Set `PRODUCT_TEST_SEMANTIC=0` on Railway anyway to remove all
doubt.

## ⚠️ The measurement-integrity trap: our own rate limiter also returns 429

`src/server/index.ts:525` rate-limits **5 tests per 10 minutes per client IP** and returns
**HTTP 429** with `{"error":"You've run several tests just now — give it a few minutes and try
again."}`.

Shopify throttling ALSO surfaces as a throttle signal. **Conflating the two would measure our own
limiter and report it as Shopify's throttle rate** — the single worst way this experiment could
fail, because the number would look plausible.

Discriminator, unambiguous:
- **Our limiter:** HTTP status `429` on the *outer* request, body has only `error`, no result fields.
- **Shopify throttle:** HTTP `200` on the outer request, body is a full result with
  `ok: false` and `errorKind: "rate_limited"`.

So: **any outer 429 is discarded and retried, never recorded.** Pacing must avoid it in the first
place: **≥ 130 s between requests** (10 min / 5 = 120 s, plus margin). 15 URLs ⇒ ~33 min. That is
also comfortably above the brief's ≥ 20 s spacing requirement.

## Bucketing, derived from what the response actually exposes

The response carries the fields needed to separate the three throttle causes the brief cares about:

| Field | Values | Source |
|---|---|---|
| `ok` | bool | — |
| `errorKind` | `bad_url \| not_shopify \| not_found \| rate_limited \| robots_disallowed \| unreachable` | `productTest.ts:118` |
| `fetchTier` | `page \| json` (which tier answered) | `productTest.ts:964` |
| `throttledTiers` | subset of `page \| json \| js \| policy` | `productTest.ts:965` |
| `policyStatus` | `not_fetched \| readable \| unreachable \| robots_disallowed \| rate_limited` | `productTest.ts:93` |
| `degraded`, `cached` | bool | — |
| `evidencedCount`, `notProvenCount`, `requiresAccessCount` | int | result-state distribution |

`policyStatus` is the key to distinguishing **B from C** — it reports whether the robots/policy
layer on that same host was reachable, which is exactly the "robots.txt 200 but `/products/*`
refused" test:

- **A. Clean** — `ok: true`. Record which tier answered.
- **B. Path-class throttled** — `errorKind: "rate_limited"` **and** `policyStatus` reachable
  (`readable`, or `robots_disallowed`/`not_found` — anything that proves the host answered us at
  the robots/policy layer). Shopify-side, per-IP, endpoint-scoped.
- **C. Host bot protection** — `errorKind: "rate_limited"` **and** `policyStatus: "rate_limited"`
  (or `unreachable` across the board). That host's WAF, not Shopify's limiter — an IP pool may not
  fix it.
- **D. Not throttling** — `errorKind` ∈ `bad_url | not_shopify | not_found`. Excluded from the
  throttle rate. `robots_disallowed` is also **D**: the store asked automated tools not to read the
  page and we complied — that is consent, not capacity.

**Throttle rate = (B + C) / (A + B + C)**, D excluded. Compare against the **60 %** dev-IP baseline
in `DEPLOY.md` §5 (1 clean / 3 rate_limited / 1 unreachable over 5 stores).

**⚠️ Verify before trusting the buckets:** confirm `policyStatus` is actually present in the JSON
the route returns (it is defined on a diagnostics type at `productTest.ts:93`; the route returns
`result` wholesale, but check one live response). If it is absent, B and C cannot be separated from
the response alone and the fallback is the Railway `product_test` log line, which carries
`tier`/`throttled`/`errorKind` — **but not** the policy status. In that case say so rather than
guessing a bucket; an honestly-unsplit "B or C" count is better than a fabricated split.

## URL set

15 URLs, ≥ 3 categories, one URL per host (buckets are per host), from stores this project has
never fetched. Exclusions must include everything in the untracked `experiments/` probe output and
the three hosts de-identified in `DEPLOY.md` §5 (Host A/B/C — apparel, wellness, personal care).

**Verify Shopify hosting by DNS only** — `Resolve-DnsName -Type A` looking for Shopify's
`23.227.38.0/24`, or a CNAME chain ending at `shops.myshopify.com`. **Do not fetch a candidate host
from this machine first:** the whole point is to measure production's egress reputation, and warming
a host from the dev IP changes what is being measured. Cloudflare-fronted stores will not show the
Shopify IP — mark those `unknown` and do not promote them silently.

*(The first attempt at assembling this list failed on a session token limit before producing
anything — `experiments/` exclusion list and candidate pool both came back empty. Redo it.)*

## Record per host

`robots/policy status`, product-page outcome, `.json` outcome, which tier answered,
result-state distribution, total duration, plus the bucket. Report the per-host table, the throttle
rate, the bucket breakdown, and the dev-IP comparison — including whether any host that refused the
dev IP now answers production, and vice versa.

**Do not retry a measurement to get a better number.** A high throttle rate honestly reported is a
successful outcome.
