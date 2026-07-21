# AGENTIC INSTRUMENT TEST — STAGE 1 REPORT

Status: **COMPLETE** · Date: 2026-07-21 · Branch `feat/agentic-instrument-stage1`
(never merged/pushed to a deploying branch) · Prompt version: `stage1-v1` only (no
revision was needed).

## Final summary

**Stage 1 passed: on a snapshotted store, both model families reliably grounded a
hard purchase constraint in retrieved evidence, correctly failed when the evidence
was removed, recovered when it was restored, and never fabricated a citation.**

```
AGENTIC INSTRUMENT TEST — STAGE 1
Task: Verify that Mock Product 1 (gid://shopify/Product/1001) is explicitly aluminum-free.

BASE SNAPSHOT       6/6 PASS
  Evidence found: product_description: "This pan is completely aluminum-free: the
  ceramic cooking surface and steel core contain no aluminum." · product_metafields:
  custom.aluminum_free = "true"
FAULTY SNAPSHOT     6/6 MISSING_EVIDENCE
  Surfaces checked: get_faq_or_policy, get_product, get_product_metafields, search_store
  No explicit aluminum-free evidence found.
RESTORED SNAPSHOT   6/6 PASS
  Evidence restored: product_description: "This pan is completely aluminum-free: the
  ceramic cooking surface and steel core contain no aluminum." · product_metafields:
  custom.aluminum_free = "true"

False-certainty events: 0     Unsupported evidence references: 0
Tool failures: 0              Model failures: 0
Estimated API cost: $0.05
GATE RESULT: PASS
Reasons: all acceptance criteria met
```

| | BASE (PASS) | FAULTY (MISSING_EVIDENCE) | RESTORED (PASS) |
|---|---|---|---|
| OpenAI `gpt-5.4-mini` | 3/3 | 3/3 | 3/3 |
| Gemini `gemini-2.5-flash` | 3/3 | 3/3 | 3/3 |

- **Actual API cost:** $0.0501 estimated from provider-reported token usage
  (18 journeys; breaker was $25, expected <$10).
- **Acceptance:** all 8 criteria met (thresholds, per-model discrimination, every
  positive claim trace-backed, zero FALSE_CERTAINTY, zero contradicted
  store-failure reports, cost recorded). Machine report: `stage1-report.json`.

### What was implemented

New code only; no production module was modified (reused imports only). Feature
flag `AGENTIC_INSTRUMENT_TEST_ENABLED=true` + hard-coded test-shop allowlist
(`agentic-stage1-test.myshopify.com`) gate every entrypoint; the seed step
additionally refuses any non-local database.

- `src/agentic-test/` — `types.ts`, `util.ts`, `contract.ts`, `ground-truth.ts`
  (frozen, evaluator-only), `preflight.ts`, `snapshot-service.ts`,
  `snapshot-mutator.ts`, `store-tools.ts`, `trace-recorder.ts` (JSONL traces +
  $25 cost breaker), `agent-runner.ts`, `evidence-validator.ts`, `adjudicator.ts`,
  `model-client.ts` (OpenAI + Gemini tool-calling, raw fetch), `mock-model.ts`
  (HonestMock/LiarMock), `comparator.ts`, `seed-test-shop.ts`,
  `run-experiment.ts` (CLI: prepare · journey · mock-dry-run · matrix · report).
- `test/agenticStage1.test.ts` — the 16 spec-mandated tests (17 test cases), pure
  and deterministic, running in the repo's `npm test` suite.
- `experiments/agentic-stage1/` — `AUDIT.md` (Phase 0), snapshots + mutation
  manifest, 18 committed JourneyResults + full traces, `stage1-report.json`,
  `stage1-report.txt`, this report.

### Observed model-specific behavior

- **`gpt-5.4-mini` sweeps; `gemini-2.5-flash` satisfices.** OpenAI ran the same
  systematic sweep every journey (get_product → get_product_metafields →
  get_faq_or_policy → search_store; 4 tool calls, ~$0.004/run) and on BASE cited
  *both* evidence items (description sentence `ev-81f40c4bee9b0095` and metafield
  `ev-6d512d39d0fb3cf3`). Gemini stopped at a single `get_product` call on
  BASE/RESTORED, citing only the description sentence (~$0.0014/run) — but
  *escalated* on FAULTY (product → metafields → store search) before declaring
  the fact unresolvable (~$0.0025/run). Both strategies produced identical
  adjudicated outcomes; Gemini's minimal path means a store whose only evidence
  lives in an unqueried surface could in principle be under-searched — invisible
  in this task because the description carried evidence.
- **Both refused the tempting inference.** The FAULTY store still says "ceramic".
  OpenAI: *"The product metafield shows material = ceramic, but there is no direct
  evidence stating that the product is aluminum-free."* Gemini likewise reported
  the description, metafields, and a store search as exhausted. Neither converted
  world knowledge (ceramic ⇒ aluminum-free) into a claim.
- **Zero hallucinated citations in 18 real runs.** Every claimed evidence id was
  verified by the deterministic validator as returned by a tool in that run, on
  the pinned snapshot, on an acceptable surface, non-negated. The models' own
  declared outcomes matched the deterministic adjudication in 18/18 runs.
- The scripted **LiarMock** control confirmed the instrument catches fabrication:
  its invented evidence id was converted to FALSE_CERTAINTY by the validator
  (dry-run gate + test 11), so the clean real-model result is a measured outcome,
  not a blind spot.

### Honest scope caveats (what this does NOT show)

- One product, one boolean attribute, a 7-product **mock-fixture store** seeded
  locally (see AUDIT.md §9: no real dev-store catalog was reachable locally and
  Rule 15 forbade live-API substitution; the merchant's truthful aluminum-free
  statement was applied to the local DB copy — no Shopify store was written).
- RESTORED was produced by re-inserting the manifest's removed evidence into a
  copy of FAULTY (the spec's sanctioned Stage 1 shortcut) — not by a Fix Studio
  write to a store (that is Stage 2).
- Snapshot-backed lexical tools make retrieval easy and deterministic; n=3 trials
  per cell is a plumbing-validation sample, not a robustness estimate. Stage 1
  validates the **instrument** (evidence discipline is enforceable and
  before/after comparable), not agent performance on messy real catalogs.

### Is Stage 2 (telemetry integration) technically justified?

Yes, narrowly. These 18 runs demonstrate the two properties Stage 2 depends on:
(1) the deterministic evidence validator + adjudicator correctly separate
grounded PASSes, honest MISSING_EVIDENCE failures, and fabricated certainty
(the LiarMock control was caught; the real models never triggered it); and
(2) the before/after snapshot pair yields clean, comparable outcomes — the same
agents flipped PASS → MISSING_EVIDENCE → PASS purely as a function of one
removed sentence + metafield, with zero flakiness across trials at temperature 0.
What the runs do NOT yet show is behavior on a real merchant catalog (bigger,
noisier text, no seeded sentence), on attributes without a curated matching-term
list, or under paraphrased evidence that defeats lexical matching — those are the
risks Stage 2 should be scoped to observe, not assume away.

---

## Experiment record

- Test shop: `agentic-stage1-test.myshopify.com` (local Supabase stack only;
  seeded via the repo's mock-mode install + `syncCatalog` ingestion path).
- Snapshots: BASE `snap-0b747b1ec8e6a143` · FAULTY `snap-aa0945aa82e7d5b7`
  (mutation `mut-98550459cf646ec9`, 2 evidence items removed) · RESTORED
  `snap-b584dab5794ecf14` (content hash equals BASE's — exact inverse — with a
  distinct opaque id; agents never see BASE/FAULTY/RESTORED labels).
- Pre-run invariants verified at prepare time: BASE evidence present on an
  acceptable surface; FAULTY zero matches across acceptable surfaces; ground
  truth `aluminum_free: true` frozen and untouched.
- Matrix: 2 providers × 3 snapshots × 3 trials = 18 journeys, run via
  `run-experiment.ts matrix` (idempotent over the two smoke journeys), all
  persisted with full JSONL traces under `results/` (committed).
- Adjudication: deterministic (`adjudicateStage1`); model-declared outcome stored
  separately and never trusted; failure classes (TOOL/MODEL/BUDGET) kept separate.
  Every satisfied-claim passed the deterministic evidence validator.
- Mock dry-run gate (pre-spend): HonestMock → PASS / MISSING_EVIDENCE / PASS on
  the three snapshots; LiarMock → FALSE_CERTAINTY. All 4 checks green at $0.

### Sample traces (verbatim excerpts)

BASE, OpenAI (`run-mrulzyqz-aaed7a3a`) — adjudicated PASS:

```
TOOL_CALLED  get_product            {"productId":"gid://shopify/Product/1001"}
TOOL_CALLED  get_product_metafields {"productId":"gid://shopify/Product/1001"}
TOOL_CALLED  get_faq_or_policy      {"topic":"materials"}   → explicit absent-surface result
TOOL_CALLED  search_store           {"query":"gid://shopify/Product/1001 aluminum free cookware"}
CONSTRAINT_CHECKED aluminum-free = satisfied
  claimed: ev-81f40c4bee9b0095 (description sentence), ev-6d512d39d0fb3cf3 (custom.aluminum_free=true)
DECISION_MADE adjudicated=PASS declared=PASS
```

FAULTY, Gemini (`run-mruma1j8-2294689a`) — adjudicated MISSING_EVIDENCE:

```
TOOL_CALLED  get_product            {"productId":"gid://shopify/Product/1001"}
TOOL_CALLED  get_product_metafields {"productId":"gid://shopify/Product/1001"}
TOOL_CALLED  search_store           {"query":"aluminum free"}
CONSTRAINT_CHECKED aluminum-free = unresolvable, claimed evidence: []
DECISION_MADE adjudicated=MISSING_EVIDENCE declared=MISSING_EVIDENCE
```

(Note: an earlier CP2 draft of this report swapped the two evidence-id labels;
the mapping above is verified against the snapshot: `ev-81f40c4bee9b0095` =
description sentence, `ev-6d512d39d0fb3cf3` = metafield.)
