# v4.3 — THE LANDING PAGE, REDESIGNED

Branch `feat/v4-3-landing`, off `main` at `3a4c5cf` (`main == origin/main == /healthz`,
both probes green before starting). Three commits: `f48a897` (CP-1), `70eb86a` (CP-2),
`1edf7ba` (housekeeping).

---

## 1. WHAT AN AGENCY PRINCIPAL NOW SEES IN THE FIRST NINETY SECONDS

**Seconds 0–10.** A warm off-white page, a serif headline, no gradient and no hero
illustration. The eyebrow says who it is for — *AI COMMERCE QA FOR ECOMMERCE AGENCIES* —
and the headline says what the thing does to their client's page: *Test whether your
clients' product pages can support an AI shopping task.* Beside it, occupying as much of
the fold as the headline does, is a bordered document with a store's name on it.

**Seconds 10–30.** They read the document rather than the copy, because it is the only
thing on the page with a proper noun in it. **Klatch Coffee · Ethiopia Yirgacheffe
Supernatural**, a standard, a content hash, and *5 proven · 5 not proven*. Then five
rows, each a question a buyer would actually ask — *Can I buy this as whole beans? Can I
buy this already ground?* — with a ✓ or a ✕, and under each one a line saying how the
rest of the sample did: *73 of 99 coffee stores don't state this. This one does.* Under
that, a monospace entry id that is a link.

This is the moment the page either works or does not, and it is the reason the artifact
is real. An agency principal has read a hundred landing pages with an invented dashboard
in them. What they have not read is one where they can click the entry id, land on the
published question, and check whether the tool is telling the truth about a store they
can also open in another tab.

**Seconds 30–60.** Below the fold: *What your agency hands the client* — six numbered
deliverables, not features. A client-ready evidence audit. The exact buyer questions the
store cannot answer. **A line between what the store controls and what it does not.**
Corrections tied to the assertion that failed. A before-and-after rerun. A regression
baseline. Then five steps in one sentence each: Test · Trace · Correct · Rerun · Retain.

**Seconds 60–90.** The complete Klatch run, all ten rows, with the store's own quoted
sentences and the surfaces they were read from. Then the rerun contract: same standard,
same hash, same entry, *only the store's text changes*, with the "after" sentence marked
illustrative. Then why this is not monitoring, then how the engine is validated against
itself, and only then — as the bridge for a sceptic rather than the opening argument —
the standards library, the tier split, and *We publish what we cannot test, and why.*

They can leave at any point in that ninety seconds having learned one checkable thing.
That is the whole design.

---

## 2. BEFORE / AFTER

| | before | after |
|---|---|---|
| default theme | near-black; light was an opt-in and a system-preference copy | **light editorial**; dark is one explicit opt-in block |
| display face | Space Grotesk (geometric sans) | **Source Serif 4** (reading serif, optical-size axis) |
| hero artifact | a hand-written example card, five invented assertions, labeled as an example | **the real pinned klatchcoffee.com run** — counts, verdicts, quotes, entry ids, content hash and peer denominators all derived |
| audience | the merchant, standards-first | **the agency**, value-first, rigor sequenced after |
| sections | 6 | **10 + FAQ**, in the §3 persuasion order |
| peer benchmark on the landing page | absent | **10/10 rows**, each with its true denominator |
| JS-off body text on `/` | ~13k chars | **19,250 chars** |
| horizontal scroll | 8px sideways at every width (pre-existing) | **none at 320 / 375 / 768 / 1280** |
| pointer targets under 24px | 6 non-inline | **0** |
| `/og/default.png` | dark card, hand-typed line in the server file | light card, line imported from linted copy |

Screenshots: `experiments/v4-3/shots/` — `landing-desktop.png`, `landing-mobile.png`,
`landing-desktop-full.png`, plus `/demo`, `/standards/coffee/1.3` and `/test` under the
new tokens.

---

## 3. THE CONTRAST TABLE

Computed, not eyeballed: `experiments/v4-3/tokens.mjs`, with a two-sided canary (black on
white ≥20:1, `#EEE` on white <1.2:1) so a checker that returns one verdict for everything
is caught before anything is read. Floor 4.5:1 (WCAG 2.1, small text), measured against
every surface each token is actually used on.

| token | hex | `--bg` #F7F5F1 | `--surface` #FFF | `--surface-2` #EFEDE8 | `--band` #E9EDF1 |
|---|---|---|---|---|---|
| `--ink` primary text | `#24273A` | 13.52 | 14.72 | 12.58 | 12.51 |
| `--ink-2` secondary | `#484C6B` | 7.65 | 8.33 | 7.12 | 7.08 |
| `--ink-3` tertiary | `#64698A` | 4.91 | 5.34 | 4.57 | 4.54 |
| `--pass` ✓ / links | `#596C8E` | 4.87 | 5.30 | 4.53 | 4.51 |
| `--not-proven` ✕ | `#BF3A4F` | 4.90 | 5.34 | 4.56 | 4.54 |
| `--requires-access` ○ | `#826738` | 4.89 | 5.32 | 4.55 | 4.52 |

White on `--ink` (the primary button): **14.72:1**.
`--border` `#C7D1DA` is a decorative hairline and carries no floor.
`--border-ui` `#728BA2` is a form-control edge — WCAG 1.4.11 non-text, floor 3:1 —
measured **3.01–3.54:1**.

### The two adjustments, stated

- **slate `#5B6F92` → `#596C8E`.** As supplied it clears white (5.08) and **fails the two
  recessed tiers** — 4.34:1 on `--surface-2` and 4.32:1 on `--band`, which is the half of
  the page a reader spends longest on. Lightness 46.5% → 45.3%, hue 218.2° → 218.5°.
- **sand `#CEB78E` → `#826738`.** As supplied it is **1.65–1.95:1** — not readable at any
  text size on any surface here. Lightness 68.2% → 36.5% at hue 38°. This is the same move
  the previous light theme had already made for the same reason (`#876022` at hue 37°).

navy `#24273A` and crimson `#BF3A4F` cleared every surface **unchanged**.

---

## 4. THE DEVIATION LOG

**1. Sand is a STATE colour only — not "selective highlights".** §1b assigned it to
requires-store-access *and* to selective highlights. That is two meanings for one hue,
which is the exact collision §1b itself cited when it moved the primary CTA off sand. The
enforcement test could not have permitted both anyway: the hue-band rule rejects every
literal at 25–55°, and the selector rule rejects `var(--requires-access)` outside a
requires-access selector. Highlights come from the navy/band pair. CTAs are navy, as
directed.

**2. The concept numbering in the brief is inverted relative to the images.** §intro
describes concept 1 as "generic SaaS template" and concept 2 as "editorial seriousness";
§2 identifies concept 1 by its Counter Culture hero and concept 2 by "42 Total
Requirements". Those two identifications are the other way round from the descriptions.
It changes nothing — §3 specifies the structure explicitly and both concepts share a
persuasion order — so it was logged rather than raised. **No palette image was supplied**;
§1b's table is complete, so nothing was blocked.

**3. The Klatch run is NOT all-pass, and no borrowed failure was needed.** §2.1 allowed
for using "the real dropps.com refusal or a clearly-labeled schematic" if visual balance
wanted failing states "the all-pass Klatch run lacks". Executed: it is **5 proven / 5 not
proven**. "Every row adjudicated true-pass" is a statement about the *passes* — that none
is a false positive — not about the verdicts. The honest artifact is already mixed.

**4. `prefers-color-scheme` is gone entirely; light is unconditional.** §1a asked for a
light token layer. Keeping a dark media query would have handed a dark-OS visitor a
different product from the one every screenshot and share card is designed as. Dark
remains one click away and persists. This also removed the duplicated-block class of bug
outright rather than continuing to assert against it.

**5. `HOW_IT_WORKS` was retired, and one of its claims survives elsewhere.** Its five
paragraph-length steps are replaced by `WORKFLOW` (§3.3, one sentence each) and
`TEST_EXPLAINED` (§3.4). Its note — that questions observed across external AI systems can
seed executable tests — is **not deleted from the site**: it is the fourth FAQ answer,
stated as an input rather than as the product, which is the right altitude on a page whose
§3.7 argument is that observation and execution are different things.

**6. The `<title>` names the reader, not the mechanism.** `AisleLens — AI commerce QA for
ecommerce agencies`, byte-identical across `<title>`, `og:title` and `twitter:title`. A
search result promising "published buying standards" delivered a page whose first screen is
about what an agency hands its client. The mechanism is the meta description (unchanged,
still the standards sentence) and the header label rasterised into `/og/default.png`.

**7. The App Store link left the top nav.** §3.11 says "app login demoted to footer at
most". It is not a login, but it was a second CTA competing with the one that matters, and
a nav with two CTAs has none. It keeps its place in the landing page's pilot section, and
the merchant install path (managed install inside Shopify admin) never went through it.
`Standards` was added to the nav in its place.

**8. Header and footer rows now wrap.** Outside the stated landing-only structural scope,
but they overflow at 320px and the page ships on them. `.foot-links` is untouched by this
session and overflows on its own.

---

## 5. THREE DEFECTS FOUND, AND THE THING THEY HAVE IN COMMON

### 5.1 The published Example test was a SAMPLE, not a replay — and it produced a false pass

Two server boots, identical commit, identical frozen capture:

| boot | result |
|---|---|
| 1 | 5 proven · 5 not proven |
| 2 | **6 proven · 4 not proven** |

`judgeClaims` (`src/server/semanticTier.ts`) is gated only on an OpenAI key existing and
`PRODUCT_TEST_SEMANTIC !== "0"` — both true in production. Every fresh run of `/demo` made
a **live, sampled model call**, and its grants flip `claim` rows to `pass_evidenced`.

The sixth pass was `ALS-COFFEE-1.3-SOURCE-001` — *"Is this coffee from one place, or is it
a blend?"* — evidenced by:

> "Discover Ethiopia Yirgacheffe Supernatural; bursting with flavor notes"

A sentence that names the product and states nothing about origin. **A false pass, on the
one page whose selection gate is that every passing row was individually adjudicated.** The
verbatim-quote safety gate worked correctly — the quote really is on the page — and the
tier still granted a claim the sentence does not make, because the gate constrains the
QUOTE and not the INFERENCE.

`test/buyerTestDemo.test.ts` **already asserted the broken invariant** (`audited ===
d.counts.pass`) and was green throughout, because the suite runs without an API key so the
tier returns empty and the extra pass never appears in CI. **An assertion that cannot fire
in the environment it runs in is not a guard.**

Fixed at the call site: `runDemo`'s deps carry `semantic: { disabled: true }`. No matcher
moved, `ENGINE_VERSION` did not move. The MECHANISM is now asserted at source level too,
because the outcome assertion is unreachable offline. **The tier is still live on `/test`
and every standard run** — filed as `ENGINE_GAPS` **P-28** with the measurement and the
four things it needs before anyone changes it, deliberately not fixed here.

### 5.2 The mobile harness asked for 320px and silently got 423px

`mobile: true` in `setDeviceMetricsOverride` makes Chromium apply its own viewport-meta
handling; the layout viewport stopped tracking the requested width. Two of four rows were
the same measurement wearing different labels, and **both said PASS**. The harness now
reports the width the page actually saw and resolves `INCOMPLETE` when emulation does not
take. With that fixed, real defects appeared immediately: `.topbar-actions` 408px, `.nav`
362px, `.foot-links` 409px inside a 320px viewport.

### 5.3 The overflow check compared against the reference that hides the defect

`scrollWidth > innerWidth` — and `innerWidth` **includes** the classic vertical scrollbar,
as does the `100vw` in the full-bleed band's `margin-inline: calc(50% - 50vw)`. So the page
overflowed by exactly one scrollbar width, at **all four viewports**, and the probe
reported `VERIFIED_CLEAN` four times. A rendered **screenshot** caught it: a scrollbar is
not a number that can be measured against the wrong reference.

Then the fix itself was wrong twice:

| rule | scored while `body{clip}` shipped | scored while `html{clip}` shipped |
|---|---|---|
| `body { overflow-x: clip }` | **inert** | works |
| `html { overflow-x: clip }` | works | **inert** |
| `html, body { overflow-x: clip }` | works | works |
| band without `100vw` | works, but loses full-bleed (1092px in a 1280px viewport) | same |

Whichever one is already present, adding the *other* stops the scroll — the root's value
propagates to the viewport while the element itself reverts to `visible`, so the viewport
and the body box need clipping separately. **Only `html, body` scored 0px in both runs.**
A single A/B would have shipped a rule that does nothing. `overflow-x: clip`, not `hidden`,
because `hidden` makes the element a scroll container and silently kills `position: sticky`.

**What all three have in common:** each returned a clean, plausible number over a live
defect, and none was caught by reading. The instrument was repaired, and the repair
immediately produced findings.

---

## 6. THE RE-PIN LIST

| test | what changed | why |
|---|---|---|
| `palette` · reserved hexes | crimson `#C7304A`→`#BF3A4F`, sand `#876022`→`#826738` | both moved with the theme; recomputed, not carried over |
| `palette` · block identity | "two light blocks are identical" → "the one theme override declares every COLOUR token the base does, and there is exactly one" | the duplication is gone, so the old assertion had nothing to compare. The replacement asserts the DEFECT (a theme omitting a token silently inherits the wrong value) and refuses a second block. Partition computed from the value, not a hand-kept exception list |
| `siteCopy` · "the standard leads" | `HERO.sub` matching `/publishes versioned buying standards/` → the rigor section still opens by defining the standard, **and** both asset lines are in the linted set | the page is re-sequenced; nothing about the standard is removed, it moves down. The intent moves with it |
| `siteCopy` · version label derived | a hand-listed 3-string subset → **walks every string in the module** | two of the three lived on `HERO_TEST`, which v4.3 deleted. A test that enumerates its own inputs stops covering anything the moment one is renamed. Floor re-measured at 2 |
| `buyerTestDemo` · new | the demo pins the semantic tier off, asserted at source level | the outcome assertion is unreachable without an API key |
| `landingV43` · new (9 cases) | derived figures, peer denominators, no-artifact-no-section, script-escape, section parity, real hrefs | §2.3 |

**Probe re-pins: none required.** `experiments/v3-7/verify_prod.mjs` checks `/healthz`,
standards byte floors, hash agreement, `llms.txt`, and that the landing links the CURRENT
standard version — all still true. `experiments/v3-8/verify_sections.mjs` is entirely about
`/standards/coffee/1.3`, which the retheme touches only through tokens. Neither was
loosened.

---

## 7. LEGACY DECISIONS

| item | decision |
|---|---|
| `HOW_IT_WORKS` copy block | **retired**; claim preserved in the FAQ (deviation 5) |
| `HERO_TEST` (the invented example card) | **deleted**; replaced by the real artifact |
| App Store link in top nav | **demoted** to the landing pilot section |
| `/scan`, `/index` routes | **untouched.** v4.1 already removed them from the sitemap's static list; they still serve existing shared links |
| Footer | already linked only real routes and had **no Blog**. Unchanged; now asserted by a test that walks every component |
| Dead CSS from the old landing | **NOT deleted.** Measured unreferenced in TSX: `hero-land`, `asrt-*`, `land-section`, `hero-proof`, `steps-5`, `cat-table`, `demo-proof`, `signals-note`, `index-promo`. An exhaustive sweep has to cover server-emitted class names too, and Grep respects `.gitignore` — this repo has already recorded a sweep that reported clean over a real leak. Filed rather than risked |
| `/og/default.png` wordmark appears twice | **observed, not changed.** Pre-existing in `buildDefaultCardSvg`; §1a scopes structural redesign to the landing page |

---

## 8. MOBILE VERIFICATION AND ITS LIMITS

`experiments/v4-3/responsive.mjs`, rendering through the system Chromium over CDP.

| width | overflow | wider than viewport | targets <24px | headline | columns |
|---|---|---|---|---|---|
| 320 | none | none | none | 277×141 @32px, wraps | all 1 |
| 375 | none | none | none | 332×141 @32px, wraps | all 1 |
| 768 | none | none | none | 390×202 @46px, wraps | rail 5, surfaces 2, ba 3, compare 3 |
| 1280 | none | none | none | 453×238 @54px, wraps | hero 2, deliver 2 |

`completion: VERIFIED_CLEAN`, 4/4 widths, with the width canary confirming each emulation
took and an anti-vacuity floor (React mounted, ≥20 targets scanned) on every row.

**Limits, stated:**
- The **Browser pane cannot composite** this session — `computer{action:"screenshot"}`
  times out — and its viewport would not move off ~423px. DOM readback and
  `javascript_tool` DO work, and screenshots come from CDP instead. Everything visual in
  this report is a real render.
- One probe run against that pane reported "0 targets under 24px" while **React had never
  mounted**, so the selector matched nothing. That is why every probe here refuses to
  report unless it can prove it reached the page.
- Rendering is **Chromium only**. Safari and Firefox are not covered. The one rule with a
  known support gap is `overflow-x: clip` (Safari 16+); on an older engine the loss is an
  8px sideways scroll, which is the status quo rather than a regression.
- **Not verified: touch interaction on a real device.** Target sizes are measured
  geometry, not a thumb.

---

## 9. GATES

| gate | result |
|---|---|
| no matcher file in the diff | ✅ `src/server/productTest.ts`, `subject.ts`, `testEvidence.ts`, `semanticTier.ts` all untouched |
| `ENGINE_VERSION` tripwire silent | ✅ no engine-version test failed across 1082 |
| standard hashes frozen | ✅ no `standards/**/standard.json` in the diff; hash tests green |
| adversarial corpus / G-14 cells untouched | ✅ not in the diff |
| palette enforcement updated **and mutation-re-proved** | ✅ **10/10 guards bite**, restore byte-identical, `VERIFIED_CLEAN` |
| contrast table, adjustments stated | ✅ §3 above and in `theme.css` |
| copy in the shared module, SSR/React parity | ✅ one module, both renderers; section parity asserted by test |
| JS-off **and** JS-on on every changed route | ✅ `/` 19,250 chars JS-off; `/demo` `/standards` `/methodology` `/test` `/privacy` `/terms` `/support` all 200 |
| forbidden-strings + derived-figures extended | ✅ `landingV43.test.ts`; the copy-module walk now covers every block |
| every probe re-pin listed | ✅ §6 |
| typecheck · viewer build · full suite | ✅ clean · clean · **1082 tests, 1006 pass, 0 fail** |
| both production probes after push | ⏳ §11 |

---

## 10. WHAT I DELIBERATELY DID NOT DO

- **Did not fix the semantic tier on `/test`.** It is live on the surface a stranger
  actually pastes a URL into, and it needs a frequency read and a precision read before
  anyone touches it. `ENGINE_GAPS` P-28, with the measurement.
- **Did not delete the dead CSS.** ~150 lines, measured unreferenced in TSX, but an
  exhaustive sweep must cover server-emitted class names and cannot use a `.gitignore`-
  respecting search.
- **Did not restructure `/demo`, `/test`, `/standards` or the legal pages.** They inherit
  the tokens; §1a scopes structural redesign to the landing page.
- **Did not touch the embedded `/app`.** Out of scope entirely.
- **Did not fix the duplicated wordmark on `/og/default.png`.** Pre-existing, non-landing.
- **Did not re-measure any published bound.** No sample, no fitness artifact and no
  standard was read for anything but rendering.
- **thirdocular.com now mismatches** the new palette and positioning — filed, not fixed,
  per §1a. ⚠️ Its build gate fetches `/api/brand.json`; `PRODUCT_DESCRIPTION`,
  `PRODUCT_CAPABILITIES` and `PRODUCT_KIND` are **unchanged**, so that gate stays green.

---

## 11. PRODUCTION

Merged to `main` and deployed. Final commit **`a098708`**; `/healthz` reports it. No
migration in this release.

**Both probes, on the deployed SHA, neither loosened:**

```
experiments/v3-7/verify_prod.mjs       21/21   VERIFIED_CLEAN
experiments/v3-8/verify_sections.mjs   15/15   VERIFIED_CLEAN
```

`verify_prod`'s last check — that the landing page links only the CURRENT standard
version — was the one this release could plausibly have broken. `versions linked from /:
1.3`.

**The live landing page, verified from production rather than locally:**

| | |
|---|---|
| JS-off body text on `/` | **19,250 characters** |
| `<title>` | `AisleLens — AI commerce QA for ecommerce agencies` |
| hero artifact block | present |
| **served counts** | **`5 proven · 5 not proven`, identical across 4 requests** |
| routes | `/` `/demo` `/standards` `/standards/coffee/1.3` `/methodology` `/test` `/og/default.png` — all 200 |

The counts are the load-bearing line. **Production has an OpenAI key**, which is the exact
condition under which the semantic tier fires — so before this release the published result
was being sampled, and 5/5 holding across repeat requests is the pin working where it
matters rather than only where it was convenient to test.

The nine distinct peer denominators live on the page:

```
45 of the 74 coffee stores   49 of 100   73 of 99   74 of 76   84 of 99
89 of 100   92 of 100   92 of 99   96 of 100
```

Five different denominators, none of them a uniform "of 100" — which is the whole of §2.3's
of-100 trap, rendered rather than asserted.
