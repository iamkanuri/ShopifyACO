# LAUNCH_CHECKLIST — external actions only

Things **only you** can do (credentials, dashboards, approvals, paid services). Code is
built to a disabled/not-configured state until each is satisfied. **Never paste secret
values into chat or commit them** — set them as environment variables in Railway (and `.env`
locally). Variable *names* only are listed here.

Status: ☐ todo · ☑ done. Order roughly matches the rollout order in IMPLEMENTATION_STATUS.md.

---

## 0. Secrets hygiene (do first)
- ☑ **Rotated the Shopify API secret (2026-06-21)** in the Partner dashboard + updated
  `SHOPIFY_API_SECRET` on the Railway web service. The burned value is invalidated.
- ☑ Confirmed `imp keys.txt` (not present/tracked) and `.env` are gitignored.

## 1. Token-encryption key (Phase 2)
- ☐ Generate a 32-byte key: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
- ☐ Set `APP_ENCRYPTION_KEY` in Railway + `.env`. Rotating it requires re-encrypting stored
  Shopify tokens (a rotation script ships with Phase 2). Losing it = all shops must reconnect.

## 2. Shopify Partner app (Phases 2–3, 6, 10)
- ☐ Create a Partner account + a **public app** (Partners dashboard).
- ☐ Create a **development store** for testing.
- ☐ App URLs:
  - App URL: `https://lens.thirdocular.com/app`
  - Allowed redirection (OAuth callback) URL: `https://lens.thirdocular.com/api/shopify/callback`
- ☐ **Scopes (least privilege):** start with `read_products`. Add `write_products` only when
  enabling approved write-back (Phase 6) — set `SHOPIFY_SCOPES=read_products,write_products` and
  have each merchant **re-consent** (re-install) so the new scope is granted; Fix Studio's apply
  path refuses to write until `write_products` is present on the shop. Do **not** add
  customer/order scopes.
- ☐ **Mandatory compliance webhooks** (GDPR): `customers/data_request`, `customers/redact`,
  `shop/redact` → all point to `https://lens.thirdocular.com/api/shopify/webhooks`.
- ☐ **App webhooks:** `app/uninstalled`, `products/create`, `products/update`,
  `products/delete`, `shop/update` → same webhooks URL.
- ☐ Set env: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SHOPIFY_SCOPES`,
  `SHOPIFY_API_VERSION` (use the current stable GraphQL Admin API version).

## 3. Database (all phases)
- ☐ Apply migrations: `npm run migrate` locally (hits `DATABASE_URL`) and automatically at
  Railway deploy. New tables this program adds: `jobs`, `usage_ledger`, `spend_reservations`
  (Phase 1); `shops`, `shop_credentials`, `installations`, `webhook_events`, `audit_log`
  (Phase 2); `products`, `variants`, `collections`, `catalog_syncs`, `catalog_snapshots`
  (Phase 3); `benchmarks`, `observations` (Phase 4); `crawl_pages`, `findings` (Phase 5);
  `fix_proposals` (Phase 6); `interventions`, `experiments` (Phase 7); `schedules`,
  `alerts`, `notifications` (Phase 8); `feeds`, `feed_versions`, `feed_items` (Phase 9); `pixel_events` (Phase 10);
  `entitlements` (Phase 11). All additive/idempotent.

## 4. Railway services (Phase 1) — ✅ DONE 2026-06-21
One image, three process modes via `PROCESS_MODE` dispatch (`src/start.ts`). railway.json's
shared start command + `/healthz` check apply to every service, so **the only per-service
difference is the `PROCESS_MODE` variable** (no start-command/healthcheck overrides). The
worker/scheduler run a minimal `/healthz` server (`src/health.ts`) so the shared check passes.
- ☑ **web** service (`ShopifyACO`): default `PROCESS_MODE=web` (has the public domain + volume).
- ☑ **worker** service (same repo): `PROCESS_MODE=worker`, copied env, no domain/volume.
- ☑ **scheduler** service (same repo): `PROCESS_MODE=scheduler`, copied env, no domain/volume.
- ☑ `JOB_QUEUE_ENABLED=1` set on the **web** service (only place it's read — gates the
  catalog-sync + evidence-diagnose routes to enqueue vs run inline; public funnel untouched).
- ☑ Verified: `/healthz/deep` shows `worker` + `scheduler` heartbeats + `jobQueueEnabled:true`.
- To add a service: Railway **+ Create → GitHub Repo** (NOT Empty Service) → set `PROCESS_MODE`.
  Each service needs the same env (shared vars are NOT auto-injected); do not hardcode `PORT`.

## 5. Engine API keys (Phases 1, 4)
- ☐ `OPENAI_API_KEY`, `GOOGLE_AI_API_KEY`, `PERPLEXITY_API_KEY` (already set in prod).
- ☐ `ANTHROPIC_API_KEY` — only when the Claude adapter is enabled (Phase 4). Adapter degrades
  gracefully if unset. Verify all keys via `/admin → Check engine keys`.

## 5b. Evidence & diagnosis crawler (Phase 5) — no new credentials
- ☐ Apply migration `0010_crawler.sql` (`crawl_pages`, `findings`) — happens automatically
  with `npm run migrate` / at Railway deploy.
- ☐ Leave `CRAWLER_MODE=mock` (default) for $0/no-network operation. Set `CRAWLER_MODE=live`
  only when you want real crawling — it makes **outbound HTTP requests** (no API spend, no new
  secrets) and is SSRF-hardened (private/link-local/metadata IPs blocked). Tune
  `CRAWLER_MAX_PAGES/DEPTH/BYTES`, `CRAWLER_TIMEOUT_MS`, `CRAWLER_MAX_REDIRECTS`,
  `CRAWLER_RESPECT_ROBOTS` as needed. The `evidence_diagnose` job runs on the worker service.

## 6. Email provider (Phase 8)
- ☐ Choose a provider (e.g. Resend/Postmark/SES). Verify a sending domain (SPF/DKIM/DMARC).
- ☐ Set `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM` (e.g. `reports@thirdocular.com`),
  `EMAIL_REPLY_TO`. Until set, notifications use the dev logger adapter (no real sends).

## 7. Stripe (Phase 11)
- ☐ Create products + prices for each plan (config-driven — do **not** hardcode prices).
- ☐ Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and per-plan price IDs
  `STRIPE_PRICE_<PLAN>`; enable the **billing portal**; set `STRIPE_PORTAL_RETURN_URL`.
- ☐ Webhook endpoint: `https://lens.thirdocular.com/api/stripe/webhook` (already live for
  `checkout.session.completed`; Phase 11 adds refunds/failures/cancellations).
- ☐ Flip from TEST to LIVE only after Stripe KYC; swap all `STRIPE_*` to live values.

## 8. Web Pixel extension (Phase 10)
- ☐ Scaffold + deploy the Shopify Web Pixel extension via Shopify CLI to the Partner app.
- ☐ Set `PIXEL_INGEST_URL` / shared secret env as documented in the Phase 10 code.

## 9. OpenAI product feed (Phase 9)
- ✅ Reviewed the current official OpenAI commerce/product-feed spec (fetched 2026-06-21,
  `developers.openai.com/commerce`); encoded as auditable data in `src/feeds/spec.ts` with
  provenance. The generator/validator/readiness/export are built (branch `phase9-feeds`).
- ✅ **Migration `0014` applied to Supabase** (`npm run migrate`, 2026-06-21) + DB-gated e2e
  PASSED 14/14 against the live DB. (Code merge to `main` + deploy still pending a go.)
- ☐ Confirm OpenAI merchant **eligibility** + complete onboarding (external).
- ☐ Set `FEED_DELIVERY_ENABLED=1` (+ the delivery endpoint/creds, when that path is built)
  ONLY when eligible. Generating/exporting a feed does **not** submit it to ChatGPT —
  submission is this external step. Until then `/app/api/feeds/delivery/status` reports
  "not configured" honestly.

## 10. Legal & app review (Phase 12–13)
- ☐ Publish Privacy Policy, Terms, Support contact, and a Data-deletion request URL.
- ☐ Set `PRIVACY_URL`, `TERMS_URL`, `SUPPORT_EMAIL`, `DATA_DELETION_URL`.
- ☐ Test the install/uninstall/compliance-webhook flows on the dev store.
- ☐ Submit the app for Shopify review.

## 11. Separate dev and prod databases (Phase 13 — data isolation)
**Why:** local/dev currently points `DATABASE_URL`/`SUPABASE_URL` at the SAME Supabase
project as production, so a live test run on a laptop writes into prod's `benchmark_runs`/
`spend_days`/etc. — dev activity then shows up in prod `/healthz` metrics and counts against
the prod `DAILY_SPEND_CAP_USD`. (Observed 2026-06-21: a $0.0439 local benchmark verification
run surfaced as prod `spendTodayDbUsd`.)
- ☐ Create a **separate Supabase project** (or at minimum a separate database/branch) for dev/staging.
- ☐ Point local `.env` `DATABASE_URL` + `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` at the dev project;
  keep prod values only on the Railway service. Run `npm run migrate` against the dev project too.
- ☐ Until then, treat any local **live** (non-mock) run as production data + spend, and prefer
  `--mock` / `SHOPIFY_MODE=mock` / `CRAWLER_MODE=mock` locally (all $0, no prod-DB writes that cost).
- Note: run the **DB-gated** test suite serially — `RUN_DB_TESTS=1 SHOPIFY_MODE=mock npm run test:db`
  (`--test-concurrency=1`). The parallel `npm test` can exceed the shared Supabase pooler's
  connection headroom and flake; `test:db` is deterministic. (Pure tests: plain `npm test`.)

---
Each phase's code checks for its env at boot and surfaces a clear not-configured state; see
`IMPLEMENTATION_STATUS.md` for which phase each item unblocks.
