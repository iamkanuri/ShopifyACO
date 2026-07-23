# AGENTIC INSTRUMENT TEST — STAGE 3 — Phase 0C Probe-Channel Audit

Date: 2026-07-22 · Branch: `feat/agentic-instrument-stage3` (off stage-2 head `9de03fe`)

## 1. Runnable visibility channels with present env keys

Three (target was ≥2 — **no abort**), all via the existing engine adapters
(`src/engines/`, raw fetch, `EngineAdapter` contract):

| Channel | Adapter | Model | Key present | Grounding |
|---|---|---|---|---|
| OpenAI | `openai.ts` (Responses API + `web_search` tool) | gpt-5.4-mini | ✅ | web_grounded (falls back ungrounded on 4xx) |
| Gemini | `gemini.ts` (`google_search` grounding tool) | gemini-2.5-flash | ✅ | web_grounded (honestly reports `unknown` if the API skipped grounding) |
| Perplexity | `perplexity.ts` (chat completions) | sonar | ✅ | web_grounded natively |

## 2. Per-channel citation availability + shape (criterion-ii input)

All three return citations through the API — captured into `EngineResult.citations`
(string URLs, deduped by `src/engines/citations.ts`):

- **OpenAI:** `url_citation` annotations on Responses output parts
  (`extractResponsesCitations`) — direct target URLs.
- **Gemini:** `groundingMetadata.groundingChunks[].web.uri`
  (`extractGeminiCitations`) — often Google REDIRECT URLs, not final hosts
  (documented in the adapter; the Phase-5 crawler resolves them, but Stage 3's
  compiler treats them as opaque source pointers). This shape difference is a
  per-channel citation-availability finding in its own right.
- **Perplexity:** top-level `citations[]` and/or `search_results[].url`
  (`extractPerplexityCitations`) — direct URLs, typically the richest list.

## 3. Probe persistence today + cost basis

- **Existing persistence paths:** (a) Phase-4 benchmarks write `benchmark_runs` +
  `observations` rows (the `observations.citations` column exists since the
  Phase-5 citation work); (b) the CLI scan pipeline persists `results.json`
  per run under the data dir. Stage 3's battery follows the established
  experiment convention: full raw responses + citations persisted as committed
  JSONL under `experiments/agentic-stage3/` (batch-tagged `stage3`), through
  the EXISTING adapters — no new provider integration.
- **Cost basis** (`src/engines/models.ts`, includes grounded-search fees):
  worst-case per call ≈ $0.020 (openai: $0.016 fixed + tokens), ≈ $0.012
  (gemini), ≈ $0.006 (perplexity). **Battery projection: 6 prompts × 3 repeats
  × 3 channels = 54 calls ≈ $0.70 worst-case ~$1.10.** Gate A+B journeys
  (32) ≈ $0.25 + semantic-tier calls (gemini-flash, tiny) ≈ $0.10. Total
  Stage 3 projection **≈ $1.5–2.5**, far under the $25 breaker (contract
  expected $8–18; probes turn out cheaper than budgeted).

## 4. Real merchant observations in local data?

**None.** Local `benchmark_runs`, `observations`, and `runs` tables all contain
0 rows; the only shops in the local stack are the two experiment shops. The
top-level `runs/` directory holds the owner's own June CLI scan outputs
(public-brand scans, no merchant installs) — untouched by Stage 3. The battery
runs fresh against the seeded dev-store category (Rule 8 upheld).

## Decision

Proceed. Semantic-tier designated model: **gemini-2.5-flash** (cheapest
qualifying, min temperature, thinking disabled), promptVersion `sem-v1`.
Compiler LLM-extraction model: **gpt-5.4-mini** (the stronger of the two cheap
models per Stage 1/2 behavior), strict JSON schema, min temperature.
