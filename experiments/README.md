# The Agentic Instrument ladder — four stages, one closed loop

An autonomous four-stage experiment program (2026-07-21 → 2026-07-23) that took
AisleLens from "can an AI shopping agent be held to evidence discipline at all"
to a complete, verified observe → reproduce → diagnose → fix → verify → monitor
loop on a real Shopify dev store — every stage gated, every claim persisted,
every deviation disclosed. Committed artifacts anonymize competitors
("observed competitor A"); real names live only in gitignored meta files.

## The stages

**[Stage 1 — the instrument's skeleton](agentic-stage1/STAGE1_REPORT.md)**
(branch `feat/agentic-instrument-stage1`). On a clean mock catalog: snapshot
pinning, sentence-level fault injection, a deterministic evidence validator
(every cited evidence id must have been returned by a tool in that run), and
deterministic adjudication. 18/18 correct adjudications across
BASE/FAULTY/RESTORED on two model families; the LiarMock control proved
fabricated citations are caught before any money was spent. GATE: **PASS**.

**[Stage 2 — real-shaped data, five fault classes](agentic-stage2/STAGE2_REPORT.md)**
(branch `feat/agentic-instrument-stage2`). A seeded catalog on the real dev
store, synced through the production ingestion pipeline; a five-constraint
contract; five injected fault classes with deterministic root causes. 36/36
expected adjudications on the five clean gate cells; zero silent variant
substitutions. GATE: **honest FAIL** — the two failing cells were model
findings the instrument itself caught (a frugal-retrieval model never read the
FAQ side of a cross-surface contradiction; one true-positive FALSE_CERTAINTY
where a model cited a returns window as delivery timing), preserved with full
traces rather than tuned away.

**[Stage 3 — the instrument upgrades + the telemetry A/B](agentic-stage3/STAGE3_REPORT.md)**
(branch `feat/agentic-instrument-stage3`). Gate A (12/12): an evaluator-side
Store Diagnostic Scan that detects gaps and contradictions from the FULL
snapshot regardless of what any agent read, plus a bounded semantic tier
(verbatim-quote-verified grants, conservative aboutness vetoes) that rejects
the packaging-trap and credits genuine paraphrases without weakening the
deterministic floor. Gate B: a pre-registered A/B (manual contracts committed
and hashed BEFORE any probe was read) over a 54-probe live battery across 3 AI
channels — verdict: **telemetry materially valuable**, chiefly for competitor
identity, channel structure, and prioritization; stated with its qualifier.

**[Stage 4 — loop closure on the real store](agentic-stage4/STAGE4_REPORT.md)**
(branch `feat/agentic-instrument-stage4`). A real store-state fault (marker-
first, reversible), reproduced (4/4 failing journeys; the faulted snapshot's
content hash was byte-identical to Stage 2's synthetic F1), fixed through Fix
Studio's PRODUCTION proposal/approval/conflict-check/apply machinery, rollback
capability API-verified, identical rerun 4/4 PASS, post-fix live battery
honestly classified ("no observed change, as structurally expected for a
password-protected store"), saved as a re-executable regression test, and
rendered as a 12-state merchant-language case with every number traceable
through a claims map. GATE C: **PASS (9/9)**, store verified back at its
truthful baseline.

## The ladder in numbers

| | Stage 1 | Stage 2 | Stage 3 | Stage 4 | Total |
|---|---|---|---|---|---|
| Gate result | PASS | honest FAIL (model findings) | A: PASS · B: PASS (verdict: valuable) | C: PASS 9/9 | 4 gates run |
| Agent journeys | 18 | 58 | 32 final (+24 archived) | 14 | **122 (+24)** |
| Live AI probes | — | — | 54 | 52 | **106** |
| Est. spend | $0.05 | $0.34 | $0.59 | $0.26 | **≈ $1.24** |
| Automated tests (cumulative suite) | 247→ | →269 | →281 | →**289 / 0 fail** | 44 spec tests |

Model families throughout: OpenAI gpt-5.4-mini and Gemini 2.5-flash, minimum
temperature, versioned prompts (one revision ever used, disclosed, full rerun).

## What this record cannot establish (verbatim from Stage 4)

> What this record CANNOT establish from inside this codebase: whether
> merchants understand the case, whether they would approve the fix, and
> whether telemetry compiles cleanly from organic buyer queries rather than
> operator-authored ones. Those are Gate 3 questions, they are human questions,
> and the rendered case is the artifact built to ask them.
