# CLAUDE.md — ShopifyACO

Guidance for future sessions working in this repo.

## Product vision

ShopifyACO tells e-commerce merchants whether AI assistants (ChatGPT, Gemini,
Perplexity, later Claude/Copilot) **recommend their products to shoppers**, measures
their **share of voice vs competitors**, and will eventually **help them fix it**. As
shoppers increasingly ask AI assistants "what should I buy", being invisible to those
assistants is the new being-on-page-2-of-Google. We measure that visibility, then
close the gap.

## Current production state (live)

**Live:** https://lens.thirdocular.com · public brand **AisleLens** (`PUBLIC_BRAND_NAME`;
repo/internal name stays `ShopifyACO`) · one Railway service · Supabase Postgres ·
custom domain on Cloudflare (DNS-only/grey-cloud). See `DEPLOY.md`.

What's shipped end-to-end (verified in prod):
- **Measurement engine** → **detection** → **analysis** → **report** (CLI + server share it).
- **Public funnel:** landing `/`, `/scan` (email-gated mini scan, 5 prompts × 3 engines,
  $0.50 cap), `/report/:id`, `/demo`, `/privacy`, `/thanks`.
- **AI Visibility Index** (the growth engine): public per-category leaderboards at
  `/index` + `/index/:slug`, built by admin from one multi-brand scan. 5 categories live.
- **Real Stripe payments** (Payment Links + webhook): $29 full report, $49/mo monitoring,
  $99 founder beta. **Currently TEST mode** — live activation pending Stripe KYC. A paid
  test order was recorded end-to-end (button → checkout → webhook → `orders` row → `/thanks`).
- **Admin cockpit** `/admin`: today metrics, funnel, runs/leads/**orders**/errors, launch
  targets, manual standard/deep scans, category-index builder, order fulfillment.
- **Abuse/spend protection** + **detection test suite** (`npm test`, 16 cases).
- **DB tables:** `leads`, `runs`, `events`, `orders`, `category_index` (migrations
  `0001`–`0005`). Result files on the Railway volume (`DATA_DIR`).

**Everything deferred (security/hardening) and every planned feature now lives in
[`TODO.md`](TODO.md). Read it before starting new work.**

## What it started as (CLI measurement engine)

A standalone TypeScript CLI — the **measurement engine**. No Shopify, DB, or UI.

Pipeline: `config.json` → expand prompt templates → ask N engines (concurrently, with
retry/backoff) → **detection module** scores brand + competitor visibility per answer →
aggregate into share-of-voice → write `results.json` + `report.md`.

Run it:
```
npm run scan -- ./config/example.config.json --mock        # zero-cost end-to-end
npm run scan -- ./config/example.config.json --dry-run      # just expand prompts
npm run scan -- ./config/example.config.json                # LIVE (asks to confirm)
```
Useful flags: `--limit-prompts N`, `--max-cost-usd X`, `--yes`, `--no-save-raw`,
`--out DIR`, `--concurrency N`. See `--help`.

## Validated learnings (first real run — Caraway, nonstick cookware, 2026-06-10)

13 prompts × 3 engines (39 grounded responses, ~$0.06). All engines confirmed
`web_grounded` (OpenAI Responses `web_search`, Gemini `google_search`, Perplexity
sonar). Findings that shaped the product direction:

- **"Known but not chosen" is the core merchant pain.** Caraway: 33% mention rate
  but only 5% recommendation rate — the widest mention→recommend gap of any brand.
  AI assistants describe the brand well yet rarely pick it.
- **The real threat is the in-niche rival, not the category leader.** All-Clad leads
  overall (49%/31%) but plays a different game (stainless/premium). **GreenPan** is
  Caraway's direct ceramic/non-toxic competitor — similar mention rate (38%) but
  recommended ~4× more (21% vs 5%), riding named third-party tests ("America's Test
  Kitchen", Valencia Pro). This is the gap-analysis story merchants will pay for.
- **Engines disagree — per-engine weakness matters.** ChatGPT recommended Caraway 0%
  and ranked it lowest (~4.3); Perplexity was kindest (rank ~1.5). "Which engine is
  my weakest" is a real, actionable metric.
- **Transactional whiteout.** Brand was absent from *every* induction / under-$X /
  first-apartment / wedding-gift / "alternatives to {competitor}" prompt. Visibility
  was confined to explicitly "non-toxic/ceramic" queries.
- **Detection caveats that bit us:** generic product terms ("Cookware Set", "Dutch
  Oven") cause false positives — keep only distinctive product names. Brand names that
  are common phrases ("Made In") risk colliding with prose ("made in USA") — in
  practice assistants list it capitalized so it was clean here, but watch it.
- **Statistical honesty is mandatory.** These are small-sample, single-run rates and
  AI answers vary run-to-run. Always show `n=` with every rate and prefer relative
  framing ("4× more often *in this scan*") over absolute claims.

## Merchant analysis layer (`src/analysis/`) + report viewer (`viewer/`)

Built on top of the engine: a **pure, offline, deterministic** analysis layer that
reads `results.json` (no API calls) and produces merchant-facing insights — main
competitor threat, mention→recommendation gap, weakest engine, transactional
whiteout, competitor proof points (keyword taxonomy), and two-tier **fix cards**
(EVIDENCE-BACKED cards cite the exact lost prompts/snippets; GENERAL HYGIENE cards —
schema/llms.txt — are labeled "not checked against your live store"). Customer-facing
copy calls these "next steps", not "fixes" (nothing is verified against the real store yet).
- **AI Visibility Score** is a documented deterministic formula (see
  `src/analysis/score.ts`); its components are shown in the UI — never a black box.
- The analysis is embedded into `results.json` under `analysis` and also rendered
  into `report.md`. Re-run offline over an existing file with
  `npm run analyze -- results/results.json` (zero API spend).
- **Viewer** is a separate **Vite + React** app in `viewer/`. Components are pure and
  prop-driven (take `MerchantAnalysis` + run data) so they lift cleanly into the
  future Shopify embedded app. Loads the bundled Caraway fixture or any uploaded
  `results.json`. Run with `cd viewer && npm install && npm run dev`.

## Self-service scan flow (`src/server/` + viewer routes)

Local-only funnel from "enter your brand" to "polished report", architected as the
future public product but **bound to localhost** tonight.

- **Backend:** small Express server (`src/server/index.ts`), `npm run server`, binds
  `127.0.0.1:8787` ONLY, prints a startup warning. Reuses the exact CLI pipeline
  (`expandPrompts → buildAdapters → runScan → writeReports`) per run into
  `runs/{runId}/` (config.json, results.json, report.md, progress.log, status.json).
  - Routes: `POST /api/prompts/generate` (deterministic, no API cost),
    `POST /api/prompts/suggest` (ONE cost-capped LLM call ≤ $0.02, never loops),
    `POST /api/scan`, `GET /api/scan/:id/status`, `GET /api/runs/:id`(+`/report.md`),
    `GET /api/demo`, `GET /api/pricing`, `POST /api/leads`.
  - **Guardrails:** one scan at a time (in-process lock → 409 on concurrent);
    refuses any run whose worst-case estimate exceeds the cap; mini-scan defaults =
    5 prompts × 3 engines, $0.50 cap; engine isolation surfaces per-engine failures.
- **Prompt library:** `src/prompts/library.ts` — deterministic buyer-intent templates
  (buyer_intent, comparison, budget, use_case, alternatives) auto-filled from the form.
- **Viewer routes** (tiny custom history router, no dep): `/demo` (bundled Caraway),
  `/scan` (form → generate/suggest/edit prompts → confirm → live run w/ progress →
  redirect), `/report/:runId`. Report components are shared/pure.
- **Pricing / payments:** `src/pricing.ts` plan constants. CTAs open the plan's Stripe
  Payment Link when its `STRIPE_*_URL` env var is set (real payment, recorded via the
  Stripe webhook → `orders` table); otherwise they fall back to an email-capture modal
  (lead). See the "Payments" section below — this is no longer a fake door.
- **Confidence guardrails** (`src/analysis/confidence.ts`): every insight is LABELED,
  never removed — High `n≥30` "Strong signal" / Medium `n≥12` "Moderate signal" /
  Directional `n<12`. Run-size badge Mini/Standard/Deep. Threat selection is
  **sample-weighted**: the niche threat is anchored to the brand's most-occupied niche
  (not a thin slice) and shows its basis n; the category leader is computed separately
  so the report can distinguish "overall leader" from "in-niche threat".

## Production deployment (Railway, single service) — see `DEPLOY.md`

The funnel is now **public-ready** and deploys as **one Railway service**: the Express
server serves BOTH the API and the built viewer (`viewer/dist` static) from one
process. No Vercel, no CORS.

- **Secrets:** every secret comes ONLY from env vars, centralized in `src/server/env.ts`
  (`ENV`). Same names for local `.env` and Railway. `SUPABASE_SERVICE_ROLE_KEY` and API
  keys are server-only — the viewer bundle imports nothing from `src/` and uses no
  `VITE_`/`import.meta.env` secret (verified by grepping `viewer/dist`).
- **Persistence (Supabase):** `src/db/supabase.ts` — runtime reads/writes via the
  Supabase client + service-role key, all graceful (DB down → log + safe default,
  scans still run on file storage). Tables: `leads`, `runs`, `events`, `orders`
  (Stripe), `category_index` (Index leaderboards) — migrations `0001`–`0005`. Result
  files live on a **Railway volume** at `DATA_DIR` (e.g. `/data`); `runStore` writes there.
- **Migration workflow (own the lifecycle — never hand-run SQL):** version-controlled
  `migrations/NNNN_*.sql` applied by `src/db/migrate.ts` (`npm run migrate`), tracked in
  `schema_migrations`, idempotent. Runs locally against `DATABASE_URL` (Supabase session
  pooler, port 5432) AND at **startup** on Railway. ⚠️ **Corrected 2026-07-25:** this used to
  say the start command was `npm run migrate; npm start`, "non-fatal". It is
  **`npm run migrate && npm start`** (`railway.json`) and `migrate.ts` exits `1` on failure —
  so **a failed migration fails the deploy**, it does not degrade. The useful consequence:
  **a green `/healthz` on a known commit is proof that every migration applied**, since the
  app cannot start otherwise. That is the one-step, credential-free way to verify any
  migration in production. Migrations need vars on the **service** (project Shared Variables
  are NOT auto-injected). First connection failure ⇒ almost always the password isn't
  URL-encoded (`@` → `%40`) or the `[…]` brackets were left in `DATABASE_URL`.
- **Abuse / spend protection (`src/server/guards.ts`, enforced in `src/server/index.ts`):**
  email-gated scans (stored as a `scan_gate` lead); per-email + per-IP daily free-scan
  limits; per-IP sliding-window rate limits; 256kb payload cap; honeypot field; per-scan
  cost cap + **global daily spend cap** (`DAILY_SPEND_CAP_USD`, default 10) enforced
  BEFORE any live API call (max of in-memory accumulator and DB sum) — when hit, scans
  pause with an honest message and capture a `spend_cap` lead; per-scan wall-clock timeout.
- **Production posture:** binds `0.0.0.0` in prod (auto-detected via `NODE_ENV` or
  Railway env), `127.0.0.1` + warning in dev; `/healthz`; structured JSON error logs;
  graceful volume-missing / DB-unreachable handling.
- **Funnel analytics:** `events` table — `scan_started`/`scan_completed` (server),
  `report_viewed`/`cta_full_report`/`cta_monitoring` (client via `/api/events`),
  `lead_submitted` (on lead capture).
- **Kill switch:** set `DAILY_SPEND_CAP_USD=0` to halt all live scans without a redeploy.

`leads.jsonl` is retired (replaced by the `leads` table).

## Beta funnel layer (admin · payments signal · landing · rebrand)

- **⚠️ PUBLIC REBRAND RULE:** never ship "Shopify" in the public-facing name/domain
  (trademark). The public name comes from `PUBLIC_BRAND_NAME` (env), surfaced via
  `GET /api/config` + server-side `index.html` placeholder substitution
  (`__BRAND_NAME__`/`__DESC__`/`__BASE_URL__`). Repo/internal names stay `ShopifyACO`.
  The future App Store listing must use the new public name, not "Shopify…".
- **Landing page** at `/` (hero, how-it-works, what-you-learn, sample, pricing, trust,
  FAQ). Routes: `/` `/demo` `/scan` `/report/:id` `/admin` `/thanks` `/privacy`. A tiny
  history router; all branding/plans/contact come from `/api/config` (nothing hardcoded,
  works behind a custom domain via `PUBLIC_BASE_URL` or request host).
- **Admin cockpit** `/admin` (`src/server/admin.ts`): `ADMIN_PASSWORD` cookie session
  (constant-time compare, rate-limited login, `no-store`). Shows today's metrics,
  funnel, runs, leads, errors, launch targets; can run standard/deep scans for paid
  beta. Data via `buildAdminData()` over the `events`/`runs`/`leads` tables.
- **Payments signal (links only, NO Stripe SDK):** CTAs open `STRIPE_FULL_REPORT_URL` /
  `STRIPE_WEEKLY_MONITORING_URL` / `STRIPE_FOUNDER_BETA_URL` when set, else fall back to
  the email-capture modal. Click → `payment_link_clicked` event; success URL →
  `/thanks?plan=…` → `payment_completed` event, which redirects to `/report/:id?paid=1`.
  Full report is now **generated automatically** on payment (deep scan + done-for-you
  artifacts, on-screen in minutes) — see the paid-report automation program below; the
  old "manually reviewed / emailed within 24h" fulfillment is retired.
- **Scan modes** (`SCAN_MODES` in `env.ts`): mini (5/$0.50, public self-serve),
  standard (15/$2, admin), deep (30/$5, admin).
- **Privacy/safety:** report IDs (`newRunId`) carry 80 bits of crypto entropy so
  `/report/:id` can't be enumerated; raw provider payloads are NOT persisted
  (`saveRaw: false`); raw IPs are never stored — only `sha256(ip+IP_HASH_SALT)`;
  `/api/runs/:id` strips any stray payloads and redacts emails in answer text;
  `/privacy` + footer disclaimer; `/healthz` reports the deployed commit.

## Payments (Stripe Payment Links — NO Stripe SDK)

- CTAs open `STRIPE_FULL_REPORT_URL` / `STRIPE_WEEKLY_MONITORING_URL` /
  `STRIPE_FOUNDER_BETA_URL` (env). Click → `payment_link_clicked`; we tag the link with
  `client_reference_id`=runId + `prefilled_email` so the order ties back to the report.
- **Webhook** `POST /api/stripe/webhook` (`src/server/stripe.ts`): raw body BEFORE
  `express.json`; HMAC signature verified manually with `STRIPE_WEBHOOK_SECRET`; only
  `checkout.session.completed` is treated as payment proof; optional `STRIPE_SECRET_KEY`
  re-confirms paid via REST; idempotent upsert into `orders` by `session_id`. Emits
  `payment_confirmed`.
- Success URL → `/thanks?plan=…` → `payment_completed` (client) + links the buyer back
  to their own report (runId from URL or `localStorage.al_last_run`).
- Fulfillment is **manual during beta** (admin runs a deep scan, emails the report).
  Monitoring ($49/mo) is sold but NOT auto-fulfilled yet (needs scheduled scans) — the
  UI shows it as a waitlist when its Stripe URL is unset.

## AI Visibility Index (growth engine) — `category_index` table

- Public per-category leaderboards: `GET /api/index`, `GET /api/index/:slug`; pages
  `/index` (list) + `/index/:slug` (ranked table with a "This is us →" deep-link to a
  prefilled `/scan`). Per-category OG title injected server-side for shareable links;
  slugs added to `sitemap.xml`.
- Built by admin: `POST /api/admin/index {label, brands[3..25], mode}` runs ONE
  multi-brand scan (brand[0] + competitors) so the analysis leaderboard ranks them all
  on the same prompts, then upserts `category_index`. Events `index_viewed`/`index_claim_click`.
- **This is the front door / acquisition loop** (publish a category → tag the losers →
  they discover their gap → prefilled scan → report → paid). See TODO.md for the
  "claim your brand" and shareable-card extensions.

## Shopify secret rotation — DONE (2026-06-21)
The previously-exposed Shopify API secret (formerly in `imp keys.txt`) was **rotated in
the Partner dashboard on 2026-06-21**; the old value is dead. `SHOPIFY_API_SECRET` (+ a
`SHOPIFY_API_SECRET_FALLBACK` for rotation grace) are set on Railway and verified live
(OAuth + token-exchange working). `imp keys.txt` is gitignored and read by no code
(verified); delete it if it's still lying around locally. No outstanding action.

## Architecture & conventions

- **Runtime:** Node 22 + TypeScript run directly via `tsx` (no build step). ESM
  modules; relative imports use the `.js` extension (TS/ESM requirement).
- **Minimal dependencies, raw `fetch`** — no engine SDKs. Only runtime dep is
  `dotenv`. Keep it that way unless there's a strong reason.
- **Secrets:** loaded from `.env` (gitignored). Never hardcode keys. `.env.example`
  documents the variables. `imp keys.txt` is gitignored too.
- **Module map** (`src/`):
  - `types.ts` — the shared contract. Change here first.
  - `config.ts` / `prompts.ts` — load+validate config; expand `{placeholder}` templates.
  - `engines/` — one adapter per engine behind `EngineAdapter` (`engines/types.ts`).
  - `detection/` — **the core IP** (see below).
  - `runner.ts` — concurrency cap + retry/backoff + per-engine graceful failure + cost stop.
  - `aggregate.ts` / `report.ts` — share-of-voice math; write `results.json` + `report.md`.
  - `cli.ts` / `index.ts` — flag parsing, pre-run cost guard + confirmation, orchestration.

### Engine-adapter pattern (the extension point)

Every engine implements `EngineAdapter` (`src/engines/types.ts`): `name`, `model`,
`preferredGrounding`, `isConfigured()`, `generate(prompt, signal)`. Adding an engine =
**new file + one line in `src/engines/index.ts`** (`allAdapters`). Nothing in
detection/runner/report changes.

- Model names + pricing live in `src/engines/models.ts` (single source of truth).
- **Grounding:** each adapter attempts web grounding and reports the mode it actually
  achieved per call (`web_grounded | api_model_only | unknown`):
  - OpenAI → Responses API `web_search` tool; falls back to chat completions.
  - Gemini → `google_search` grounding tool; falls back to plain `generateContent`.
  - Perplexity `sonar` → grounded natively.
  The report flags any engine that ran ungrounded — web grounding matters most for
  shopping queries.

### Detection module — core IP (`src/detection/`)

Pure, dependency-free, **unit-tested** (`npm test` — 16 cases in `test/detection.test.ts`;
run before changing this module). Turns one answer into per-brand `recommendationStatus`.
The enum has five values; **only three are implemented now**: `recommended`,
`mentioned_neutral`, `not_mentioned`. Matching is case-insensitive, variant-aware
(aliases, products, possessives, corporate suffixes, store **domains**), and
word-boundary safe. Computes list rank, first-mention order, and a snippet.

Recommendation classification is **clause-scoped**: it narrows to the clause around a
brand mention (split on sentence punctuation, `;`, and contrastive conjunctions —
" but / whereas / however / while ") and applies a **negation guard** ("wouldn't
recommend", "not the best", "steer clear", "avoid") so mixed answers like *"I don't
recommend GreenPan; I recommend Caraway"* attribute correctly. Still imperfect on very
complex sentences — an optional LLM classification pass is the planned upgrade (TODO.md).

## Platform build (in progress) → [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md)

A larger "beta → AI-commerce control plane" program is underway. Its phased status,
architecture decisions, and external blockers live in `IMPLEMENTATION_STATUS.md`;
external (credential/dashboard) actions live in [`LAUNCH_CHECKLIST.md`](LAUNCH_CHECKLIST.md).

> **STATUS (2026-06-25): Phases 1–14 are all MERGED to `main` and LIVE in production**
> (commit `8cf42c1`; verify via `GET /healthz`). The per-phase **"built on branch
> `phaseN-…`"** wording below is **historical** (how each phase was developed) — those
> branches are merged; do not read them as unshipped. Embedded mode is live + verified
> in-admin. What's genuinely NOT yet shipped: the App Store *listing submission*
> (icon/screenshots/submit) and `write_products` live write-back (deferred by design).
> The authoritative current-state record is the **"LIVE DEPLOYMENT STATE"** block in
> `IMPLEMENTATION_STATUS.md`.

**Phase 1 (durable job system) is built on branch `phase1-job-system`** but dormant
relative to the live funnel until a worker service + `JOB_QUEUE_ENABLED=1` are verified:
- `migrations/0006_jobs.sql` — `jobs` (atomic claim via `FOR UPDATE SKIP LOCKED`,
  idempotency, retry/backoff/dead-letter, lease recovery), `spend_days`+`spend_reservations`
  (multi-instance-safe atomic spend reservation), `usage_ledger`, `system_heartbeats`.
- `src/db/pg.ts` (runtime raw-pg pool for row locks), `src/queue/*` (jobs, spend, backoff,
  handlers, runner), `src/worker.ts` + `src/scheduler.ts` (process modes via `PROCESS_MODE`).
- Health: `/healthz/deep`; admin: `GET /api/admin/queue` + retry/cancel. Tests:
  `test/queue.test.ts` (pure always-on + DB-gated `RUN_DB_TESTS=1`, verified against Supabase).
- The legacy in-process scan lock still serves prod unchanged (D2 in IMPLEMENTATION_STATUS).

**Phase 2 (Shopify OAuth + multi-tenancy) is built on branch `phase2-shopify-oauth`**,
testable with `SHOPIFY_MODE=mock` (no real Shopify creds needed):
- `migrations/0007_shopify.sql` — `shops`, `shop_credentials` (AES-256-GCM token at rest),
  `installations`, `webhook_events` (idempotency), `audit_log`, `oauth_states` (single-use nonce).
- `src/shopify/*` (crypto, domain, hmac, oauth, client) + `src/server/shopify.ts` (install/
  callback/webhooks + `requireShop`) + `src/db/shops.ts`. Live client = **GraphQL Admin API
  only** (no REST). HMAC timing-safe; offline tokens; GDPR compliance webhooks; least-privilege
  `read_products`. `test/shopify.test.ts` (pure + DB-gated), HTTP e2e verified. 503 until configured.

**Phase 5 (Evidence & diagnosis engine — SSRF-hardened crawler) is built on branch
`phase5-crawler`** (off `phase4-benchmarks`), mock-verified at $0 with **no network**
(`CRAWLER_MODE=mock`, the default). It explains WHY competitors win by crawling the merchant's
page + the competitor pages the assistants cited, then diagnosing the structural gap.
- **SSRF + prompt-injection are the PRIMARY threat model.** `src/crawler/ssrf.ts` blocks
  non-http(s) schemes, URL credentials, non-standard ports, localhost/*.internal/.local/
  metadata hostnames, and **every** private/loopback/link-local (incl. `169.254.169.254`)/
  CGNAT/multicast/reserved IPv4+IPv6 address (incl. IPv4-mapped/NAT64/6to4 embedded forms).
  `src/crawler/fetch.ts` (`node:http/https`, not global fetch) installs a validating DNS
  `lookup` that **pins the socket to a vetted public IP** (DNS-rebinding-safe), enforces
  timeout/byte-cap/bounded-redirects (**each hop re-validated**)/content-type allowlist, and
  re-checks the peer address. All crawled text is **untrusted data, never instructions**
  (`sanitize.ts`: `sanitizeHtml`, `detectInjection`, `wrapUntrusted`). `robots.ts` is respected.
- **Extraction** (`src/crawler/extract.ts`, pure): JSON-LD/`@graph`, Product/Offer, identifiers
  (GTIN/MPN/SKU/brand), price/availability, shipping/returns policy, AggregateRating (rating +
  review count), headings, FAQ, canonical + noindex signals, and presence booleans.
- **Findings** (`src/diagnosis/diagnose.ts`, pure) join benchmark observations (lost intent,
  winning competitor, AI answer + citations) with the crawled gap → recommended intervention +
  **expected MECHANISM, always hedged — never a guaranteed outcome, and never inferring causation
  from a competitor merely exposing a signal.** Two tiers: `evidence_backed` (tied to specific
  lost queries) and `general_hygiene`. Each ships confidence/`basisN`/limits.
- `migrations/0010_crawler.sql` (`crawl_pages`, `findings`; additive). `src/diagnosis/execute.ts`
  + `evidence_diagnose` queue handler (mock default; `live` opt-in hits the network — gated).
  Shop-scoped API `src/server/evidence.ts` (`/app/api/evidence/diagnose|findings|pages`, each
  verifies run ownership). `test/crawler.test.ts` (20 pure + 1 DB-gated). **Live crawl needs
  `CRAWLER_MODE=live` on BOTH the `web` (sets the live default at enqueue) AND `worker` (runs the
  fetch) services + a user go.** ✅ **DONE 2026-06-26:** real engine citations are now captured
  (OpenAI `url_citation` annotations / Gemini `groundingChunks` / Perplexity `citations` —
  `EngineResult.citations`, `src/engines/citations.ts`) into `observations.citations`, the diagnose
  route honors `CRAWLER_MODE` as the default, and live diagnosis derives competitor URLs from those
  citations PLUS the merchant's own page from the synced catalog (`getStorefrontUrl`).
  ✅ **MOCK-HONESTY GUARDRAILS (2026-07-11, migration `0025`):** fixture pages can never masquerade
  as a merchant's store — a CONNECTED shop's mock diagnosis never substitutes `MOCK_*` fixture URLs
  (degrades to the honest "no product URL" finding; tests/demos must pass fixture URLs explicitly);
  a live request on a mock-mode process THROWS (no silent fixture 404s → no false "unreachable"
  finding; the resolved mode is threaded through `crawlSeeds`); every finding is stamped
  `findings.crawl_mode` and the Evidence UI badges mock-crawl findings; prod boot warns if
  `SHOPIFY_MODE`/`CRAWLER_MODE` are left mock. Fix Studio apply now also VERIFIES EFFECT: a write
  whose re-read value is unchanged reports failed "no observable effect" instead of applied, and
  the audit logs the store's actual post-write value.

**Phase 6 (Fix Studio — gated, reversible write-back) is built on branch `phase6-fixes`** (off
`phase5-crawler`), mock-verified end-to-end at $0. It turns diagnosis findings + catalog data
into reviewable proposals and applies approved ones to the store.
- **`write_products` is the only place this app mutates a store, and it is gated four ways:**
  merchant **approval** → **`write_products` scope** check (`hasWriteScope`) → **re-read conflict
  check** (abort if the live value changed since the proposal — never clobber) → **snapshot for
  rollback** → audited, with `userErrors` (partial failure) surfaced. `rollbackProposal` is itself
  conflict-checked. `src/fixes/apply.ts` + `src/fixes/source.ts` (`productUpdate`/`rereadProduct`;
  mock simulates + records writes so the lifecycle runs at $0).
- **Proposals never fabricate** (`src/fixes/propose.ts`, pure): direct **write_products** covers the
  SEO title/description backfill composed only from existing catalog data, **plus the product body
  (`descriptionHtml`) — but ONLY to append one sentence the merchant explicitly confirmed**
  (`proposeClaimStatement`, gated on a `requirement_confirmations` "yes"); everything else is
  **copy_ready** validated JSON-LD — a factual Product snippet from the catalog, plus clearly
  placeholdered AggregateRating/shipping/return/FAQ templates the merchant fills with real numbers.
  **And never propose a placebo** (App Store 2.1.4 kickback, fixed 2026-07-11): when `seo.title` is
  unset Shopify falls back to the product title, so proposing the title verbatim writes a change no
  one can observe — `composeSeoTitle` now composes a visibly-different `{title} | {vendor|type}` (or
  proposes nothing). The proposals list is enriched with the LIVE catalog value per row (`drifted`
  flag; apply/rollback mirror the re-read product straight into the catalog) so Fix Studio always
  agrees with the Shopify admin; the UI refetches on tab focus.
  ⚠️ **The body write MUST use raw HTML end to end** (v2.1 CP2.5, migration `0027` adds
  `products.description_html`). `CatalogProduct.description` is `stripHtml()`'d by construction, so
  the earlier code appended to the STRIPPED text and wrote that into `descriptionHtml` — destroying
  the merchant's paragraphs/lists/links, while the rationale promised it "changes nothing else",
  and leaving rollback unable to restore the markup. Keep both views: **stripped** for evidence
  matching and the claim linter, **raw** for anything the write path touches. `liveFieldOf` was
  removed with this — every writable field now reads back from the field of the same name.
- `migrations/0011_fixes.sql` (`fix_proposals` + `findings.signal`; additive). Shop-scoped API
  `src/server/fixes.ts` (`/app/api/fixes/propose|…/{approve,apply,rollback,dismiss}`, tenant-isolated).
  `test/fixes.test.ts` (5 pure + 2 DB-gated lifecycle/conflict/scope). **`write_products` is now in
  the default scopes (`shopify.app.toml` + `SHOPIFY_SCOPES`, 2026-06-25) so one-click apply is
  enabled** — but going live still needs `SHOPIFY_SCOPES` set on Railway → `shopify app deploy` →
  merchant re-consent before relying on it for a real merchant.
  ✅ **The dev-store live-write test is DONE (2026-07-25, v2.1 CP3).** The live write path has
  now run against a real store: propose → approve → apply → **independent Admin API read** →
  rerun (`not_proven` → `pass_evidenced`) → rollback → byte-identical restore, 44 assertions,
  store returned to its pre-session baseline. It exercised the **product body**
  (`descriptionHtml`), which is the most gated write, not just an SEO field. Record:
  `experiments/v2-1/CP3_LIVE_WALK.md`. Two things it established: **Shopify normalizes
  `descriptionHtml` on write**, so "unchanged" must always be judged against the verified
  re-read (which `apply` already does); and the dev store is
  **`ai-visibility-dev-m2su2ozk.myshopify.com`** — the suffix-less form is a live *third-party*
  store, so always assert `{ shop { myshopifyDomain } }` before any write.

**Phase 7 (Experiments & verification — "prove whether it worked") is built on branch
`phase7-experiments`** (off `main`), mock-verified at $0. **The differentiator.** A matched pair
of benchmark runs — the SAME definition before vs after an intervention — compared with CIs.
- **Rigor + honesty are the whole point.** `src/experiments/verify.ts` (pure) reuses the Phase-4
  two-proportion test (Wilson CIs) to classify each metric **improved | regressed | inconclusive**
  (the 95% CI of the difference must exclude 0). It **never claims causation** — an intervention
  plus a measured change is association; confounders (assistant model updates, index refreshes,
  competitor moves, run-to-run variance) are surfaced as **comparability warnings** (model/engine/
  prompt/repetition mismatch, low power) + explicit **caveats**. "Inconclusive" is a first-class
  outcome = "no change detectable at this n", NOT "no effect".
- `migrations/0012_experiments.sql` (`interventions` + `experiments`; additive).
  `src/experiments/execute.ts`: `planIntervention` → `captureBaseline` (run BEFORE) →
  `runVerification` (run AFTER + compare + persist verdict), reusing Phase-4 `executeBenchmark`
  (mock $0; live reserves spend) + `aggregateRun`. `experiment_verify` queue handler.
  Shop-scoped API `src/server/experiments.ts` (`/app/api/experiments/plan|:id/{baseline,verify}|…`,
  tenant-isolated; mock default, live needs `{ live: true }`). `test/experiments.test.ts`
  (4 pure + 1 DB-gated e2e). **Live baseline/verification spend money — cost-gated + user go.**

**Phase 8 (Monitoring & alerts) is built on branch `phase8-monitoring`** (off
`phase7-experiments`), mock-verified at $0. Recurring schedules re-run a benchmark / re-verify a
fix and alert on change.
- **Honest alerting (no cry-wolf):** `src/monitoring/alerts.ts` (pure) fires a regression/
  improvement alert **only when the 95% CI of the difference excludes 0** — identical/noisy runs
  raise nothing. Plus threshold-floor + share-of-voice **competitor-overtake**. Never claims
  causation. `evaluateAlerts` + `nextRunAt` cadence math.
- `src/notify/provider.ts`: `NotificationProvider` seam — `LoggerProvider` (default) +
  `EmailProvider` (gated on `EMAIL_*`; reports `skipped` until the Phase-11 HTTP send, never
  fakes delivery). `src/monitoring/execute.ts`: `monitorRun` (re-run → compare to previous →
  alert → notify → advance cadence) reusing Phase-4 `executeBenchmark`/`aggregateRun` + Phase-7
  `runVerification`; `runDueSchedules` wired into the **Phase-1 scheduler** (`src/scheduler.ts`);
  `monitor_run` worker handler.
- **Recurring runs are mock ($0) by default; `MONITORING_LIVE=1` opts into live engine spend**
  (still under the daily cap) so monitoring never auto-spends silently.
- `migrations/0013_monitoring.sql` (`schedules`/`alerts`/`notifications`; additive). Shop-scoped
  API `src/server/monitoring.ts` (`/app/api/schedules*`, `/app/api/alerts*`, tenant-isolated).
  `test/monitoring.test.ts` (4 pure + 2 DB-gated, incl. no-false-alert-on-identical-runs).

**Phase 9 (Product feeds & agentic readiness) is built on branch `phase9-feeds`** (off `main`),
verified pure at $0. A **versioned feed generator + validator + readiness score** over the
normalized catalog (Phase 3). Pure local computation — **$0, no network**; the only network was a
read-only fetch of the CURRENT official OpenAI spec at build time. **Generating a feed ≠ submitting
it** — OpenAI onboarding/delivery is an external, config-gated step (`FEED_DELIVERY_ENABLED`).
- **Spec as auditable data, not assumptions** (`src/feeds/spec.ts`): the OpenAI Agentic Commerce
  product-feed spec fetched from `developers.openai.com/commerce` (2026-06-21) — 14 always-required
  fields + conditional/recommended/optional tiers, enums, formats — with **provenance** (source URL,
  fetch date, `SPEC_VERSION` flagged `versionConfirmed:false`; `return_policy` docs discrepancy marked).
- **No fabrication** (`src/feeds/map.ts`, pure): one record **per variant** (`group_id`/`variant_dict`
  tie variants); catalog-absent fields stay absent; merchant decisions (currency, eligibility, seller
  identity, countries) come from per-feed config with derived defaults; ARCHIVED/DRAFT filtered.
- **Factual validation only** (`src/feeds/validate.ts`, pure): required/conditional presence,
  eligibility invariant, enums, http(s)-URL shape, price format + sale≤price, full ISO-3166-1 alpha-2,
  ISO-8601, **GTIN check-digit**, length limits, feed-level **duplicate item_id**. error vs warning.
  No URL-200 network check (documented limit, never claimed).
- **Transparent score** (`src/feeds/readiness.ts`, pure): 0..100 =
  `0.45·validity + 0.25·requiredCompleteness + 0.20·recommendedCoverage + 0.10·identifierCoverage`,
  every component exposed — never a black box. Export CSV/TSV/JSON (official) + JSONL (convenience,
  `official:false`) via `src/feeds/export.ts`.
- `migrations/0014_feeds.sql` (`feeds`/`feed_versions`/`feed_items`; additive, format-agnostic for
  future Gemini/Copilot/Shopify-Catalog adapters). Orchestrator `src/feeds/generate.ts` (load synced
  catalog via `db/catalog.ts#loadNormalizedProducts` → map → validate → score → persist a NEW version
  atomically) + `feed_generate` queue handler ($0, no mock/live split). Shop-scoped API
  `src/server/feeds.ts` (`/app/api/feeds*`, `/spec`, `/delivery/status`, `:id/generate`,
  `versions/:vid[/items|/export]`, tenant-isolated; config whitelisted). `test/feeds.test.ts` (13 pure
  + 1 DB-gated e2e). **Migration `0014` applied to Supabase + DB e2e PASSED 14/14 (2026-06-21);
  code merge to `main` + deploy await a user go.**

**Phase 10 (Directional attribution — Web Pixel) is built on branch `phase10-pixel`** (off
`main`), verified pure at $0. A Shopify **Web Pixel extension** detects storefront sessions
that arrived from an AI assistant and beacons consent-gated funnel events → directional
attribution. **"Identifiable AI-referred sessions," NOT causal** (assistants strip referrers →
it undercounts; surfaced as a floor). Generating data needs the extension deployed (external).
- **Conservative classifier** (`src/pixel/referrer.ts`, pure): ChatGPT/Perplexity/Gemini/
  Copilot/Claude by referrer host + `utm_source`. Plain google.com/bing.com are organic search,
  NOT AI — a miss beats mislabeling normal traffic. Server-authoritative (the pixel does a
  minimal client check; the server re-classifies).
- **Untrusted-input hygiene** (`src/pixel/event.ts`, pure): the public beacon is typed/length-
  capped/enum-checked; consent honored; PII minimized (referrer HOST + landing PATH only, query
  stripped); client clock clamped.
- **Honest security posture** (`src/server/pixel.ts`): `POST /api/pixel/ingest` is PUBLIC (CORS
  + preflight), per-IP rate-limited, **consent-gated**, **install-scoped** (`getShop`), server-
  re-classified, stores no raw IP (salted hash), and always 202s so a beacon never breaks a
  storefront. A storefront pixel can't hold a real secret → `PIXEL_SHARED_SECRET` is a weak
  anti-noise gate, NEVER auth. Shop-scoped read `GET /app/api/pixel/attribution` (distinct-
  session funnel by source).
- `migrations/0015_pixel.sql` (`pixel_events`; additive). `extensions/ai-referral-pixel/`
  (`shopify.extension.toml` with `customer_privacy.analytics=true` platform consent gate;
  `src/index.js` persists the original AI referrer in sessionStorage so later funnel events stay
  attributed) — **the owner-deployed artifact (`shopify app deploy`)**.
- **Activation** (`src/pixel/activate.ts` + `client.activateWebPixel`): deploying the extension
  only REGISTERS it — an app-owned pixel must be created per shop via `webPixelCreate` (then
  `webPixelUpdate`, idempotent via `shops.web_pixel_id`, migration `0016`) with the ingest URL as
  settings. **Scope-gated like Phase 6 write_products**: needs `write_pixels` +
  `read_customer_events` (else `missing_scope`). Auto-runs best-effort on OAuth install + `POST
  /app/api/pixel/activate`. `shopify.app.toml` scopes updated (⚠️ re-consent on deploy).
- `test/pixel.test.ts` (12 pure + 2 DB-gated). **Phase 10 ingest/attribution are LIVE; activation
  (branch `phase10-pixel-activate`) + migration `0016` + the scope change/`shopify app deploy`
  await a user go.**

**Phase 11 (Commercial product & entitlements / billing) is built on branch `phase11-entitlements`**
(off `main`), mock-verified at $0. A central, **config-driven entitlements model** + a complete,
**idempotent Stripe billing lifecycle** — layered on the existing payment flows **without changing
them**. NO new dependency (the no-SDK / raw-`fetch` Stripe integration is extended). Stripe stays in
**TEST mode**.
- **Entitlements are CONFIG, not prices** (`src/billing/entitlements.ts`, pure): plan→features+limits
  (free | full_report | monitoring | founder_beta) — never a price. `effectiveEntitlement`/
  `isGrantActive` resolve a grant to access (active/past_due grant; **canceled grants until
  current_period_end**; expired/refunded never); `bestEntitlement` picks the highest-tier active
  grant. `migrations/0017_entitlements.sql` — `entitlements` (dual-keyed by shop_domain AND/OR email
  so it reconciles the Shopify install + the public email funnel) + `billing_events` (idempotency
  ledger) + additive `orders.stripe_payment_intent`/`refunded_at`.
- **The webhook now drives the full lifecycle** (`src/server/stripe.ts` + `src/billing/provision.ts`):
  the verified `checkout.session.completed` → `orders` path is **UNCHANGED** (payment proof);
  entitlement provisioning is added **best-effort + PG-gated** so a billing hiccup never breaks the
  live $29 order path. New events: `customer.subscription.created/updated/deleted` (status/period
  mapping), `invoice.payment_failed` (→ past_due), `charge.refunded` (revoke **only on a FULL
  refund**). Idempotency is layered: `orders.session_id` + idempotent entitlement upserts + a
  `billing_events` ledger (checked at start, recorded after success → a failed event reprocesses).
- **Billing portal** (`src/billing/portal.ts`, raw `fetch`, gated on `STRIPE_SECRET_KEY` + a known
  customer) + shop-scoped `GET /app/api/billing` (effective plan, usage vs limits, plan catalogue) +
  `POST /app/api/billing/portal`. **Enforcement is DORMANT by default** (`BILLING_ENFORCED`, mirrors
  the Phase-1 D2 "ship dormant" rule): the pure `gateFeature`/`gateLimit` gates are wired (402 +
  upgrade payload) into live benchmarks / monitoring schedules / Fix Studio apply / feed definitions,
  but blocking is off until flipped — so deploy never breaks existing behavior or the owner's own dev
  store. `/app/billing` UI surfaces plan + usage + upgrade (Phase 12 patterns). `test/billing.test.ts`
  (9 pure + 4 DB-gated). **✅ LIVE in production (merged + deployed 2026-06-22, commit `6660aa6`;
  migration `0017` applied, DB suite 136/136; Stripe sandbox webhook now subscribes to the
  subscription/refund events + customer portal enabled).** Enforcement stays DORMANT
  (`BILLING_ENFORCED` unset — flip to `1` to gate); going LIVE (real cards) needs Stripe KYC.

**Phase 12 (Experience redesign — the embedded `/app` UI) is built on branch `phase12-app-ui`**
(off `main`), preview-verified. It makes the headless Phase 4–8 backend **visible + demoable**.
- `viewer/src/app/*` — embedded shell (`AppShell.tsx`, sidebar + sub-routes via the shared tiny
  router; wired in `App.tsx` for `/app[/evidence|fixes|experiments|monitoring]`, own chrome) +
  screens: **Dashboard** (score ring, KPIs w/ CIs, the 5-step loop, SoV, alerts), **Evidence**
  (findings w/ AI answer+citations+gap+mechanism), **Fix Studio** (diff + copy-ready snippets +
  approve/apply/dismiss), **Experiments** (baseline→verification CI bars + verdict + caveats),
  **Monitoring** (schedules + acknowledge alerts). Dark token palette; all loading/empty/error states.
- `appApi.ts` hits the real `/app/api/*`; on **401/503/unavailable it falls back to `fixtures.ts`
  (the Caraway loop story) and flags `demo:true`** → an honest "Demo data" badge + Connect-store
  prompt (never fakes liveness). New homepage headline "Turn AI shopping visibility into action" +
  **Connect Shopify** CTA. `npm --prefix viewer run build` green; preview-verified all 5 screens +
  responsive. Components are prop-driven so they lift cleanly. (Pre-existing viewer `tsc` errors in
  `Report`/`IndexLeaderboard` are unrelated; the ship path is `vite build`/esbuild.)
- **Dashboard now wired to REAL per-merchant data** (branch `phase14-dashboard-live`, off `main`;
  built + tested, not yet merged/deployed). The Dashboard was the last screen showing the Olipop
  SAMPLE to everyone; it now loads shop-scoped `GET /app/api/dashboard` (`src/server/dashboard.ts`,
  behind `requireShop`) computing the merchant's own score/rates(CI)/SoV/weakest-engine/top-threat/
  loop-counts/alerts from their latest completed run. Score uses `scoreFromMetrics` (benchmarks/
  metrics.ts) which shares the single-source `SCORE_WEIGHTS` exported from `src/analysis/score.ts`
  (the CLI and dashboard scores can't diverge). Falls back to the labeled sample ONLY on 401 (no
  shop session); a connected shop with no run yet sees a "run your first benchmark" state, never
  sample numbers. Read-only — no migration.
- **Embedded install via TOKEN EXCHANGE is built** (same branch; needed before `embedded=true`).
  Embedded apps use Shopify managed install, which never hits our OAuth callback — so the first
  framed load has a valid App Bridge session token but no shop row, and `requireShop` 401s. New
  PUBLIC `POST /api/shopify/token` (`tokenExchangeHandler`, authed by the session token itself, not
  `requireShop`) verifies the token and exchanges it for an offline access token (RFC 8693,
  `ShopifyClient.exchangeSessionToken`), persisting via the shared `completeInstall` helper (factored
  out of `callbackHandler` so classic OAuth + token exchange behave identically). `appApi.ts` makes
  it transparent: on a 401 it does a one-time deduped bootstrap then retries. Idempotent; mock+live.
  ⚠️ Still needs the external `embedded=true` flip + `shopify app deploy` + REAL in-admin testing to
  confirm the handshake (the build is the most-likely-correct path, but only live testing proves it).

## Aboutness is decided by the SUBJECT, not a window (`src/server/subject.ts`, v2.5)

The largest false-pass class was aboutness: the store states a fact about its **packaging**,
**shipment**, a **bundled item**, a **competitor** or a **review**, and the row credits it to
the product. Two guards were supposed to stop that and structurally could not — a closed
10-noun list (`SUBJECT_BEFORE_VETO`) and a 24-character window after the term
(`MODIFIED_SUBJECT`). Neither can ever reach "Every order is wrapped in 100% cotton muslin.",
which contains no vetoed noun at all: the signal is the subject and the verb.

`nonProductSubject` reads the subject span and the container-verb frame. It **fails OPEN** —
only a confident non-product reading vetoes — because vetoing on "unknown" would suppress the
ordinary subject-less copy that fills a Shopify description and gut depth.

> **Why not the semantic tier (v2.5 CP2 decision).** It exists, has the right grant/veto
> asymmetry, and was inert. It was still the wrong tool here, for a measurable reason: **the
> adversarial corpus is the acceptance gate and runs offline**, so `judgeClaims` returns empty
> and a semantic aboutness gate could close no corpus case and could not be reached by the
> mutation proof. A fix the gate cannot measure is not a fix. The tier remains the right tool
> for **paraphrase** — recovering true statements no term list can match — which is what it was
> built for. It is still inert; that is a live decision, not an oversight.

⚠️ **The legacy guards are NOT dead.** Both are still load-bearing and complementary: they reach
the shapes with no finite verb, where the subject rule has nothing to delimit ("Our packaging:
made from recycled cardboard."). The corpus carries a control case for each — without them the
mutation proof reports both as decorative, which is a corpus hole, not a useless guard.

⚠️ **`CLAUSE_BOUNDARY` is serving two incompatible jobs** and this is the known open defect. The
boundaries that stop a negation leaking forward onto an unrelated statement ("Our cups are not
dishwasher safe, and they are made from stoneware.") are the same ones that stop it reaching a
conjunct it genuinely governs ("We do not offer weekend pickup, or overnight shipping."). One
boundary set cannot serve both; fixing it needs scope, not another list.

> ✅ **RESOLVED (v2.8 CP2): `origin` was REMOVED from the shipped library.** It had been deferred
> four times. Two independent measurers plus a refuting verifier wrote three separate sets and one
> natural-frequency read of 5,322 real product descriptions. The session's fixed decision rule
> could not arbitrate — the same matcher scored **100.0%, 94.0% and 17.0%** specificity on the three
> independently-written negative sets, which makes that term a property of the set author. What
> decided it: on 369 naturally-occurring origin sentences the proposed narrowing was **17 true
> statements lost, 0 false passes gained**, and the class it closed (`"Made in Georgia pine."`) has
> **zero instances across all 5,322 real products**. The shipped form could not stay either — it
> answered "no stated country of origin" to `"Made in the U.S.A."` (the clause splitter cuts on the
> abbreviation's dots), `"Handcrafted in Nepal."`, and every city (the gazetteer had none, while
> `AMBIGUOUS_PLACE` listed five entries that were not in `PLACES` and could never fire). Wrong in
> both directions, and `not_proven` in 10 of the 11 stores that carried it. **Losing one row of
> depth costs less than one false statement about a real store.** The measured path back — the
> terminator rule closed every false pass, the frame narrowing closed none and cost 32 of 33 lost
> positives — is in the tombstone above `MEASUREMENT` in `productTest.ts` and in
> `experiments/v2-8/FITNESS.md`. **Do not attempt a third head-noun rule.**

## A measurement that did not complete is not a passing measurement (v2.8 CP0)

`src/measure/completion.ts`. Every aggregate, sweep and harness resolves to exactly one of
**`VERIFIED_CLEAN` · `DEFECTS_FOUND` · `INCOMPLETE`**, and `confirmedCount` is `number | null` —
**`null` on INCOMPLETE, never `0`** — so an incomplete run cannot be summed into a defect total or
read as a pass by a caller that only looks at the number. `requireDecisive()` throws at the top of
any ship decision.

This exists because the same bug has appeared four times, always in the flattering direction:
a workflow returned `confirmed: 0` because its three verifiers died holding 24 candidates; an
`xargs`-piped hygiene sweep reported CLEAN over a real leak; `python -c` / `npx tsx -e` emit no
output and exit 0; and a v2.8 sample probe **failed open on an unreadable `robots.txt`**, printing a
line identical to a permitted read. Zero is the most dangerous number a broken instrument returns,
because it is also what a healthy one returns.

`INCOMPLETE` is forced by: a unit that did not return; candidates no verifier adjudicated; attackers
with no verifier scheduled; nothing scheduled at all; or `confirmed > adjudicated`. A dead verifier
makes even a `DEFECTS_FOUND` run non-decisive — partial verification reports a floor of unknown
depth. **Two agents died mid-run in the session that shipped this; both were resumed, and both then
returned findings that changed what shipped.**

> ⚠️ **Real-store audits before v2.8 were UNDERPOWERED, not reassuring.** v2.3 audited 37 rows and
> v2.5 audited 18, both reporting zero false positives, and that was read as evidence the engine is
> fit on real copy. v2.8 audited **100 pass rows across 35 stores and found two** — a nutrition
> quantity read as a product measurement, and a product claim proven from the shipping policy's SEO
> chrome. Both predate v2.8. "Zero across 55 rows" was a statement about sample size.
>
> **v2.9 closed both, and measured to a BOUND rather than to a hope.** 172 stores, 507 pass rows,
> every row audited: **1 false positive**, cluster-adjusted 95% upper bound **1.30%**. Always report
> the cluster-adjusted figure — pass rows are not independent, they share a store's copy conventions
> (~2.95 rows/store, DEFF 1.39 at ICC 0.2), and the bare `3/n` rule of three is only its x=0 case.

## Measurement is cheap now — there is no excuse to defer it (v2.9 CP3)

`experiments/v2-9/{capture,replay,audit}.ts`. The fitness measurement went from **76 minutes
through production to seconds offline**, validated at **99.6% row agreement** against the
production run it replaces (tolerance stated before the number was read).

Two design rules make it trustworthy, and both were chosen the hard way:
- **Capture the RAW HTTP responses, never a parsed product.** A parsed snapshot bakes in that
  day's extraction code, so changing segmentation makes every earlier snapshot incomparable and a
  mixed run silently averages two engines.
- **Replay through `runProductTest` itself** with only the transport swapped. Re-implementing the
  requirement library, the access de-dup, the floor or the linter gate would create a second
  engine that drifts — the mistake this repo already documents elsewhere.

It earned its cost the day it was built: replaying the changed engine over 172 real stores caught
a regression (`case` in a veto list killing *"With its case measuring a classic 39mm"* on a watch
store) that no unit test or corpus case detected. **Re-run it after every matcher change.**

> ⚠️ **`safeFetch` is fingerprint-refused by some Cloudflare-fronted stores.** Capturing through it
> yielded 11 of 20, every drop `rate_limited`; raw `fetch` got 200 on the same hosts seconds later
> across every header variant. The cause is the TRANSPORT — `node:https` pinned to a vetted IP,
> forcing HTTP/1.1 with a distinct TLS fingerprint — not pacing and not the User-Agent. Production
> is not refused today, but **the throttle rate this project tracks as an escalation signal is
> partly a property of our transport, not of the stores.**

> ⚠️ **An independent pass can only be trusted if its ATTRIBUTION is mechanical.** v3.0's
> pass returned 27 confirmed defects against the new `care` guard, and a regex over the
> refuters' prose said 1 was guard-caused. Running all 53 attacker sentences through the
> pre-change commit and diffing said the truth: **0 regressions, 0 status changes at all** —
> 35 residual and 18 pre-existing, none of them the guard's doing. Never classify "did my
> change cause this" by reading an agent's reasoning; A/B it against the parent commit.
> `experiments/v3-0/attribute_ab.mjs`.

> ⚠️ **A rule stated only in a comment is not a rule.** v2.9's quantity guard broke
> `"Each 12 oz bag contains 8 g of protein."` — the sentence its own comment named as a must-pass.
> Grepping for it returned exactly one hit: the comment. No test, no corpus entry, 157 tests green.
> If a comment says "must still pass", it owes a corpus case in the same commit.

## A published standard can now be executed (v3.0) — and a general sample is the wrong instrument

`standards/` holds a versioned, content-hashed **assertion grammar** plus **Coffee Standard
v1.0** (42 entries, 10 executable) and `standards/compile.ts`, which maps entries to the
engine's real `Requirement` type. **G-09 is closed**: `RunOptions.requirements` + `standard`
let a pinned contract run against a PUBLIC url, the result carries `standardId/version/hash`
so a citation resolves, `MAX_REQUIREMENTS` is a *rendering* cap that supplied contracts
bypass, the `requires_store_access` collapse is disabled for a conformance list, and
`contractVersion` gains a `c1s-` tag folding in the standard identity (a generated contract
still hashes `c1-…`, byte-identical). Pinned runs **bypass the result cache in both
directions** — it is keyed on URL alone, so otherwise a conformance result would be served to
the public funnel.

⚠️ **Merging `standards/` protected nothing until it was wired.** `npm test` globbed
`test/*.test.ts` and `npm run typecheck` included `src/**/*.ts`, so an engine change could
break every standard with both gates green. Both now run the standards project; the wiring
was *proved* by renaming an engine export that root `tsc` accepts and the second half
catches. **Do not un-wire it.**

> ⚠️ **THE INSTRUMENT FINDING, and v3.1 turned it into two numbers that cannot both be
> right about the same product.** Same engine, same day, same audit discipline:
>
> | | general sample | coffee sample |
> |---|---|---|
> | stores | 172 | 42 |
> | pass rows, each audited individually | 507 | 69 |
> | confirmed false positives | **0** | **3** |
> | cluster-adjusted 95% bound (ICC 0.2) | **0.83%** | **13.68%** |
>
> Two of the three coffee defects fire on vocabulary a coffee page contains and a general
> DTC page does not — a brewing recipe, a caffeine dose *per serving*, soil described as
> rich in *organic matter*. **The general-sample bound is not an estimate of the error rate.
> It estimates the error rate on copy that looks like the average of every category at
> once, which is copy no individual merchant writes.** v2.8: "zero across 55 rows was a
> statement about sample size." v3.0: "…about sample SHAPE." v3.1 measures it: the number a
> coffee roaster experiences is **13.68%**, not 0.83%.
>
> **The operational rule: a category standard must be fitness-measured on that category
> before it is published.** Full record: `experiments/v3-1/STANDARD_RUN_2.md`.

✅ **G-10 (applicability gating) is CLOSED (v3.1 CP3)** — `standards/applicability.ts` plus a
per-standard sidecar. Signal order is the engine's own and G-10's: **`product_type`
authoritative → JSON-LD category → breadcrumb → `title` FALLBACK → never tags**, and tags are
excluded *structurally* (`ClassifiableProduct` has no tags field, so the module cannot read
them even when handed in). Two properties are non-optional and tested: **every exclusion is
reported with a reason** (a list that drops entries silently is worse than one that runs them
all — the reader cannot tell passing from not being asked), and **excluding everything is a
loud error with `includedCount: null`, never `0`**. `unknown` is its own class: a product with
no `product_type` and an undecisive title is not the same as one that clearly does not match,
and neither is the same as one that passed.

The rules live in `standards/<cat>/<ver>/applicability.json` **beside** the document, not
inside it: `standard_hash` covers `standard.json`'s bytes and a citation resolves through it,
so encoding the executable reading of prose already there must not invalidate every citation
made against v1.0.

⚠️ **What its absence cost, measured on run 1's own snapshots: 16 of 25 products should never
have been asked** (13 out of category — `Merch`, `Home`, `Gifts`, an espresso machine, a
cocktail shaker, three t-shirts — and 3 unclassifiable). Run 1 reported 11 by hand. On a valid
44-product sample the bands go to **HELD 2/10 with all 8 misses HIGH**, and **three of run 1's
ten verdicts were artefacts of n=9**: `WEIGHT-001` (11.1% → 48.8%) and `DELIV-001` (MISSED low
33.3pp → HELD) were about to be reclassified as carrying no information, and are among the
standard's best entries.

✅ **RESOLVED (v3.2 CP2): `product_type` now survives the page tier.** It used to be dropped
whenever the page's JSON-LD was complete — `pageSufficient` skips the `.json` tier, so the
value fell back to JSON-LD `Product.category`, null on most themes and the breadcrumb root
`"Home"` on one store. 15 of 44 coffee products were unclassifiable, and the same null flows
into `CATEGORY_CLAIMS` and `AttributeSpec.onlyFor`, so category inference in PRODUCTION was
degrading to the title alone at that rate. After the fix: **G-10 skips 15 → 2**.

⚠️ **The obvious fix was the wrong one, and the reason generalises.** Fetching
`/products/{handle}.json` anyway spends the extra request the tier ORDER exists to avoid (the
v1.1 smoke run measured `.json` returning 429 while HTML on the same hosts returned 200) —
and it **breaks every existing snapshot**, because replay serves only URLs that were actually
recorded and on precisely these stores the engine never fetched it. *A fix that invalidates
the corpus it must be measured on is not a fix.* The value was already in bytes we hold:
Shopify's analytics bootstrap (`var meta = {"product":{…,"type":"Coffee",…}}`) carries the
merchant's own field on 43 of 44 captured pages — measured before the code was written. It is
**parsed, not regexed**: `"type"` also appears inside `variants[]`, so a bare regex would
silently return a variant's field on a theme that reorders keys.

## The standard is PUBLISHED, and readable without JavaScript (v3.2 CP6+CP7)

`src/server/standardsSite.ts` + `test/standardsSite.test.ts`. Stable URLs, because these
are citations — an agency writes *"your product pages fail ALS-COFFEE-1.0-CERT-002"* and it
has to resolve: `/standards` · `/standards/coffee/1.0` · `/standards/coffee/1.0/standard.json`
(`application/json`, plus an `X-Standard-Hash` header) · `/standards/coffee/1.0/{ENTRY-ID}`
for all 42 · `/standards/coffee/1.0/grounding` · `/llms.txt`. All are in `sitemap.xml`.

**Every published number is generated from the artifact.** Structure from `standard.json`,
error bounds from a new `standards/coffee/v1.0/fitness.json` sidecar — beside the document,
not inside it, for the same reason `applicability.json` is a sidecar: `standard_hash` covers
`standard.json`'s bytes and a citation resolves through it, so a measurement taken after
publication must not invalidate every citation made against v1.0. **When a sample is absent
the page says so; it never invents a bound.** The test asserts the served JSON is byte-identical
to the file on disk, because a re-serialised body still parses but hashes differently.

⚠️ **The document's own words are published unedited.** Its `status` is `draft` and its posture
says it "has never been applied to a real store by anyone" and is "a rubric with a versioned
changelog, not a standard". Publishing it under a heading calling it finished would make the
site's first claim about itself a false one. The heading is "Buying standards", the status is
stated, and the posture paragraph renders verbatim above everything else.

> ⚠️ **A renderer that reads a field which does not exist produces NOTHING, and nothing looks
> exactly like a section that legitimately has nothing to show.** The grounding renderer read
> `grounding.sources`; the artifact's key is `grounding.citations`. All 42 entry pages and the
> whole grounding page rendered empty — with eleven tests green, because they asserted the
> presence of *other* things. The test now asserts CONTENT: ≥20 grounded entries, every citation
> URL present on both the entry page and the grounding page, and a byte floor. Grounding went
> from 309 to 26,652 characters. **A presence-only assertion cannot see an empty section.**
>
> Related and equally silent: **`[object Object]` reached published pages three times**
> (`posture`, `applicability`, a derived assertion's `expected`). Template interpolation
> converts without throwing. There is now one `renderScalarish` and a test forbidding the
> string on every page.

## Your own replay CANNOT validate a matcher change (v3.2 — the eighth instance)

**The three coffee false positives were fixed, measured, and reverted, and the measurement is
worth more than the fix would have been.**

| instrument | verdict on the same four guards |
|---|---|
| replay over **216 captured real stores**, 1,669 rows, comparing rendered QUOTES not just statuses | **0 real positives lost** |
| 2 independent attackers, 661 chosen sentences, every claim re-executed and A/B'd against the parent | **192 regressions** |

Both ran in this repo, on the same commit, the same day. The replay is not broken — it is
answering a different question. This project already wrote the rule down and then trusted the
sample anyway: *"Sampling real stores catches artefacts; only executing the matcher against
deliberately chosen input catches logic."* A 216-store sample cannot find
`"Our stock pot measures 10 inches across."` because none of those stores sells one.

**The operational rule: a real-store replay is a REGRESSION check, never an acceptance gate
for a matcher change.** The gate is an adversarial pass by someone who did not write the guard.

Why each guard was unsalvageable rather than merely too wide — all four failure modes are
general, and all four are worth recognising before writing the next guard:
- **A closed list used as the PROTECTOR fails open in the damaging direction.** `SERVING_HEAD`
  vetoed `serving` unless followed by a serveware noun; `pitcher, jug, cup, glass, carafe, mug,
  crock, tureen, ramekin, basket, vessel, cone` were all missing, and each miss deletes a real
  product. Same shape as the head-noun rule v2.8 removed from `origin` after four attempts.
- **A frame that also matches money.** `for\s*\d` is how a recipe introduces water *and* how a
  page states a price: `"Our 16 oz water bottle sells for 19.99."`
- **Substance words are product words.** `stock` (pot), `ice` (cream scoop), `cream`, `water`
  (bottle, -resistant). A hyphen defeats an adjacency lookahead entirely.
- **Homographs, and the violation path.** `SENSE_SHIFT`'s `reach` is both the EU chemicals
  regulation (`"BPA-free, REACH compliant"`) and the commonest closing clause in DTC copy
  (`"reach out with any questions"`); `compounds` is the FDA's own wording for an antiperspirant
  active, so vetoing it told a store that STATES the violating claim that it stated nothing.
  **Status-only comparison cannot see that** — both answers are `not_proven`.

And they did not close their own class: `"Pour 6 oz of hot water over the grounds."` still
passes (`USAGE_VERB` has steep/brew/dissolve; coffee copy says pour, heat, fill, boil, bloom),
and `"organic plant matter"` / `"organic material"` walk past `SENSE_SHIFT` on one adjective
and one synonym. **Closing three sentences is not closing a class.** All four are pinned in
the corpus with the cost of the attempt beside them; `EXPECTED_OPEN_GAPS` 31 → 36.

## Never trust your own fix measurement — the sixth and seventh instances (v3.1)

Two corrections, both to numbers this project had already acted on, both found the same way:
**execute every claim against the commit serving production and diff.** Neither was findable
by reading anything.

1. **v3.0's attribution A/B reported `0 regressions, 0 status changes` across 53 attacker
   sentences.** Re-run from three independently checked-out worktrees: **nine**, every one a
   real care instruction the guard deleted. Its published counts (`residual 35 /
   pre-existing 18`) are exactly what you get when the "pre" probe returns the POST answers —
   a file swap that did not take. The method was sound; the run was not. A whole session's
   brief was written on that number.
2. **v3.1's own fixes carried 28 regressions against production**, in four causes, **none of
   which any probe the author wrote had reached.** The worst was one hour old: an unanchored
   `free of` frame that suppressed 16 *genuine* violations — "Free from parabens, this
   antiperspirant contains aluminum chlorohydrate." — which is the commonest thing
   personal-care copy does.

> ⚠️ **Use full `git worktree` checkouts, never a file swap.** A swap that silently fails to
> apply is indistinguishable from "no differences". Put a **two-sided liveness canary** in
> every probe (two inputs with known-different answers) and exit `INCOMPLETE` if it collapses.
> Compare the **rendered quote** too — a pass with a different quote is a different answer.
> `experiments/v3-1/{ab_probe_tpl.ts,ab_diff.mjs,reexec.ts,attribute.mjs}`.

**A refuter verdict is a candidate, not a finding, if the tree moved under it.** v3.1 edited
`src/` while its refuters were running, so all 123 claims were re-executed mechanically
afterwards and that diff is what the conclusions rest on. **Freeze the tree for the duration
of an independent pass**, and tell agents given a repo not to run a package manager — one ran
`npm install` and emptied `node_modules` mid-session.

**Four buckets, and only one of them blocks:** REGRESSION (worse than production — yours),
CLOSED (production is wrong and you fixed it), RESIDUAL (wrong in both, inside your guard's
charter — an incomplete fix), PRE-EXISTING (wrong in both, another mechanism owns it). v3.1's
final split was `regressions 2 · closed 12 · residual 75 · unresolved 8`. **The 75 is the
honest headline: the branch was not the problem, the engine is.**

> ⚠️ **A guard whose anchor a later fix has SUBSUMED has silently stopped being proved.**
> v3.1's mutation refresh found three guards reading DECORATIVE and two anchors SKIPping, for
> five different reasons — a status-asserting corpus cannot see a guard whose damage is in the
> DETAIL (`"states the opposite"`); a control case can be pre-empted by a *different* guard
> running first; another was dropped by G-08's lint pre-filter before matching; one anchor
> drifted in a refactor; and one was written with a `\b` escape through a non-raw string so
> the file received a real **0x08 BACKSPACE**, which matches only a backspace. That last one
> made a sweep report **55 of 55 rows** as defects — a broken instrument reads like a
> catastrophe. Repair with a **script file** (`experiments/v3-1/fix_ctl.mjs`); every layer of
> `node -e` and `python -c` quoting eats one backslash.

## The adversarial corpus — the standard for evidence matchers (v2.4 CP1)

`test/adversarialCorpus.test.ts` + `test/support/adversarial.ts`. **A new requirement
kind, term list, or guard ships with adversarial corpus entries — not with a passing
sample of real stores.**

Why this is a rule and not a preference: v2.3 audited 7 real stores, found zero false
positives, and that was close to worthless as a general claim. A pass that *executed the
matcher against chosen sentences* then found six more defects on copy those stores merely
happened not to write. v2.4 ran **959 such probes across every matcher and confirmed 131
defects**, every one re-executed by an independent adversarial verifier.
**Sampling real stores catches artefacts; only executing the matcher against deliberately
chosen input catches logic.**

How the corpus works — read the header of the test file before adding a case:
- Each case carries `correct` (the honest answer, argued from evidence availability) and,
  when the engine currently disagrees, `actual` — a **measured, known gap**. The test
  asserts `actual ?? correct`, so the suite is green on today's behaviour while every
  defect is pinned in code. It fails in **both** directions: fix a gap and its case fails
  (delete the `actual`); regress and its case fails.
- `EXPECTED_OPEN_GAPS` is asserted exactly, so gaps cannot quietly multiply.
- A case with `actual` is **not an accepted behaviour**. It is a debt with a receipt.
- Hostile classes to cover for any new matcher: the term present but about **packaging,
  shipping, a bundled item, a competitor, or a review quote**; present as a **placeholder**
  or a **negation**; present in a **marketing idiom**; the **canonical true phrasings** that
  must still pass; and **merchant-controlled strings** (title, product_type, option values)
  that must never reach a linted output.

**Mutation proof is part of the standard.** `experiments/v2-4/mutate.mjs` disables each
guard in turn and requires a specific corpus case to fail. A guard whose removal breaks
nothing is not a guard. Current state: **12/12 guards load-bearing**. When it first ran,
4 read as "decorative" — every case written for them was already a known gap, so removing
the guard changed nothing. That is a corpus coverage hole, not a useless guard: each needed
a **control case the guard currently catches** (e.g. `"Shipped in 100% recycled packaging."`
for `MODIFIED_SUBJECT`). Keep those anchors.

> ⚠️ Two traps this session hit, both of which fake a clean result:
> - **`npx tsx -e` and `python -c` produce NO output** in this environment's PowerShell and
>   exit 0. A silent one-liner is indistinguishable from a clean sweep. **Always use a
>   script file.**
> - **Ripgrep/Grep respects `.gitignore`.** A repo-wide search for the send-pack template
>   found nothing because the artefacts are under the ignored `experiments/`. Sweeps that
>   must be exhaustive need a walker that ignores `.gitignore` (see
>   `experiments/v2-4/findgen.mjs`).
> - The **Grep tool renders a leading `//` as `\`** in some context lines. It mimics the
>   0x08 corruption exactly. Confirm at the byte level (`experiments/v2-4/ctlsweep.mjs`)
>   before believing source is corrupt — it was not.

## Roadmap & deferred work → [`TODO.md`](TODO.md)

The full backlog — **every deferred security/hardening item** and **all planned
features** (Shopify OAuth, scheduled monitoring, fixes/generators engine, multi-run
aggregation, growth experiments, payments lifecycle) — lives in `TODO.md`. Keep it the
single source of truth; update it as items ship.

> ⚠️ **The bottleneck right now is distribution, not features.** The product is a
> credible beta. Before building anything in TODO.md, the highest-ROI work is getting it
> in front of ~10 real merchants (publish Index categories, DM the brands their rank).
> Build new features only once there's a paying-customer signal that pulls for them.

## TODO markers in code
- `src/engines/anthropic.ts` — **Claude adapter placeholder** (not implemented). Fill in
  Messages API + web_search tool, register in `engines/index.ts`. **Copilot** follows
  the same shape.
- `src/detection/index.ts` — sentiment + LLM classification pass (see above).

## Security reminder
`imp keys.txt` (gitignored, read by no code) once held a **Shopify API secret** exposed
in plaintext. That secret was **rotated 2026-06-21** (old value dead) — no outstanding
action; delete the file if still present locally. Keep all live secrets in env vars only
(`.env` local / Railway prod); `.env.prod.bak` holds prod creds and is gitignored — never
commit it or expose it to external tools.
