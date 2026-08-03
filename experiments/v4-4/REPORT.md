# v4.4 — THE TIER THE BOUNDS WERE NEVER MEASURED WITH

Branch `feat/v4-4-semantic`, off `main` at `16e90c3` (= `origin/main` = `/healthz`, both
production probes `VERIFIED_CLEAN` before any work).

**§2 fired the pre-authorized pivot on the first query.** Four permanent, citable results
in production carry a pass the semantic tier granted, and three of them publish a claim the
quoted sentence does not support — about named third-party stores, at URLs designed to
resolve forever. Remediation came before the rate measurement, as authorized.

---

## §1 — DISCOVERY, BY EXECUTION

### 1.1 The tier was live in production, and the deployed process says so

Read from `funnel_events`, which the live server writes (`index.ts:954`,
`semanticInvoked: Boolean(result.semantic)`, and `result.semantic` exists only when
`outcome.stats.called`). `experiments/v4-4/prod_semantic_audit.mjs`.

| | |
|---|---|
| funnel_events rows | 160 (2026-07-25 → 2026-07-30) |
| `semantic_invoked = true` | **7**, all on `test_completed` |
| `semantic_invoked = false` | 70 |
| summed `semantic_cost_usd` | **$0.00833** |
| canary | column carries **both** true and false — "false everywhere" was ruled out |

No kill switch was set on Railway. The mechanism is `PRODUCT_TEST_SEMANTIC=0`
(`semanticTier.ts:80`, `semanticEnabled()`), documented in `DEPLOY.md` at four places as a
no-redeploy kill switch — a Railway **service variable**, not a code change.

⚠️ **`funnel_events` UNDERCOUNTS the tier, and the gap is structural.** The standard route
emits `standard_test_requested` and no completion event, so its tier invocations are
invisible there — n=3 requested, `invoked=0`. Yet `public_tests` holds a **standard** row
with `granted: 1`. Telemetry that covers one of two public routes reads as "the tier barely
runs" when it ran on both.

### 1.2 Every caller of the tier, and which persist

`applySemanticTier` is reached only from `runProductTest`. Callers:

| caller | reaches the tier | persists a permanent result |
|---|---|---|
| `POST /api/product-test` (`/test`) | yes → **now pinned off** | **yes** — `storePublicTest`, `kind: general` |
| `POST /api/product-test/standard` (`/test`, standard mode) | yes, via `runStandardTest` → **now pinned off** | **yes** — `storePublicTest`, `kind: standard` |
| `runDemo` / landing hero (`buyerTestDemo.ts`, `heroArtifact.ts`) | **no** — pinned at v4.3 | no |
| `src/server/authenticatedTest.ts` | **no** — calls `evaluate` directly, never `runProductTest` | writes `buyer_test_runs`, not `public_tests` |

So the tier's entire live footprint was the two public routes, and **both of them mint
permanent citable artifacts**. That is the worst possible pairing and it is why §2 was
right to be checked first.

### 1.3 Harnesses: 56 decided, 27 inert

`experiments/v4-4/harness_default.mjs` (walks the tree; ripgrep respects `.gitignore` and
`experiments/` is ignored). 2,565 files walked, both buckets non-empty so the split means
something.

- **DECIDED** (56) — sets `PRODUCT_TEST_SEMANTIC="0"` or `semantic: { disabled: true }`.
  Includes `replay.ts`, `run_standard`, `term_measure`, `census`, `fetch_harness`, `reexec`,
  `untruncate`, `contract_probe`, `standard_run_probe`.
- **INERT** (27) — off *only* because this machine has no key at that moment. Most are
  archived worktrees, but four are live and could spend on a developer machine:
  `experiments/v4-2/seed_general.ts`, `seed_reference.ts`, `experiments/v4-3/probe_demo.ts`,
  `probe_peers.ts`.

Filed, not fixed — the cheap fix (an explicit default-off line in each entrypoint) is listed
in the handoff. Nothing here affected a published bound, because every bound came out of a
DECIDED harness.

### 1.4 As-prod configuration, recorded rather than assumed

Model `gpt-5.4-mini`; `response_format: json_object`; `max_completion_tokens: 700`;
timeout 3,000 ms; one batched call per test; cost measured, not estimated.

⚠️ **THE MODULE HEADER SAYS "temperature 0". THE REQUEST BODY SETS NO TEMPERATURE.**
`semanticTier.ts:20` claims it; `defaultComplete` (lines 88–99) sends `model`, `messages`,
`response_format`, `max_completion_tokens` and nothing else, so the tier has always run at
the API default. This repo already has the rule — *a rule stated only in a comment is not a
rule* — and this instance bears directly on the variance question the session exists to
answer. **Not changed**: the measurement runs as-prod-configured, and "improving" the
configuration mid-measurement would measure something production has never run.

### 1.5 Every determinism claim in shipped copy — 38 sites, 21 files

`experiments/v4-4/determinism_claims.mjs` (enumerates; it cannot pass or fail, because there
is no banned word — "deterministic" is a word we *want*, and the defect was that it was
untrue). The load-bearing ones, verbatim:

| location | claim | before | after |
|---|---|---|---|
| `viewer/src/copy.ts:256` | "The evaluator is **deterministic**: it matches evidence, it does not reason about the product. A requirement with no retrievable sentence behind it is reported as not proven, **never inferred from context**…" | **FALSE on `/test`** — a sampled model call inferred from context and promoted rows | **true** |
| `viewer/src/copy.ts:236` | "The identical test runs again against the same version and content hash, so **the question cannot have moved** between the two runs." | true of the *question*, false of the *answer* | true |
| `viewer/src/copy.ts:168` | "Reruns that **repeat exactly**" | **FALSE** | true |
| `viewer/src/copy.ts:219` | "The identical test, same standard, same content hash, run again after the change" | misleading | true |
| `viewer/src/copy.ts:398` | "Same test, same models, versions pinned." | **FALSE** — the model was sampled | true |
| `viewer/src/copy.ts:425` | "the identical test that failed now passes — reported honestly either way" | at risk | true |
| `MethodologyPage.tsx:71` | "**a deterministic match** against the exact text or structured data" | **FALSE** for claim rows | true |

**No copy was edited.** The sentences were true of the design and false of the deployed
configuration; the correct repair is to the configuration, and that is what shipped.

---

## §2 — THE DURABILITY QUESTION. It was the worst part.

Production was reachable from this session (`.env.prod.bak` → Supabase session pooler).

```
public_tests rows                94   (general 93 · standard 1)   2026-07-25 → 2026-07-30
  carrying a semantic object     40
  semantic.called = true         40
  semantic.granted > 0            4    <-- AFFECTED PERMANENT RESULTS
  semantic.granted = 0           36
  semantic.vetoed  > 0            7
canary: the JSON path resolved on 40 rows, so "4" is a measurement and not a dead query
```

### Attribution was mechanical, not read off the prose

The stored blob records a **count**, never which row moved. The obvious shortcut is wrong:
the tier's detail string (`"Stated in your X."`) is *also* produced by the lexical path, so a
pattern read matched two rows per result and could not separate them.
`experiments/v4-4/attribute_grants.ts` uses two independent legs — the claim-kind filter
(exact: `applySemanticTier` can only promote `kind === "claim"`) and a tier-off replay of the
captured bytes — and **records the basis per row**, because a leg that did not run must not
read as a leg that agreed. Canary A confirmed the kind filter discriminates on this data (4
claim rows against 20 non-claim pass rows); canary B confirmed the replay produced rows.

### The four, named, each adjudicated against full untruncated evidence

| token | store | row | verdict |
|---|---|---|---|
| `t_15802547df13b8daf273` | www.klatchcoffee.com | Single-origin | **CONFIRMED FALSE** |
| `t_91db6f4c309fcf6734c9` | www.klatchcoffee.com | Single-origin | **CONFIRMED FALSE** |
| `t_0db9852c7e19461c49f8` | klatchcoffee.com — **standard, Coffee v1.3** | A single-origin claim is stated in readable text | **CONFIRMED FALSE** |
| `t_5996b5618d2d5f9988eb` | magicspoon.com | Gluten-free | **stands** (borderline, counted as a true pass) |

The three false passes all quote:

> "Discover Ethiopia Yirgacheffe Supernatural; bursting with flavor notes of sweet berries,
> rose, and silky milk chocolate, this exceptional coffee showcases an enhanced natural
> "Supernatural" process…"

which names the product and describes flavour and processing, and says nothing about whether
the coffee is from one place or a blend. Six evidence sentences on that page mention the
region; every one of them is the product's **name**.

⚠️ **One of the three is a STANDARD-layer result citing Coffee Standard v1.3** — the
content-hashed, citable conformance artifact that is the strongest thing this product makes,
and the one whose whole promise is that it resolves unchanged forever.

`magicspoon.com` is recorded as **stands**: the product is a granola variety pack and the
page's own FAQ says *"Magic Spoon Protein Granola: certified gluten free"*. The tier quoted a
cross-sell line rather than the certification sentence a few paragraphs down — a weaker
receipt than the page offers, but not a false statement.

### The remediation: render-time notices, never byte edits

`src/server/resultNotices.ts` + `test/resultNotices.test.ts` (9 tests).

- **DETECTION IS DERIVED** from the stored blob (`semantic.granted > 0`, read at both stored
  shapes). It cannot go stale and cannot miss a row minted later by a path that still runs
  the tier. A curated-list-only design silently misses whatever it does not know about.
- **ATTRIBUTION IS CURATED**, because the blob records only a count. Each entry is the output
  of the mechanical attribution above.
- A detected result with **no** curated entry still gets a notice — it reports an *unnamed*
  row rather than inventing one.
- The notice renders **above the provenance card** (a correction read after the number it
  corrects is read too late), **on the affected row itself**, and **in full on the
  one-pager** — the copy that actually gets forwarded, where a pointer back to the page would
  not travel.
- Rows recorded as **stands** carry a notice too. If the notice appeared only on wrong rows,
  its mere presence would leak the verdict.
- The stored result is **not edited and not deleted**. Editing would destroy the record of
  what we published; deleting would break a link already sent. The remediation IS the
  disclosure.

**Mutation-proved**: adding one trailing space to a single attribution label fails 2 of the 9
tests. The anti-vacuity anchor reads the real production rows from a committed fixture and
**fails if the fixture is absent** — it was first read from `experiments/v4-4/`, which is
gitignored, so it would have been passing on this machine alone.

⚠️ **The palette test caught a real error in the remediation itself.** The notice was styled
with `--not-proven` (crimson). That token means exactly one thing on this site — *a
requirement this store could not prove* — and borrowing it would have made a correction of
**ours** read as a failure of **theirs**, on the page a merchant is most likely to be shown.
Switched to `--attention`, which is what the guard's own message prescribes.

### And the fifth was stopped

Remediating four rows does not stop a fifth. Both public routes now pass
`semantic: { disabled: true }`. **This is not a verdict on the tier's precision** — that is
measured below. It is forced by durability alone, and P-28 item 4 stated it before any rate
was known: *"A citable result cannot be a sample. Even at perfect precision… any stored
result must pin the tier, or two readers of the same URL can see different verdicts."*

`ENGINE_VERSION` **v2.4.0 → v2.5.0**. §6's instruction, and the tripwire is worth recording:
`test/engineVersion.test.ts` hashes matcher files, and **no matcher logic moved** — had the
version literal not lived inside `productTest.ts`, the hash would have stayed identical while
live verdicts changed. The hash is a floor, not a ceiling; it is blind to a behaviour change
made in a route, a dep or an env var.

---

## §3 — THE MEASUREMENT (PILOT). Hard stop reached.

`experiments/v4-4/tier_measure.ts`. Three runs per store over identical snapshots: **A** tier
off, **B** tier on as-prod-configured, **C** tier on again. Only the STORE transport is
replayed; the model call is live and unswapped. Comparisons are over
`(status, detail, quote, surface)` — never status alone, because the tier can leave a row
`pass_evidenced` and change the sentence under it.

**20 stores** (10 coffee, 10 general), deterministically selected, seeded with the pinned
klatchcoffee.com capture.

```
stores evaluated             20/20
tier reported called         10
claim rows asked             16
grants                        3      = 18.75% of claim rows asked
rows differing B vs C         0      <-- no merchant-visible variance at this n
spend (B+C, 20 stores)       $0.02937
canary 1 — seeded klatch grant recovered   TRUE
canary 2 — tier called on >=1 store        TRUE
completion: VERIFIED_CLEAN
```

### The three grants, adjudicated individually

| store | quote the tier granted on | verdict |
|---|---|---|
| klatchcoffee.com | "Discover Ethiopia Yirgacheffe Supernatural; bursting with flavor notes…" | **false** — the seeded known-positive, reproduced |
| bluebeardcoffee.com | "…Mandomashe is a farmer group in the southern highlands of Tanzania, Mbozi district, serving four producer villages…" | **true** — a real origin statement, no term list matches it |
| mikava.coffee | "…Variety: TabiFarm: Finca Bella Vista." | **true** — a named single farm |

**2 of 3 grants are genuine recall the lexical pass missed.** That is the paraphrase problem
the tier was built for, and it is the reason §0 forbade opening by killing it.
**n=3 states no rate.**

### The variance dimension found something the row diff could not

| | |
|---|---|
| stores where the tier ran | 10 |
| stores where the **model's output** varied B vs C (granted/vetoed/discarded triple) | **2** |
| stores where a **merchant-visible row** varied | **0** |

`mikava.coffee` returned `1/1/0` then `1/0/1`; `firebellytea.com` returned `0/0/0` then
`0/0/4`. **The model is demonstrably non-deterministic on identical input**, and on this
pilot the verbatim-quote gate absorbed all of it. That gate is load-bearing, not decorative:
across run B it discarded **6** candidates against **3** grants and withdrew **7** lexical
matches as vetoes.

The honest reading: *zero row variance at n=10 is not evidence of stability, it is evidence
that the gate caught this sample's variance.* Whether it always does is a property of n. And
this is consistent with §1.4 — the tier runs at the API default temperature, not the 0 its
own header claims.

### ⛔ HARD STOP — user go required before the full corpus

| | |
|---|---|
| measured spend per store (B+C) | $0.00147 |
| **projected full corpus (338 stores × 3 runs)** | **$0.50** |
| command | `PILOT_N=338 MEASURE_OUT=full.jsonl npx tsx experiments/v4-4/tier_measure.ts` |

The number is small. The stop is the instruction, and it is also right: the number gets seen
before it gets spent.

---

## §4 — NOT YET DECIDED, AND DELIBERATELY

The pilot is n=3 grants. It **falsifies outcome 1** (the tier does grant — 18.75% of rows
asked) and it does not yet separate outcome 2 from outcome 3. The full corpus decides that.

What is already decided, and did not need the rate:

- **The tier is out of the permanent-result path.** Durability, not precision. Even at
  perfect precision a citable artifact cannot be sampled.
- **"Precise but unstable" does not ship**, per §4.2(b). The model's output already varies on
  identical input, and the only thing standing between that and a merchant's row is the
  verbatim gate.

### What happens to the published bounds — stated in every branch, as required

**9.99% (coffee) and 5.17% (general) are UNCHANGED, and now for a better reason than
before.** They were measured through a tier-off harness. Until today that was a *fidelity
gap* against production; as of v4.4 both public routes run tier-off, so **the harness setting
now matches the deployed configuration on those routes**. The bounds describe the engine that
runs.

No sidecar note is written yet, and that is deliberate: outcome 2 would require re-measuring
the bounds *with* the tier, outcome 3 would require a sidecar note saying they were measured
without it, and writing either now would mint a figure the full run may contradict. §7's
parking rule, applied to ourselves.

`experiments/v2-9/replay.ts`'s fidelity-gap comment **is rewritten** (required in every
branch). The retired argument, its exact false step, the measured replacement, and the
variance finding are all in it.

---

## §5 — THE CARD SHOWN TWICE: DROPPED, as §5 permits

Explicitly droppable if §2 pivots. §2 pivoted on the first query and the remediation plus the
measurement consumed the session. Nothing was started, so nothing is half-done. Carried to
the handoff with the full spec intact.

---

## What I deliberately did not do

- **Did not kill the tier outright.** It bought 2 genuine recall wins in 3 grants. §0's
  `origin` precedent cuts both ways.
- **Did not touch `productTest.ts`'s matchers, `subject.ts`, or any term list.** §6.
- **Did not reissue a standard.** Hashes frozen.
- **Did not un-pin `/demo`.**
- **Did not edit or delete a stored result.** Append-only.
- **Did not edit the determinism copy.** The sentences were true of the design; the
  configuration was wrong, and that is what was fixed.
- **Did not fix the temperature.** Measuring as-prod-configured requires not improving the
  configuration mid-measurement. Filed.
- **Did not fix the 27 inert harnesses**, the `funnel_events` standard-route telemetry gap,
  or the raw-HTML leak into evidence quotes (`</p>` appears inside a published quote on
  `t_5996b5618d2d5f9988eb`). All three filed.
- **Did not run the full corpus.** §3's hard stop.

---

## One paragraph a merchant could read

**Was the number we published about ourselves measured on the engine we run?** Until this
session, not quite. We publish how often this engine calls a requirement proven when the
evidence does not support it — 9.99% on coffee, 5.17% on general storefronts — and those
numbers were measured with one component switched off: a step that could promote a
requirement to "proven" by *reading* a sentence rather than by *matching* the store's own
words. We had argued that switching it off could only undercount passes and could not
flatter the error rate. That argument was wrong, and we found it wrong by executing it: the
step can promote a row on its own reading, and on four permanent results it already had —
three of them wrongly, including one about a real coffee roaster that we published as a
citable conformance result. Those four pages now carry a correction naming the exact row,
and the results themselves are untouched, because a result that can be quietly rewritten is
not worth citing. The step is switched off on both public routes as of this release, so the
published numbers and the running engine now describe the same thing. What we have not
finished is the interesting half: on a 20-store pilot that step also recovered **two real
statements** our word-matching missed — a named farmer group in Tanzania, a named single farm
in Colombia — which is exactly what it was built for. Whether that trade is worth making is a
question about a rate, and we are measuring the rate rather than guessing it.

---

## PRODUCTION VERIFICATION (post-deploy, `dcaf1f5`)

Merged and deployed. `/healthz` reports `dcaf1f516b01d71e38c1ddbcbb6991dd4ada0db0`.

```
EXPECT_SHA=$(git rev-parse HEAD) node experiments/v3-7/verify_prod.mjs      VERIFIED_CLEAN  21/21
EXPECT_SHA=$(git rev-parse HEAD) node experiments/v3-8/verify_sections.mjs  VERIFIED_CLEAN  15/15
```

Neither probe was re-pinned. The disclosure, read off the live pages:

| token | store | page notice | row notice | one-pager | headline served |
|---|---|---|---|---|---|
| `t_15802547df13b8daf273` | www.klatchcoffee.com | ✓ | ✓ | 200 | Correction: 1 row … did not meet the evidence bar |
| `t_91db6f4c309fcf6734c9` | www.klatchcoffee.com | ✓ | ✓ | 200 | Correction: 1 row … did not meet the evidence bar |
| `t_0db9852c7e19461c49f8` | klatchcoffee.com **(standard, Coffee v1.3)** | ✓ | ✓ | 200 | Correction: 1 row … did not meet the evidence bar |
| `t_5996b5618d2d5f9988eb` | magicspoon.com | ✓ | ✓ | 200 | Notice: a row … was reached by inference |

⚠️ **THE CONTROL IS THE HALF THAT MAKES THIS A MEASUREMENT.** Four pages showing a notice
proves nothing on its own — a notice that always renders would look identical. A stored
result with `semantic.granted = 0` (`t_42d82db8c8f616802805`, selected by query rather than
by hand) was fetched from production and returns **0** occurrences. The notice is
condition-driven on the live site, not merely present.

Each verdict is served correctly per row: the three adjudicated false say *"did not meet the
evidence bar"*, and magicspoon — adjudicated as standing — says *"reached by inference"*
instead. A notice that appeared only on the wrong rows would leak the verdict by its presence.
