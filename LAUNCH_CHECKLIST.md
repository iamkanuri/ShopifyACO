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
- ☑ **Scopes:** `read_products,read_customer_events,write_pixels,write_products` (in
  `shopify.app.toml` as of 2026-06-25). `write_products` enables Fix Studio one-click apply (SEO
  title/description backfill only; gated by approval + conflict check + rollback). To go live with
  it: (1) set `SHOPIFY_SCOPES=read_products,read_customer_events,write_pixels,write_products` on the
  Railway **web** service, (2) `shopify app deploy`, (3) merchant **re-consent** (reinstall granting
  write), (4) **TEST on the dev store first** — ✅ **PROVEN 2026-06-26**: in Fix Studio approve +
  Apply an SEO edit to a dev-store product, confirmed it changed in Shopify admin, then Rollback
  restored it. (Required adopting expiring offline tokens + the `2026-01` API version + live
  scope recording — see IMPLEMENTATION_STATUS 2026-06-26.) Do **not** add customer/order scopes.
- ☐ **Mandatory compliance webhooks** (GDPR): `customers/data_request`, `customers/redact`,
  `shop/redact` → all point to `https://lens.thirdocular.com/api/shopify/webhooks`.
- ☐ **App webhooks:** `app/uninstalled`, `products/create`, `products/update`,
  `products/delete`, `shop/update` → same webhooks URL.
- ☐ Set env: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SHOPIFY_SCOPES`,
  `SHOPIFY_API_VERSION=2026-01` (the current supported GraphQL Admin API version; the old
  `2025-01` is unsupported and 403'd. Code default is also `2026-01`.).
- ☐ **Activate embedded mode (when ready to run inside the Shopify admin iframe):** the code is
  built — dynamic per-shop CSP `frame-ancestors`, App Bridge injection on `/app` (host/shop param),
  session-token API auth, AND the **embedded install handshake via token exchange**
  (`POST /api/shopify/token`, transparent client bootstrap). To turn it on: flip `embedded = true`
  in `shopify.app.toml` → `shopify app deploy` → load the app in the dev-store admin and test
  install → framed load → an `/app/api/*` call authing via the Bearer token. No new env var. (The
  token-exchange path is the most-likely-correct embedded install flow but is only fully proven by
  real in-admin testing — report any handshake error and it'll be fixed.)

## 3. Database (all phases)
- ☐ Apply migrations: `npm run migrate` locally (hits `DATABASE_URL`) and automatically at
  Railway deploy. New tables this program adds: `jobs`, `usage_ledger`, `spend_reservations`
  (Phase 1); `shops`, `shop_credentials`, `installations`, `webhook_events`, `audit_log`
  (Phase 2); `products`, `variants`, `collections`, `catalog_syncs`, `catalog_snapshots`
  (Phase 3); `benchmarks`, `observations` (Phase 4); `crawl_pages`, `findings` (Phase 5);
  `fix_proposals` (Phase 6); `interventions`, `experiments` (Phase 7); `schedules`,
  `alerts`, `notifications` (Phase 8); `feeds`, `feed_versions`, `feed_items` (Phase 9); `pixel_events` (Phase 10);
  `entitlements`, `billing_events` (Phase 11, migration `0017`; + additive `orders` columns);
  `shop_credentials` refresh-token + expiry columns (migration `0018`, expiring offline tokens,
  applied to prod 2026-06-26). All additive/idempotent.

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
  on **BOTH the `web` and `worker` services** when you want real crawling — web sets the live
  default at enqueue, the worker runs the actual fetch (set only one → still mock). It makes
  **outbound HTTP requests** (no API spend, no new secrets) and is SSRF-hardened (private/
  link-local/metadata IPs blocked). Tune `CRAWLER_MAX_PAGES/DEPTH/BYTES`, `CRAWLER_TIMEOUT_MS`,
  `CRAWLER_MAX_REDIRECTS`, `CRAWLER_RESPECT_ROBOTS` as needed. The `evidence_diagnose` job runs on
  the worker service. (Real engine citations + merchant-page derivation are wired as of 2026-06-26,
  so live diagnosis crawls both the cited competitors and the merchant's own synced catalog page —
  run **Catalog → Sync** first so there's an `online_url`.)

## 6. Email provider (Phase 8)
- ☐ Choose a provider (e.g. Resend/Postmark/SES). Verify a sending domain (SPF/DKIM/DMARC).
- ☐ Set `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM` (e.g. `reports@thirdocular.com`),
  `EMAIL_REPLY_TO`. Until set, notifications use the dev logger adapter (no real sends).

## 7. Stripe (Phase 11) — code DONE (branch `phase11-entitlements`), TEST-mode setup pending
The entitlements model, idempotent billing lifecycle (provision/refund/failed-payment/cancel/
expire), and the billing portal are built (no Stripe SDK — raw `fetch`). KEEP STRIPE IN **TEST
MODE**; going live needs KYC + an explicit go.
- ☐ **Apply migration `0017`** (`npm run migrate`) — `entitlements`, `billing_events`, +
  `orders.stripe_payment_intent`/`refunded_at`. Additive/idempotent. Then run the DB-gated suite
  (`RUN_DB_TESTS=1 SHOPIFY_MODE=mock npm run test:db`) to verify the lifecycle against Supabase.
- ☐ Create products + prices for each plan in the **TEST** dashboard (config-driven — do **not**
  hardcode prices). Copy each price id into `STRIPE_PRICE_FULL_REPORT` / `STRIPE_PRICE_MONITORING`
  / `STRIPE_PRICE_FOUNDER_BETA`.
- ☐ Set (Railway, TEST values): `STRIPE_SECRET_KEY` (test), `STRIPE_WEBHOOK_SECRET`, the
  `STRIPE_PRICE_*` ids; **enable the billing portal** in the dashboard; set `STRIPE_PORTAL_RETURN_URL`
  (e.g. `https://lens.thirdocular.com/app/settings`).
- ☐ Webhook endpoint `https://lens.thirdocular.com/api/stripe/webhook` — **add the new events** to
  the existing endpoint: `customer.subscription.created/updated/deleted`, `invoice.payment_failed`,
  `charge.refunded` (already live for `checkout.session.completed`).
- ☐ Leave `BILLING_ENFORCED` unset (dormant) until you want to actually gate paid features; the
  plan/usage surface in `/app/billing` is live regardless. Flip to `1` to enforce.
- ☐ Flip from TEST to LIVE only after Stripe KYC; swap all `STRIPE_*` to live values.

## 8. Web Pixel extension (Phase 10)
- ✅ Built the Web Pixel extension (`extensions/ai-referral-pixel/`) + ingest endpoint
  (`POST /api/pixel/ingest`) + classifier + attribution (`GET /app/api/pixel/attribution`).
- ✅ **Migration `0015` applied to Supabase** (`npm run migrate`, 2026-06-21) + DB-gated e2e
  PASSED 11/11 against the live DB.
- ☐ **Apply migration `0016`** (`npm run migrate`) — adds `shops.web_pixel_id` for idempotent activation.
- ☐ **Grant the pixel scopes:** set `SHOPIFY_SCOPES=read_products,read_customer_events,write_pixels`
  on the server (matches `shopify.app.toml`, already updated). `webPixelCreate` needs
  `write_pixels` + `read_customer_events`.
- ☐ **Deploy the extension + scope change:** `shopify app deploy` (repo root, Shopify CLI authed)
  → releases the new version with the pixel + new scopes. The merchant must **re-consent**
  (reinstall/approve the added scopes) — the app then **auto-activates** the pixel on install,
  or you can trigger `POST /app/api/pixel/activate`. (App-owned pixels are NOT configured in
  Admin → Customer events; the app sets the Ingest URL via `webPixelCreate`.)
- ☐ The Ingest URL is derived server-side from `SHOPIFY_APP_URL`/`PUBLIC_BASE_URL`
  (`…/api/pixel/ingest`); set `PIXEL_SHARED_SECRET` if you want the anti-noise header.
- ☐ Verify: visit the store with `?utm_source=chatgpt`, then check `/app` attribution
  (or `pixel_events` in Supabase). Note: directional only — AI assistants strip referrers.

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

## 11. Separate dev and prod databases (Phase 13 — data isolation) — ✅ DONE 2026-06-22
**Resolved via a local Supabase stack** (Supabase CLI + Docker), so local dev no longer
touches the production database at all. Prod stays on the hosted Supabase project (Railway
env, unchanged); local `.env` points at the local stack.
- ☑ **Local stack:** `npx supabase init` + `npx supabase start` (Docker). Local `.env`:
  `SUPABASE_URL=http://127.0.0.1:54321`, `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`,
  `SUPABASE_SERVICE_ROLE_KEY=<local demo key from \`npx supabase status\`>`. Prod values are
  preserved locally in `.env.prod.bak` (gitignored) and remain authoritative on Railway.
- ☑ `pgSslConfig()` (`src/db/pg.ts`, used by `pg.ts` + `migrate.ts`) auto-disables SSL for a
  localhost DB (the local Postgres speaks plaintext); cloud connections keep SSL on — prod
  behavior unchanged.
- ☑ `npm run migrate` applied all 17 migrations to the fresh local DB; full DB-gated suite
  **145/145** against local (`RUN_DB_TESTS=1 SHOPIFY_MODE=mock npm run test:db`).
- **Day-to-day:** start the stack with `npx supabase start`, stop with `npx supabase stop`,
  browse it at Studio `http://127.0.0.1:54323`. NOTE: our schema lives in `migrations/` +
  `migrate.ts` (NOT the CLI's `supabase/migrations/`), so after a fresh `start` run
  `npm run migrate` — don't rely on `supabase db reset`. The `supabase/` dir is gitignored.
- To run something locally against PROD on purpose (rare), temporarily restore `.env.prod.bak`.
- Note: run the **DB-gated** suite serially — `RUN_DB_TESTS=1 SHOPIFY_MODE=mock npm run test:db`
  (`--test-concurrency=1`). (Pure tests: plain `npm test`.)

---
Each phase's code checks for its env at boot and surfaces a clear not-configured state; see
`IMPLEMENTATION_STATUS.md` for which phase each item unblocks.
