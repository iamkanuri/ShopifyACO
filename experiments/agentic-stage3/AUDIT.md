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

---

# GATE A EXECUTION RECORD (2026-07-22)

Three defects were caught by the gates themselves and fixed with disclosure:
1. **Veto scope bug (paid smoke caught):** variant/price/metafield STRUCTURED
   support was being sent to the aboutness judge (variant titles judged "about
   a scent"); Rule 6 scopes vetoes to explicit LEXICAL matches only. Fixed;
   regression-tested (paranoid-judge test).
2. **Claim-rescue design collision (PARA-v2 4/4 FALSE_CERTAINTY):** agents
   citing REAL retrieved paraphrase sentences were condemned by the lexical
   floor before the semantic tier could judge the claim. Fixed: real+pinned+
   in-scope citations failing ONLY the lexical check go to quote-bounded
   semantic judgment (rescue → SEMANTIC_VERIFIED); fabricated ids still hard-
   disable the tier. Deterministic-only behavior (Stage 1/2) unchanged.
3. **sem-v1 → sem-v2 (the one allowed prompt revision, full Gate A rerun):**
   sem-v1's "about THE PRODUCT ITSELF" made the judge veto LEGITIMATE
   shipping-policy evidence for delivery_timing (caught by the BASE regression
   cell: gemini BASE → POLICY_OPACITY). sem-v2 derives the legitimate subject
   from the constraint's surfaces (policy attributes ≙ store policy). Both
   versions' full Gate A results are preserved: `results-prebugfix/` (code
   bugs), `results-semv1/` (prompt bug), `results/` (final).

**Gate A final (sem-v2): 12/12** — TRAP 4/4 REJECTED_ABOUTNESS→MISSING_EVIDENCE;
PARA-v2 4/4 PASS@SEMANTIC_VERIFIED; BASE 2/2 PASS (EXPLICIT c1); F1 2/2
MISSING_EVIDENCE/EVIDENCE_GAP. Scan gate F1/F2/F5 100% with quotes. LiarMock +
SemanticLiarMock caught at $0. Zero fabricated citations credited anywhere.

---

# CP5 EXECUTION RECORD (2026-07-23)

- **Battery:** 54/54 probes (6 prompts × 3 repeats × 3 channels), all
  web-grounded, full responses + citations persisted (`probes/probe-battery.jsonl`,
  batch `stage3`). Spend ≈ $0.28. Merchant absent in ALL 54 responses — the
  canonical observation confirmed.
- **Compiler:** 6/6 prompt-groups compiled (0 live rejections — the rejection
  rules are proven on fixture prompts in test 32); 2 UNCONFIRMED constraint
  exclusions exercised (fragrance_free: variant-specific; returns_policy: no
  deterministic support fixture).
- **Two compiler bugs caught + fixed during CP5** (disclosed): (a) per-group
  alias maps overwrote each other — aliases are now GLOBAL across the battery;
  (b) the brand extractor's precision — "I'd" (curly-apostrophe contraction)
  ranked as the top "competitor"; fixed with apostrophe normalization,
  contraction/retailer/discourse stopwords. Also fixed: full-snapshot price
  disagreement compared the metafield against OTHER products' variants (Gift
  Card $100) when no required variant is set — now product-scoped.
- **Competitor capture (Rule 7):** top global competitor (named 17× across all
  3 channels) captured via one public `/products/<handle>.js` request —
  DISCLOSURE: the endpoint was hit twice; the first response was lost to a
  local ENOENT (missing fixtures dir) before any read, and one retry was made.
  Real name only in gitignored files; committed artifacts say "observed
  competitor A". Comparison note: `compiled/competitor-comparison.json`.
- **Known limitation (disclosed, not churned):** variant price evidence carries
  no product linkage, so a no-required-variant price scan can quote another
  product's variant as its sample (verdicts unaffected on our catalog).
