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

### Phase 6 — Fix Studio (`/app/fixes`) 🟡 (built + mock-verified $0; 🔒 live write needs write_products + go)
Built on branch `phase6-fixes` (off `phase5-crawler`). Turns diagnosis findings + catalog
data into reviewable change proposals, and applies approved ones through a gated, reversible
write-back path. **Mock-verified end-to-end at $0** (no network/credentials); the only
store-writing path is `applyProposal`, gated four ways.
- ✅ `migrations/0011_fixes.sql` — `fix_proposals` (lifecycle: proposed → approved → applied |
  failed | conflict | rolled_back | dismissed; `based_on` baseline + `applied_snapshot` for
  rollback). Also `alter table findings add column signal` (additive) so a finding maps to its fix.
- ✅ `src/fixes/propose.ts` (pure) — two tiers: **write_products** (only SEO-title/description
  backfill — exact, reversible reformats of data the merchant ALREADY has; **never fabricates**
  review counts/GTINs/prices) and **copy_ready** (validated JSON-LD: a factual Product snippet
  built from the catalog, plus clearly-placeholdered AggregateRating/Offer-shipping/return/FAQ
  templates the merchant fills with their real numbers).
- ✅ `src/fixes/source.ts` — `rereadProduct` (re-read for the conflict check) + `productUpdate`
  (GraphQL Admin `productUpdate`; mock simulates + records the write so re-read/rollback are
  observable at $0). `src/fixes/apply.ts` — the write-back engine: **approval-gated**,
  **write_products-scope-gated** (`hasWriteScope`), **re-read conflict-checked** (never clobbers
  a value changed since the proposal), **snapshotted for rollback**, **audited**, with
  partial-failure (`userErrors`) surfaced. `rollbackProposal` is itself conflict-checked so it
  won't clobber a newer merchant edit.
- ✅ Shop-scoped API `src/server/fixes.ts`: `POST /app/api/fixes/propose`, `GET /app/api/fixes`,
  `POST /app/api/fixes/:id/{approve,apply,rollback,dismiss}` (each tenant-isolated; apply returns
  409 on conflict, 422 on failure).
- ✅ Tests `test/fixes.test.ts` (5 pure + 2 DB-gated): proposal generation (no fabrication),
  scope gate, input shaping, and the full **approve → conflict-checked apply → rollback** lifecycle
  + conflict + scope-denied refusals (mock store writes). Migration `0011` applied to Supabase;
  full suite **80/80** with `RUN_DB_TESTS=1 SHOPIFY_MODE=mock`; typecheck clean.
- ⬜ Follow-ups: writing metafields (richer direct writes) once needed; theme-app-extension path
  for JSON-LD instead of copy-paste; Fix Studio UI (Phase 12). **Live writes require the merchant
  to grant `write_products` (re-consent) + a user go.**

**Phase 6 status: functionally complete (mock-verified, $0); live writes gated on scope + go.**

### Phase 7 — Experiments & verification (`/app/experiments`) 🟡 (built + mock-verified $0; 🔒 live runs cost-gated)
Built on branch `phase7-experiments` (off `main`). **The central differentiator: "prove
whether it worked."** A matched pair of benchmark runs (the SAME definition, before vs after
an intervention) compared metric-by-metric with Wilson CIs. Mock-verified end-to-end at $0.
- ✅ `migrations/0012_experiments.sql` — `interventions` (the merchant change: fix_applied |
  copy_applied | manual; links a `fix_proposals.id`) + `experiments` (matched
  `baseline_run_id`/`verification_run_id` + verdict + `result`/`comparability` jsonb). Additive.
- ✅ `src/experiments/verify.ts` (pure) — `compareExperiment` reuses the Phase-4 two-proportion
  test (Wilson CIs) across recommendation/mention/top-choice/coverage/citation rates →
  **improved | regressed | inconclusive** (CI of the difference must exclude 0). Emits
  **comparability warnings** (engine model changed between runs, engine-set/prompt-count/
  repetition mismatch, low power, denominator change) and **causation caveats** — association,
  not proof; confounders (model updates, index refreshes, competitor moves, run-to-run variance)
  are surfaced, never hidden. "Inconclusive" is a first-class, honest outcome.
- ✅ `src/db/experiments.ts` + `src/experiments/execute.ts` — `planIntervention` →
  `captureBaseline` (run BEFORE) → `runVerification` (run AFTER + compare + persist verdict).
  Reuses Phase-4 `executeBenchmark` (mock $0; live reserves worst-case spend up front) +
  `aggregateRun`. `experiment_verify` queue handler registered in the worker (mock default;
  live requires `payload.live`).
- ✅ Shop-scoped API `src/server/experiments.ts`: `POST /app/api/experiments/plan`,
  `POST /app/api/experiments/:id/{baseline,verify}`, `GET /app/api/experiments[/:id]`,
  `GET /app/api/interventions` — each tenant-isolated; baseline/verify default to mock, a live
  run needs explicit `{ live: true }`.
- ✅ Tests `test/experiments.test.ts` (4 pure + 1 DB-gated): verdict classification,
  comparability/low-power flags, causation caveats, and the full **plan → baseline →
  verification** e2e (deterministic mock → identical runs → honest *inconclusive*). Migration
  `0012` applied to Supabase; full suite **86/86** with `RUN_DB_TESTS=1 SHOPIFY_MODE=mock`; typecheck clean.
- ⬜ Follow-ups: auto-open an experiment when a Phase-6 fix is applied; scheduled re-verification
  (Phase 8); UI (Phase 12). **Live baseline/verification spend money — cost-gated + user go.**

**Phase 7 status: functionally complete (mock-verified, $0); live runs gated on cost + go.**

### Phase 8 — Monitoring & alerts 🟡 (built + mock-verified $0; 🔒 live cadence + email gated)
Built on branch `phase8-monitoring` (off `phase7-experiments`). Closes the loop: re-run a
benchmark (or re-verify a fix) on a cadence and alert on **statistically credible** change.
Mock-verified at $0.
- ✅ `migrations/0013_monitoring.sql` — `schedules` (cadence + next_run_at + last_run_id),
  `alerts` (regression/improvement/threshold/competitor_overtake + CI-backed `comparison`),
  `notifications` (delivery log). Additive.
- ✅ `src/monitoring/alerts.ts` (pure) — `nextRunAt` cadence math + `evaluateAlerts(current,
  previous)`: a regression/improvement alert fires **only when the 95% CI of the difference
  excludes 0** (no cry-wolf on run-to-run noise); "inconclusive" is silent. Also threshold-floor
  + share-of-voice **competitor-overtake** (lead flip). Never claims causation — alerts say
  "your measured visibility moved", with the comparison attached.
- ✅ `src/notify/provider.ts` — `NotificationProvider` interface + `LoggerProvider` (default,
  dev-safe) + `EmailProvider` (gated on `EMAIL_*`; reports `skipped` rather than faking a send
  until the Phase-11 HTTP integration). `getProvider()` picks by config.
- ✅ `src/db/monitoring.ts` + `src/monitoring/execute.ts` — `monitorRun` (re-run → compare to
  the previous run → raise alerts → notify → advance cadence) reusing Phase-4 `executeBenchmark`/
  `aggregateRun` and Phase-7 `runVerification`. `runDueSchedules` enqueues due schedules;
  `monitor_run` worker handler. **Wired into the Phase-1 scheduler** (`src/scheduler.ts`).
- ✅ Recurring runs are **mock ($0) by default**; the scheduler enqueues LIVE engine spend only
  when `MONITORING_LIVE=1` (so monitoring never auto-spends without an explicit opt-in; still
  under the daily cap).
- ✅ Shop-scoped API `src/server/monitoring.ts`: `POST/GET /app/api/schedules`,
  `POST /app/api/schedules/:id[/delete|/run]`, `GET /app/api/alerts`,
  `POST /app/api/alerts/:id/acknowledge` — tenant-isolated.
- ✅ Tests `test/monitoring.test.ts` (4 pure + 2 DB-gated): cadence, CI-gated alert verdicts
  (incl. **no false alert on identical runs**), provider behavior, schedule run + advance, alert
  lifecycle. Migration `0013` applied; full suite green with `npm run test:db`; typecheck clean.
- ⬜ Follow-ups: real email dispatch (Phase 11 env), per-merchant alert recipients/preferences,
  historical dashboards (Phase 12). **Live recurring runs need `MONITORING_LIVE=1` + a user go.**

**Phase 8 status: functionally complete (mock-verified, $0); live cadence + email gated.**

### Phase 9 — Product feeds & agentic readiness 🟡 (built + verified $0; 🔒 live DB apply + delivery gated)
Built on branch `phase9-feeds` (off `main`). A **versioned product-feed generator +
validator + agentic-readiness score** over the normalized catalog (Phase 3). Pure local
computation — **$0 and NO network**; the one network action was a read-only fetch of the
CURRENT official OpenAI spec at build time (logged below). Generating a feed is **not**
submitting it — OpenAI onboarding/delivery is an external, config-gated step.
- ✅ **Spec fetched live, encoded as auditable data:** `src/feeds/spec.ts` records the
  OpenAI Agentic Commerce product-feed spec from `developers.openai.com/commerce`
  (fetched 2026-06-21) — the 14 always-required fields, conditional/recommended/optional
  tiers, enums (availability/condition), formats, + **provenance** (source URL, fetch date,
  `SPEC_VERSION="2026-01-30"` flagged `versionConfirmed:false` because the rendered docs
  expose no machine-readable version). `return_policy` discrepancy (Products table says
  Required; required-only view omits it) is **marked**, not silently resolved — treated as
  conditional-on-checkout.
- ✅ `src/feeds/map.ts` (pure) — normalized product → **one record per variant** (OpenAI
  per-item granularity; `group_id`/`variant_dict` tie variants). **Never fabricates**
  (same discipline as Phase 6): catalog-absent fields stay absent; merchant decisions
  (currency, eligibility flags, seller identity, target/store countries) come from per-feed
  config with safe derived defaults. ARCHIVED always excluded; DRAFT excluded unless opted in.
- ✅ `src/feeds/validate.ts` (pure) — **FACTUAL/structural checks only**: required presence,
  conditional (checkout→privacy/tos/return; pre_order→availability_date), eligibility
  invariant, enum membership, http(s) URL well-formedness (https-preferred), price format
  + sale≤price, **full ISO-3166-1 alpha-2** country validation, ISO-8601 dates, **GTIN
  check-digit** (8/12/13/14), length limits, all-caps title; FEED-level **duplicate item_id**.
  Two levels (error = would be rejected / warning = accepted-but-weaker). No network 200-check
  (documented limit, not a claim).
- ✅ `src/feeds/readiness.ts` (pure) — documented deterministic 0..100 score
  (`0.45·validity + 0.25·requiredCompleteness + 0.20·recommendedCoverage + 0.10·identifierCoverage`),
  every component (weight/value/points/the count behind it) exposed — **never a black box**.
- ✅ `src/feeds/export.ts` (pure) — CSV/TSV/JSON (all **officially** accepted) + JSONL
  (convenience, `official:false`), correct escaping, spec-ordered columns.
- ✅ `migrations/0014_feeds.sql` — `feeds` (definition+config), `feed_versions` (snapshot +
  readiness + summary, version per feed), `feed_items` (one record + issues per item).
  Additive + idempotent; `shop_domain` scopes every row; format-agnostic for future
  Gemini/Copilot/Shopify-Catalog adapters.
- ✅ `src/db/feeds.ts` + `src/db/catalog.ts#loadNormalizedProducts` + `src/feeds/generate.ts`
  — orchestrator: load synced catalog → map → validate → score → persist a NEW version
  atomically (row-locked version numbering; chunked item insert). `feed_generate` queue
  handler (no mock/live split — it's $0 everywhere). Re-generating preserves history.
- ✅ Shop-scoped API `src/server/feeds.ts`: `POST/GET /app/api/feeds`, `GET /app/api/feeds/spec`
  (transparency), `GET /app/api/feeds/delivery/status` (honest not-configured state),
  `POST /app/api/feeds/:id/generate` (enqueue when worker on, else inline; 409 on empty
  catalog), `GET /app/api/feeds/:id/versions`, `GET /app/api/feeds/versions/:vid[/items|/export]`
  — each tenant-isolated; config whitelisted (no arbitrary jsonb persisted).
- ✅ Tests `test/feeds.test.ts` (13 pure + 1 DB-gated): spec/provenance, mapping (per-variant,
  no-fabrication, draft/archived filter), validation (required/conditional/enums/urls/countries/
  dates/gtin/price/duplicate-id), readiness transparency, export escaping, format helpers + a
  DB e2e (empty→NoCatalogError, generate→version+items+readiness+export, re-gen→v2). `npm test`
  **89 pass / 20 skipped / 0 fail**; `npm run typecheck` clean.
- ✅ **Migration `0014` APPLIED to Supabase (2026-06-21); DB-gated e2e PASSED** (14/14 against
  the live DB: empty→NoCatalogError, generate→version+items+readiness+export, re-gen→v2,
  self-cleaned). Code merge to `main` + deploy still await a user go.
- ⬜ Follow-ups: capture shop currency at catalog sync (currency is config/default today);
  Gemini/Copilot/Shopify-Catalog mappers; Feeds screen (Phase 12); review_count/star_rating +
  shipping/returns from metafields; version pruning. **Delivery to OpenAI needs
  `FEED_DELIVERY_ENABLED=1` + OpenAI merchant onboarding + a user go (external).**

**Phase 9 status: ✅ LIVE in production (merged + deployed 2026-06-21, commit `c178cb4`); feed DELIVERY to OpenAI remains external/config-gated.**

### Phase 10 — Directional attribution (Web Pixel) 🟡 (built + verified $0; 🔒 extension deploy gated)
Built on branch `phase10-pixel` (off `main`), mock-verified at $0. A Shopify **Web Pixel
extension** (official Web Pixels API) detects storefront sessions that arrived from an AI
assistant and beacons consent-gated funnel events to a public ingest endpoint → directional
attribution. **"Identifiable AI-referred sessions," NOT causal attribution** (AI assistants
strip referrers, so it undercounts — surfaced as a floor).
- ✅ `migrations/0015_pixel.sql` — `pixel_events` (session/event/ai_source/referrer_host/
  utm/landing_path/consent/ip_hash; additive, idempotent, shop-scoped).
- ✅ `src/pixel/referrer.ts` (pure) — server-authoritative AI classifier (ChatGPT/Perplexity/
  Gemini/Copilot/Claude by host + utm_source). **Deliberately conservative**: plain
  google.com/bing.com are organic search, NOT AI (only assistant subdomains count) — a miss
  beats mislabeling normal traffic.
- ✅ `src/pixel/event.ts` (pure) — validates the untrusted public beacon: shop normalize,
  event-type enum, session-id shape, consent honored, **PII minimized** (referrer HOST +
  landing PATH only, query stripped), client-clock clamp.
- ✅ `src/db/pixel.ts` + `src/server/pixel.ts` — `POST /api/pixel/ingest` (PUBLIC, CORS +
  preflight, per-IP rate-limit, consent-gated, **install-scoped** via `getShop`, server
  re-classifies, no raw IP — only salted hash; always 202s so a beacon never breaks a
  storefront) + shop-scoped `GET /app/api/pixel/attribution` (distinct-session funnel by
  source). **Honest security posture documented**: a storefront pixel can't hold a real
  secret, so `PIXEL_SHARED_SECRET` is a weak anti-noise gate, never auth.
- ✅ `extensions/ai-referral-pixel/` — the Web Pixel extension (`shopify.extension.toml` with
  `customer_privacy.analytics=true` platform consent gate + settings; `src/index.js` persists
  the original AI referrer in sessionStorage so later funnel events stay attributed; README
  deploy steps). **This is the merchant/owner-deployed artifact (`shopify app deploy`).**
- ✅ Tests `test/pixel.test.ts` (10 pure + 1 DB-gated): classifier (each assistant + no
  false-positive on organic search + utm fallback), beacon validation (bad shop/type/session,
  consent honored, PII stripping, clock clamp), and a DB e2e (distinct-session funnel,
  consent-filtered). `npm test` 99 pass / 21 skipped / 0 fail; `npm run typecheck` clean.
- ✅ **Migration `0015` APPLIED to Supabase (2026-06-21); DB-gated e2e PASSED** (11/11 against
  the live DB: distinct-session funnel by source + consent filtering, self-cleaned). Code merge
  to `main` + deploy still await a user go.
- 🔒 The Web Pixel **extension deploy** (`shopify app deploy`) + activation + settings is an
  external step only the app owner can do (LAUNCH_CHECKLIST item 8).
- ⬜ Follow-ups: surface attribution in the `/app` UI (Phase 12); add-to-cart funnel step;
  optional server-pixel path for higher-fidelity checkout events.

**Phase 10 status: ✅ LIVE in production (merged + deployed 2026-06-21, commit `b7e1184`); the storefront Web Pixel extension deploy (`shopify app deploy`) remains an external step to start data collection.**

### Phase 11 — Commercial product & entitlements ⬜
Central `entitlements` model (config-driven limits), preserve current Stripe flows during
migration. Idempotent provisioning, refunds, failed payments, cancellation, expiration,
billing portal. No hardcoded unapproved prices.

### Phase 12 — Experience redesign (`/app/*`) 🟡 (core IA built + preview-verified)
Built on branch `phase12-app-ui` (off `main`). The authenticated embedded experience that
finally makes the headless Phase 4–8 backend **visible + demoable**. Dark system, same tiny
token palette. Preview-verified (vite) end-to-end with zero console errors.
- ✅ `viewer/src/app/` — embedded shell (`AppShell.tsx`, sticky sidebar nav, sub-routes via the
  shared tiny history router) wired into `App.tsx` (`/app`, `/app/{evidence,fixes,experiments,
  monitoring}`), rendered standalone (own chrome, no public header/footer).
- ✅ **Screens (prop-driven, dark, all states):** Dashboard (AI Visibility Score ring, headline
  KPIs with CIs, the 5-step measure→diagnose→fix→verify→monitor loop, share-of-voice,
  open alerts) · Evidence (findings: AI answer + citations + merchant gap + competitor
  advantage + intervention + hedged mechanism + confidence/limits) · Fix Studio (proposals
  with current/proposed diff, copy-ready snippets, approve/apply/dismiss) · Experiments
  (baseline→verification with CI bars, improved/regressed/inconclusive verdict, comparability
  warnings + causation caveats) · Monitoring (schedules + acknowledgeable alerts).
- ✅ `appApi.ts` calls the real `/app/api/*`; on **401/503/unavailable it falls back to demo
  fixtures and flags `demo:true`** → an honest "Demo data" badge + a Connect-store prompt
  (this doubles as the unavailable/denied state — we never fake liveness). `useLoaded` gives
  uniform loading/empty/error. `fixtures.ts` carries the Caraway loop story for $0 preview.
- ✅ New homepage positioning (`LandingPage`): headline "Turn AI shopping visibility into
  action", CTAs **Connect Shopify** + Run a free scan + See the app.
- ✅ `viewer build` green (66 modules); preview-verified all 5 screens + responsive (sidebar
  collapses < 920px) + the homepage, desktop + narrow.
- ⬜ Follow-ups: Catalog/Settings/Billing screens; live wiring against a connected dev store;
  Playwright e2e; the onboarding wizard (Connect→Sync→Select→Benchmark→Baseline). Pre-existing
  viewer `tsc` errors (Report/IndexLeaderboard) are unrelated and don't block the esbuild build.

**Phase 12 status: core authenticated IA built + preview-verified; demoable now via fixtures.**

### Phase 13 — Security, privacy & quality ⬜ (continuous)
> **Known item — dev/prod DB isolation:** local dev shares the production Supabase project,
> so local **live** runs write into prod tables (`benchmark_runs`/`spend_days`/…) and show up in
> prod `/healthz` + count against the prod spend cap (observed 2026-06-21: a $0.0439 local
> benchmark run appeared as prod `spendTodayDbUsd`). Fix = a separate dev/staging Supabase
> (LAUNCH_CHECKLIST §11). Until then, run local work in mock mode ($0, no costly prod-DB writes).
Token encryption+rotation, OAuth state/HMAC, webhook verify/idempotency, shop isolation,
CSRF, secure cookies/headers, rate limits, SSRF, prompt-injection, output schema validation,
secret redaction, data export/deletion, compliance webhooks, audit logging, least privilege.
Tests: queue, stats, catalog mapping, detection, crawler, feed validation, fix apply/conflict/
rollback, OAuth, webhooks. Threaded through every phase, hardened before review submission.

---

## 🟢 LIVE DEPLOYMENT STATE (updated 2026-06-21, commit `b7e1184`)
**Phases 1–10 + 12 are merged to `main` and LIVE in production** at https://lens.thirdocular.com.
Verified end-to-end via `/healthz` + `/healthz/deep` + smoke tests on each deploy.
- **All 15 migrations applied** to Supabase (`0001`–`0015`; `0015_pixel` applied 2026-06-21).
- **Multi-process is LIVE:** one image, three Railway services via `PROCESS_MODE` dispatch
  (`src/start.ts`). `web` (the site + API) + `worker` + `scheduler` all deployed and
  **heartbeating** (`/healthz/deep`). `JOB_QUEUE_ENABLED=1` on web → durable queue + scheduled
  monitoring are **running** (recurring runs stay mock/$0 until `MONITORING_LIVE=1`).
- **Shopify:** live OAuth (`read_products`); API secret **rotated** 2026-06-21.
- **The embedded `/app` UI is live** (demo-fallback for non-sessions). Homepage repositioned.
- **Phase 9 (Product feeds & agentic readiness) is LIVE** (merged + deployed 2026-06-21,
  commit `c178cb4`; `/healthz/deep` green, new worker heartbeating with the `feed_generate`
  handler, `/app/api/feeds/*` registered + tenant-gated). 89 pure pass / 0 fail; migration
  `0014` applied + DB-gated e2e 14/14; both reviews clean/fixed.
  **Phase 10 (Web Pixel attribution) is LIVE** (merged + deployed 2026-06-21, commit `b7e1184`;
  `/healthz/deep` green, new worker heartbeating, `/api/pixel/ingest` smoke-verified —
  preflight 204/CORS, bad-payload 400, unknown-shop 202 no-op, attribution read 401). The
  external Web Pixel **extension deploy** (`shopify app deploy` + activate + Ingest URL) is the
  only remaining step to start collecting data. **Next unbuilt: Phase 11** (commercial/entitlements);
  Phase 13 (continuous security) also remains. The live (non-demo) loop for real merchants
  needs a merchant to install + (optionally) `MONITORING_LIVE=1` / `CRAWLER_MODE=live` (both
  gated, spend-capped). Feed DELIVERY to OpenAI still needs `FEED_DELIVERY_ENABLED=1` +
  external onboarding (generating ≠ submitting).

## External blockers (summary → details in LAUNCH_CHECKLIST.md)
1. ✅ Rotate exposed Shopify secret — **done 2026-06-21**.
2. ✅ Shopify Partner app + API key/secret + callback URLs + scopes + compliance webhooks — live.
3. ✅ `APP_ENCRYPTION_KEY` (token encryption at rest) — set (live OAuth works).
4. ✅ Railway `worker` + `scheduler` services + `JOB_QUEUE_ENABLED=1` — **done 2026-06-21**.
5. 🔒 Email provider + verified domain (Phase 8 send lands in Phase 11; logger until then).
6. 🔒 Stripe products/prices/webhook/portal (live) — needs KYC + Phase 11.
7. 🔒 Web Pixel extension deploy — Phase 10 build **done** (ingest + classifier + attribution +
   the extension in `extensions/ai-referral-pixel/`); still needs `shopify app deploy` +
   activation + settings (Ingest URL) by the app owner, and migration `0015` applied.
8. 🔒 OpenAI product-feed onboarding/eligibility — Phase 9 build **done** (generate/validate/
   score/export); still needs OpenAI merchant approval + `FEED_DELIVERY_ENABLED=1` + a
   delivery endpoint to actually submit. Generating/exporting a feed never submits it.
9. 🔒 Legal/support/data-deletion URLs for app review.
10. ⏸️ Separate dev/prod Supabase (hygiene, LAUNCH_CHECKLIST §11) — intentionally skipped for now.

## Verification log
- 2026-06-21 Phase 10 DEPLOY: `phase10-pixel` fast-forwarded into `main` (`9caab20..b7e1184`)
  and pushed → Railway auto-deployed. `/healthz` flipped to `b7e1184`; `/healthz/deep` green
  (db ok, jobQueueEnabled, scheduler + new `b7e1184-svc` worker heartbeating). Public ingest
  smoke-verified: OPTIONS 204 + ACAO; `{}`→400 invalid_shop; valid-shape-unknown-shop→202
  `stored:false/unknown_shop` (install-scoping writes nothing); `/app/api/pixel/attribution`→401.
  Migration `0015` already applied → startup migrate a no-op.
- 2026-06-21 Phase 10 (branch `phase10-pixel`, off `main`): built the AI-referral Web Pixel
  (extension + public consent-gated ingest + server-authoritative classifier + directional
  attribution). `npm test` **99 pass / 21 skipped / 0 fail**; `npm run typecheck` clean. NO
  network/spend (pure + mock). **Migration `0015` APPLIED to Supabase + DB-gated e2e PASSED
  11/11 against the live DB (2026-06-21, user-authorized; self-cleaned).** Code merge/deploy +
  the external `shopify app deploy` of the extension await a user go.
- 2026-06-21 Phase 9 DEPLOY: `phase9-feeds` fast-forwarded into `main` (`cee1550..c178cb4`) and
  pushed → Railway auto-deployed. `/healthz` flipped to `c178cb4`; `/healthz/deep` green
  (`database:ok`, `jobQueueEnabled:true`, scheduler + new `c178cb4-svc` worker heartbeating,
  0 dead-letter); `/app/api/feeds/spec` returns 401 (registered + tenant-gated, not 404).
  Migration `0014` already applied, so startup migrate was a no-op.
- 2026-06-21 Phase 9 (branch `phase9-feeds`, off `main`): built the product-feed generator/
  validator/readiness/export over the normalized catalog. **One network action** — a read-only
  WebFetch of the CURRENT OpenAI Agentic Commerce product-feed spec
  (`developers.openai.com/commerce`) — flagged + done at build; spec encoded with provenance
  (version flagged unconfirmed). `npm test` **89 pass / 20 skipped / 0 fail**; `npm run typecheck`
  clean. **Migration `0014` APPLIED to Supabase + the DB-gated e2e PASSED 14/14 against the live
  DB (2026-06-21, user-authorized; self-cleaned).** Code not merged/deployed — awaits a user go.
- 2026-06-21 DEPLOY: Phases 4–8 + 12 + the `PROCESS_MODE` dispatcher all merged to `main` and
  deployed to Railway in sequence (each fast-forward, smoke-tested green). Full serial DB suite
  (`npm run test:db`) peaked at 95/95. Worker + scheduler services stood up; `/healthz/deep`
  confirms both heartbeating + `jobQueueEnabled:true`. Reviews: `/security-review` clean on
  Phase 5/6/8; `/code-review high` findings fixed on each. **`npm run test:db` is the
  deterministic DB-gated run (parallel `npm test` can flake on the shared Supabase pooler).**
- Phase 1: `npm test` (pure queue unit tests + existing 16 detection) green; `npm run
  typecheck`; `viewer` build; DB-gated integration tests run once against Supabase with
  cleanup (see commit notes). Live funnel untouched (dormant).
- Phase 5: `npm test` 61 pass / 11 skipped (DB-gated) / 0 fail; `npm run typecheck` clean.
  Full crawl→extract→diagnose pipeline mock-verified at $0 with NO network
  (`CRAWLER_MODE=mock` default). SSRF deny-list exhaustively unit-tested (IPv4/IPv6/mapped,
  metadata, ports, schemes, credentials); `safeFetch` refuses blocked URLs before connecting.
  Migration `0010` applied to Supabase (2026-06-21); DB-gated `diagnoseRun` end-to-end test
  (crawl → diagnose → persist crawl_pages + findings → idempotent re-run) PASSED against the
  live DB with cleanup (`RUN_DB_TESTS=1`, 21/21).
