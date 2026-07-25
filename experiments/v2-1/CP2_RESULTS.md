# CP2 — production egress measurement (run 2026-07-25)

Method: `CP2_METHOD.md`. Endpoint `POST https://lens.thirdocular.com/api/product-test`,
body `{url, force:true}`, production at commit `80f04c1`.

> Hosts are de-identified, as in `DEPLOY.md` §5, for the same reason: these are measured
> facts about *named third parties'* bot-protection posture, gathered by fetching their
> storefronts, and this file is tracked in git. The host↔label mapping and the raw
> responses live in `experiments/v2-1/cp2_results_raw.jsonl` (gitignored).

## Headline

**Throttle rate = (B+C)/(A+B+C) = 0/14 = 0.0%.** Fourteen of fifteen hosts returned a
complete test; one was `unreachable`; **zero** returned `rate_limited`.

The dev-IP baseline in `DEPLOY.md` §5 was **60%** (3 `rate_limited` of 5). Counting the
same way the baseline did (with the ambiguous non-throttle in the denominator) this run is
**0/15 = 0.0%**. The result is 0% under either convention, so the conclusion does not
depend on how the ambiguous row is bucketed.

## Per-host results

Row states: `E` evidenced · `NB` no blocking evidence · `NP` not proven · `RA` requires store access.

| # | category | bucket | outcome | tier | throttled | rows (E/NB/NP/RA) | ms |
|---|---|---|---|---|---|---|---|
| 01 | pet supplies | A | ok | page | — | 5 (2/1/2/0) | 8514 |
| 02 | pet supplies | A | ok | page | — | 5 (2/1/2/0) | 7186 |
| 03 | pet supplies | A | ok | **json** | — | 6 (1/1/4/0) | 10837 |
| 04 | bags/luggage | A | ok | page | — | 6 (4/1/1/0) | 10948 |
| 05 | bags/luggage | A | ok | page | — | 5 (1/1/2/1) | 5366 |
| 06 | stationery | A | ok | page | — | 6 (3/1/2/0) | 10304 |
| 07 | stationery | A | ok | page | — | 5 (2/1/2/0) | 6571 |
| 08 | stationery | A | ok | **json** | — | 5 (2/1/2/0) | 9978 |
| 09 | candles | A | ok | page | — | 5 (2/1/1/1) | 5130 |
| 10 | kitchen/cookware | A | ok | *none* | — | 4 (0/1/2/1) | 11238 |
| 11 | board games | *(see below)* | **unreachable** | — | — | — | 6486 |
| 12 | cycling | A | ok | page | — | 6 (3/1/2/0) | 10197 |
| 13 | outdoor/camping | A | ok | page | — | 6 (4/1/1/0) | 11003 |
| 14 | gardening | A | ok | page | — | 5 (2/1/2/0) | 6593 |
| 15 | music accessories | A | ok | page | — | 5 (2/1/2/0) | 6494 |

Bucket totals: **A = 14 · B = 0 · C = 0 · D = 0 · ambiguous = 1.**
Duration: min 5.1s, median 8.5s, max 11.2s. No result was served from cache (`force:true`
honored; `cached` was null on every row).

**Page-first is doing its job.** 11 of 14 clean tests were answered by the HTML page alone,
so `.json` was never requested — the ~50% request reduction `DEPLOY.md` §5 claims for a
well-marked-up store is visible here at scale, not just on one host.

## Measurement-integrity checks

- **Our own rate limiter never contaminated the sample.** `src/server/index.ts` limits 5
  tests / 10 min per IP and returns an outer HTTP 429 — the same status a Shopify throttle
  would produce. Pacing at ≥130s meant **0 outer-429 discards across all 15 requests**, so
  no result was retried and none was discarded. The discriminator (outer 429 with only an
  `error` body = ours; HTTP 200 with `ok:false, errorKind:"rate_limited"` = theirs) was
  implemented but never needed to fire.
- **No candidate host was fetched from this machine before the run.** Shopify hosting was
  verified by **DNS only** (`Resolve-DnsName -Type A` → `23.227.38.0/24`, or a CNAME chain
  ending at `shops.myshopify.com`).
- **Exclusions honored.** All 15 hosts were checked against the 446 hostnames this project
  has previously fetched (extracted from `experiments/`); zero collisions. The three hosts
  de-identified in `DEPLOY.md` §5 are inside that set and were excluded.

## ⚠️ `policyStatus` is NOT in the response — B and C cannot be split

`CP2_METHOD.md` flagged this as a thing to verify first. It was verified, and the answer is
**no**, for two independent reasons — both structural, neither a guess:

1. `policyStatus` is declared on `PublicProduct` (`productTest.ts:93`), **not** on
   `ProductTestResult` (`productTest.ts:801`), which is what the route returns. It is absent
   from all 15 responses (checked programmatically, not assumed).
2. More fundamentally, **the policy layer is never probed on the failing path.**
   `attachShippingPolicy` runs only after a product node was obtained; a `rate_limited`
   error returns at `productTest.ts:369`, before it. So even if the field were exposed, it
   would read `not_fetched` in exactly the case that needs it.

`throttledTiers` cannot substitute: `"policy"` is appended only inside
`attachShippingPolicy` (`productTest.ts:459`), i.e. only on the success path. And a
`robots.txt` that 429s is silently degraded to `{rules: [], fetched: false}`
(`productTest.ts:302`) rather than recorded as a throttled tier — so a WAF that blocks
everything and a limiter that blocks only `/products/*` produce **byte-identical responses**.

This did not affect the headline (there were zero throttles to split), but it is a real
**instrumentation gap**: if the rate ever rises, the telemetry cannot tell us which of the
two causes it is — and they have different fixes (an IP pool addresses one and not the
other). See `EGRESS_DECISION.md`.

## Limitations — read these before trusting 0%

1. **This measures cold, well-spaced egress, not egress under load.** One request per host,
   ≥130s apart, 15 hosts the production IP had never touched. Real traffic is bursty and
   repeat-heavy. 0% at this cadence does not predict 0% at concurrency.
2. **Selection bias, and it runs in the optimistic direction.** Candidates were confirmed
   Shopify **by DNS**; three were dropped as `unknown` because a Cloudflare/Vercel front end
   hides the Shopify IP. Cloudflare-fronted storefronts are precisely the population most
   likely to be **bucket C (host WAF)**. So this sample under-represents the highest-block-risk
   segment by construction, and the true population rate is very likely **higher than 0%**.
3. **Row 11 (`unreachable`) is ambiguous.** It is not `rate_limited`, so it is not counted as
   a throttle, but `unreachable` can also be how a silent block presents (connection reset,
   or a WAF answering with something that isn't 429/403). Worst case, if it is a disguised
   block, the rate is **1/15 = 6.7%** — still under every escalation threshold.
4. **This is not a controlled comparison with the 60% baseline.** Different egress IP,
   different date, different hosts, n=5 vs n=15. It refutes "the throttle is inherent to the
   product's fetch pattern" — it does not isolate *why* the production IP fares better.
5. **Row 10 answered with no product node** (`fetchTier: null`, 4 rows, 0 evidenced). Not a
   throttle — an honestly degraded test on a page whose markup the extractor could not use.
   Worth a look on its own merits; it is a coverage question, not a capacity one.

## Direct answer to the brief's comparison question

> whether any host that refused the dev IP now answers production, and vice versa

**Not answerable from this run, by design.** The dev-IP baseline hosts (`DEPLOY.md` §5,
Hosts A/B/C) were deliberately **excluded** from this sample — the method required stores
this project had never fetched, and re-probing them would also have re-warmed hosts whose
earlier state is the only baseline we have. Answering it properly needs a separate, explicit
A/B against those three hosts from both IPs, which is a different experiment.
