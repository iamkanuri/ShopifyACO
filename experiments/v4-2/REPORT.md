# v4.2 — A RESULT YOU CAN SEND

**Branch:** `feat/v4-2-sendable` off `main` @ `46e5c5e`.
**Base confirmed by execution:** `main` = `origin/main` = `46e5c5e`; `/healthz` reported the
same commit; `GET /standards` → 200.

Numbers here are executed, not recalled. Where something could not be established it says
INCOMPLETE and what blocked it.

---

## THE HEADLINE

The brief's central premise was false in the half that mattered, and the session found two
live production defects the brief did not know about — one of them in v4.1's own headline
feature.

| | |
|---|---|
| **CP-0** | 5 discovery questions answered by execution; 7 probes + 42 adversarial verifiers |
| **CP-1** | `/result/:token` — permanent, unguessable, never re-runs. 26/26 e2e against a real DB |
| **CP-2** | print fix proved by RENDERING: **20 evidence items gained on `/demo`, 88 on the standard page, 0 lost** |
| **CP-3** | two reference one-pagers, **23/23 artifact checks** against the PDF bytes |
| **CP-4** | `outreach_final.md` generated from artifacts, **3 flags** where the honest value contradicts the copy |
| **found** | the retired **1.6× spread sentence was LIVE** on two published standard pages |
| **found** | **v4.1's peer line joined 0 of 10 rows** — it has never rendered |
| gates | `npm test` **1071 · 995 pass · 0 fail · 76 skipped** (base 1053/977/76) · typecheck green |

---

## CP-0 — DISCOVERY

### D-1. The brief's central premise is false: the standard layer persisted NOTHING

> The brief: *"Results ARE persisted to `public_tests` on every run, but no public GET route
> exists."*

Half right, and the wrong half is the half CP-3 needs.

| route | engine | persisted? |
|---|---|---|
| `POST /api/product-test` | generated requirements (general layer) | yes |
| `POST /api/product-test/standard` | Coffee Standard v1.3 (standard layer) | **no — no `storePublicTest` call at all** |

`grep -rn "storePublicTest" src/` returned exactly one call site. The standard-layer handler
computed `runStandardTest(url, slug)` and `res.json(out)`, dropping the verdict along with the
standard identity, the per-entry citation URLs and the peer rates — which exist nowhere else.

**So the layer that makes the site's own headline true was the layer with zero durability**,
and CP-1 was not "add a GET route to an existing table". Fixed: the standard route now persists
the whole `StandardRunResult`, so a stored row is indistinguishable from a live one.

### D-2. A "permanent" URL over `public_tests` would have 404'd in seven days

`PUBLIC_TEST_TTL_MS = 7 days`, and every read filtered `expires_at > now()`. Migration 0026's
own comment says *"unclaimed tokens are short-lived"* — the table was built to carry a result
through OAuth, not to be an archive.

**Two lifetimes were sharing one column.** Resolved by separating them rather than widening the
TTL: `expires_at` keeps its exact meaning and every claim query still filters on it;
`getStoredResult` (new, render-only) does not consult it. `getPublicTest` had exactly one caller
(`shopify.ts:243`), so this touched nothing else. Proved both ways in the e2e — the result
survives the window expiring **while the claim path still refuses it**.

### D-3. `/test` is client-rendered; `/demo` is the machinery, with one constraint

`publicSsrFor()` handles `/` and `/methodology` only, so `/test` ships an empty `#root`.
`/demo` is a standalone document via `renderDemo` → `renderStandaloneDocument`.

**The constraint that decided CP-1's renderer:** `/demo` recovers *untruncated* evidence
sentences by re-running `presentableQuote` over the product's evidence index. A stored
`ProductTestResult` carries only the ≤180-character quote — not the index. `/demo`'s existing
fallback explains a missing sentence as *"could not be matched back to a single evidence
sentence"*, which would be a **false explanation** on a stored page: the index was never stored.
A wrong reason for a real limit is still a wrong statement, so CP-1 has its own row renderer and
says the true thing.

### D-4. `/c/:token` — retired, and retiring it breaks nothing (measured, not assumed)

`hostedCase.ts` served one pre-rendered outreach case per token from a bundle on the Railway
volume; generator out-of-repo; `caseDefects()` as a last-boundary refusal gate.

It is the same artifact class as CP-1 reached by the opposite architecture. The brief's rule —
subsume or explicitly retire, never build alongside — settles it, and the operational question
was answered by execution rather than by DEPLOY.md's checklist:

- The real 12-case bundle **is on disk** at `experiments/stage6/out/hosted/` (gitignored, never
  committed). A discovery agent claimed no bundle could be found; its verifier found it.
- All 12 minted tokens requested against production: **0 returned 200**, with a two-sided canary
  proving the route was mounted and answering (`/c/NOTVALID` → 404 `text/plain`, an unknown path
  → the SPA's 200 `text/html`).

**Residual, stated:** this proves no token anyone ever minted is served. It does not prove
`HOSTED_CASES_DIR` is unset — the 404 is deliberately indistinguishable.

Carried across rather than dropped: the header posture (`noindex, nofollow` · `private,
no-store` · `Referrer-Policy: same-origin`, *not* `no-referrer`, which once made outreach
attribution structurally impossible), the refusal gate (as `resultPageDefects`), and the
referrer class. **That last one was the trap**: `classifyReferrer` hard-codes the literal `/c/`
path, so without moving it every arrival from a sent result would have classified as `other` and
the one number measuring whether outreach works would have read as a collapse in outreach rather
than as a rename. Both prefixes now match.

### D-5. The print CSS — the brief is wrong about the shape, right about the defect

There are **two** `@media print` blocks, and the first **does** name `.pt-*`. What is true:
neither names `details`, and neither names `.std-page` — the wrapper on every standard page,
every entry page and `/demo`.

### D-6. Two live production defects the brief did not know about

Both found during discovery, both on the surfaces CP-3/CP-4 send people to. See below.

---

## CP-1 — THE PERMANENT RESULT URL

`GET /result/:token`, server-rendered, JS-off readable, registered ahead of `express.static`
and the SPA catch-all. Migration `0031` adds provenance (`ran_at`, `engine_version`, `kind`,
standard identity, `contract_version`), `shared_at`, and lineage (`rerun_of`, `superseded_by`).

**Never a silent re-run**, asserted twice because the negative is what matters and a happy-path
test cannot see it: statically over the import graph (no runner, no fetcher, no matcher; a
`productTest.js` import must be `import type`), and behaviourally with stored counts of 777/888
on a two-row result — numbers no engine can produce. A page that *did* re-run would look right
almost always: the result cache is keyed on URL alone with a 7-day TTL, so it would diverge only
after a Railway restart or a matcher change, i.e. in front of the recipient, weeks later.

### The three product decisions

**1. Sharing posture.** Every result is unguessable (80 bits), `X-Robots-Tag: noindex,
nofollow` **always**, absent from `sitemap.xml`, linked from no page. What `shared_at` gates is
the **social card** — the thing that actually makes a link travel. An unshared result will not
unfurl in Slack or on a timeline until a human presses the button; a shared one still never
enters search. Marking is one-way, because a link already sent cannot be recalled and a button
that pretended otherwise would be a lie.

**2. Staleness with teeth.** Results are append-only. A re-run mints a new token; the older row
is never rewritten and learns only a `superseded_by` **pointer**. Both pages link to each other
and say *"linked, not reconciled: if they disagree, the store changed, and both readings are
true of their own day."* Same rule as the fitness sidecars, and the same shape as the
supersession notice a byte-frozen standard gets from its renderer rather than from an edit.

**3. Retention.** Made actually permanent, by separating the claim window from the read window
(D-2) rather than by extending a TTL. The page states the posture in words: *"kept indefinitely
and not deleted on a schedule. A permanent link that expires would be a false statement with a
delay, so it does not expire."* Nothing purges this table and adding a job would break the URL.

**What is frozen vs re-derived**, because they are different kinds of claim: every
per-requirement verdict, detail, quote and surface is FROZEN; the peer rates and the published
error bound are RE-DERIVED from the exact standard **version this run pinned** — never from
`currentOf`, which would attribute another document's measurement to a run that never saw it.
The page says which it is doing.

**e2e against a real Postgres and a real HTTP server: 26/26**, every positive paired with a
negative, including the decisive pair in D-2 and a canary that an unknown path still reaches the
SPA with 200.

---

## CP-2 — THE PRINT PATH

**Proved by rendering, never by reading the CSS.** `experiments/v4-2/cdp.mjs` is a
zero-dependency Chrome DevTools Protocol client over Node 22's global `WebSocket`, driving the
system Chromium. No `npm install` — this repo has a session on record that emptied
`node_modules` that way.

**The measurement, A/B over the SAME served HTML with only the stylesheet swapped**
(`git show HEAD:viewer/src/theme.css` vs the working copy — not a rebuild, which would compare
two bundles, and not a file swap, which fails silently):

| surface | items compared | gained in print | lost | page-break seams |
|---|---|---|---|---|
| `/demo` | 45 | **20** | 0 | 0 |
| `/standards/coffee/1.3` | 96 | **88** | 0 | 4 (reported) |

Both runs on both surfaces: media canary live (screen `false` → print `true`), PDF-extractor
canary live (positive control found, nonce absent), DOM and PDF agreeing on every string.

**The fix is not the one everybody cites.** Six candidates scored against the real engine, each
with a two-sided check (the collapsed body must appear *and* a legitimately print-hidden control
must stay hidden, so a blanket reveal cannot pass):

| rule | works |
|---|---|
| `details > *:not(summary) { display: revert !important }` | **no** |
| `details > * { display: block !important }` | no |
| `details { content-visibility: visible !important }` | no |
| `* { content-visibility: visible !important }` | no — the universal selector does not match pseudo-elements |
| `details::details-content { content-visibility: visible !important }` | **yes** |

Chromium moved the hidden content behind a `::details-content` pseudo-element. **Only that rule
ships.** The obvious pairing — the children rule, "for older engines" — measured inert here and
cannot be justified on a browser this project has not rendered in; a guard whose removal changes
nothing is decorative. The rule is **unscoped**: a `.std-page`-scoped copy printed 1 page where
the unscoped rule printed 4, and eight of the fourteen `<details>` in this codebase live on SPA
surfaces wrapped in `.app`.

**Browser-support honesty.** `::details-content` is Baseline newly-available (Sept 2025;
Chrome/Edge 131, Firefox 143, Safari 18.4) — about 83% of readers. That gap **does not reach the
sendable artifact**: the one-pager PDF is rendered by our own Chromium, so what the recipient's
browser supports never enters into it. It affects only a reader printing one of these pages
themselves, and for them the loss is the status quo, not a regression.

Also fixed: the disclosure marker is driven by `[open]`, so an expanded-in-print section would
have printed a "+" that is both untrue and unusable on paper.

### Three instrument failures, all caught by a canary or an anchor, none by reading

1. **A throwaway checker written via a bash heredoc lost one backslash** and sent `/s+/g` to the
   page instead of `/\s+/g`, replacing every literal `s` — so "Can I buy this as whole beans?"
   became "Can I buy thi a whole bean ?" and it reported **124 phantom missing items**. The
   load-bearing probe was written with the Write tool and has `\\s+`; it was unaffected. This is
   the repo's own documented rule — every quoting layer eats one backslash — in a new costume.
2. **The PDF extractor built one global `/F1 → font` map**, but each PDF page carries its own
   `/Font` resource dict and Chrome reuses short names across pages. Fixed to resolve per page.
3. **Chromium repeats a `<thead>` on every printed page**, wedging the header into a table cell
   that spans a break. Handled by stripping DOM-derived headers and then allowing exactly one
   **bounded** seam (≤250 chars). The first cut allowed an unbounded gap and the BEFORE run
   started "finding" text by stitching fragments from opposite ends of the document — caught by
   the DOM/PDF agreement canary, which is the only reason it did not ship as a silent loosening.
   Seam-matched items are counted and reported (`items_matched_across_page_break`), never folded
   into the pass count.

---

## CP-3 — THE AGENCY ONE-PAGER

`GET /result/:token/one-pager`, generated from the stored run. Deliberately carries **no
`<details>` and no interactive affordance at all** — nothing that reads as broken on paper.

**"Most material" is a stated, derived rule, printed on the artifact:**

> unmet requirements first, ranked by how many comparable stores DO state the same thing (the
> widest peer gap first); where two are equal, the one a stranger can check on the fewest
> surfaces comes first. Nothing here is hand-picked.

A row with **no** measured peer rate sorts after every row that has one — an unmeasured gap is
not a small gap, it is an unknown, and ranking it above a measured one would be a claim we
cannot support. Ties break on label so two runs of the same data cannot disagree.

**The two reference PDFs**, verified against the PDF **bytes** (23/23, extractor canaried on
each):

- `experiments/v4-2/onepager_coffee_klatchcoffee.pdf` — coffee / standard layer, with peer
  lines. Built by replaying the committed frozen capture through the real engine ($0, no
  network); every passing row of this product was adjudicated `true_pass` in the v3.2 audit.
  Carries the standard, the content hash, per-entry citations, the measured bound with its
  audited row count, and the permanent URL.
- `experiments/v4-2/onepager_general_barebonesliving.pdf` — general layer. Asserted to contain
  **no percentage at all**, no peer sentence and no reference to a standard it did not execute.
  Store chosen from the v3.7 general audit behind a gate that refuses any host with a
  non-`true_pass` adjudication.

**An honest outcome worth stating:** a live run against the first candidate came back
`rate_limited` — the documented `safeFetch` Cloudflare fingerprint refusal — so both references
are replays. And the general engine asked a *watch strap* whether it was "Paraben-free" and
"Fragrance-free"; its category inference produced cosmetics claims for leather goods. That store
was not used, and the observation is filed rather than smoothed.

---

## CP-4 — THE INSTANTIATED OUTREACH PACK

`experiments/v4-2/outreach_final.md`, **generated** by `instantiate_outreach.ts`, not written.
The three findings in each email come from the same `selectMaterial()` that renders the attached
PDF, so the email and the artifact cannot disagree about which findings are material.

**Three flags where the honest value contradicts the pack's prose. The number was kept.**

1. **CLAUDE.md's general-sample bound is stale by a release.** It records 7.53% over 488 rows
   (v3.7). The artifact publishes **5.17% over 483 rows** (v3.8, after the tier-aware cents fix
   and the non-USD refusal). Filling the placeholder from the notes would have published a
   figure the standard page one click away contradicts.
2. **"of 100" is false** for one of the three Track A findings (99 adjudicated of 99 asked).
   Every peer sentence is generated by `peerSentence()`, which names its own denominator.
3. **The pack's Track A argument does not hold on this store.** The copy reads *"X of 100 stores
   state this on-page — so this is a peer gap, not a nitpick"*, which needs a **high** X. On
   klatchcoffee.com every unmet requirement is one most comparable stores also fail (8/100,
   7/99, 4/100 state it). The honest framing is the opposite — and arguably stronger: this is a
   **category-wide gap**, an argument for the standard rather than a criticism of one merchant.
   The generated line says that instead.

Plus a standing refusal: the two samples' intervals overlap (coffee 2.14–8.75%, general
1.28–4.03%), so **no sentence may claim a category sample and a general sample differ**.

---

## TWO LIVE PRODUCTION DEFECTS, FOUND IN DISCOVERY AND FIXED

### P-A. The retired 1.6× spread sentence was serving on two published standard pages

At commit `46e5c5e`, `/standards/coffee/1.0` and `/standards/coffee/1.1` both published:

> *"The Coffee category sample bound is higher than the General DTC sample bound by about 1.6×.
> … so the number that matters to a merchant is the one measured on their own category."*

That is the sentence CLAUDE.md records as **retired three times and revived by a fix twice**.
Neither existing refusal could fire: v1.0's sidecar predates `interval_95` (so the overlap
branch is unreachable) and its general sample is a floor with 18 confirmed (so the x=0 branch is
unreachable). Execution fell straight through to the arithmetic — `12.78 / 7.80 = 1.638`.

**The retirements only ever covered the shapes the CURRENT version happens to have.** A
superseded document keeps serving its own bytes forever, so a renderer bug on it is permanent
and silent, and every check ran against whichever version was current. Worse, the floor caveat
this renderer already appends says in full that *"the gap between them is not a measurement"* —
printed directly **below** a sentence stating the size of that gap.

Fixed by generalising the refusal twice more: **no intervals ⇒ no ratio** (an unmeasured
interval is not a narrow one) and **any floor ⇒ no ratio**. The new test walks **every published
version**, not the current one.

### P-B. v4.1's peer line joined 0 of 10 rows and has never rendered

`peerRatesFor` set `label` to the entry's **question** ("Can I buy this as whole beans?");
`compileStandard` labels the requirement with the **binding's** label ("Whole bean option is
listed and purchasable"). Both renderers joined on label. Measured across all ten executable
coffee entries: **0 of 10 rows matched**.

So the peer benchmark — the standard layer's entire differentiator, and v4.1's headline — has
rendered nowhere. Nothing threw and no test failed, because **a join that finds nothing looks
exactly like a standard that has published no measurement**. Same shape as the
`grounding.sources` defect and the three `s.fitness` ones.

Fixed by carrying an explicit `requirementLabel` join key. Verified two-sided: **0/10 without
the fix, 10/10 with it**, and the test refuses to pass if the pre-fix path stops reproducing the
defect. `resolveStored` re-derives peer rates and had to merge the key back across, or the fix
would have been undone one function later.

---

## PRODUCTION VERIFICATION

Deployed as `6f47641`, then `9d9685d`. `railway.json` runs `npm run migrate && npm start` and
`migrate.ts` exits 1 on failure, so **a green `/healthz` on this commit is proof migration
`0031` applied**.

Both standing probes: `experiments/v3-7/verify_prod.mjs` **21/21 VERIFIED_CLEAN**,
`experiments/v3-8/verify_sections.mjs` **15/15 VERIFIED_CLEAN**.

The retired spread sentence, every published version — `/standards/coffee/1.0` and `1.1` now
serve "No comparison is drawn", `1.3` serves "No difference is stated", and the canary confirms
`1.3` still publishes 4.38% / 9.99%.

**A real standard run, executed against klatchcoffee.com through production**, then its
permanent URL fetched:

```
POST /api/product-test/standard   → ok, ALS-COFFEE v1.3, 10 peers, 10 carrying requirementLabel
                                    resultToken t_0db9852c7e19461c49f8
GET  /result/t_0db98…             → 200 · x-robots-tag: noindex, nofollow
                                         · cache-control: private, no-store
                                         · referrer-policy: same-origin
                                         · no og:image (unshared)
                                         · 7,064 characters of body text with JS off
                                         · standard id, content hash, peer lines, 9.99% bound,
                                           "kept indefinitely", "This result is unlisted"
GET  /result/t_0db98…/one-pager   → 200 · selection rule printed
                                         · "92 of 100 coffee stores don't state this either."
                                         · "92 of 99  coffee stores don't state this either."
```

Those last two lines are the denominator trap resolved in production: 100 for one entry, **99**
for another, in the same artifact, each naming its own.

### One regression, introduced and caught by a probe rather than by a test

`/c/2jmh6zli5tn3` returned **HTTP 200 with the marketing homepage** after the first deploy.
Deleting `app.get("/c/:token")` also deleted the `app.use("/c", 404)` beneath it, so the SPA
catch-all took the path. That is exactly what the retired module's own comment recorded — *"a
broken outreach link would have looked like it worked"* — and a 200 tells a link checker, a
crawler and a recipient that a dead outreach link is live. Restored in `9d9685d` with a test.
It is worth naming plainly: **the standing production probes caught this and the 1,072-test
suite did not**, because no test enumerates the Express route table.

## WHAT THIS BRIEF GOT WRONG

1. **"Results ARE persisted on every run."** The standard layer persisted nothing (D-1). This is
   the finding that reshaped CP-1, and it means the strongest artifact this product can produce
   was the one that could not be sent.
2. **"The single `@media print` block names no … `.pt-*`."** There are two blocks and the first
   one does name `.pt-*`. The defect is real; the description was not.
3. **`OUTREACH_PACK.md` was described as attached** and was in neither the repo nor Downloads at
   session start; the user supplied it mid-session.
4. **The brief scoped CP-2 to the standards/demo surfaces.** The worst-affected surface is
   `/report`, which owns the **only** `window.print()` in the repo and collapses six of its
   seven sections by default. The fix is unscoped so it covers that too, but the brief's framing
   would have missed it.

---

## FILED, NOT FIXED

- **A hand-typed figure on `/test`.** `pt-stdfoot` states "100 real coffee products across 77
  storefronts" as literals. Both are currently correct against `fitness.json`, so this is not a
  falsity — but it is a hand-typed figure on a surface that lints none of its own copy
  (`ProductTestPage.tsx` is outside `PUBLIC_MARKETING_STRINGS` by its own admission).
- **The general engine's category inference produces off-category claims** — "Paraben-free" for
  a watch strap. Touching it is a matcher edit and out of scope.
- **`cross_sample_comparison.general_interval_95` in `fitness.json` still holds v3.7 values**
  (2.3457–5.7548) while `samples[general].interval_95` holds v3.8's (1.28–4.03). Nothing false
  is published today only because the renderer reads the sample. A future script that reads the
  comparison block would publish a superseded interval.
- **`/llms.txt` carries four version blocks**, three with superseded figures. Never pattern-match
  a figure out of it; scope to the current block or read the sidecar through `fitnessOf`.
- **The SPA-Link guard's regex misses `<Link className="…" to="/x">`** — a prop before `to`
  walks past it. The guard shipped in `46e5c5e` to close a production 404.
- **`src/server/publicSsr.ts` is covered by no test at all.**

---

## THE FOUNDER PARAGRAPH — what an agency does now, click by click

You pick an agency and a client from their portfolio. You open `lens.thirdocular.com/test`,
paste the client's product URL, and press the button; the general engine returns a table in a
few seconds. If the product is coffee, a second button runs the published standard against the
same page — two fetch sequences, never cached, so it is a deliberate act. Under the result there
is now a line that was not there before: **"This result has a permanent address"**, with the
URL. That link renders the same verdict forever, states the day it ran and the contract that
produced it, never re-runs anything, and carries a no-index header so it is yours to send rather
than the internet's to find. Append `/one-pager` to it and you get the forwardable version: the
three most material findings by a rule printed on the page itself, each with the store's own
sentence or the precise absence, each with a "check it" line a stranger can follow in thirty
seconds, the peer benchmark where one is published with its true denominator, the measured
false-pass rate of the engine in one footer line, and the citation URL. Ctrl-P, Save as PDF —
and because of CP-2 the printed file now contains the evidence that used to vanish with the
collapsed sections. Attach it to the email. If the client fixes the page and you re-run, you get
a **second** URL; the first still says what it said, and the two link to each other rather than
one quietly overwriting the other.
