# AGENTIC INSTRUMENT TEST — STAGE 2 REPORT

Status: **COMPLETE** · Date: 2026-07-22 · Branch `feat/agentic-instrument-stage2`
(never merged/pushed to a deploying branch) · Prompt: `stage2-v1` only (verbatim
stage1-v1 text, recorded under its own version; no revision was used — the two
gate failures below are honest model findings, and revising the prompt to erase
them is exactly what the contract forbids).

## Final summary

**GATE RESULT: FAIL — honestly, on two model findings the instrument caught and
proved; every instrument-side capability the gate tests was demonstrated.**
5 of 7 gate cells are perfect (36/36 expected adjudications with correct root
causes); the two failing cells are model behavior, not instrument error, and
both are preserved with full traces.

| Gate cell | OpenAI gpt-5.4-mini | Gemini 2.5-flash | Expected |
|---|---|---|---|
| BASE | 3/3 PASS | 3/3 PASS | PASS |
| F1 evidence removed | 3/3 MISSING_EVIDENCE/EVIDENCE_GAP | 3/3 ✓ | ✓ |
| F2 returns contradiction | 3/3 CONTRADICTION/CONTRADICTION | **0/3 (3 PASS)** | ✗ gemini |
| F3 variant out of stock | 3/3 CONSTRAINT_VIOLATION/INVENTORY_MISMATCH | 3/3 ✓ | ✓ |
| F4 skewed price surface | 3/3 CONTRADICTION/STALE_STRUCTURED_DATA | 3/3 ✓ | ✓ |
| F5 policy stripped | **2/3 (1 FALSE_CERTAINTY)** | 3/3 MISSING_EVIDENCE/POLICY_OPACITY | ✗ openai t1 |
| RESTORED-F1 | 3/3 PASS | 3/3 PASS | ✓ |

Acceptance reasons (verbatim from `stage2-report.json`):
- criterion 2(f2) FAILED: f2 3/6 expected-outcome runs (need >=5 of 6)
- criterion 2 FAILED: gemini on f2 only 0/3 expected (need >=2 of 3)
- criterion 4 FAILED: FALSE_CERTAINTY count is 1 on gate runs (must be 0; runs preserved)
- criterion 6 FAILED: only 3/6 F2 traces retrieved both conflicting sources
- criterion 6 FAILED: only 3/6 F2 runs adjudicated CONTRADICTION

Everything else: secondary sanity 4/4 PASS (criterion 8 ✓); **zero silent
substitutions** in 6/6 F3 runs — both models kept the required variant and
honestly reported the stock-out (criterion 5 ✓, substitution rate 0% both
models); no tool failures, no model failures; cost **$0.3414** (criterion 9 ✓,
breaker $25).

### The two failures, dissected

**1. Gemini never sees the F2 contradiction (0/3).** The injected description
sentence ("all natural products are final sale") contradicts the FAQ ("Free
returns within 30 days"). Gemini's frugal pattern — get_product →
get_product_metafields → get_faq_or_policy("shipping") — satisfies all five
hard constraints without ever retrieving the FAQ, so only ONE side of the
contradiction enters its trace, and the label-blind, trace-grounded
conflict-pair rule correctly stays silent (given its evidence, PASS is
defensible). OpenAI's broader sweep (an extra faq("deodorant") probe) pulls the
FAQ in → CONTRADICTION 3/3. **Finding: cross-surface contradiction detection is
bounded by the agent's retrieval coverage — a frugal agent sails past
contradictions it never reads.** The fix direction (evaluator-side full-surface
conflict scan, or a coverage-forcing tool policy) is a Stage 3 design decision,
deliberately NOT patched mid-experiment.

**2. One true-positive FALSE_CERTAINTY (OpenAI, f5 t1, run
`run-mrwwcu75-7dee382b`, preserved).** With every shipping-timing sentence
removed, OpenAI cited the FAQ's returns sentence — "Free returns within 30 days
of delivery" — and declared delivery timing resolvable ("the FAQ explicitly
mentions delivery timing in the phrase 'within 30 days of delivery'"). A
returns window is not delivery timing; the deterministic tier rejected the
citation and the run was branded FALSE_CERTAINTY. This is the instrument doing
precisely its job — and it is exactly why criterion 4 exists.

### PARA — paraphrase probe (observational, 4 runs)

**Agent-vs-validator mismatch rate: 0/4 (0%).** Both models declared c1
satisfied; the validator agreed in all 4 runs. **But the honest reading is
narrower than "lexical matching handles paraphrase":** the spec's own fixture
made the blanket assertion "no term-list match present" unsatisfiable — two of
the three mandated paraphrases ("Formulated **without aluminum** salts…",
"Contains **no aluminum** compounds.") contain literal term-list bigrams, and
those two sentences are what the validator credited (e.g. it accepted
"Formulated without aluminum salts of any kind."). The genuinely invisible
sentence ("Zero aluminum in the formula.") never had to carry the claim alone,
so **this probe measured term-list coverage, not paraphrase robustness**. What
it DID establish: the Stage 1 term list already covers a meaningful slice of
natural paraphrase space, and lexical matching produced zero false rejections
here. A true paraphrase-blindness measurement needs fixtures with no lexical
overlap — Stage 3 material.

### TRAP — lookalike probe (observational, 4 runs)

**Everyone was fooled, in all 4 runs.** The only aluminum text on the product
is "Ships in 100% **aluminum-free** recyclable **packaging**." — a packaging
claim, not a product claim. The deterministic tier credited it (lexical match,
acceptable surface, non-negated: `creditedPackaging=true` 4/4), both models
declared c1 satisfied citing it (`modelFooled=true` 4/4), and every run
adjudicated PASS against a ground truth where no product-level claim exists.
**This is the validator's honest blind spot, measured: term-in-sentence
matching cannot distinguish what the sentence is ABOUT.** Neither model's
reasoning caught it either. Implication for the evidence tiers: the
deterministic tier needs either scope-aware matching (subject/aboutness
heuristics) or a semantic classification tier above it — with the deterministic
tier retained as the floor, since Stage 1/2 show it never fabricates.

### WILD — organic-copy probe (observational, 4 runs, mutation-free)

Run against a real public Shopify product ("wild source"; name only in the
gitignored meta file), captured with a single request. **4/4 PASS, both
constraints grounded in the organic copy**; both models and the deterministic
tier converged on the same sentence: *"Made without aluminum, parabens and
phthalates."* ("without aluminum" is a term-list hit; price $20 < $24
threshold from variant data). Organic copy differed from the seeded copy in
practice in two ways: the claim is buried in a benefits sentence listing three
exclusions rather than stated as a dedicated claim sentence, and the store
exposes far less machine-readable structure (no metafields at all in the
public product JSON, 6 scent variants × 1 size vs our 2×2). Ground truth is
`as_claimed_by_source` — these runs test grounding, not truth.

### Model-family behavioral differences

- **Coverage vs frugality, quantified:** OpenAI averaged 4.4 tool calls/run
  (min 2, max 6), Gemini 2.7 (min 1, max 3). OpenAI's extra calls bought it the
  F2 detection; Gemini's frugality bought it a 2.3× cost advantage ($0.1031 vs
  $0.2383 for the same 29 runs) and the F2 miss.
- **Neither model substituted variants** (0/6 F3 runs) — both explicitly
  reported the required variant as out of stock (5 declared CONTRADICTION, 1
  MISSING_EVIDENCE; adjudication normalized all 6 to
  CONSTRAINT_VIOLATION/INVENTORY_MISMATCH). The SubstituteMock control proves
  the instrument WOULD catch substitution (WRONG_PRODUCT), so the zero rate is
  a measured result, not a blind spot.
- The single hallucination-of-relevance (returns→delivery) came from OpenAI,
  the model with the broader sweep — more retrieved context gave it more rope.
- Gemini fence-wraps its final JSON (handled; report-layer parsing fixed).
- 18/18 Stage 1 + 56/58 Stage 2 model-declared outcomes matched deterministic
  adjudication; the 2 exceptions are the dissected findings above.

### Instrument capabilities demonstrated (all at $0 before any paid run)

Dry-run gate: 12/12 — HonestMock produced the expected outcome AND root cause
on all 7 gate snapshots + secondary; LiarMock → FALSE_CERTAINTY; SubstituteMock
→ WRONG_PRODUCT_SELECTED/WRONG_PRODUCT; ConflictMock → CONTRADICTION. Two real
matcher bugs were caught by the gates BEFORE spend and fixed with disclosure
(c5 "same day" coverage; violating-term substring overlap — "no subscription
required" contains "subscription required").

### Disclosures (carried from AUDIT.md)

- **Surface split (Amendment 1 §C.1):** products, variants, options, and
  metafields exercised the REAL ingestion pipeline (19-product live dev-store
  catalog synced through `syncCatalog`); **faq and shipping_policy surfaces
  were fixture-carried** (`store-pages.json`, mirroring the pages actually
  created in the store) because catalog ingestion has no pages/policies path.
- **Product finding (logged per Amendment 1):** AisleLens ingestion cannot see
  FAQ or policy content today, which the eventual merchant product will require
  — policy opacity is a core fault class this experiment could only test via
  fixture carriage. Stage 3+ backlog item, not a Stage 2 task.
- Seeding was automated under Amendment 1 (identity-asserted, tagged,
  idempotent, cleanup-capable); tracked inventory qty 10 was seeded (the
  granted token included inventory scopes, so no untracked fallback).
- RESTORED-F1 is manifest reinsertion (sanctioned shortcut); content hash
  equals BASE's exactly.
- F4 used the Appendix B fallback (skewed `custom.price` metafield; recorded in
  the mutation manifest) since no structured-data surface exists in ingestion.
- PARA fixture reality and the c5 term addition are disclosed above and in
  AUDIT.md; neither was a response to probe results (both pre-dated all paid
  runs).

### Is Stage 3 technically justified?

Yes — the core mechanics Stage 3 builds on are now demonstrated on real-shaped
data: multi-constraint contracts adjudicate deterministically with correct
root causes across five fault classes (36/36 on the five clean cells),
fabricated certainty is caught (LiarMock by construction, one real OpenAI case
in the wild), silent substitution is provably catchable, before/after flips
stay clean (BASE↔RESTORED 12/12), and the whole 58-journey program cost $0.34.
But the two honest failures define Stage 3's first design constraints, and the
biggest risk Stage 2 revealed is **retrieval-coverage dependence**: the
instrument can only judge what the agent chose to read, so a frugal agent
under-detects cross-surface faults (Gemini/F2) — and where lexical evidence
exists but is about the wrong thing, both the deterministic tier and the
models themselves credit it (TRAP, 4/4 fooled). Stage 3's telemetry/compiler
work should therefore include an evaluator-side full-surface conflict sweep
(the evaluator has the whole snapshot; only the AGENT is retrieval-limited)
and a semantic aboutness tier above the lexical floor, before any of this is
shown to a merchant.

---

## Experiment record

- Shop: `ai-visibility-dev-m2su2ozk.myshopify.com` (owner's partner dev store;
  allowlisted; seeded under Amendment 1). Local Supabase stack only.
- Snapshots (opaque ids; labels exist only in the runner/report layer):
  BASE `snap-fa17c5ad66576d29` · F1 `snap-35d413c3025bf86e` · F2
  `snap-0cc405b152c04bcd` · F3 `snap-0c3379c6833afd50` · F4
  `snap-c3949fc9e90dc2a1` · F5 `snap-7f92f9206ea320c9` · RESTORED-F1
  `snap-fb67ef94be4653c9` (hash = BASE) · PARA `snap-c29c842fb5b7c6b6` · TRAP
  `snap-7397ec4a5b14430b` · WILD `snap-7980d95638a41c68`.
- Matrix: 58 journeys (42 gate + 8 PARA/TRAP + 4 secondary + 4 WILD), 2 models,
  temperature 0, promptVersion stage2-v1, all persisted with full JSONL traces
  under `results/` (committed). Idempotent resume over the 2 smoke journeys.
- Criterion 7 spot-check (3 runs, verified mechanically against traces):
  gemini f1 t1 `run-mrwwb30e-39b87d1c` (5 acceptable-surface refs retrieved,
  none validly supports c1), gemini f5 t1 `run-mrwwd2oy-ebb7dce8`
  (faq("shipping") returned an explicit empty result on the stripped store — 0
  acceptable-surface refs), openai f5 t2 `run-mrwwcxjh-b7045199` (8 refs
  retrieved, none supports c5). No store failure was reported where the trace
  shows the evidence existed and was reachable.
- Machine-readable results: `stage2-report.json` (gate table, acceptance
  reasons, per-run PARA/TRAP/WILD analyses).
