# DEPLOY.md — ShopifyACO (Railway, single service)

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
| `DAILY_SPEND_CAP_USD` | global daily spend ceiling | `10` |
| `NODE_ENV` | production posture | `production` |
| `DATA_DIR` | volume mount path for result files | `/data` |

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
