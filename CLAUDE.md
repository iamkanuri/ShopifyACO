# CLAUDE.md — ShopifyACO

Guidance for future sessions working in this repo.

## Product vision

ShopifyACO tells e-commerce merchants whether AI assistants (ChatGPT, Gemini,
Perplexity, later Claude/Copilot) **recommend their products to shoppers**, measures
their **share of voice vs competitors**, and will eventually **help them fix it**. As
shoppers increasingly ask AI assistants "what should I buy", being invisible to those
assistants is the new being-on-page-2-of-Google. We measure that visibility, then
close the gap.

## What exists today (tonight's build)

A standalone TypeScript CLI — the **measurement engine**. No Shopify yet, no DB, no UI.

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

Pure, dependency-free, unit-testable. Turns one answer into per-brand
`recommendationStatus`. The enum has five values; **only three are implemented now**:
`recommended`, `mentioned_neutral`, `not_mentioned`. Matching is case-insensitive,
variant-aware (aliases, products, possessives, corporate suffixes, store **domains**),
and word-boundary safe. It also computes list rank, first-mention order, and a snippet.

## Roadmap

### Week 1
- Shopify OAuth + catalog read (pull real products/collections to auto-build configs).
- Dashboard (visualize share of voice over time).
- Scheduled scans (cron) with historical tracking.

### Week 2+ (do NOT build before week 1)
- **Fixes engine** — requires **store crawling**; suggests concrete content/PDP/schema
  changes to improve AI visibility. The report currently has only a stub line for this.
- **Detection day 2-3:** sentiment pass to populate `mentioned_positive` /
  `mentioned_negative`, plus an optional **LLM classification pass** for ambiguous
  answers. Enum values already exist so this is non-breaking.
- Persistence / DB.

## TODO markers in code
- `src/engines/anthropic.ts` — **Claude adapter placeholder** (not implemented). Fill in
  Messages API + web_search tool, register in `engines/index.ts`. **Copilot** follows
  the same shape.
- `src/detection/index.ts` — sentiment + LLM classification pass (see above).

## Security reminder
`imp keys.txt` in the repo root holds live secrets including a **Shopify API secret**.
It is gitignored. That secret has been exposed in plaintext — **rotate it before
production**.
