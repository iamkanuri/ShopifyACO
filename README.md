# ShopifyACO — AI Visibility Engine (CLI)

Does ChatGPT / Gemini / Perplexity recommend **your** store to shoppers — or your
competitors? This CLI measures it: it asks each engine your buyer-intent prompts,
detects who got mentioned and recommended, and produces a share-of-voice report.

> Tonight's build is the standalone measurement engine. Shopify integration, a
> dashboard, and the fixes engine come later — see [CLAUDE.md](CLAUDE.md).

## Setup

```bash
npm install
cp .env.example .env      # then paste your real keys into .env
```

`.env` keys: `OPENAI_API_KEY`, `GOOGLE_AI_API_KEY`, `PERPLEXITY_API_KEY`.

## Usage

```bash
# Zero-cost full pipeline against deterministic fake engines:
npm run scan -- ./config/example.config.json --mock

# See the expanded prompts without calling anything:
npm run scan -- ./config/example.config.json --dry-run

# Live run (prints a cost estimate and asks you to confirm first):
npm run scan -- ./config/example.config.json
```

### Flags
| Flag | Meaning |
|---|---|
| `--mock` | Deterministic fake engines, no API spend |
| `--dry-run` | Expand prompts + print plan only |
| `--limit-prompts N` | Only run the first N expanded prompts |
| `--max-cost-usd X` | Abort if est. max cost > X; hard-stop mid-run if exceeded |
| `--no-save-raw` | Don't store raw API payloads in `results.json` |
| `--yes` | Skip the live-run confirmation |
| `--out DIR` | Output directory (default `./results`) |
| `--concurrency N` | Max concurrent engine calls |

## Output

Written to `./results/` (gitignored):
- **`report.md`** — human-readable: AI Visibility Score, executive insight, grounding
  status, mention vs recommendation rates (overall + per engine), per-prompt breakdown,
  where competitors beat you, prompts where you're absent, snippets, cost summary, the
  **gap analysis**, and **evidence-backed + general-hygiene fix cards**.
- **`results.json`** — full machine-readable run, with the merchant analysis embedded
  under `analysis`.

## Gap analysis (offline, deterministic)

The `src/analysis/` layer reads `results.json` and produces merchant insights — main
competitor threat, mention→recommendation gap, weakest engine, transactional whiteout,
competitor proof points, and prioritized fix cards. It makes **no API calls**, so you
can re-run it for free after tweaking the logic:

```bash
npm run analyze -- results/results.json   # regenerates report.md + analysis, $0
```

The **AI Visibility Score** is a documented, deterministic formula (see
`src/analysis/score.ts`); every component is shown so the number is never a black box.
All rates carry their raw counts (`n=`) and are framed as single-scan signal, not fact.

## Self-service scan flow (local web app)

Run the local funnel: a `/scan` form that anyone can fill in to get a polished report,
plus `/demo` and `/report/:runId`. Two processes:

```bash
# terminal 1 — the scan API (binds 127.0.0.1:8787 ONLY)
npm run server

# terminal 2 — the web UI (proxies /api to the server)
cd viewer && npm run dev      # http://localhost:5173
```

- `/demo` — the bundled Caraway report.
- `/scan` — enter brand + competitors → **Generate prompts** (deterministic, free) →
  optionally **Suggest more with AI** (one call, ≤ $0.02) → edit prompts → **Run mini
  scan** (5 prompts × 3 engines, $0.50 cap). You confirm the estimated cost before any
  live call. Progress streams; it redirects to the report when done.
- Report CTAs ("Full Report — $29" / "Weekly Monitoring — $49/mo") are a **pricing
  test** — clicking opens an honest "payments aren't live yet, leave your email" modal.

> ### 🔒 SECURITY — localhost only
> The server runs with **your live API keys** and has **no auth, no rate limits, and
> no per-day spend cap** (only the per-scan cost cap). It binds to `127.0.0.1` and
> prints a warning on startup. **Never expose it publicly as-is.** See the
> `DEPLOYMENT TODOs` in [`src/server/index.ts`](src/server/index.ts) (auth, per-IP
> rate limiting, daily spend caps, abuse protection) — all required before deploying.
>
> Scan outputs and captured emails live in `runs/` and `runs/leads.jsonl`, which are
> **gitignored**. Don't commit them.

## Web report viewer

A polished **Vite + React** dashboard in `viewer/` renders a `results.json` the way a
merchant would read it — visibility score, executive insight, competitor leaderboard,
per-engine breakdown, lost-prompts table, gap analysis, and two-tier fix cards.

```bash
cd viewer
npm install
npm run dev        # opens http://localhost:5173 with the bundled Caraway demo
```

Use **Load results.json** in the header to drop in any run. Components are pure and
prop-driven so they lift cleanly into the future Shopify embedded app.

## Config

See [config/example.config.json](config/example.config.json). Templates use
`{placeholder}` tokens; `{category}`, `{buyerPersona}`, `{location}`, `{priceRange}`
auto-fill from top-level fields, and anything in `placeholderValues` is expanded as a
cartesian product.
