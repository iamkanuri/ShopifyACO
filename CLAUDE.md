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
  pooler, port 5432) AND at **startup** on Railway (`railway.json` start =
  `npm run migrate; npm start`, non-fatal so a DB hiccup degrades gracefully instead of
  crash-looping). Migrations need vars on the **service** (project Shared Variables are
  NOT auto-injected). First connection failure ⇒ almost always the password isn't
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
  `/thanks?plan=…` → `payment_completed` event. Full report is sold honestly as
  "manually reviewed during beta, delivered by email within 24h".
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

## ⚠️ Rotate the Shopify secret before any Shopify work
`imp keys.txt` holds a live **Shopify API secret** that was exposed in plaintext. No
code reads it (verified), but it MUST be rotated in the Shopify dashboard before any
Shopify OAuth / App Store work begins.

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
  `CRAWLER_MODE=live` + a user go.** Known follow-up: Phase 4 stores `observations.citations`
  as `[]` — wire real engine citations so live diagnosis auto-derives competitor URLs.

**Phase 6 (Fix Studio — gated, reversible write-back) is built on branch `phase6-fixes`** (off
`phase5-crawler`), mock-verified end-to-end at $0. It turns diagnosis findings + catalog data
into reviewable proposals and applies approved ones to the store.
- **`write_products` is the only place this app mutates a store, and it is gated four ways:**
  merchant **approval** → **`write_products` scope** check (`hasWriteScope`) → **re-read conflict
  check** (abort if the live value changed since the proposal — never clobber) → **snapshot for
  rollback** → audited, with `userErrors` (partial failure) surfaced. `rollbackProposal` is itself
  conflict-checked. `src/fixes/apply.ts` + `src/fixes/source.ts` (`productUpdate`/`rereadProduct`;
  mock simulates + records writes so the lifecycle runs at $0).
- **Proposals never fabricate** (`src/fixes/propose.ts`, pure): direct **write_products** is limited
  to SEO title/description backfill (exact reformats of existing data); everything else is
  **copy_ready** validated JSON-LD — a factual Product snippet from the catalog, plus clearly
  placeholdered AggregateRating/shipping/return/FAQ templates the merchant fills with real numbers.
- `migrations/0011_fixes.sql` (`fix_proposals` + `findings.signal`; additive). Shop-scoped API
  `src/server/fixes.ts` (`/app/api/fixes/propose|…/{approve,apply,rollback,dismiss}`, tenant-isolated).
  `test/fixes.test.ts` (5 pure + 2 DB-gated lifecycle/conflict/scope). **Live writes need
  `SHOPIFY_SCOPES=…,write_products` + merchant re-consent + a user go.**

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
`imp keys.txt` in the repo root holds live secrets including a **Shopify API secret**.
It is gitignored. That secret has been exposed in plaintext — **rotate it before
production**.
