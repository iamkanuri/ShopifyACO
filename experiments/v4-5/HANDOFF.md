# v4.5 — HANDOFF (restart-sufficient)

**Shipped and live at `87701c6`.** `main` = `origin/main` = `/healthz`. Both probes green.
`ENGINE_VERSION` **v2.6.0**. Suite 1101 tests / 1025 pass / 0 fail / 76 DB-gated skips.
`npm run typecheck` green on **both** projects.

## What changed

| | |
|---|---|
| **P-19 first half** | a published `$0.00` is no longer read as a price (`zeroAwareMin`), and `evaluate` re-tests the zero at the branch that renders |
| **P-19 second half** | built, refuted by an independent pass, **REVERTED**. `extract.ts` is byte-identical to the parent; the diff is a tombstone comment carrying the order a correct version would need |
| **general bound** | 5.17% → **3.05%** (473 rows, 11 → 5 defects), re-measured in the same push. Coffee unmoved at 9.99%, premise checked from the artifact |
| **5 permanent results** | disclosed at render time — 1 `$0.00`, 4 CAD-as-dollars. Never edited |
| **A3** | cards differentiated · HTML leak sanitized · 4 harnesses default-off · standard route emits a completion event |

## The five things a next session must not re-learn

1. **`npm run typecheck`, never `tsc --noEmit -p .`** The root project is `src/**` only; the
   STANDARDS project is the half that catches an engine change. A required new field on
   `PublicProduct` broke two standards fixtures and I ran the wrong command all session.
2. **The register is read by its HEADINGS.** P-17's heading said "has no adversarial corpus"
   for two releases while its body said the opposite. It cost an entire planning pass.
3. **Restart through the tool that owns the process.** Two stale servers nearly produced two
   wrong conclusions — a page showing the old bound after a sidecar write, and a funnel event
   reported missing when the request was served by a dead-but-still-bound old build.
4. **`git worktree remove` traverses a `node_modules` junction** and deletes `.bin/` from the
   MAIN repo. It happened twice. Remove the junction (`rmdir node_modules`) FIRST.
5. **A re-measurement moves the rate; the decomposition beside it is a separate field.**
   `defect_classes` summed to 18 against a confirmed count of 5, live on the published page.
   There is now a test; it immediately found v1.0 publishes the same field as strings.

## The number to watch

**The coffee/general 95% intervals now overlap by 0.31pp** (was 3.40). `renderComparison`
refuses a ratio only while they overlap. One more improvement of that size to the general
figure and the page starts publishing the spread sentence retired three times. The
live-artifact assertion in `test/standardsSite.test.ts` fails first — **re-derive the
comparison, do not delete the assertion.**

## Instruments (all under `experiments/v4-5/`, gitignored except `evidence/`)

| file | what it does |
|---|---|
| `p19_probe.ts` / `p19_ab.mjs` | replay 335 deduped stores through the real engine, quote-level A/B |
| `p19_population.mjs` | scores a candidate rule before it is built |
| `remeasure.mjs` | the bound, method carried verbatim from v3-8 |
| `write_sidecar.mjs` / `fix_defect_classes.mjs` | sidecar writes, both with refusal gates |
| `price_sweep.mjs` / `price_sweep_currency.ts` | the stored-results audit |
| `card_probe.mjs` | renders the landing page at two widths and asserts they DISAGREE |
| `spend_audit.mjs` | which harnesses could spend on a keyed machine |

## Open, and deliberately not done

- **Phase B remainder** — pre-v4.3 one-pagers/OG images not regenerated; thirdocular.com
  parent retheme not done (repo present at `../ThirdOcular`); exhibits not stamped with
  engine version + run date. All stale-not-wrong.
- **The backfill residual** — 6 snapshots sit at the 10-requirement cap and would gain an
  unadjudicated `In stock and purchasable` row if their price were refused. 0 occurred here;
  the commit's "0 appeared" was a true observation and a false generalisation.
- Everything in the report's **post-signal** list, which is meant to be chosen by agency
  answers rather than by internal audit.
