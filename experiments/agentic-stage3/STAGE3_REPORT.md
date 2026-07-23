# AGENTIC INSTRUMENT TEST — STAGE 3 REPORT

Status: **COMPLETE** · Date: 2026-07-23 · Branch `feat/agentic-instrument-stage3`
(never merged/pushed) · Versions: journeys `stage3-v1` (stage1-v1 text, distinct
label), semantic tier `sem-v2` (the one allowed prompt revision, disclosed below).

## Final summary

**GATE A: PASS (12/12).** The evaluator-side Store Diagnostic Scan detects
evidence gaps and cross-surface contradictions from the FULL snapshot,
independent of any agent's retrieval; the bounded semantic tier fixes
aboutness-blindness (TRAP now rejected 4/4) and recognizes genuine paraphrases
(PARA-v2 now credited 4/4) without weakening the deterministic floor
(fabrication still caught at $0 and in every paid run; **zero fabricated
citations credited anywhere; 0 semantic-tier fabrications survived** — the
scripted SemanticLiarMock's were all discarded by the verbatim-substring
wrapper).

| Gate A cell | OpenAI | Gemini | Expected |
|---|---|---|---|
| TRAP ("aluminum-free packaging") | 2/2 MISSING_EVIDENCE + REJECTED_ABOUTNESS | 2/2 ✓ | ✓ |
| PARA-v2 (genuine paraphrases) | 2/2 PASS @ SEMANTIC_VERIFIED | 2/2 ✓ | ✓ |
| BASE regression | 1/1 PASS (c1 EXPLICIT) | 1/1 ✓ | unchanged ✓ |
| F1 regression | 1/1 MISSING_EVIDENCE/EVIDENCE_GAP | 1/1 ✓ | unchanged ✓ |

Scan gate: F1 (evidence gap), F2 (returns contradiction, BOTH sides quoted:
FAQ "Free returns within 30 days…" vs description "…all natural products are
final sale."), F5 (policy opacity) — detected **deterministically, 100%, with
quotes, zero model calls**, plus F4's price-source conflict and F3's contrary
availability evidence recorded. Stage 2's Gemini/F2 "failure" is hereby
formally what it always was: a **retrieval-coverage measurement** (see below).

**GATE B: PASS (the comparison was rigorous), and the verdict is: TELEMETRY IS
MATERIALLY VALUABLE — 2 of 3 criteria hold cleanly, the third weakly.**
Pre-registration held: the two manual contracts were authored from the catalog
alone and committed at **`4cc1381`** (file sha256 `4578c2fc7668293c…`, recorded
in `preregistration.json`, enforced mechanically by the guard + test 34)
BEFORE any probe was fetched or parsed. 3 channels probed, 54/54 raw responses
persisted with citations; 6 contracts compiled (≥3 required); all 20 A/B
journeys persisted.

- **(i) Discovery — HOLDS.** Compiled contracts contain hard constraints the
  pre-registered manual contracts lack: `aluminum_free` and
  `subscription_required` (compiled p1/p5; the manual arm deliberately varied
  to baking-soda-free/travel/vegan/tallow themes) — plus the actual named
  competitors, which no catalog-only author can produce: "observed competitor
  A" named **17× across all three channels**. Artifacts:
  `compiled/compiled-contracts.json` vs `src/agentic-test/manual-contracts.ts`.
- **(ii) External evidence — HOLDS, weakly.** Citation harvesting (44/54
  responses carried citations) contributed: two competitor **brand-store hosts
  cited directly** (10× and 3× — competitor claims reachable for diagnosis),
  and the grounding structure that sharpens the absence diagnosis per channel —
  OpenAI recommendations ground in retailer pages (one retailer cited 22×) and
  publisher listicles; Perplexity in marketplaces/Reddit/YouTube plus brand
  stores. Caveat stated plainly: no harvested citation changed a
  SNAPSHOT-side diagnosis (those are catalog-derived); the contribution is to
  the channel/why-competitors-win diagnosis. **Gemini's 44 citations are 100%
  opaque `vertexaisearch` redirect URLs — zero host information** — the
  per-channel citation-availability finding predicted in the Phase 0C audit.
- **(iii) Model-specific prioritization — HOLDS.** Live per-channel differences
  drive prioritization unavailable to the manual arm: competitor A's
  all-channel dominance makes it the priority rival; the shave-soap category's
  competition is **marketplace-driven** (Etsy sellers dominate those answers)
  while deodorant is retail/publisher-driven — two different fix strategies.
  The captured competitor-A product JSON (Rule 7, one request — see
  disclosure) yields a concrete comparison: identical $14.00 price point,
  64-variant scent breadth vs our 4, aluminum-free evidenced in their copy —
  but **no no-subscription evidence** where ours states it explicitly
  (`compiled/competitor-comparison.json`).
- **(iv) Post-fix live re-probe — UNTESTED, deferred to Stage 4** by contract.

### The A/B table (20 journeys, BASE snapshot, semantic tier active)

| Contract | OpenAI | Gemini |
|---|---|---|
| manual-travel-deodorant | 2/2 PASS | 2/2 PASS |
| manual-shave-soap | 2/2 PASS | 2/2 PASS |
| compiled-p1 (aluminum/price/subscription) | 2/2 PASS | 2/2 PASS |
| compiled-p2 (baking-soda/delivery) | 2/2 PASS | 2/2 PASS |
| compiled-p3 (travel variant/price) | 2/2 PASS | **2/2 MODEL_FAILURE** |

The Gemini p3 failures are a model finding, preserved: at temperature 0 it
twice transcribed the machine-generated constraint id
`x2-required-variant-in-stock` as `…variant-in_stock` (mixed hyphen/underscore),
failing the strict id round-trip both times. OpenAI handled the same id 2/2.
Not tuned away; Stage 4 note: the compiler should emit round-trip-friendly ids.

### Retrieval coverage per model (the formalized Stage 2 finding)

Across the 16 final Stage 3 journeys per model: **OpenAI 0.94 average coverage
ratio, Gemini 0.88** — Gemini persistently skips a scan-relevant surface
(typically the FAQ) even when constraints could draw on it. The Store
Diagnostic Scan makes this harmless to the instrument (the evaluator sees the
whole snapshot) and turns it into per-model telemetry.

### Semantic-tier discipline

Fabrications discarded in final paid runs: **0** (the sem-v2 judge produced
only verbatim quotes); the discard path itself is proven by SemanticLiarMock
(3 discards in the $0 dry-run) and test 27. Confidence tiers are carried on
every satisfied constraint (EXPLICIT vs SEMANTIC_VERIFIED); vetoes only ever
withdrew credit (REJECTED_ABOUTNESS), never invented it.

### Disclosures (full list in AUDIT.md)

- Three Gate A defects were caught by the gates and fixed with archived
  evidence (`results-prebugfix/`, `results-semv1/`): structured-support veto
  scope; claim-rescue for real-but-lexically-unsupported citations;
  sem-v1→sem-v2 subject scoping (the one allowed prompt revision, full rerun,
  both versions reported — sem-v1: TRAP 4/4 ✓, PARA-v2 4/4 ✓, but BASE
  regression broken by policy-evidence vetoes; sem-v2: 12/12).
- Compiler bugs caught during CP5 (global aliases; "I'd"-class brand-extractor
  precision; product-scoped price disagreement) — fixed before the A/B ran.
- Competitor capture endpoint hit twice (first response lost to a local
  ENOENT before any read); real names only in gitignored meta files.
- ~$0.02 of compiler-extraction spend was misrouted to the Stage 1 ledger
  file (accounting bug, counted in the total below).
- FALSE_CERTAINTY policy correction (spec 4.10) applied: instrument-caught
  events are findings, not gate failures; what fails a gate is an unsupported
  claim SURVIVING to credit — none did, anywhere.

### Cost

Stage 3 actual: **≈ $0.59** (Gate A final $0.08 + archived Gate A runs $0.18 +
battery $0.28 + A/B and compiler ≈ $0.05) — far under the $25 breaker and
under the $8–18 projection (probes proved cheap). Cumulative Stages 1–3:
**≈ $0.98**.

### Is Stage 4 justified — and which thesis does the evidence support?

Yes, Stage 4 is justified, and the evidence currently supports the **unified
product thesis (telemetry-driven testing), with one honest qualifier.** The
mechanics all now exist and are proven: observations compile into runnable,
grounded, adjudicable contracts (6/6, with working rejection rules);
before/after journeys are clean; the instrument's tiers are bounded and
fabrication-proof; live probes are cheap ($0.28 for a 54-probe battery). The
qualifier: on THIS seeded store, compiled constraints largely rediscovered
what a competent author could write from the catalog — the uniquely-telemetry
value demonstrated here is **competitor identity, channel structure, and
prioritization** (criteria i's competitor half and iii), not novel constraint
discovery. That is still the product's wedge (it is exactly what merchants
cannot see themselves), but Stage 4 should measure criterion (iv) — whether a
Fix Studio correction plus identical rerun plus post-fix live re-probe moves
anything — before the thesis is declared load-bearing. Biggest risk carried
forward: the battery's prompts were authored by this experiment's operator;
organic buyer queries (real telemetry) may compile messier, and the
brand-extraction precision issues found here (fixed for obvious cases) hint at
the tail. The standalone-instrument fallback remains fully viable: Gates A and
the Stage 1–3 record show the instrument stands on its own.

---

## Experiment record

- Snapshots: BASE/F1/TRAP reused from Stage 2 (ids in
  `experiment-manifest.json`); PARA-v2 `snap-f68fce1fc466e64e` (zero
  explicit-tier c1 matches, asserted + test 30).
- Pre-registration: manual contracts commit `4cc1381`, recorded in
  `preregistration.json`; probe battery and compiler both call
  `assertPreregistered()` before touching observations (test 34). Ordering
  held throughout the session; Gate B is valid.
- Probe battery: `probes/probe-battery.jsonl` — 54 records, batch `stage3`,
  channel/model/citations/grounding per record (test 35).
- Compiled cases + grounding prechecks + UNCONFIRMED exclusions:
  `compiled/compiled-contracts.json`; competitor comparison:
  `compiled/competitor-comparison.json` (anonymized).
- All journeys persisted with traces under `results/` (final), with the two
  archived Gate A generations kept for the honesty trail.
