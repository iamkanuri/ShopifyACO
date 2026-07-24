# DEPLOY.md — ShopifyACO (Railway, single service)

---

# ▶ RELEASE: "AI Commerce QA" repositioning + the Buyer Test

**Branch:** `feat/phase-b-v1-1` · **Base:** `main` (fast-forward, no merge commit)
**Carries:** the public repositioning · Phase B (the Buyer Test) · the hardening ·
v1.1 (headline math, recovered surfaces, task ranking, semantic tier).

Nothing in this release is deployed until you run the push below.

## 1. Merge + push (run these yourself)

```bash
git checkout main
git merge --ff-only feat/phase-b-v1-1     # must fast-forward; if it refuses, STOP and re-check
git push origin main                       # Railway auto-builds (npm run build) + deploys
```

## 2. Set / confirm these Railway variables

| Variable | Value | Why |
|---|---|---|
| `PUBLIC_BRAND_NAME` | `AisleLens` | public name (never "Shopify…") |
| `PUBLIC_BASE_URL` | `https://lens.thirdocular.com` | OG/share URLs |
| `OPENAI_API_KEY` | (already set) | powers the semantic tier (~$0.001/test) |
| `PRODUCT_TEST_SEMANTIC` | *unset* (or `0` to kill) | `0` disables the semantic tier without a redeploy |
| `AGENTIC_INSTRUMENT_TEST_ENABLED` | **leave unset** | keeps the experiment routes off in production |
| `HOSTED_CASES_DIR` | **leave unset** | keeps `/c/:token` inert |

## 3. Post-deploy verification (in order)

1. **`/healthz`** → `ok:true` and `commit` matches the SHA you just pushed.
2. **Hard-refresh** `https://lens.thirdocular.com/` (Cmd/Ctrl-Shift-R) — the hero must read
   *"AI buyers treat your store like an API. We test it like one."* with the terminal-style
   pass/fail card. Tab title: *"AisleLens — AI Commerce QA for Shopify"*.
3. **Run one Buyer Test on production**: paste a real Shopify product URL at `/test`.
   Confirm the assertion table renders, the headline counts only unproven rows, and every
   green **Proven** row shows a quote that plainly supports it. *If any Pass isn't plainly
   supported by its quote, roll back (§4) — that is the one unrecoverable failure mode.*
4. **OG image + title**: view-source on `/` → `og:image` = `/og-image.svg`,
   `og:title` = the hero line. Open the SVG directly; it must say *AI Commerce QA for Shopify*.
5. **Re-scrape the social card once** (platforms cache aggressively):
   LinkedIn Post Inspector <https://www.linkedin.com/post-inspector/> and
   X Card Validator — paste `https://lens.thirdocular.com/` and force a refresh.
6. **Spot-check the legacy surfaces**: an old `/report/<id>` link still loads, and its share
   title says *"AI buyer readiness"* (not "AI Visibility Score"). `/methodology` renders.

## 4. Rollback

```bash
# Fastest: Railway → Deployments → previous green deploy → Redeploy.
# Or by commit:
git revert --no-edit <the-merge-or-head-sha>
git push origin main
```
Migrations are unchanged by this release, so a code rollback is complete and safe.
The kill switches (no redeploy needed): `PRODUCT_TEST_SEMANTIC=0` disables the semantic
tier; `DAILY_SPEND_CAP_USD=0` halts all live scan spend.

## 5. Known production risk: the egress throttle (watch this)

Shopify applies a rate limit (`local_rate_limited`) that is **per-egress-IP and
endpoint-specific, applied across all stores** — not per store. Observed during v1.1 smoke
testing: `/products/*` returned 429 on three unrelated brands we had never touched, while
`/robots.txt` and `/policies/*` **on those same hosts** returned 200, and shell `curl` with
the identical UA succeeded. It persisted past a six-minute cooldown. Every Buyer Test
originates from one Railway IP, so this is a capacity ceiling on the whole funnel, not a
per-store courtesy problem — and per-host throttling structurally cannot help, because the
limiter does not count per host.

**Shipped mitigations (V2 CP1):**

| Defense | Where | Behavior |
|---|---|---|
| Page-first fetch order | `productTest.ts` | HTML product page is tier 1 (it survives when `.json` is throttled); `.json` only fills a gap the page left; `.js` last |
| Global egress budget | `productTestCache.ts` | process-wide **20 fetches/min across all hosts** + concurrency 2; bursts wait, they don't stampede |
| Honest degradation | `productTest.ts` | a throttled tier yields a **partial test** with the affected rows marked `requires_store_access` and the accurate reason — never "this store publishes nothing", never an error page |
| Result cache | `productTestCache.ts` | **7 days** per normalized URL ("Tested 3 days ago · Run again") |
| Negative cache | `productTestCache.ts` | a host that 429s is not re-probed for **10 minutes** |

Tunable without a code change: `PRODUCT_TEST_EGRESS_PER_MIN` (default 20),
`PRODUCT_TEST_EGRESS_CONCURRENCY` (default 2), `PRODUCT_TEST_EGRESS_MAX_WAIT_MS` (default 10000).

### Escalation path (NOT built — decide from telemetry)

Every test logs a `product_test` line carrying `tier` (which fetch tier answered),
`throttled` (which tiers were refused) and `degraded`. The same fields land on the
`product_test` event row.

**The trigger signal: throttle rate over a rolling 24h** —
`count(degraded or errorKind="rate_limited") / count(product_test)`.

- **< 5%** — no action. The caches and budget are absorbing it.
- **5–20% sustained for 48h** — raise the cache TTL and lower `PRODUCT_TEST_EGRESS_PER_MIN`
  first; these are env-var changes, no redeploy of code paths.
- **> 20% sustained, or any day where `degraded` exceeds clean results** — pick one:
  1. **Egress proxy pool** — route product fetches through N rotating egress IPs. Highest
     leverage, since the limiter keys on IP. Cost: a proxy vendor + a per-IP budget split.
  2. **Queued async flow** — accept the URL, return "we'll show your result in a minute",
     run it off the existing Phase-1 job queue at a paced rate. Removes the interactive
     deadline that makes throttling visible, at the cost of the instant-gratification funnel.
  3. **Storefront API for installed merchants** — authenticated merchants stop using the
     public crawl path entirely. Doesn't help the public funnel (the acquisition surface),
     so it is a complement to 1 or 2, never a replacement.

If tests start failing broadly, check the `product_test` log lines for
`errorKind:"rate_limited"` and the `tier`/`throttled` fields before suspecting the engine.

---

One Railway service runs **everything**: the Express API **and** the built React
viewer (static files) from the same process. No Vercel, no CORS, no second service.

## Architecture

```
Browser ──> Railway service (Express, 0.0.0.0:$PORT)
              ├── /api/*            JSON API (scans, prompts, leads, events)
              ├── /healthz          health check
              └── /* (everything)   serves viewer/dist (built React SPA)

  Supabase Postgres   ← runtime data (leads, runs, events) via service-role key
  Railway Volume (/data) ← result files (results.json, report.md, progress.log)
```

- **Build:** `npm run build` (installs + builds the viewer to `viewer/dist`). No
  secrets needed at build time.
- **Start:** `npm run migrate; npm start` (railway.json). Migrations run at startup
  where Railway reliably injects the service's runtime variables, then the server
  boots (`tsx src/server/index.ts`, binds `0.0.0.0` in production). The `;` makes
  boot resilient: a migrate hiccup degrades persistence gracefully rather than
  crash-looping the container (check `/healthz` → `supabase`).
- **Variables must be set on the SERVICE**, not project "Shared Variables" (those
  are not auto-injected). The build-step approach failed for exactly this reason.

## Environment variables (set ALL of these in Railway → Variables)

| Variable | Purpose | Example |
|---|---|---|
| `OPENAI_API_KEY` | engine | `sk-proj-…` |
| `GOOGLE_AI_API_KEY` | engine | `AQ.Ab8…` |
| `PERPLEXITY_API_KEY` | engine | `pplx-…` |
| `SUPABASE_URL` | persistence | `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | persistence (server-only) | `eyJ…` |
| `DATABASE_URL` | migrations (session pooler, **port 5432**) | `postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres` |
| `DAILY_SPEND_CAP_USD` | global daily spend ceiling | `25` |
| `NODE_ENV` | production posture | `production` |
| `DATA_DIR` | volume mount path for result files | `/data` |
| `ADMIN_PASSWORD` | gates `/admin` (unset ⇒ admin disabled) | `a-long-random-string` |
| `IP_HASH_SALT` | salts the one-way IP hash stored for limits | `random-string` |
| `PUBLIC_BRAND_NAME` | public name (UI/titles/OG) — **never "Shopify"** | `AI Visibility` |
| `PUBLIC_BASE_URL` | absolute URL for OG/share links (blank ⇒ from request) | `https://yourbrand.com` |
| `CONTACT_EMAIL` | shown on `/privacy` + footer | `hi@yourbrand.com` |
| `STRIPE_FULL_REPORT_URL` | Stripe Payment Link (missing ⇒ email modal) | `https://buy.stripe.com/...` |
| `STRIPE_WEEKLY_MONITORING_URL` | Stripe Payment Link | `https://buy.stripe.com/...` |
| `STRIPE_FOUNDER_BETA_URL` | Stripe Payment Link | `https://buy.stripe.com/...` |

`PORT` is set by Railway automatically — do not hardcode it.
**`SUPABASE_SERVICE_ROLE_KEY` is server-only.** It is never imported by the viewer
bundle (verified: no `import.meta.env`/`VITE_` secret usage; `grep` of `viewer/dist`
finds no secrets).

## Database / migrations workflow

Migrations are version-controlled SQL in `migrations/` applied by `src/db/migrate.ts`.

```bash
# locally (uses DATABASE_URL from .env)
npm run migrate          # applies pending migrations, then prints the verified tables
```

- The runner tracks applied files in a `schema_migrations` table and is idempotent.
- On Railway the same command runs automatically at startup (`railway.json` start
  command), so production schema stays in sync on every deploy. It needs
  `DATABASE_URL` as a **service** variable (build time is too early / unreliable).
- Adding a migration = drop a new `migrations/NNNN_name.sql` and redeploy (or run
  `npm run migrate`). Never hand-run SQL in the dashboard.

## First-time Railway setup (dashboard steps)

1. **New Project → Deploy from GitHub repo** → pick this repo. Railway reads
   `railway.json` for build/start.
2. **Variables** → paste every variable from the table above.
3. **Volume** → add a volume, mount path **`/data`**, and set `DATA_DIR=/data`.
4. **Deploy.** Build runs `npm run build && npm run migrate`; start runs `npm start`.
5. **Networking → Generate Domain** to get the public URL.
6. Open `/healthz` → should return `{ ok: true, supabase: true, … }`.

## Smoke test (production)

1. `GET /healthz` → `ok:true`, `supabase:true`.
2. Open the domain → `/demo` renders the Caraway report.
3. `/scan`: enter brand + competitor + email → Generate → Run → report renders.
4. Click a CTA → submit email → check Supabase `leads` table has the row.
5. Verify `events` rows: `scan_started`, `scan_completed`, `report_viewed`, `cta_*`.
6. Spend cap: temporarily set `DAILY_SPEND_CAP_USD=0.01`, try a scan → blocked with
   the honest "daily capacity reached" message + a `spend_cap` lead. Reset after.

## Where data lives

- **Postgres (Supabase):** `leads`, `runs`, `events`. The source of truth for
  analytics, leads, and rate-limit counters.
- **Volume (`/data`):** per-run files `config.json`, `results.json`, `report.md`,
  `progress.log`, `status.json`. Survives redeploys; lost only if the volume is deleted.

## Custom domain (Railway)

The app reads its public URL from `PUBLIC_BASE_URL` (or the request host) — there are
**no hardcoded `*.up.railway.app` URLs**, so it works behind any domain.

1. **Railway:** service → **Settings → Networking → Custom Domain** → enter your domain
   (e.g. `app.yourbrand.com` or apex `yourbrand.com`). Railway shows a target value.
2. **DNS (at your registrar):**
   - Subdomain → add a **CNAME** record from the subdomain to the Railway-provided
     target (e.g. `app` → `xxxx.up.railway.app`).
   - Apex/root → use an **ALIAS/ANAME** (or your registrar's flattened CNAME) to the
     target, since CNAME on a root is usually disallowed.
3. Wait for DNS + Railway to provision the TLS cert (minutes to ~an hour).
4. Set **`PUBLIC_BASE_URL=https://yourdomain`** in Variables so OG tags + share links
   use the real domain. Also set **`PUBLIC_BRAND_NAME`** to your final public name.
5. (Stripe) Point each Payment Link's success URL at `https://yourdomain/thanks?plan=<id>`
   and set the `STRIPE_*_URL` vars; the CTAs open them, the `/thanks` page logs
   `payment_completed`.

## Admin cockpit

`/admin` is gated by `ADMIN_PASSWORD` (cookie session, constant-time check,
rate-limited login). It shows today's metrics, the funnel, runs, leads, errors, and
launch-target progress, and can launch standard/deep scans for paid-beta customers.
If `ADMIN_PASSWORD` is unset, `/admin` is disabled.

## Multi-process services (LIVE 2026-06-21) — web + worker + scheduler
One image, three Railway services from the **same repo**. `railway.json` runs `npm run migrate;
npm start` for all of them; `src/start.ts` then **dispatches on `PROCESS_MODE`**: `web`
(default → Express + viewer) · `worker` (`npm run worker`) · `scheduler`. So the **only
per-service difference is the `PROCESS_MODE` variable** — no per-service start-command or
healthcheck overrides (Railway handles those inconsistently). `worker`/`scheduler` run a minimal
`/healthz` server (`src/health.ts`) so the shared healthcheck passes; they need no domain/volume.
- Add a service: Railway **+ Create → GitHub Repo** (NOT Empty Service) → copy the web service's
  env vars → set `PROCESS_MODE=worker` (or `scheduler`). Don't hardcode `PORT` (Railway injects it).
- Turn the queue on LAST: set `JOB_QUEUE_ENABLED=1` on the **web** service only.
- Verify: `/healthz/deep` → `worker` + `scheduler` heartbeats + `jobQueueEnabled:true`.
- Recurring monitoring is mock/$0 until `MONITORING_LIVE=1`; live crawl needs `CRAWLER_MODE=live`.

## Rollback

- **Code:** Railway → Deployments → pick a previous green deploy → **Redeploy**.
- **Migrations:** forward-only. To undo schema, add a new migration that reverses it
  (don't edit an applied file). Data in Supabase is unaffected by a code rollback.
- **Kill switch:** set `DAILY_SPEND_CAP_USD=0` to immediately stop all live scans
  (new scans get the "capacity reached" message); no redeploy needed after the var
  change propagates.

## Security posture

- Localhost-only with a loud warning in dev; binds `0.0.0.0` only in production.
- Email-gated scans; per-email + per-IP daily free-scan limits; per-IP rate limits;
  request size cap; honeypot field; per-scan + global daily spend caps enforced
  **before** any live API call; scan wall-clock timeout.
- No secret is read from anything but environment variables.
