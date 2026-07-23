# AGENTIC INSTRUMENT TEST — STAGE 4 REPORT

Status: **COMPLETE** · Date: 2026-07-23 · Branch `feat/agentic-instrument-stage4`
(never merged/pushed) · Versions: `stage4-v1` journeys, `sem-v2` semantic tier.

## Final summary — GATE C: PASS (all nine acceptance criteria)

The loop is closed on the REAL dev store, end to end:

| Capability | Result | Per-model journeys |
|---|---|---|
| REPRODUCE (real-store fault) | scan c1 `absent`, 0 hits — content hash **byte-identical to Stage 2's synthetic F1** | openai 2/2 + gemini 2/2 MISSING_EVIDENCE/EVIDENCE_GAP |
| DIAGNOSE | Store Diagnostic Scan + trace-cited surface searches | (same 4 runs) |
| FIX (Fix Studio production path) | proposal → conflict check (passed, real baseline) → approve → **applied** | — |
| ROLLBACK (capability) | separate seo probe applied → rolled back → **API re-read matches pre-change** | — |
| VERIFY-SIM (identical rerun) | version pins asserted; before/after diff persisted | openai 2/2 + gemini 2/2 PASS |
| VERIFY-LIVE (criterion iv mechanism) | 52/54 post-fix probes persisted (2 transient failures disclosed); comparison + honest classification | — |
| MONITOR (regression) | bundle saved; `rerun-case` executed once → **PASS** (openai PASS, gemini PASS), history appended | — |

**The real-store flip: 4/4 MISSING_EVIDENCE → 4/4 PASS**, same contract, same
models, same prompt versions, pinned and asserted
(`before-after-diff.json`). Id-format regression: 4/4 clean round-trips with
separator-free constraint ids (the Stage 3 Gemini mangling mode is closed).
Final store-state assertion **PASSED**: live description + metafield match
ground truth, live FAQ carries its aluminum Q&A, and **no pending-revert
marker remains**.

### The live comparison's classification (exact case language)

> "Store-side failure: FIXED AND PROVEN (simulation layer, deterministic —
> before/after journeys 0/4 → 4/4 PASS). External visibility: no observed
> change, as structurally expected for a password-protected store; external
> verification requires an indexed store, which requires a design partner or a
> public store — a business step beyond this experiment."

Merchant mentions: **0/54 pre → 0/52 post** (per channel: 0 everywhere).
Competitor mentions shifted at noise level (observed competitor A 21→23
responses); citation-host drift recorded. **No causal language anywhere** —
the two missing post-fix probes (gemini p2r3, perplexity p2r1, transient API
failures after retries) are disclosed, not backfilled.

### The rendered Case

`experiments/agentic-stage4/case/index.html` (committed, anonymized) + the
internal route `/admin/agentic-case` (flag-gated; verified serving with the
flag on and absent with it off; hydrates the real competitor name only from
the gitignored meta when run locally). Twelve states in merchant language;
**every number and quoted string resolves through `case/claims-map.json`** (20
claims, each naming its artifact; test 41 proves no orphan placeholders;
seeded 3-claim spot-check re-derived from sources: 3/3 verified,
`case/spot-check.json`).

### Fix Studio findings: exercised vs injected, and the merchant-facing backlog

**Production logic exercised for real:** proposal persistence + lifecycle,
approval gate, `write_products` scope gate (it correctly REFUSED twice when a
catalog sync reset the shop row to read-only — the gate works), token
decryption path, conflict re-read (real comparison on the normalized
baseline), GraphQL `productUpdate`, post-write snapshot, audit rows, and the
conflict-checked rollback path (probe change verified restored via API).

**Experiment-injected (disclosed):** identity assertion before writes (driver-
side; Fix Studio has none), auto-approval (`experiment-auto-approved`), local
data steps (scope row update, token re-encryption under the session key), and
restoration of surfaces OUTSIDE Fix Studio's writable set (metafield + FAQ
page) via the tagged Amendment-1 actuator. Additive code (disclosed in
AUDIT.md): `WritableField`/`writableField` completion for `descriptionHtml`
(implemented-but-unreachable since Phase 6) and the typed `liveFieldValue`
read the compiler forced (which turned a latent vacuous conflict check into a
real one).

**Backlog for merchant-facing operation (not built):** metafield write-back;
page/FAQ write-back; identity assertion inside the apply path; store raw HTML
in the rollback snapshot (today a description rollback would restore stripped
text); a proposal generator that emits description restorations; session
sourcing for headless/scheduled applies; the approval UI hook; conflict-basis
capture at proposal time.

### Disclosures

FAQ fault extension (the spec's fault design overlooked its own seeded FAQ —
the live page still evidenced c1; extended with marker-first page fault +
fixture mirroring); fix = revert equivalence (the description revert was
executed by the production actuator; metafield + FAQ completed by the tagged
experiment mechanism); orphaned proposal #121 (approved, never applied — the
first apply attempt failed on a decryption issue, retried as #122); post-fix
battery spend (~$0.19) landed on the Stage 3 ledger file (routing quirk,
reconciled below); probe-file env override added to the battery module.

### Cost

Stage 4 actual: **≈ $0.26** (journeys + regression rerun $0.076; post-fix
battery $0.187). **Cumulative Stages 1–4: ≈ $1.24** — the entire four-stage
ladder ran for about a dollar and a quarter against a $25-per-stage breaker.

### Is the instrument-side MVP complete?

**Yes — against the original claim ladder, the instrument-side MVP is
complete.** Stage 1 proved evidence discipline is enforceable and
before/after comparable on a clean mock. Stage 2 proved five fault classes
adjudicate with correct root causes on real-shaped catalog data, with the
gaps measured honestly. Stage 3 added the evaluator-side scan (journey-
independent detection), a bounded semantic tier (TRAP rejected, paraphrases
credited, floor intact), and a rigorous pre-registered A/B whose verdict —
telemetry materially valuable, chiefly for competitor identity and channel
structure — held with its qualifier. Stage 4 closed the loop on a real store
through the production fix machinery, verified by identical rerun, re-probed
live with the honest no-movement classification, saved as a regression test,
and rendered as a merchant-language case with every claim traceable.

What this record CANNOT establish from inside this codebase: whether
merchants understand the case, whether they would approve the fix, and
whether telemetry compiles cleanly from organic buyer queries rather than
operator-authored ones. Those are Gate 3 questions, they are human questions,
and the rendered case is the artifact built to ask them. Per the contract,
stopping here.

---

## Execution record

- Fault window: marker written before every write; fault → sync → snapshot →
  journeys → fix executed continuously; `revert-log.jsonl` records the marker
  lifecycle; the standalone `revert-fault` command remains available.
- Snapshots: FAULTED `snap-7f9f72bd963dd3ac` (hash = Stage-2 F1), FIXED
  `snap-cace8f07404d8a2c` (scan c1 evidenced, 4 hits on 3 surfaces).
- Fix Studio: proposal #122 target `descriptionHtml`, status `applied`,
  rollback snapshot recorded; probe proposal applied + rolled back.
- Artifacts: `before-after-diff.json`, `live-comparison.json`,
  `probes/probe-battery-postfix.jsonl`, `case/*` (bundle, history, claims map,
  spot-check, static export), `revert-log.jsonl`, results + traces under
  `results/` (committed).
- Tests 36–43 green; full suite 289 pass / 0 fail.
