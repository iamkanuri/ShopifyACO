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
- 🔒 Live verification needs the Partner app + `SHOPIFY_API_KEY/SECRET` + `APP_ENCRYPTION_KEY`
  + callback URL registered (launch checklist). **Models for products/variants/collections/
  catalog_syncs/snapshots land in Phase 3** (catalog sync), keeping migrations cohesive.
- ⬜ `/app` onboarding UI (Connect→Sync→Select→Confirm→Benchmark→Baseline) is Phase 12 IA;
  the URL-based free scan for non-Shopify prospects is retained unchanged.

### Phase 3 — Product-level catalog intelligence ⬜
Depends on Phase 2 tokens. Models: `products`, `variants`, `collections`, `catalog_syncs`,
`catalog_snapshots`. GraphQL cursor sync + incremental webhooks + resumable full sync.
`/app/catalog` UI. Brand-mention vs SKU-recommendation kept distinct.

### Phase 4 — Statistically credible benchmarks ⬜
Reusable `benchmarks` (versioned config) + `observations` (one row per response). Metrics
with CIs + sample sizes. LLM adjudication pass (optional, recorded per classification).
Claude adapter added only when its current API + grounding are correctly configured.
Partially seeded by existing analysis/detection — will extend, not replace, tested logic.

### Phase 5 — Evidence & diagnosis engine (crawler) ⬜
SSRF-hardened bounded crawler (`src/crawler/`), JSON-LD/Offer extraction, evidence-backed
findings (mechanism, not guaranteed outcome). Treat crawled text as untrusted (injection
defense). Heavy security test surface.

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
