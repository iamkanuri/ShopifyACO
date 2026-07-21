# AGENTIC INSTRUMENT TEST — STAGE 1 — Phase 0 Audit

Date: 2026-07-21 · Branch: `feat/agentic-instrument-stage1` (off `main` @ `252d4ee`)

## 1. Language / framework / runtime

**Not Next.js.** The repo is a plain **TypeScript + Node 22** app run directly via `tsx`
(no build step), ESM modules with `.js`-suffixed relative imports. Backend is **Express**
(`src/server/index.ts`); the UI is a separate Vite+React app in `viewer/` (irrelevant to
Stage 1). Dependency policy: minimal deps, **raw `fetch`, no provider SDKs**. Stage 1
honors that (no new dependencies).

## 2. Existing catalog/product ingestion

The ingestion pipeline (Phase 3 of the platform build) is:

- `src/catalog/source.ts` — `fetchProductsPage(shop, token, cursor)` pulls product pages
  from the Shopify GraphQL Admin API (live) **or a deterministic 7-product fixture
  (`SHOPIFY_MODE=mock`)**. Captures per product: `id, title, handle, descriptionHtml,
  vendor, productType, tags, status, onlineStoreUrl, seo{title,description},
  featuredImage, variants (id/title/sku/barcode/price/availableForSale/selectedOptions),
  collections, metafields (namespace/key/value/type)`.
- `src/catalog/normalize.ts` — pure `normalizeProduct()` → `NormalizedProduct`
  (strips HTML from `descriptionHtml` via `stripHtml`, decodes entities, collapses
  whitespace — exactly the normalization Stage 1 needs, reused as-is).
- `src/catalog/sync.ts` — `syncCatalog(shop)` orchestrates full sync → Postgres.
- `src/db/catalog.ts` — persistence; **`loadNormalizedProducts(shop)` reconstructs the
  full normalized catalog from the DB** (built for the Phase 9 feed generator). This is
  the read surface Stage 1 snapshots from.

**Surfaces available:** product_title, product_description, product_metafields,
product_variants, product_options (variant `selectedOptions`). Also SEO title/description
(not an EvidenceSurface in the Stage 1 contract — ignored). **Surfaces NOT ingested
anywhere in AisleLens: structured_data (JSON-LD), faq, shipping_policy, returns_policy**
— per spec 4.3.2 these are recorded as absent in snapshot metadata; no new ingestion is
built. (`src/crawler/extract.ts` can parse JSON-LD/FAQ but only from *crawled public
web pages*, not from the store catalog — not an ingestion path for a store snapshot.)

## 3. Model-provider clients

All raw-`fetch` adapters behind `EngineAdapter` (`src/engines/types.ts`), keys read from
env via `ENV.keys` (`src/server/env.ts`): `OPENAI_API_KEY`, `GOOGLE_AI_API_KEY`,
`PERPLEXITY_API_KEY`, `ANTHROPIC_API_KEY`.

| Provider | Key in local `.env` | Native tool calling | Stage 1 eligible |
|---|---|---|---|
| OpenAI `gpt-5.4-mini` (`src/engines/openai.ts`) | ✅ | ✅ (chat completions `tools` / Responses API) | **✅ family A** |
| Gemini `gemini-2.5-flash` (`src/engines/gemini.ts`) | ✅ | ✅ (`functionDeclarations`) | **✅ family B** |
| Perplexity `sonar` | ✅ | ❌ no native function calling | excluded |
| Anthropic | ❌ no key (placeholder adapter) | ✅ | excluded (no key) |

**Two qualifying families exist → no abort.** The existing adapters are completion-only
(hardwired to web-grounded shopping answers), so per spec 4.11 Stage 1 adds **thin
tool-calling adapters** for OpenAI + Gemini in new code, reusing `postJson`/`HttpError`
from `src/engines/http.ts` and pricing/cost estimation from `src/engines/models.ts`
(`gpt-5.4-mini` and `gemini-2.5-flash` are both already in `PRICING`). No web grounding
is requested — the only tools exposed are the four snapshot store tools.

## 4. Database & logging conventions

- Runtime DB access: `@supabase/supabase-js` for simple rows, **raw `pg` pool
  (`src/db/pg.ts`: `pgQuery`/`pgTx`) for anything relational** — Stage 1 uses `pgQuery`
  only (via the ingestion layer + seed).
- Migrations: version-controlled `migrations/NNNN_*.sql` applied by `npm run migrate`,
  tracked in `schema_migrations`, idempotent. **Stage 1 adds no migration** — snapshots,
  traces, and results persist as filesystem JSON/JSONL under
  `experiments/agentic-stage1/` (explicitly allowed by spec 4.3.6/4.7), keeping the
  schema untouched.
- Logging: structured JSON `console` logs server-side; Stage 1 logs progress to stdout
  and writes full traces to JSONL files.
- Local DB: **Supabase CLI local stack** (`supabase/config.toml`; Postgres on
  `127.0.0.1:54322`, referenced by `.env` `DATABASE_URL`). Verified up and migrated;
  contains **zero shops and zero products** (see §9).

## 5. Existing experiment / before-after infrastructure

Phase 7 (`src/experiments/verify.ts`, `execute.ts`) runs matched before/after benchmark
pairs with Wilson CIs, and Phase 4 (`src/benchmarks/`) executes benchmark runs. **Not
reused**: Stage 1's adjudication is deterministic count thresholds over 18 journeys (spec
4.9/4.13), not proportion CIs, and the benchmark executor is built around engine answer
text + brand detection, not tool-calling agent loops. Reusing them would import a lot of
machinery to use none of its core. What IS reused: ingestion (§2), HTTP helper + pricing
(§3), `pgQuery` (§4), and the mock-shop seeding pattern from `test/catalog.test.ts`.

## 6. Fix Studio write/rollback (located; NOT used)

`src/fixes/apply.ts` (`applyProposal`/`rollbackProposal`, four-gate write path),
`src/fixes/source.ts` (`productUpdate`/`rereadProduct`), `src/fixes/propose.ts`.
Stage 1 does not import or touch any of it. RESTORED is produced by re-inserting the
manifest's removed evidence into a copy of FAULTY (spec's sanctioned shortcut).

## 7. Feature-flag mechanism

Convention confirmed: **plain env vars centralized in `src/server/env.ts` (`ENV`)** —
e.g. `JOB_QUEUE_ENABLED`, `MONITORING_LIVE`, `BILLING_ENFORCED`. Stage 1 follows the
same convention but reads `AGENTIC_INSTRUMENT_TEST_ENABLED` in its own module (adding it
to `ENV` would modify a production module for no production purpose). Flag defaults to
disabled; the runner refuses without it (test-enforced).

## 8. Test framework

`node:test` via tsx: `npm test` → `node --import tsx --test test/*.test.ts`. All test
files live flat in `test/`. DB-dependent tests are opt-in via
`RUN_DB_TESTS=1` + `DATABASE_URL` (`{ skip: !RUN_DB }` pattern). Stage 1 tests go in
`test/agenticStage1.test.ts` (pure/deterministic — no DB, no network, runs on every
`npm test`).

## 9. Test shop identification

There is **no shop and no synced catalog in the local database**, and no
`SHOPIFY_API_KEY`/`SHOPIFY_API_SECRET` in local `.env`, so live OAuth against the real
dev store (`ai-visibility-dev.myshopify.com`) is impossible locally — and Rule 15
forbids substituting live Shopify API access. The repo's canonical no-credentials test
store is **`SHOPIFY_MODE=mock`**: mock OAuth/token + a deterministic 7-product fixture
catalog, seeded exactly as the repo's own DB-gated test does
(`test/catalog.test.ts`: `upsertShop` → `storeCredentials(shop, "mock_token", …)` →
`syncCatalog(shop)` — requires `APP_ENCRYPTION_KEY`, generated ephemerally for the
seed run; the token is never needed again after seeding).

**Stage 1 test shop: `agentic-stage1-test.myshopify.com`** — created locally by the
seed step, hard-coded as the ONLY allowlisted shop in the runner. It exists only in the
local Supabase stack; production is untouched.

**Test product & attribute:** `Mock Product 1` (`gid://shopify/Product/1001`, Cookware,
ceramic). Its fixture description contains no aluminum-free text, so per spec 4.2 the
seed step adds the merchant's truthful statement to the test store product **at the
database level** (the local `products` row + a `custom.aluminum_free` metafield), then
snapshots via `loadNormalizedProducts`. Deviation note, reported honestly: in mock mode
the "store" is a code fixture, so "edit the store then re-ingest" is impossible without
modifying the production fixture module (forbidden by Rule 12); the ingested DB row is
the store-of-record the entire app (feeds, fixes, dashboard) reads, and editing it is a
merchant-edit simulation on a **local database-backed copy — no Shopify store is
written** (Rule 1 intact). The attribute stays `aluminum_free` with the spec's exact
matching-terms list ("aluminum-free construction" is a real, natural cookware claim —
ceramic vs. aluminum pans); ground truth for this fictional product is defined by us as
merchant: `aluminum_free: true`.

## 10. Implementation plan

**Layout** (all new code; no production module modified):

- `src/agentic-test/` — implementation (inside `src/` so `npm run typecheck` covers it;
  tsconfig only includes `src/**`; spec allows `src/agentic-test/`): `types.ts`,
  `contract.ts`, `ground-truth.ts`, `snapshot-service.ts`, `snapshot-mutator.ts`,
  `store-tools.ts`, `trace-recorder.ts`, `model-client.ts` (OpenAI+Gemini tool-calling
  adapters), `mock-model.ts`, `agent-runner.ts`, `evidence-validator.ts`,
  `adjudicator.ts`, `comparator.ts`, `seed-test-shop.ts`, `run-experiment.ts` (CLI).
- `experiments/agentic-stage1/` — `AUDIT.md`, `STAGE1_REPORT.md`, `snapshots/*.json`,
  `results/*.json(l)` (data + docs, committed for auditability).
- `test/agenticStage1.test.ts` — the 16 required tests, pure.

**Reused:** `loadNormalizedProducts` + `NormalizedProduct` (ingestion), `pgQuery`,
`upsertShop`/`storeCredentials`/`syncCatalog` (seed only), `postJson`/`HttpError`,
`PRICING`/`estimateCostUsd`. **Created:** everything in `src/agentic-test/`.

**Assumptions:** local Supabase stack running (verified); OpenAI + Gemini keys valid
(smoke-tested in CP2 — a dead key at CP2 is a stop-and-report); mock catalog sync works
locally (same code path as the repo's own DB test).

**Cost estimate:** 18 journeys × ≤8 tool-loop calls × small contexts ≈ **well under $1
expected** (gpt-5.4-mini $0.75/$4.5 per M; gemini-2.5-flash $0.30/$2.50 per M; no web
grounding fees). Hard breaker at $25 per the contract.

**Maximum-hours estimate:** ~10–14 h of focused implementation+runs
(CP1 ≈ 3, CP2 ≈ 3, CP3 ≈ 3, CP4 ≈ 2, CP5 ≈ 2).

**First executable checkpoint (CP1):** seed script + snapshot service + fault mutator +
fixtures, with tests 1–3 and 13–16 green under `npm test`.

## Abort-condition check

1. ~~No identifiable test shop~~ → mock test shop via the repo's canonical mock-mode
   path, seeded locally (§9). **Not aborting** — the alternative reading ("only a real
   Shopify store counts") would force live-API substitution, which Rule 15 forbids more
   strongly; deviation documented above.
2. ~~Fewer than two tool-calling providers with keys~~ → OpenAI + Gemini both qualify (§3).
3. ~~No ingestion path~~ → mock sync → Postgres → `loadNormalizedProducts` (§2).

**Proceeding to CP1.**
