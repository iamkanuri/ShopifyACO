# CP5 — egress architecture decision

**Date:** 2026-07-25 · **Input:** `CP2_RESULTS.md` (production, commit `80f04c1`, n=15)
**Decision owner:** repo owner · **Status:** recommendation, not yet implemented.

## The measurement, in one line

**Throttle rate 0/14 = 0.0%** from the production egress IP (0/15 = 0.0% counting the one
ambiguous row the way `DEPLOY.md` §5 counted its own). The **60%** figure in `DEPLOY.md` §5
was measured from a residential dev IP and **does not describe production.**

## Recommendation — ship as is, instrument, do not build

The brief's decision table puts anything under ~10% in the "ship as is; add monitoring with
an alert threshold; revisit at volume" branch. The measurement is at the floor of that band,
so:

**Do not build the async/queue path. Do not buy a proxy pool. Do not restrict the live test
to installed merchants.** Every one of those was scoped to solve a 60% block rate that
production does not have. Building any of them now spends real effort and adds a permanent
moving part to defend a number that isn't there.

Two things *are* worth doing, and both are small:

### 1. Close the B/C instrumentation gap (~1 hour) — the only code change recommended

Today, if the throttle rate rises, **the telemetry cannot tell us why**, and the two causes
have different fixes:

- **Shopify's per-IP limiter** on the `/products/*` path class → an egress IP pool helps.
- **The host's own WAF** → an IP pool very likely does **not** help.

They are indistinguishable in the current response (see `CP2_RESULTS.md` for the two
structural reasons). The cheap fix is to make the failing path record what it already knows:

- surface `policyStatus` on `ProductTestResult` (it exists on `PublicProduct` already), and
- on the `rate_limited` return at `productTest.ts:369`, record whether the **`robots.txt`
  fetch itself** was refused — the code fetches it first (`productTest.ts:308`) and currently
  discards a non-200 into `{rules: [], fetched: false}` without noting it.

That is one extra field on the log line and the `product_test` event. **Do this before the
number matters, not after** — otherwise the first sustained rise produces a decision we
cannot make from the data we kept.

### 2. Keep `DEPLOY.md` §5's alert, and correct its premise

§5's escalation metric is already the right one and is already logged. Nothing new to define.
What changes is the *starting point*: §5 currently reads as though the product is sitting past
its own escalation trigger ("already past the §2.5 escalation trigger"). It is not. That
sentence should be corrected to point at the production measurement, or it will drive an
expensive decision from a number that was never about production.

## The one metric to monitor

Unchanged from `DEPLOY.md` §5 — **do not add a second one**:

```
throttle rate (rolling 24h) = count(errorKind = "rate_limited" OR degraded) / count(product_test)
```

Already emitted on every test as the `product_test` log line and the `product_test` event row
(`tier`, `throttled`, `degraded`, `errorKind`).

**Thresholds: keep §5's, they are sound.** < 5% no action · 5–20% sustained 48h → raise the
cache TTL and lower `PRODUCT_TEST_EGRESS_PER_MIN` (env-var changes, no redeploy) · > 20%
sustained, or any day where `degraded` exceeds clean results → escalate to the options below.
Today's measurement sits in the first band with room to spare.

## The trigger that would change this recommendation

Any **one** of these, and this decision is reopened:

1. **The rolling-24h rate leaves §5's first band** — i.e. **≥ 5% sustained for 48h**. Use §5's
   numbers, not a new set: 5–20% means *tune first* (raise the cache TTL, lower
   `PRODUCT_TEST_EGRESS_PER_MIN` — env vars, no redeploy), and only **> 20% sustained, or any
   day where `degraded` exceeds clean results**, justifies building anything from the table
   below. The brief's "~10%" band and §5's bands are the same decision at different
   resolutions; §5 is the one already wired to telemetry, so it wins. The measured 0% is a
   *cold, well-spaced* number (one request per host, ≥130s apart) — the most likely way it
   moves is **concurrency**, not time.
2. **Bucket C turns out to dominate** once the instrumentation above exists. Per-host WAFs are
   not solved by IP rotation; if most blocks are WAFs, the honest conclusion is that the
   addressable market for a *live public* test is narrower than assumed, and the answer is the
   pre-computed/outbound model, not more IPs.
3. **A single host starts serving a large share of traffic** (e.g. one Index category goes
   viral). Per-host courtesy limits and the 7-day result cache absorb this, but it is the one
   traffic shape that turns a per-IP limiter into a user-visible failure fastest.
4. **Shopify changes the limiter's key** from per-IP to per-app or per-token. That would make
   an IP pool useless overnight and is entirely outside our control.

## If a trigger fires — the options, pre-costed

Kept here so the decision is ready rather than re-derived under pressure. **Do not build any
of these now.**

| Option | Rough monthly cost | Effort | Addresses | What must be true for it to be right |
|---|---|---|---|---|
| **Egress proxy/IP pool** | ~$50–300 (datacenter) to ~$500+ (residential) | ~2–3 days: route `defaultFetchUrl` through a pool, per-IP budget split, health-check/eviction | Shopify's **per-IP** limiter only | Blocks are predominantly **bucket B**. Needs the instrumentation above to know. |
| **Async enqueue + poll** | ~$0 infra (the Phase-1 job system already exists) | ~3–4 days: enqueue on submit, poll/stream the result, share results per product URL | **Latency and burst smoothing**, not the block itself | The problem is *bursts* tripping the limiter, not a standing block. Note: a queue changes *when* we fetch, not *from where* — it does not fix a host WAF. |
| **Pre-computed case batches (outbound)** | ~$0 marginal | ~2–3 days: batch-run target stores offline, serve from cache | Removes live egress from the visitor path entirely | The public page's job is demonstration, not on-demand truth. This is the only option that is immune to *both* causes. |
| **Live test for installed merchants only; public page = gallery** | $0 | ~1–2 days | Removes third-party egress almost entirely | Blocks are severe AND the public live test is not carrying its weight as a funnel. |

**If bucket C dominates, say it plainly:** per-host bot protection is not an IP problem. The
right response is the outbound/pre-computed model (row 3), and the live public test becomes a
best-effort feature with an honest fallback — not the product's front door.

## What would make this decision wrong

Stated so it can be checked rather than trusted:

- **The sample excludes the riskiest population.** Three candidates were dropped as `unknown`
  because a Cloudflare/Vercel front end hid the Shopify IP — and Cloudflare-fronted stores are
  exactly the ones most likely to be bucket C. The true rate is very likely **> 0%**, and this
  sample cannot say by how much.
- **n=15, one shot per host.** Wide confidence interval. The honest reading is "not 60%, and
  not obviously above the 5% no-action threshold" — not "provably 0".
- **0% is a snapshot of one IP on one day.** Railway can change egress IPs; a shared IP's
  reputation can degrade because of a neighbour, with no change on our side. This is a reason
  to keep the alert, not a reason to build now.
