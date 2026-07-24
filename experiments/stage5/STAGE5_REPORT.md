# STAGE 5 — THE DIAGNOSTIC ACQUISITION ENGINE — REPORT

Status: **COMPLETE** · Date: 2026-07-24 · Branch `feat/diagnostic-acquisition-stage5`
(off tag `agentic-instrument-mvp-v1`; never pushed/merged). Category: natural
deodorant. All real store names are anonymized in this committed report and live
only in the gitignored `experiments/stage5/out/`.

## Final summary — GATE D

**PASS on the loop-independent claim, with the honesty boundary held.** The
instrument, pointed at real public Shopify stores nobody on this project
controls, produced trace-cited, evidence-availability-scoped diagnoses and 5
sendable merchant-specific cases — using only public data, respecting robots
and rate limits, storing no PII, and never asserting anything about product
truth.

- **Probed:** 90 live category probes (10 buyer-intent prompts × 3 repeats × 3
  channels: OpenAI, Gemini, Perplexity), 73/90 with citations.
- **Prospected:** 35 brands extracted from responses; 17 resolved to their own
  domain via citations only; **13 confirmed Shopify-hosted** (2 WINNERS, 11
  CANDIDATES); 22 skipped (no resolvable own-domain, or not Shopify).
- **Diagnosed:** 8 real stores snapshotted from public catalogs → Store
  Diagnostic Scan → 4 journeys each (2 models × 2 trials) = **32 real-store
  journeys**.
- **Rendered:** **5 real-store cases**, every one passing the deterministic
  claim linter, each with `index.html` + `claims-map.json` + `provenance.json`
  + a pasteable `message.txt`.
- **Cost:** $0.65 total (battery $0.31 + 32+ journeys; breaker $25).

## The 5 shortlisted findings (anonymized; real in the gitignored output)

Every finding is scoped to EVIDENCE AVAILABILITY, never product truth:

1. **Prospect A** (severity 15, appeared in 6/90 answers): public store does not
   state, in an AI-verifiable form, that its deodorant is a one-time purchase /
   not a subscription. It DOES publicly evidence aluminum-free. The category's
   most-recommended competitor was named 43× in the battery.
2. **Prospect B** (severity 15, appeared in 4/90): same one-time-purchase
   evidence gap; aluminum-free is publicly evidenced.
3. **Prospect C** (severity 9): one-time-purchase evidence gap; its lowest
   readable deodorant price is at (not under) the tested cap — reported as a
   readable value that doesn't meet the ask, NOT as a missing price.
4. **Prospect D** (severity 9): one-time-purchase evidence gap.
5. **Prospect E** (severity 9): one-time-purchase evidence gap.

**The dominant real pattern: 8/8 diagnosed stores lack a machine-verifiable
"one-time purchase / no subscription" statement on their public product data**,
even though shoppers explicitly ask for it (battery prompts d1/d5/d7). That is a
genuine, consistent, category-wide evidence gap the diagnostic surfaced from
public data alone.

## What public data could NOT establish (the honest limit)

- **`product_metafields` are never public** → always `not_inspectable`, reported
  as "would need store access", never as missing. Every case's provenance
  section lists the not-inspectable surfaces (metafields, faq, shipping/returns
  policy) explicitly.
- **`faq` / `shipping_policy` / `returns_policy`** are reachable on some stores
  but heavy and non-standard; Stage 5 left them `not_inspectable` by default
  rather than over-fetch. So `delivery_timing`-type constraints demote to
  observational for public runs — they can never render as a failure.
- **Ground truth is unknowable for a third-party store.** No case asserts a
  product is or isn't anything. The claim linter (deterministic, blocking)
  enforces this: product-truth, revenue, causal, and predictive phrasings are
  refused, and any number not in the case's claims-map is refused. A case that
  fails the linter is not rendered (test 45 proves it blocks a non-compliant
  fixture; all 5 real cases passed).

### The Rule-4 bug the real data caught (disclosed)

On the first pipeline run, a prospect whose deodorant is priced exactly at the
tested cap had `variant_price` marked `absent` by the scan (no variant satisfied
"under $20") — and the case would have said "your store does not state the
price." **That is false: the price is fully public.** Fixed before finalizing:
a constraint is a genuine evidence gap ONLY when the store exposes nothing
readable (no supporting AND no contrary evidence); a readable-but-unmet value
(price present, over the cap) is excluded from every "not stated" claim and from
severity, and the linter now defensively blocks any price-not-stated phrasing.
This is exactly the ground-truth-boundary discipline Rule 4 exists to enforce,
caught and closed on real data.

## Is this materially different from a free readiness scanner?

**Yes, judged on the artifacts.** A readiness scanner inspects one store in
isolation and emits generic "add structured data / fill your meta description"
advice. Each Stage 5 case instead:
- opens with a **live competitive signal from real AI answers** — "we asked
  assistants 90 questions in your category; you appeared in K; [named
  competitor] was recommended 43×" — which no single-store scanner can produce;
- ties a **specific missing evidence surface** to **what shoppers actually asked
  the assistants for** (the battery prompts), not to a generic checklist;
- backs the finding with **agent journey traces** (what an AI shopper's tool
  calls could and couldn't resolve), not a static lint;
- states the fix as **the exact evidence to add**, and is honest that applying +
  verifying it needs an install (the funnel seam).
The honest caveat: on this category the compiled gap converged to one dominant
attribute (one-time-purchase phrasing), so the *depth* per store is modest;
the *differentiator* is the competitive framing and the trace-cited specificity,
not a longer list of fixes.

## Politeness / safety record (verified from `out/fetch-log.json`)

64 public requests total across the run; **0 stores fetched behind
auth/password**; only public catalog/page endpoints (admin/cart/checkout/account
paths are refused by an allowlist); **1 host returned 403/429 and was skipped**,
with its 3 subsequent requests correctly refused as `host-blocked`; **no host
exceeded the 10-request cap**; robots.txt checked before every path; every
response disk-cached (no URL fetched twice); descriptive UA with a contact URL;
no write, no auth header, no admin/cart/checkout call anywhere in the Stage 5
modules (test 48, static call-graph check). No PII collected or rendered — the
only contact datum is a public `/pages/contact` URL string (test 49).

## Files / commits / disclosures

- New modules: `public-fetch.ts` (polite fetcher), `public-catalog.ts`
  (public snapshot + `not_inspectable`), `prospect-finder.ts`,
  `stage5-battery.ts`, `categories/deodorant/contracts.ts` (category library
  v1), `stage5-diagnose.ts`, `stage5-case.ts` (renderer + claim linter),
  `stage5-run.ts` (orchestrator). Additive: a structural type on
  `extractBrandCandidates`, a read-only `shopAllowlistOverride` on the agent
  runner (no write path exists), snapshot `provenance`/`surfacesNotInspectable`
  fields. Tests 45–50 in `test/stage5.test.ts`; full suite green.
- Commits: `stage5: public catalog ingestion` · `stage5: category battery +
  prospect extraction + diagnostic/case modules` · `stage5: real-store
  diagnostics + real cases rendered` · `stage5: Rule-4 honesty fix` · `stage5:
  report`.
- Disclosures: the Rule-4 readable-but-unmet fix (above); Stage 5 leaves
  faq/policy surfaces `not_inspectable` by default (a deliberate under-fetch,
  not a limitation of the endpoints); winner-contrast is captured at the signal
  level (the named competitor + mention count in every case) — a scan-level
  "what the winner evidences that you don't" contrast is a documented, honest
  enhancement not rendered into these 5 cases.

## What Gate D does NOT establish

Whether these cases move a real merchant — that is the human Gate 3 experiment.
Whether the one-dominant-gap depth generalizes to other categories — coffee or a
constraint-richer category would test that. And whether a merchant, shown a case
naming their store and a real competitor, reads it as fair rather than
intrusive — a question the honesty scoping was designed for but which only real
conversations can answer.
