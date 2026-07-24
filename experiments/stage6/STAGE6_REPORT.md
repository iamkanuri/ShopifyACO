# STAGE 6 — THE SEND ENGINE — REPORT

Status: **COMPLETE** · Date: 2026-07-24 · Branch `feat/send-engine-stage6`
(off `feat/diagnostic-acquisition-stage5`; never pushed/merged). Categories:
natural deodorant + coffee. Every real store name lives ONLY in the gitignored
`experiments/stage5/out/` and `experiments/stage6/out/`; this committed report is
anonymized (the category leaders are "the leader", prospects are D1–D9 / C1–C3).

## What Stage 6 was for

One purpose: maximize the reply probability of real outreach. Three builds, all
in service of sending, plus the pack the human actually sends. **Nothing was
sent by this work** (the send protocol is the human's, pre-registered separately).
All Stage 5 rules held unchanged: read-only forever against third-party stores,
robots/rate-limit/cache discipline, no PII, the claim linter blocks every rendered
case, evidence-availability scoping absolute (never product truth).

## The headline finding (6.2 — the generalization test)

The Stage 5 open question was whether the "one dominant gap" depth was real or an
artifact of one category. Running the **full pipeline on coffee** answered it:

| | Deodorant | Coffee |
|---|---|---|
| Flagship contract | aluminum-free · <$20 · one-time | single-origin · <$22 · one-time · roast-date |
| Diagnosed stores (unique) | 9 | 4 |
| **Multi-gap diagnoses** | **1 of 9** | **all of them (5/5 diagnostic runs)** |
| Dominant gap | one-time-purchase phrasing | single-origin AND roast-date AND one-time |

**Coffee did NOT converge.** Its variant/logistics-rich nature — single-origin,
roast-date freshness, and one-time-vs-subscription are each independently
checkable from public catalog + structured data — produced **2–3 genuine evidence
gaps per store**, where deodorant collapsed to a single broadly-checkable public
gap (subscription phrasing). The one-dominant-gap pattern was category-specific,
not a property of the instrument. That is the answer that shapes the next
category battery: constraint-richness of the category, not the tool, sets depth.

## The send pack (6.4 — the deliverable)

`experiments/stage6/out/send-pack/` — **12 sendable prospects** (9 deodorant,
3 coffee), each with a hosted URL, a ≤120-word link message, a public contact
URL, severity, and a one-line finding. Plus `send-log-template.csv` and the
portable hosted bundle `experiments/stage6/out/hosted/`.

The funnel, honestly (per category: 90 probes each):

| | brands extracted | own-domain + Shopify | diagnosed (unique) | sendable |
|---|---|---|---|---|
| Deodorant | 35 | 13 (2 leaders + 11 candidates) | 9 | 9 |
| Coffee | 30 | 7 (2 leaders + 5 candidates) | 4 | 3 |

**Sendable = 12, below the 15–20 target (disclosed).** The honest reasons: the
brand→domain resolver fix (below) dropped one coffee store that was only reachable
by a wrong name; the coffee leader is excluded from its own send list; and after
deduping brand-name variants of the same domain, the Shopify-hosted + genuine-gap
+ correctly-nameable pool of these two categories was 12. A truthfully small pack
of correctly-addressed cases beats a padded one — the send protocol's thresholds
were written to read whatever this returns.

Every message is ≤120 words (max 119), personalized with the store's real
appearance count K, the leader's count N, the battery size, and the one-line
finding; every one-line finding and message body passes a prose linter (the same
forbidden-phrasing spine as the case linter, minus the number-sourcing rule — no
ranking, revenue, guarantee, or product-truth claims).

## Winner-contrast, both directions, on real data (6.1)

Each case now scans the category **leader's** public snapshot against the same
contract and renders an evidence-availability contrast — and both directions
occurred on real stores:

- **Leader states it, you don't** (the quote path): the deodorant leader's public
  product description verbatim states aluminum-free; a prospect whose public data
  can't evidence it gets that exact contrast. The coffee leader's structured data
  verbatim states single-origin; same treatment. Quotes are verbatim substrings of
  the leader's public evidence (deterministic-floor / semantic-asymmetry discipline
  — a grant needs a real quote), registered as claims so any embedded number is
  sourced.
- **Even the leader doesn't state it** (the open-advantage path): the deodorant
  leader — famously subscription-first — does **not** publicly state one-time-
  purchase either, so the case says "even the category leader doesn't state this;
  stating it is an open advantage." That is the stronger sentence the build was
  designed to produce, and it emerged from the real data, not a fixture.

A store is never contrasted with itself (origin-equality suppresses it), and the
linter gates every contrast sentence.

## Hosting (6.3)

**Phase 0F finding: the public web property (lens.thirdocular.com) IS deployable
from this repo** — Railway builds `npm run build` and serves the API + viewer from
one Express process (`tsx src/start.ts`). So the seam was added *in this repo,
behind the existing deploy flow, and NOT deployed*:

- A gated `GET /c/:token` route serves one rendered case from `HOSTED_CASES_DIR`,
  `noindex, nofollow`, no index page, no cross-links, token strictly `[a-z2-7]{12}`
  (60 bits, path-traversal-proof). Registered only when
  `AGENTIC_INSTRUMENT_TEST_ENABLED=true` **and** `HOSTED_CASES_DIR` is set, before
  the SPA catch-all — inert by default. Verified end-to-end in the real server:
  200 + noindex header for a known token, 404 for unknown/malformed, and the SPA
  never sees `/c/*`.
- A **portable static bundle** (`out/hosted/`) is emitted regardless — `c/<token>/`
  pages + `_headers` (`X-Robots-Tag: noindex`) + `robots.txt` + a README with exact
  deploy steps (static host, or copy to the Railway volume + flip the flag). This
  keeps real store names out of git while giving the human a one-drag deploy.
- Tracking is one unguessable token per send → page views per token from the host's
  existing analytics = opens. No pixels, no fingerprinting, no PII. Tokens are
  stable per store across re-renders (a sent link never changes).

## Honesty disclosures (every deviation)

1. **Resolver bug caught and fixed (the important one).** The Stage 5 brand→domain
   resolver matched a brand to a host by loose *substring*. On real data this named
   the wrong store: a spurious "One" resolved to two unrelated domains that merely
   *contain* "one" (b·**one**·s, h·**one**·y), which would have sent "Dear One" to a
   real merchant. Fixed to require **prefix/suffix alignment** (keeps the true
   matches — "…beauty" prefixed by the brand, "weare·**wild**" suffixed — drops the
   coincidences). A store reachable only by a coincidental name is now **dropped
   rather than mis-addressed** (honest: better unsent than wrong). This cost one
   coffee prospect and zero mis-addressed sends. Test 60 locks it.
2. **Volume 12 vs target 15–20** — funnel-disclosed above; treated as an honest
   yield, not padded.
3. **The coffee "leader" is a decaffeination brand**, surfaced by the two decaf-
   heavy prompts, not a typical bean retailer — an artifact of mention-counting.
   The winner-contrast reference is therefore that brand; a prompt-weighting change
   could shift it, but the one-revision-per-stage rule was not spent here.
4. **Quote quality varies by surface**: the deodorant leader's aluminum-free quote
   is a descriptive sentence; the coffee leader's single-origin quote is a product
   title (both verbatim, both honest evidence-availability, the title just less
   compelling as copy).
5. **Some correctly-resolved names are partial** (a brand's first word — the
   "milk + honey" store renders as "Milk", "Oars + Alps" as "Oars"). Prefix-correct,
   not wrong, but abbreviated; a human can refine before sending.
6. **The coffee leader rendered a case but is excluded from the send list** (a store
   is never sent its own "you have gaps" diagnostic; its self-contrast is also
   suppressed).
7. Deodorant journeys were re-run three times across CP1/CP2/CP3 (contrast render,
   descriptor-parity, full-candidate coverage); the offline `run-context.json`
   re-render path added this stage means copy/name changes now cost **$0** (no
   journeys) — the resolver-fix re-label used it.

## Politeness / safety record (coffee — the first new category under the fetcher)

From `experiments/stage6/out/coffee/fetch-log.json`: 46 public requests, **0
admin/cart/checkout/account hits**, **0 auth headers**, **0 hosts 403/429-blocked**,
robots checked before every path, every response disk-cached (no URL fetched
twice), descriptive UA with a contact URL. No PII collected or rendered — the only
contact datum is a public `/pages/contact` URL string (verified across all 12 pack
items). The static call-graph test (48) still proves no write/auth/cart path exists
anywhere in the Stage 5/6 modules.

## Files / commits / tests

- New modules: `categories/coffee/contracts.ts` (contract library v2 + registered
  coffee term fixtures), `categories/registry.ts` (CategoryDescriptor), `run-battery.ts`
  / `run-category.ts` (category-parameterized entrypoints), `hosted-case.ts` +
  `hosted-case-route.ts` (the funnel seam), `send-pack.ts` (the assembler). Additive:
  a term-fixtures registry + `fixturesFor`/`lintProse`/`oneLineFinding`/`attrLabel`
  exports, winner-contrast in `stage5-diagnose.ts`, contrast render + labels in
  `stage5-case.ts`, a descriptor-driven + offline-re-renderable `stage5-run.ts`,
  the prefix/suffix resolver fix + extra-stopword threading, and the extracted
  battery core.
- Commits: `stage6.1: winner-contrast enrichment` · `stage6.2a: category descriptor
  + coffee contracts; free offline re-render` · `stage6.3: hosted-case bundle +
  gated /c/:token route` · (this commit) `stage6.4: send-pack + resolver fix + report`.
- Tests: **+10** (51–53 winner-contrast + coffee contract in `test/stage5.test.ts`;
  54–60 hosting + resolver + finding in `test/stage6.test.ts`). Full suite **307 /
  0 fail** (356 total, 49 DB-gated skipped). Typecheck clean.
- Spend: Stage 6 ≈ **$1.03** (deodorant journeys ≈ $0.60 across three runs, coffee
  battery $0.33 + pipeline $0.10; the re-label + all re-renders were $0). Breaker
  $25; cumulative ladder ≈ $2.9.

## What this stage does NOT establish

Whether any of the 12 messages get opened, replied to, or corrected — that is the
send protocol's job, and it is a human experiment with real merchants, not
something this codebase can answer. Whether "Milk"/"Oars"-style partial names read
as sloppy or fine to a recipient. Whether the coffee multi-gap depth converts
better than the deodorant single-gap alarm. And whether a store shown a case naming
it and a real competitor reads it as fair rather than intrusive — the honesty
scoping was built for exactly that question, but only the replies can answer it.
