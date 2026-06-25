# ShopifyACO / AisleLens Deep Review

Review date: 2026-06-25

Repo reviewed: `iamkanuri/ShopifyACO`

Local clone: `C:\Users\iamka\Documents\Codex\2026-06-25\i-n\work\ShopifyACO`

Commit reviewed: `390c9ee03ba49bdcbaaf41024ba6e0a2f9569cf9`

I treated `IMPLEMENTATION_STATUS.md` as authoritative, did not treat historical phase branches as unshipped, and did not read `.env`, `.env.prod.bak`, `imp keys.txt`, or `supabase/`. The cloned public tree did not include those secret files in the tracked file list.

## Verification

- `npm test`: passed. 152 tests total, 124 passed, 28 skipped.
- `npm run typecheck`: passed.
- `npm --prefix viewer run build`: passed with Vite/esbuild after running outside the sandbox, because the sandbox denied esbuild access to `vite.config.ts` on Windows.
- `npm audit --json`: one low-severity root advisory for `esbuild` on Windows dev server file reads. Viewer install reported 0 vulnerabilities.
- DB-gated tests were not run because no local Supabase stack was started.
- Browser screenshot QA was not completed. The in-app browser/node tool failed with `EPERM` while inspecting `C:\Users\iamka\AppData`; UI review below is from source and successful build output, not visual screenshots.

## Executive Summary

The repo is far more coherent than many incremental products at this stage. The Shopify auth surface, webhook HMAC path, token encryption, public/private API separation, and SSRF crawler are intentional and mostly strong. The highest-value fixes are not "add an SDK" or "build the server"; they are specific correctness holes around spend accounting, statistical comparison, path validation, and demo fallbacks.

Most important fixes:

1. Reconcile real spend on partial failures instead of releasing the whole reservation.
2. Reconcile spend against the reservation's original day, not `current_date`.
3. Replace the benchmark before/after Wald interval with a Wilson/Newcombe or exact method.
4. Validate public `runId` params before joining them into filesystem paths.
5. Make app demo fallback conditional on true unauthenticated/demo state, not all backend failures.
6. Reject pixel events for shops marked `uninstalled`.

## P1 Findings

### P1-1: Live benchmark spend can be undercounted after partial failure

Files:

- `src/benchmarks/execute.ts:49`
- `src/benchmarks/execute.ts:57`
- `src/benchmarks/execute.ts:78`
- `src/benchmarks/execute.ts:104`
- `src/benchmarks/execute.ts:110`

`executeBenchmarkRun()` reserves estimated spend before the loop and accumulates `totalCost` after each paid engine call. On success it reconciles the reservation to the real `totalCost`. On outer failure, it marks the run failed and calls `releaseSpend(reservationId)`.

That is correct only if no paid calls happened. If API calls succeeded and a later DB insert, aggregation, finish, or other non-provider step throws, the catch path releases the whole reservation as if cost was zero. Actual provider spend is then missing from the cap/accounting surface.

Concrete fix:

- In the outer catch, if `totalCost > 0`, call `reconcileSpend(reservationId, totalCost)` instead of `releaseSpend`.
- Only release the reservation when `totalCost === 0`.
- Add a test that stubs one successful adapter call, forces `insertObservation` or `finishRun` to throw, and asserts the reservation is reconciled to observed spend.

### P1-2: Spend reconciliation can corrupt daily buckets across midnight

Files:

- `migrations/0006_jobs.sql:57`
- `src/queue/spend.ts:47`
- `src/queue/spend.ts:58`

`spend_reservations` records a `day`, but `reconcileSpend()` only reads `estimate_usd,status` and updates `spend_days where day = current_date`. A long-running benchmark reserved before midnight and reconciled after midnight will leave yesterday's `reserved_usd` inflated and move today's `actual_usd` up.

That breaks the daily cap model in both directions: yesterday can remain artificially locked, while today can be charged for spend it did not reserve.

Concrete fix:

- Select `day` with the reservation row.
- Lock `spend_days where day = $reservationDay`.
- Update that row during reconciliation and release.
- Add a DB test with a fixed reservation day and a mocked/inserted non-current day.

### P1-3: Before/after benchmark verdict can claim certainty from tiny samples

Files:

- `src/benchmarks/stats.ts:79`
- `src/benchmarks/stats.ts:88`
- `src/benchmarks/stats.ts:91`

The individual proportions use Wilson intervals, which is good. But `compareProportions()` uses a Wald standard error for the difference. At extremes, the standard error collapses to zero. Example executed locally:

```json
compareProportions(0, 3, 3, 3)
{
  "baseline": { "rate": 0, "ciHigh": 0.5614970317550455 },
  "current": { "rate": 1, "ciLow": 0.43850296824495455 },
  "diff": 1,
  "diffCiLow": 1,
  "diffCiHigh": 1,
  "verdict": "improved"
}
```

The component intervals say both rates are highly uncertain, but the difference interval says certainty is absolute. That conflicts with the product's statistical honesty principle.

Concrete fix:

- Use a Wilson/Newcombe interval for the difference in independent proportions.
- Simple conservative option: `diffLow = current.ciLow - baseline.ciHigh`, `diffHigh = current.ciHigh - baseline.ciLow`.
- Keep verdict `inconclusive` unless the difference interval excludes zero and each side meets a minimum `n`.

### P1-4: Public run ID routes join unvalidated params into filesystem paths

Files:

- `src/server/index.ts:523`
- `src/server/index.ts:535`
- `src/server/index.ts:542`
- `src/server/runStore.ts:45`

The public run endpoints accept `:runId`, pass `String(req.params.runId)` to `runDir()`, and append fixed filenames such as `status.json`, `results.json`, `progress.log`, or `report.md`. Express can decode `%2F` inside params, so encoded traversal segments can escape `RUNS_DIR`.

This is not arbitrary filename read because the appended filenames are fixed, but it is still a public path traversal class bug and should be closed centrally.

Concrete fix:

- Add `parseRunId()` or `assertRunId()` with the generated ID shape, for example `^\d{8}-\d{6}-[a-f0-9]{20}$`.
- Reject non-matching IDs with 404 or 400 before calling `runDir()`.
- In `runStore`, resolve and verify `candidate.startsWith(resolve(RUNS_DIR) + sep)` as defense in depth.

## P2 Findings

### P2-1: Signed shop cookie fails open to a hard-coded fallback secret

Files:

- `src/server/shopify.ts:22`
- `src/server/shopify.ts:23`
- `src/server/shopify.ts:35`
- `src/server/shopify.ts:78`

The signed shop cookie secret falls back to `"al-shop-cookie"` if neither the Shopify secret nor `APP_ENCRYPTION_KEY` is available. Production should have real secrets, and `requireShop()` still checks the DB shop row, but auth primitives should fail closed under misconfiguration.

Concrete fix:

- Remove the hard-coded fallback.
- If no effective secret is configured, do not accept cookie auth and log a startup warning/error.
- Prefer Shopify session token auth in embedded surfaces, with cookie only as a properly signed fallback.

### P2-2: Pixel ingest accepts shops that are marked uninstalled

Files:

- `src/server/pixel.ts:67`
- `src/server/pixel.ts:70`
- `src/db/shops.ts:75`

The pixel comment says the shop must be installed, but the code only checks that a shop row exists. Rows marked `uninstalled` can still receive browser-self-reported AI referral events.

Impact: a stale/uninstalled shop row can accumulate noisy data. If the merchant reinstalls, old forged or stale events can contaminate attribution history.

Concrete fix:

- Change the check to `if (!shop || shop.status === "uninstalled")`.
- Consider requiring the shop to have an active pixel/web-pixel id if that becomes available in the shop record.

### P2-3: Embedded app read failures are converted into demo data

Files:

- `viewer/src/app/appApi.ts:50`
- `viewer/src/app/appApi.ts:56`
- `viewer/src/app/appApi.ts:57`
- `viewer/src/app/appApi.ts:59`

`load<T>()` returns fixture/demo data for 401, 503, all non-OK responses, and thrown fetch errors. The intentional demo fallback is good for no-session preview, but connected merchants should not see sample data when a real endpoint is failing.

Impact: a production 500, broken migration, or route bug can look like a demo state instead of an operational error. This weakens merchant trust and can mask regressions.

Concrete fix:

- Return demo data only for unauthenticated/no-session preview paths.
- If the app is embedded or has a host/shop/session context and the request fails, show an error or empty state with retry.
- Keep the honest demo banner, but make it impossible for a connected merchant to confuse fixture data with a failed live backend.

### P2-4: Optional public AI endpoints charge before cap enforcement

Files:

- `src/server/index.ts:405`
- `src/server/index.ts:413`
- `src/server/index.ts:414`
- `src/server/index.ts:424`
- `src/server/index.ts:433`

`/api/prompts/suggest` and `/api/store/infer` perform paid OpenAI calls and only then record/check the resulting cost. They have rate limits and low per-call caps, but the daily spend cap is not reserved before the paid work starts.

Concrete fix:

- Use the same reservation model as benchmark runs, or at least call `spendAllows(SUGGEST_COST_CAP_USD)` before dispatch.
- Record actual cost after the call and reconcile/release.

### P2-5: Cost estimates omit fixed search/request charges

Files:

- `src/engines/models.ts:20`
- `src/engines/models.ts:24`
- `src/cli.ts:78`
- `src/benchmarks/execute.ts:43`

The pricing model estimates token costs only. The code comment notes that Perplexity sonar also bills per-request for web search. Grounded OpenAI/Gemini modes can also involve provider-specific search/grounding charges depending on model and API terms.

Impact: user-facing estimates and spend reservations can be too low exactly where live search is most expensive.

Concrete fix:

- Extend `ModelPrice` with `fixedPerCallUsd` and optionally `groundingPerCallUsd`.
- Include provider search/request fees in `estimateMaxCost()`.
- Keep a safety multiplier until pricing metadata is exact.

### P2-6: Citation-backed rate fabricates denominator 1 when there are zero mentions

Files:

- `src/benchmarks/metrics.ts:44`
- `src/benchmarks/metrics.ts:48`
- `src/benchmarks/metrics.ts:93`

When there are no merchant mentions, `citationBackedRate` is computed as `0/1` because `mentionedCount = Math.max(1, mentioned)`. That creates a fake sample size. The existing `proportion()` helper already supports `n=0`.

Concrete fix:

- Use `proportion(citationBacked, mentioned)`.
- Render `n=0` as no eligible mentions / not applicable.

### P2-7: Experiment planning does not validate proposal/product ownership

Files:

- `src/server/experiments.ts:24`
- `src/server/experiments.ts:30`
- `src/server/experiments.ts:32`
- `src/server/experiments.ts:33`
- `src/db/experiments.ts:30`

The benchmark ownership check is present, but `proposalId` and `productGid` are accepted from the request and passed into `planIntervention()` without verifying they belong to the same shop.

Today this is mostly a data-integrity issue because the values are metadata, but it is the kind of cross-tenant seam that becomes a security bug when later joins or write-backs rely on it.

Concrete fix:

- If `proposalId` is provided, load the proposal and require `proposal.shop_domain === shop`.
- If `productGid` is provided, require it exists in the shop's catalog snapshot or product table.
- Add a negative test with a valid benchmark and a proposal from another shop.

### P2-8: Feed version insert ignores failed parent-feed lock

Files:

- `src/db/feeds.ts:91`
- `src/db/feeds.ts:98`
- `src/db/feeds.ts:106`

`saveFeedVersion()` locks `select id from feeds where id=$1 and shop_domain=$2 for update`, but does not check whether a row was returned before inserting into `feed_versions`.

The HTTP handler validates before this path today, so this is a defensive invariant issue rather than an immediate endpoint bug.

Concrete fix:

- Check `rowCount === 1` after the lock query.
- Throw a typed not-found/forbidden error before inserting a version.

## P3 Findings And Polish

### P3-1: Stripe billing-event ledger failures are swallowed after processing

Files:

- `src/server/stripe.ts:231`
- `src/server/stripe.ts:239`
- `src/server/stripe.ts:241`

If entitlement provisioning succeeds but `recordBillingEvent()` fails, the handler logs and still returns 200. A future duplicate event may be reprocessed because the ledger was not recorded. Most upserts are idempotent, so this is low risk, but it weakens webhook idempotency.

Fix options:

- Record the ledger before or inside the same transactional unit as entitlement updates where possible.
- If ledger persistence is required for correctness, return 500 so Stripe retries.

### P3-2: Billing portal return URL can fall back to request host

Files:

- `src/server/billing.ts:17`
- `src/server/billing.ts:18`
- `src/server/billing.ts:20`
- `src/billing/portal.ts:20`

If both `STRIPE_PORTAL_RETURN_URL` and `PUBLIC_BASE_URL` are unset, the portal return URL is derived from `req.get("host")`. Production warnings already push toward `PUBLIC_BASE_URL`, so this is mostly a hardening item.

Concrete fix:

- Require an explicit configured return URL outside local/dev.
- Optionally validate `Host` against an allowlist before using it.

### P3-3: Webhook GraphQL registration interpolates callback URL into a mutation string

Files:

- `src/shopify/client.ts:109`
- `src/shopify/client.ts:113`
- `src/shopify/client.ts:114`

`callbackUrl` comes from server env, not user input, so this is low risk. Still, use GraphQL variables for the webhook callback URL the way the web pixel mutation already does.

### P3-4: README is still stale for external reviewers

The user-provided context correctly says to trust `IMPLEMENTATION_STATUS.md`, and I did. But the public README still reads like an earlier CLI/public-scan phase and can mislead an external reviewer about auth, Shopify surfaces, and production state.

Fix:

- Replace the README's "tonight" framing with a short production map and point detailed status to `IMPLEMENTATION_STATUS.md`.

## Security Review Notes

### Strong areas

- Shopify webhook raw-body ordering is correct: webhooks are registered before `express.json()` and use raw HMAC verification.
- OAuth/session-token handling is disciplined: timing-safe comparisons, strict `myshopify.com` normalization, exp/nbf/aud checks, single-use OAuth state, and token-exchange idempotency.
- Token-at-rest encryption is appropriate: AES-256-GCM, base64 32-byte key validation, random IV, auth tag, and explicit decrypt errors.
- The crawler SSRF layer is strong: scheme/credential/port checks, host suffix handling, private IPv4/IPv6 coverage, DNS pinning via custom lookup, redirect revalidation, content-type gating, and byte caps.
- Most `/app/api/*` endpoints are behind `requireShop`, and many handlers explicitly use `shopOf(req)` rather than trusting request body shop values.

### Hardening suggestions

- Remove the signed-cookie fallback secret.
- Require both `dest` and `iss` host consistency in session tokens if Shopify's token shape guarantees them.
- Add an admin CSRF token for state-changing admin routes as defense in depth, even with SameSite cookies.
- Add a regression test that every `/app/api/*` route has `shopMw` or a route-level auth wrapper.

## UI/UX Review

### What works

- The embedded app IA is sane: Dashboard, Measure, Catalog, Evidence, Fixes, Experiments, Monitoring, Feeds, Pixel, Billing.
- The app copy is unusually honest about mock/live modes, confidence intervals, and attribution limits.
- The dashboard avoids overclaiming and keeps operational surfaces close to actions.

### Main UX gaps

1. Landing hero is text-heavy and abstract.
   - File: `viewer/src/pages/LandingPage.tsx`
   - Above the fold does not show the actual value artifact: a score, assistant answer, competitor comparison, or fix recommendation. Add a compact proof panel that shows "AI answer -> visibility score -> fix".

2. Client-side scan configuration allows zero engines.
   - Files: `viewer/src/pages/ScanPage.tsx:67`, `viewer/src/pages/ScanPage.tsx:213`, `viewer/src/pages/ScanPage.tsx:231`, `viewer/src/pages/ScanPage.tsx:408`
   - The UI lets the user uncheck every engine and proceed until the server rejects. Disable the CTA or show inline validation when `enabledEngines.length === 0`.

3. Prompt suggestion duplicate filtering can use stale state.
   - Files: `viewer/src/pages/ScanPage.tsx:177`, `viewer/src/pages/ScanPage.tsx:180`, `viewer/src/pages/ScanPage.tsx:189`
   - `doSuggest()` awaits `ensurePrompts()` into `base`, but builds `existing` from stale `prompts`. Use `base` for duplicate filtering.

4. Modals need accessibility semantics and focus behavior.
   - Files: `viewer/src/components/ConnectShopify.tsx:37`, `viewer/src/components/ConnectShopify.tsx:38`, `viewer/src/pages/ScanPage.tsx:466`, `viewer/src/pages/ScanPage.tsx:467`
   - Add `role="dialog"`, `aria-modal="true"`, labelled title association, Escape close, focus initial/restore, and focus trap.

5. Some icon-only remove buttons lack accessible labels.
   - Files: `viewer/src/pages/ScanPage.tsx:345`, `viewer/src/pages/ScanPage.tsx:399`
   - Add `aria-label` values such as "Remove competitor" and "Remove prompt".

6. Error notes are styled as success.
   - Files: `viewer/src/app/Evidence.tsx:22`, `viewer/src/app/Evidence.tsx:38`, `viewer/src/app/Fixes.tsx:95`, `viewer/src/app/Fixes.tsx:111`
   - Use `al-note err` for errors and demo-denied states.

7. Live benchmark action is server-supported but not visible in Measure.
   - Files: `viewer/src/app/Measure.tsx:22`, `viewer/src/app/Measure.tsx:42`, `viewer/src/app/Measure.tsx:53`, `viewer/src/app/appApi.ts:122`
   - The server accepts `live: true`, but the Measure UI always calls the free preview path. Add an explicit advanced live-run action with estimate, confirmation, entitlement/cap messaging, and disabled state when unavailable.

## Data Model And Migration Notes

Strengths:

- Migrations are additive and mostly idempotent.
- Tenant scoping is explicit across shop-owned tables.
- Entitlements and billing tables use useful partial uniqueness.
- Job/spend migrations model the right concurrency primitive: locked daily rows plus reservation rows.

Concerns:

- `pixel_events` has no event-level idempotency. The browser session/event model may intentionally count each event, but duplicate beacons can inflate counts if the browser retries. Consider optional `event_id` with unique `(shop_domain, event_id)`.
- Add foreign-key-like ownership checks at handler boundaries even where the DB does not enforce them, especially proposal/product/experiment links.
- Add tests around migration re-run idempotence if not already covered by DB-gated tests.

## AI And Analysis Layer

Strengths:

- The detection layer distinguishes recommendation from mention instead of collapsing all appearances.
- Metrics carry `n` and Wilson intervals.
- The copy and outputs avoid causal claims from interventions.

Concerns:

- The before/after comparison interval is the biggest statistical issue.
- Citation-backed rate should preserve `n=0`.
- Provider extraction/matching should keep adversarial tests for brand collisions, generic names, and competitor names embedded in product titles.
- Cost estimates should include fixed grounded-search charges.

## Suggested Test Additions

High priority:

- Spend partial failure reconciles actual cost.
- Spend reservation reconciles against original reservation day.
- `compareProportions(0,3,3,3)` remains inconclusive.
- Public run routes reject encoded traversal params.
- Pixel ingest rejects `uninstalled` shops.
- App read client does not return demo fixtures for connected-session 500s.

Medium priority:

- Experiment plan rejects proposal/product IDs owned by another shop.
- Feed version insert fails when parent feed lock returns no row.
- Prompt suggestion dedupe uses generated base prompts.
- Scan CTA disabled when no engines selected.
- Modal accessibility unit or Playwright checks for dialog role and Escape close.

## Practical Fix Order

1. Patch spend accounting and stats comparison first. These protect the product's core trust model.
2. Patch run ID validation and cookie fallback next. These are small, high-confidence security hardening changes.
3. Patch pixel uninstalled-shop handling and app demo fallback semantics.
4. Add the focused tests above.
5. Then do UI polish: modal accessibility, engine validation, stale prompt dedupe, and visual proof in the landing hero.

