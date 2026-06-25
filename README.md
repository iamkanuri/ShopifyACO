# ShopifyACO — AisleLens

Are AI assistants (ChatGPT, Gemini, Perplexity) recommending **your** store to shoppers —
or your competitors? AisleLens measures that visibility, diagnoses *why* competitors win,
proposes reviewable fixes, and verifies whether a change actually moved the needle — with
real statistics, never vanity claims.

> **Public name:** **AisleLens** (`PUBLIC_BRAND_NAME`). The repo/internal name stays
> `ShopifyACO`. 🏷️ Public-facing names must **never** contain "Shopify" (trademark).

## Current state — this is LIVE in production

Live at **https://lens.thirdocular.com** (one Railway web service + worker + scheduler,
Supabase Postgres). It's a Shopify **embedded app** + a public self-serve funnel, with real
Stripe payments. The single source of truth for what's built/deployed is the **"LIVE
DEPLOYMENT STATE"** block + verification log in
[`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md). Architecture, conventions, and the
per-phase history live in [`CLAUDE.md`](CLAUDE.md); external/credential actions in
[`LAUNCH_CHECKLIST.md`](LAUNCH_CHECKLIST.md); the roadmap in [`TODO.md`](TODO.md).

Shipped, end-to-end: measurement engine → detection → analysis → report; public funnel
(`/`, `/scan`, `/report/:id`, `/demo`, AI Visibility Index); embedded `/app` (Dashboard,
Catalog, Measure, Evidence, Fix Studio, Experiments, Monitoring, Feeds, Billing) with
per-merchant data; Shopify OAuth + token-exchange install; durable job queue; live Stripe
billing; abuse/spend protection; SSRF-hardened evidence crawler.

## Security & secrets (production posture)

- **Auth:** `/app/api/*` is shop-scoped behind `requireShop` (App Bridge session token or a
  signed, fail-closed cookie). Public endpoints are rate-limited + spend-capped.
- **Spend safety:** anything that costs money or hits the network is **mock by default**
  (`SHOPIFY_MODE`, `CRAWLER_MODE`, monitoring); live paths are explicit opt-in, gated by a
  global **daily spend cap** + atomic reservation. Stripe is in **TEST mode** (live pending KYC).
- **Secrets:** env vars only (`.env` local / Railway prod, both gitignored). `.env.prod.bak`
  holds prod creds and is gitignored — **never commit it or expose it to external tools**.
  The previously-exposed Shopify API secret was **rotated 2026-06-21** (old value dead).
- Tokens are encrypted at rest (AES-256-GCM); raw IPs are never stored (salted hash only).

## Run it

```bash
npm install
cp .env.example .env        # paste keys; see .env.example for the full list
npm test                    # pure tests ($0, no network)
npm run typecheck
npm --prefix viewer run build
```

**Local dev** runs against a local Supabase stack (CLI + Docker) — see
[`LAUNCH_CHECKLIST.md`](LAUNCH_CHECKLIST.md) §11. DB-gated tests:
`RUN_DB_TESTS=1 SHOPIFY_MODE=mock APP_ENCRYPTION_KEY=<base64-32> npm run test:db`.

### The CLI measurement engine (still here)

The original standalone engine is intact:

```bash
npm run scan -- ./config/example.config.json --mock     # zero-cost full pipeline
npm run scan -- ./config/example.config.json --dry-run  # expand prompts only
npm run scan -- ./config/example.config.json            # LIVE (asks to confirm)
npm run analyze -- results/results.json                 # re-run offline analysis, $0
```

Useful flags: `--limit-prompts N`, `--max-cost-usd X`, `--yes`, `--no-save-raw`,
`--out DIR`, `--concurrency N`. See `--help`.

The **AI Visibility Score** is a documented, deterministic formula (`src/analysis/score.ts`;
the benchmark path shares the same `SCORE_WEIGHTS`) — every component is shown, never a black
box. All rates carry their raw counts (`n=`) and 95% confidence intervals, framed as
single-scan signal, not fact.

## Config

See [config/example.config.json](config/example.config.json). Templates use `{placeholder}`
tokens; `{category}`, `{buyerPersona}`, `{location}`, `{priceRange}` auto-fill from top-level
fields, and anything in `placeholderValues` is expanded as a cartesian product.
