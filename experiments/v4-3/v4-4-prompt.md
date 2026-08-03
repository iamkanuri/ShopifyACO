# v4.4 — THE TIER THE BOUNDS WERE NEVER MEASURED WITH

You are Claude Code, working in the ShopifyACO repo (public product: AisleLens,
lens.thirdocular.com).

**Base:** confirm `main` = `origin/main` = `/healthz`, both probes green. Branch
`feat/v4-4-semantic`. Standing protocol: pauses only for decisions the record doesn't
determine; HANDOFF.md restart-sufficient; REPORT.md as you go.

---

## §0 — THE CLAIM THIS SESSION EXISTS TO TEST

`experiments/v2-9/replay.ts` states the fidelity gap between the measurement harness and
production, and its first item is:

> **THE SEMANTIC TIER IS OFF (`PRODUCT_TEST_SEMANTIC=0`).** Production makes one batched
> model call to resolve CLAIM rows the lexical pass could not, so offline some claim rows
> stay `not_proven` that production might have resolved. **It cannot manufacture a lexical
> false pass, so it does not flatter the false-positive rate; it can only understate
> claim-row PASS COUNTS.**

Every published bound in this repo was measured through that harness or one that sets the
same variable — coffee **9.99%**, general **5.17%**, and every figure in the history behind
them. Production sets no such variable and has an OpenAI key, so **production runs the tier
on.**

v4.3 produced a counterexample to the sentence in bold. On the pinned klatchcoffee.com
capture, two server boots on the identical commit gave 5 proven and 6 proven; the extra
pass was `ALS-COFFEE-1.3-SOURCE-001` — *"Is this coffee from one place, or is it a blend?"*
— granted on:

> "Discover Ethiopia Yirgacheffe Supernatural; bursting with flavor notes"

A sentence that names the product and states nothing about origin. The verbatim-quote gate
worked exactly as designed: it constrains the QUOTE, not the INFERENCE. So the tier can
manufacture a false pass; it just cannot manufacture a *lexical* one, which is not the
property the argument needed.

**n = 1.** That is enough to falsify the claim and not enough to state a rate. This session
measures the rate.

⚠️ **DO NOT OPEN BY KILLING THE TIER.** It exists for PARAPHRASE — recovering true
statements no term list can match — which is a real recall problem this engine has. The
`origin` removal is the precedent in both directions: it was removed only after 5,322 real
descriptions were read and the cost of keeping it was measured at 17 true statements lost
for 0 false passes gained. A tier deleted without measuring the recall it buys repeats that
mistake in reverse.

---

## §1 — DISCOVERY, BY EXECUTION

1. **Is the tier actually on in production?** `PRODUCT_TEST_SEMANTIC` is unset by default
   and `ENV.keys.openai` is set. Confirm from the deployed process rather than from the
   code — the `semantic_tier` log line carries `granted`/`vetoed`/`discarded`/`costUsd`.
   If a kill switch is already set on Railway, this session is much smaller and you should
   say so immediately.
2. **Every caller.** `applySemanticTier` is reached from `runProductTest`, so
   `runStandardTest`, `/test`, `/api/product-test`, `/api/product-test/standard`, the
   paid-report path and the authenticated path all inherit it. Enumerate them and say which
   ones persist their result.
3. **THE DURABILITY QUESTION, and it may be the worst part.** v4.2 made results permanent,
   append-only and citable at `/result/:token`. Any stored result minted while the tier was
   live may contain a tier-granted pass, at a URL that never re-runs and is designed to
   resolve forever. Count them. A row's `result` JSON carries the assertions; the
   `semantic` stats are on `ProductTestResult`. **If a stored result contains a granted
   pass, that is a permanent published false statement about a named store**, and it
   outranks the rate measurement.
4. **Which harnesses set the variable, and which are merely inert.** `map_probe`,
   `replay`, `run_standard`, `dump` set it explicitly. Others (the corpus, the standards
   suite) are inert only because CI has no key. The distinction matters: an explicit
   setting is a decision, an inert one is an accident that a key on a developer machine
   silently reverses.
5. **What the tier costs.** `semanticSpendUsd()` and `estimateCostUsd`. You will be running
   it over hundreds of stores; know the per-call cost before you scale it.

---

## §2 — THE MEASUREMENT

**The instrument already exists and must not be rebuilt.** `experiments/v2-9/replay.ts`
replays captured bytes through the real `runProductTest` with only the transport swapped,
and it validated at 99.6% row agreement against the production run it replaced. The
corpus is 338 captured stores (334 merchants — `onyxcoffeelab`/`vervecoffee` and the two
`deathwishcoffee` captures are duplicates; **do not union the sets**, see P-16).

Run it **twice over the same snapshots**: once as it stands, once with the tier live.
Everything else identical.

**What to capture, and it is not just statuses.** The tier grants a quote. A status diff
alone cannot see a row whose verdict was already `pass_evidenced` and whose *evidence*
changed — v3.5 recorded two regressions invisible to a status diff for exactly this
reason. **Compare the rendered quote.** Record for every grant: the entry/requirement, the
attribute, the granted quote, the surface, and the sentence it came from.

**Then adjudicate every grant individually**, against that store's full untruncated
evidence, the same discipline as every published bound. Not sampled. The output is:

- `grants` — how many rows the tier moved, over how many claim rows asked
- `confirmed false` — grants where the sentence does not state the attribute
- `confirmed true` — grants that recover a real statement the lexical pass missed
- `borderline` — argued, and counted as true passes, as the bounds always have

**Both halves are the finding.** A tier with a 2% false rate that recovers 30% more true
claim rows is a different decision from one with a 20% false rate that recovers 3%.

⚠️ **THIS COSTS REAL MONEY AND MAKES HUNDREDS OF LIVE MODEL CALLS.** Cost-cap it, report
the spend, and **get a user go before the full run.** Do a 20-store pilot first, report
the observed grant rate and the extrapolated cost, and stop.

⚠️ **A GRANT RATE OF ZERO IS A BROKEN INSTRUMENT UNTIL PROVEN OTHERWISE.** The tier
returns empty when the key is missing, when the model call times out (a 3s timeout was
observed in v4.3), and when the JSON is malformed — and all three look identical to "the
tier had nothing to add." Require a two-sided canary: at least one grant somewhere, and a
recorded `called: true` on every store. Resolve `INCOMPLETE` rather than reporting a zero
you cannot distinguish from silence.

---

## §3 — WHAT TO DO WITH THE ANSWER

Four outcomes, and the response differs for each. Decide from the measurement, not before.

1. **The tier never grants in practice** (rate ≈ 0 over the corpus). Then it is buying
   nothing, it is spending money and non-determinism on every public run, and the honest
   move is to disable it in production and say so. The published bounds are unaffected,
   because they measured the engine that was actually running.
2. **It grants, and its precision is high.** Then the bounds must be re-measured WITH it,
   because they currently describe an engine no merchant uses. The bound moves in the
   flattering-to-unflattering direction and that is the whole point of publishing one.
3. **It grants, and its precision is poor.** Then it comes out of the public path, and
   `fitness.json` gains a recorded note that the previously published figures were
   measured without it. **A new version of the standard is NOT required** — the standard
   did not change, the engine did — but the sidecar rule applies: a measurement taken
   after a version ships is a sidecar and must not touch `standard_hash`.
4. **It cannot be measured** (throttling, cost, an instrument that will not stabilise).
   Then say so, disable it in the public path on the precautionary reading, and file what
   a real measurement would need. `INCOMPLETE` is a first-class outcome here.

**In every branch, `experiments/v2-9/replay.ts`'s fidelity-gap comment gets rewritten.**
The sentence "it cannot manufacture a lexical false pass, so it does not flatter the
false-positive rate" is now known to be false in the half that matters, and it is the
justification every published bound rests on. Leaving it standing is the worst available
option.

---

## §4 — CONSTRAINTS

- **No matcher change.** This session measures a tier and decides where it runs. It does
  not rewrite `productTest.ts`, `subject.ts` or any term list. `ENGINE_VERSION` stays put.
  If the measurement implies a matcher change, **file it as a proposal** — the standing
  rule.
- **No standard reissue.** Hashes frozen. If a fitness figure moves it moves in a sidecar.
- **Do not un-pin `/demo`.** v4.3 pinned it for reasons that hold regardless of the rate:
  a citable artifact cannot be a sample, and its selection gate is that every pass was
  adjudicated.
- **Freeze the tree for the duration of any independent pass**, and A/B against the parent
  commit with full `git worktree` checkouts — never a file swap. Two-sided liveness canary
  in every probe. The repo has recorded a file swap that silently failed to apply and
  produced "0 regressions" over nine real ones.
- Standing gates: typecheck, viewer build, full suite, JS-off and JS-on on changed routes,
  both production probes after any push.

---

## §5 — REPORT

The grant rate with its denominator. The precision, adjudicated row by row, with the
confirmed-false examples quoted in full. The recall the tier buys, stated as the number of
true claim rows it recovers that the lexical pass missed — because that is what the
decision costs. The spend. Every stored result that contains a tier-granted pass, named.
The rewritten fidelity-gap comment. What you deliberately did not do. And one paragraph a
merchant could read: **was the number we published about ourselves measured on the engine
we run?**
