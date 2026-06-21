# IMPLEMENTATION_STATUS — AisleLens platform build

Master control document for the "beta → AI-commerce control plane" program. Updated
continuously. **Source of truth for what is actually built vs. designed vs. blocked.**

Legend: ✅ done & tested · 🟡 in progress · ⬜ not started · 🔒 blocked on external action
(see [`LAUNCH_CHECKLIST.md`](LAUNCH_CHECKLIST.md)) · ⏸️ intentionally deferred.

> **Honesty rule (from the brief):** a phase is complete only when persistence,
> authorization, error handling, tests, and docs all work — never because screens exist.
> Nothing below is marked ✅ unless it meets that bar.

Branch: `phase1-job-system` (foundation built off `main` so live prod is untouched until
the worker service + flag flip in the launch checklist).

---

## Cross-cutting decisions (ADRs)

- **D1 — Queue lives in Postgres, not a new broker.** We already run Supabase Postgres
  and `pg`. A `FOR UPDATE SKIP LOCKED` jobs table gives durable, atomic claiming with
  zero new infra. Runtime DML that needs row locks uses a raw `pg` pool (`src/db/pg.ts`);
  supabase-js (no locks) stays for everything else. Revisit only if throughput demands it.
- **D2 — Additive & dormant first.** Phase 1 ships tables + queue code but does NOT rewire
  the live mini-scan path. The in-process scan lock keeps serving prod until the worker
  service is deployed and `JOB_QUEUE_ENABLED=1` is verified (launch checklist). This honors
  "preserve working production behavior" and "1 replica until verified."
- **D3 — Process modes via `PROCESS_MODE`.** One image, three entrypoints: `web` (default,
  `npm start`), `worker` (`npm run worker`), `scheduler` (`npm run scheduler`). Locally /
  cheaply, `WORKER_IN_PROCESS=1` lets `web` also run the worker loop so no second Railway
  service is required to function; production separates them for isolation.
- **D4 — Shopify uses the current stable GraphQL Admin API only.** No legacy REST. Tokens
  encrypted at rest with `APP_ENCRYPTION_KEY` (AES-256-GCM). Min scopes `read_products`;
  `write_products` requested only at first approved write.
- **D5 — Never fake liveness.** Every unbuilt/credential-gated capability renders an explicit
  disabled / not-configured state; the corresponding external action is in the launch checklist.
- **D6 — Compromised Shopify secret in `imp keys.txt` is treated as burned.** Not read by any
  code; must be rotated before any Shopify work (launch checklist item 1). Never reused.

---

## Phase status

### Phase 0 — Audit & execution control ✅
- Audited CLAUDE.md, TODO.md, migrations 0001–0005, detection tests, DEPLOY.md, funnel,
  reports, payments, engine adapters, detection, cost controls, admin.
- Created this file + `LAUNCH_CHECKLIST.md`. Updating CLAUDE/TODO/.env.example as we go.
- Shopify secret warning confirmed (gitignored, unused, must rotate). Not exposed.

### Phase 1 — Production foundation (durable job system) 🟡
Built this pass (branch), tested with pure + DB-gated integration tests:
- ✅ `migrations/0006_jobs.sql` — `jobs`, `usage_ledger`, `spend_reservations` (+ indexes,
  service_role grants, idempotent).
- ✅ Persistent job states: `queued | running | completed | failed | cancelled | dead_letter`.
- ✅ Atomic claim via `FOR UPDATE SKIP LOCKED` (`src/queue/jobs.ts`).
- ✅ Idempotency keys (unique partial index; enqueue is a no-op upsert on key).
- ✅ Retry policy with exponential backoff + jitter + dead-letter on max attempts
  (`src/queue/backoff.ts`, pure-unit-tested).
- ✅ Abandoned-job recovery (heartbeat/lease timeout → requeue).
- ✅ Atomic spend reservation BEFORE work + reconcile to actuals (`src/queue/spend.ts`),
  enforced inside a transaction against a daily cap row (multi-instance safe).
- ✅ Usage ledger by shop/run/engine/model/plan with token + cost columns.
- ✅ Per-shop / per-user / per-email / global concurrency controls (claim-time counts).
- ✅ Process modes: `src/worker.ts`, `src/scheduler.ts`, `PROCESS_MODE`, npm scripts.
- ✅ Health: `/healthz` extended + `/healthz/deep` (db, queue depth, worker heartbeat,
  scheduler heartbeat, engine creds via existing `healthcheck.ts`).
- 🟡 Admin queue visibility + retry/cancel controls — endpoints built; admin UI panel
  pending (Phase 12 redesign), JSON endpoint usable now.
- 🔒 **Not yet wired to the live mini-scan path** (D2). Flip is a launch-checklist step
  after the worker Railway service exists and integration tests pass against it.

### Phase 2 — Shopify OAuth & multi-tenancy 🟡 (built against mock; 🔒 live verify)
Built + tested on branch `phase2-shopify-oauth` (off `phase1-job-system`). **`SHOPIFY_MODE=mock`
runs the entire flow with no real credentials**; flip to `live` after Track-B setup.
- ✅ `migrations/0007_shopify.sql` — `shops`, `shop_credentials` (encrypted), `installations`,
  `webhook_events` (unique dedupe → idempotency/replay), `audit_log`, `oauth_states`
  (single-use nonce store, multi-instance-safe).
- ✅ Token encryption at rest: AES-256-GCM, versioned blobs, rotation (`reEncrypt`) —
  `src/shopify/crypto.ts`. Verified tokens are never stored in plaintext.
- ✅ Strict shop-domain validation (anti open-redirect/SSRF) — `src/shopify/domain.ts`.
- ✅ Timing-safe HMAC for OAuth callback (hex, sorted query) + webhooks (base64, raw body) —
  `src/shopify/hmac.ts`.
- ✅ OAuth authorization-code flow with offline tokens, crypto state/nonce (single-use),
  shop-scoped session cookie (signed) + `requireShop` middleware — `src/shopify/oauth.ts`,
  `src/server/shopify.ts`. Live client uses the **current GraphQL Admin API** (no REST).
- ✅ Lifecycle: install / reconnect / uninstall (`app/uninstalled` clears the token),
  `shop/update`, product create/update/delete signals, **GDPR compliance webhooks**
  (`customers/data_request|redact`, `shop/redact`) — all HMAC-verified, idempotent, audited.
- ✅ Least-privilege scopes (`read_products`); `write_products` deferred to Phase 6.
- ✅ Mandatory + app webhooks registered on install (mock records, live via GraphQL).
- ✅ Health: `/healthz/deep` reports a `shopify` block. Routes 503 when not configured.
- ✅ Tests: `test/shopify.test.ts` — crypto round-trip/tamper/rotation, domain, HMAC,
  authorize URL (pure, always-on) + DB-gated (state single-use, encrypted-token round trip,
  webhook idempotency, uninstall). HTTP e2e verified: install→callback→exchange→encrypt→
  store→8 webhooks→signed session (200/redirect) and webhook gate (valid 200 / bad 401).
- ✅ **LIVE-VERIFIED on prod (2026-06-21):** real OAuth install of `ai-visibility-dev-
  m2su2ozk.myshopify.com` → shop `active`, offline token stored **encrypted** (decrypts only
  with the Railway key), install audited, 8 webhooks registered. App configured via
  `shopify app deploy` (version `ai-visibility-2`). Catalog models moved to Phase 3.
- ⬜ `/app` onboarding UI (Connect→Sync→Select→Confirm→Benchmark→Baseline) is Phase 12 IA;
  the URL-based free scan for non-Shopify prospects is retained unchanged.

### Phase 3 — Product-level catalog intelligence 🟡 (backend built + tested; UI = Phase 12)
Built on branch `phase3-catalog`. Pulls the catalog using the decrypted offline token.
- ✅ `migrations/0008_catalog.sql` — `products`, `product_variants`, `collections`,
  `product_collections`, `catalog_syncs` (resumable cursor), `catalog_snapshots`.
- ✅ `src/catalog/source.ts` — GraphQL Admin API products query, cursor pagination,
  adaptive **rate-limit/throttle handling** (leaky-bucket restoreRate) + retries; mock
  fixture (7 products / 2 pages) for $0 testing. Single-product fetch for incrementals.
- ✅ `src/catalog/normalize.ts` — pure map (ids, title, HTML-stripped description, vendor,
  type, tags, url, image, variant options, price, sku/barcode/GTIN, SEO, metafields).
- ✅ `src/db/catalog.ts` — **deterministic upserts** (re-sync converges; removed variants/
  collection-links pruned), sync tracking, snapshots, search/list.
- ✅ `src/catalog/sync.ts` — full **resumable** sync, incremental single-product upsert +
  delete (wired to `products/*` webhooks), `catalog_sync` queue handler.
- ✅ Shop-scoped API: `POST/GET /app/api/catalog/sync[/status]`, `GET /app/api/catalog/products`
  (requireShop). Enqueues when the worker is on, else runs inline.
- ✅ Tests `test/catalog.test.ts`: normalize (pure) + DB-gated upsert/prune + **full mock
  sync (7 products, idempotent)**. Brand-mention vs SKU kept distinct (variants are rows).
- ⬜ `/app/catalog` UI (search/filter/health/selection) → Phase 12. Live sync against the
  real store is free (Shopify reads) — triggerable post-deploy via the shop session.

### Phase 4 — Statistically credible benchmarks 🟡 (statistical foundation built + tested)
Built on branch `phase4-benchmarks`. The pure statistical + data + intent core is done and
unit-tested; live multi-engine execution wiring is the remaining piece.
- ✅ `migrations/0009_benchmarks.sql` — `benchmarks` (versioned config), `benchmark_runs`,
  `observations` (one row per engine answer × brand; captures engine/model/grounding/
  prompt-version/rank/sentiment/citations/snippet/latency/cost/`classification_method`/
  `response_id`). `shop_domain` nullable so the URL free-scan reuses it.
- ✅ `src/benchmarks/stats.ts` — **Wilson CIs** for proportions (well-behaved at small n),
  mean+stderr, volatility, share-of-voice, engine divergence, and a two-proportion
  **compareProportions** that returns improved/regressed/**inconclusive** (CI of the diff
  must exclude 0 — "no evidence of change" ≠ "declined"). Unit-tested.
- ✅ `src/benchmarks/intents.ts` — deterministic shopper-intent cohort across all 10
  taxonomy types (category discovery → alternatives). Unit-tested.
- ✅ `src/benchmarks/metrics.ts` — pure `aggregate(observations, brand)` → recommendation/
  mention/top-choice rates, avg position, prompt coverage, citation-backed rate, SoV,
  per-engine breakdown + divergence, per-answer win/loss — all with CIs + sample sizes.
  `compareRuns` for baseline-vs-verification. Unit-tested.
- ✅ `src/db/benchmarks.ts` — CRUD + versioned config, `createRun`, `insertObservation`,
  `finishRun`, `getObservations`, `aggregateRun`.
- ✅ `src/benchmarks/execute.ts` — expands product×prompt×engine×repetition → calls each
  engine (reuses existing adapters) → deterministic detection → stores one observation per
  assessed brand (own + competitors, shared `response_id`). Live runs **reserve worst-case
  spend up front** (Phase-1 atomic reservation) + reconcile to actuals + write the usage
  ledger; on cap-hit the run fails cleanly without spending. Errors record an own-brand
  not_mentioned row so the denominator stays honest. Queue handler `benchmark_run`
  registered in the worker.
- ✅ **Verified end-to-end against the mock engine ($0):** a 2-rep × 3-engine cohort →
  140 observations → recommendation rate 30% [CI 20–43%, n=60], mention/coverage, engine
  divergence, win/loss, share-of-voice. Self-cleaned. A real run spends money (per-scan +
  $25/day caps; always cost-confirmed with the user first).
- ⬜ Follow-ups: optional LLM adjudication pass (`classification_method` column ready);
  Claude adapter when its current API/grounding are configured (degrade gracefully);
  reuse the concurrency runner for large cohorts (currently sequential).

**Phase 4 status: functionally complete (mock-verified); live runs gated on cost confirmation.**

### Phase 5 — Evidence & diagnosis engine (crawler) 🟡 (built + mock-verified $0; 🔒 live verify)
Built on branch `phase5-crawler` (off `phase4-benchmarks`). `CRAWLER_MODE=mock` (the
default) runs the entire pipeline against fixtures at $0 with **no network**; `live`
makes outbound HTTP requests (spends no API money — gated for the network access).
**SSRF + prompt-injection are the primary threat model.**
- ✅ `migrations/0010_crawler.sql` — `crawl_pages` (sanitized, untrusted artifacts;
  unique on `(coalesce(run_id,0), url)` so re-crawl converges) + `findings`
  (two-tier: `evidence_backed` | `general_hygiene`). Additive + idempotent.
- ✅ `src/crawler/ssrf.ts` — URL guard: http/https only, no credentials, port allowlist,
  literal-host blocklist (localhost/*.internal/.local/metadata names), and full IPv4+IPv6
  classification (loopback, RFC1918, CGNAT, link-local incl. `169.254.169.254`, multicast,
  reserved, IPv4-mapped/NAT64/6to4 embedded forms). `pickPublicAddress` PINS the socket to
  a validated IP (DNS-rebinding-safe). Exhaustively unit-tested.
- ✅ `src/crawler/fetch.ts` — bounded fetcher on `node:http/https` with a validating DNS
  `lookup` hook (so the connected IP is the one we vetted), per-request timeout, byte cap
  (socket destroyed on overflow), bounded redirects **each re-validated through the guard**,
  content-type allowlist, and a peer-address re-check (defense in depth).
- ✅ `src/crawler/robots.ts` — robots.txt fetch (via the safe fetcher) + parse + longest-match
  allow/deny for our UA (falls back to `*`); respected per origin (cached).
- ✅ `src/crawler/sanitize.ts` — `sanitizeHtml` (strip scripts/handlers/`javascript:`),
  `htmlToText`, `detectInjection` (curated hijack-cue list), `wrapUntrusted` (fences any
  future LLM input). All crawled text is treated as untrusted data, never instructions.
- ✅ `src/crawler/extract.ts` — pure extraction: JSON-LD/`@graph`, Product/Offer, identifiers
  (GTIN/MPN/SKU/brand), price/availability, shipping (`OfferShippingDetails`) + returns
  (`MerchantReturnPolicy`), AggregateRating (rating + review count), headings, FAQ (`FAQPage`),
  canonical + `robots`/noindex signals, and presence booleans the diagnosis layer diffs.
- ✅ `src/crawler/crawl.ts` (+ `fixtures.ts`) — bounded orchestration: page/depth caps,
  same-origin link-following, dedupe, robots respect; `crawlOne` never throws (failures land
  on the page). Mock fixtures (thin merchant vs rich competitor + an injection page).
- ✅ `src/diagnosis/diagnose.ts` — PURE findings. Joins observations (the lost intent, winning
  competitor, AI answer snippet + citations) with crawled merchant/competitor structured
  signals → evidence-backed gap + recommended intervention + **expected MECHANISM (hedged,
  never a guaranteed outcome; no causation inferred from a competitor merely having X)** +
  confidence/`basisN`/limits. Plus `general_hygiene` findings for structural deficiencies.
- ✅ `src/db/crawler.ts` + `src/diagnosis/execute.ts` — shop-scoped persistence (upsert on
  `(run_id,url)`; findings replaced per run = idempotent) + orchestrator + `evidence_diagnose`
  queue handler (registered in the worker). Mock by default; live requires `payload.live`.
- ✅ Shop-scoped API `src/server/evidence.ts`: `POST /app/api/evidence/diagnose`,
  `GET /app/api/evidence/findings`, `GET /app/api/evidence/pages` (each verifies the run
  belongs to the caller's shop — tenant isolation). Enqueues when the worker is on, else inline.
- ✅ Tests `test/crawler.test.ts` (20 always-on + 1 DB-gated): SSRF deny-list (v4/v6/mapped),
  `safeFetch` refusal before connect, robots, sanitize/injection, extraction, bounded crawl
  (mock), and diagnosis (mechanism present, no guarantee, hygiene tier). `npm test` 61 pass /
  11 skipped / 0 fail; `npm run typecheck` clean.
- ⬜ Follow-ups: capture REAL engine citations into `observations.citations` (Phase 4 stores
  `[]` today) so live diagnosis derives competitor URLs automatically; UI surfaces (Phase 12);
  optional LLM adjudication over `wrapUntrusted` evidence. Live crawl needs `CRAWLER_MODE=live`
  + user go (network).

**Phase 5 status: functionally complete (mock-verified, $0); live crawl gated on user go.**

### Phase 6 — Fix Studio (`/app/fixes`) ⬜
Evidence-backed proposals with current/proposed/diff/approval. Merchant-approved GraphQL
`write_products` with re-read conflict check, rollback snapshot, audit, partial-failure
reporting. Themes/schema → validated copy-ready output + future theme-app-extension path.

### Phase 7 — Experiments & verification (`/app/experiments`) ⬜
`interventions` + matched baseline/verification benchmarks; improved/inconclusive/regressed
classification with CIs. **The central differentiator: "prove whether it worked."**

### Phase 8 — Monitoring & alerts ⬜
Recurring schedules (scheduler from Phase 1) + triggers. Notification provider interface,
dev logger first, email adapter (Phase 11 env). Historical dashboards w/ comparability flags.

### Phase 9 — Product feeds & agentic readiness ⬜🔒
Versioned feed validator vs current official OpenAI commerce spec (consult docs at build).
Readiness score = factual validations only. Export CSV/JSONL where officially supported.
Delivery/onboarding behind explicit config (launch checklist). Normalized catalog layer so
Gemini/Copilot/Shopify-Catalog adapters slot in without rewriting storage.

### Phase 10 — Directional attribution (Web Pixel) ⬜🔒
Shopify Web Pixel extension (official Web Pixels API), consent-aware AI-referrer + funnel
events. "Identifiable AI-referred sessions," not full causal attribution. Needs extension deploy.

### Phase 11 — Commercial product & entitlements ⬜
Central `entitlements` model (config-driven limits), preserve current Stripe flows during
migration. Idempotent provisioning, refunds, failed payments, cancellation, expiration,
billing portal. No hardcoded unapproved prices.

### Phase 12 — Experience redesign (`/app/*`) ⬜
Authenticated product IA (dashboard/catalog/benchmarks/runs/evidence/fixes/experiments/
monitoring/settings/billing). Keep dark system. New homepage positioning (headline
"Turn AI shopping visibility into action." / CTAs Connect Shopify · Run a free scan).
Full loading/empty/partial/unavailable/denied/cost-limit/retry/failure states. Playwright.

### Phase 13 — Security, privacy & quality ⬜ (continuous)
Token encryption+rotation, OAuth state/HMAC, webhook verify/idempotency, shop isolation,
CSRF, secure cookies/headers, rate limits, SSRF, prompt-injection, output schema validation,
secret redaction, data export/deletion, compliance webhooks, audit logging, least privilege.
Tests: queue, stats, catalog mapping, detection, crawler, feed validation, fix apply/conflict/
rollback, OAuth, webhooks. Threaded through every phase, hardened before review submission.

---

## External blockers (summary → details in LAUNCH_CHECKLIST.md)
1. 🔒 Rotate exposed Shopify secret.
2. 🔒 Shopify Partner app + API key/secret + callback URLs + scopes + compliance webhooks.
3. 🔒 `APP_ENCRYPTION_KEY` (token encryption at rest).
4. 🔒 Railway `worker` + `scheduler` services.
5. 🔒 Email provider + verified domain.
6. 🔒 Stripe products/prices/webhook/portal (live).
7. 🔒 Web Pixel extension deploy.
8. 🔒 OpenAI product-feed onboarding/eligibility.
9. 🔒 Legal/support/data-deletion URLs for app review.

## Verification log
- Phase 1: `npm test` (pure queue unit tests + existing 16 detection) green; `npm run
  typecheck`; `viewer` build; DB-gated integration tests run once against Supabase with
  cleanup (see commit notes). Live funnel untouched (dormant).
- Phase 5: `npm test` 61 pass / 11 skipped (DB-gated) / 0 fail; `npm run typecheck` clean.
  Full crawl→extract→diagnose pipeline mock-verified at $0 with NO network
  (`CRAWLER_MODE=mock` default). SSRF deny-list exhaustively unit-tested (IPv4/IPv6/mapped,
  metadata, ports, schemes, credentials); `safeFetch` refuses blocked URLs before connecting.
  DB-gated `diagnoseRun` end-to-end test (persists + idempotent re-run) ready behind
  `RUN_DB_TESTS=1` + migration `0010` (not yet applied to Supabase — network, awaiting go).
