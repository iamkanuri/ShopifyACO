# v3.3 — MAKING THE PUBLIC SURFACES TELL THE TRUTH ABOUT THE PRODUCT

*Session record. Base: `main` at `24dedf0`, confirmed equal to `origin/main` and to the
commit `https://lens.thirdocular.com/healthz` reported before any work started.*

---

## 0. The one-paragraph version

The proof surface showed a product we do not sell, and the page whose job is to prove the
product delivers returned **zero characters** of text to a reader without JavaScript.
`/demo` is now a real Coffee Standard result on a real coffee product page — Klatch
Coffee's Ethiopia Yirgacheffe Supernatural — replayed from a capture committed to this
repository, with every requirement's untruncated evidence and the surface it was read
from. Coffee Standard **v1.1** was issued because v1.0's posture had gone false about
itself in three ways, all understating the work; v1.0 is byte-frozen and still served.
The standard is navigable. **No matcher file was touched**, proved by diff. Along the way
four defects nobody was looking for: the site's primary share image had been clipping its
own description mid-word and advertising the retired product in an image no vocabulary
sweep can read; the same read-the-wrong-shape bug appeared **three times** in one session;
and the brief's own CP-D premise was stale.

---

## 1. What shipped

| | where | state |
|---|---|---|
| CP-A | `/demo`, `src/server/buyerTestDemo.ts`, `fixtures/buyer-test/` | real result, JS-off 0 → 11,700 chars |
| CP-B | `standards/coffee/v1.1/`, grammar 1.1 | issued, hash `f8ec2780…` |
| CP-C | `src/server/standardsSite.ts`, `viewer/src/theme.css` | ToC, 42 anchors, fonts, type ramp |
| CP-D | `ThirdOcular/`, `GET /api/brand.json` | two-way content gate, verified end-to-end |
| CP-E | `AGENTS.md`, `DEPLOY.md` | pointer + 3 release blocks + 4 false facts corrected |
| CP-F | `src/server/publicSsr.ts` | landing pre-render 569 → 7,921 chars |
| CP-G | the bound page | identifier worked example, from captured bytes |

---

## 2. Five corrections to the brief

**1. CP-D's premise was stale — thirdocular.com had already been fixed.** The brief quotes
a product block reading *"001 AisleLens · Live — Who AI recommends instead of you, and how
to fix it"* and a meta description about being *"recommended, ranked, and discovered"*, and
says it was fetched live today. Fetched live at the start of this session, the page carries
the conformance-testing copy, shipped in `eefac78`. None of the quoted text is present.

What WAS wrong is smaller and better: **the two sites differed by three characters** —
`pass` where this site says `proven`, plus two curly apostrophes where the constant has
ASCII. So CP-D became the durable half of what it asked for: one shared string, served at
`/api/brand.json`, with a build gate in the other repo that refuses to deploy on a
mismatch and refuses to pass a check it could not perform.

**2. "The only two carrying information" is wrong — there are four.** The brief says eight
of ten entries are above band, "so they separate nobody from anybody", and that
`WEIGHT-001` (49.0%) and `DELIV-001` (45.0%) are the only two carrying information. Those
are different questions and the answers differ:

```
bands HELD               1/10   the PREDICTION was right
above predicted band     8/10   discriminates LESS than predicted
carries information      4/10   MEASURED rate inside the grammar's own 15-85% band
```

`FORMAT-001` measured 73.7% against a predicted 30-60% and `GRIND-001` 84.8% against
55-85% — above their bands, and both squarely inside the band where an answer
discriminates. "Above its predicted band" does not mean "carries no information". All
three numbers are now published separately and derived
(`experiments/v3-3/check_v11.mjs`).

**3. The verdict enum has four values, not five.** The brief asks each row to show
"`pass_evidenced` / `not_proven` / `violating` / `requires_store_access` / `unsupported`".
`AssertionStatus` is `pass_evidenced | pass_no_blocking | not_proven |
requires_store_access` (`productTest.ts:1565`). `violating` is a detection concept, not a
row status. The page publishes a legend of the states its result actually produced.

**4. The landing page is not "the title and nothing else".** A no-JS fetch returned **569
characters** of body text — the full hero — identical across eight user agents including
GPTBot, ChatGPT-User, PerplexityBot and Googlebot. The server does not vary by UA; the
discarding happened extractor-side. **The genuinely empty page was `/demo`: 0 characters.**
It is now 11,700. The landing hero was thin rather than absent, so the SSR snapshot was
widened to the whole argument: **569 → 7,921**.

**5. Measurements go inside a version born with them.** The brief says "`fitness.json` and
`applicability.json` stay sidecars. Same reason as before." The reason is not "measurements
live outside the document" — it is that a measurement taken AFTER a version is published
must not change that version's bytes, because a citation resolves through its hash. v1.0's
came after v1.0 shipped, so it is a sidecar. **v1.1's came before v1.1 existed**, so it
lives in the document, covered by the hash and unable to drift from it. Same rule, opposite
outcome. `applicability.json` stays a sidecar because it encodes an executable reading of
prose the document does not assert.

---

## 3. The defect that appeared three times in one session

`s.fitness` is v1.0's sidecar. v1.1 carries its measurement inside the document. Reading
the field directly is correct for one shape and silently wrong for the other, and it
produced three different wrong pages before `fitnessOf()` normalised them:

| where | what it produced | how it was caught |
|---|---|---|
| `defectClasses` renderer | four table rows reading **"undefined"** on the v1.0 page | the blanket `no page renders undefined` assertion |
| `boundSection` on `/demo` | *"This standard has not yet been fitness-measured"* — on the session whose point is publishing the measurement | the no-hardcoded-figure test |
| `llmsTxt` | the **superseded** version advertised as measured and the **current** one as unmeasured, to exactly the machine readers that file exists for | a new test asserting every published version's bound appears |

None threw. Each looked like a section that legitimately had nothing to show — the
`grounding.sources` defect this repo already documents, reproduced three times, one version
later, by the same reflex. The blanket assertions earned their keep; the specific pairs are
now pinned.

---

## 4. Four defects nobody was looking for

**The site's primary share image was broken in two ways at once.**
`/og/default.png` — the image that travels every link to this site — rendered
"ChatGPT · Gemini · Perplexity" beneath a header reading "PUBLISHED BUYING STANDARDS". The
card contradicted itself and advertised the retired product. **v3.2 audited this site for
retired vocabulary and passed**, because every one of those checks reads source strings,
and no absence sweep over source can see a phrase rasterised into a PNG.

It was also clipping. The wrapper split text at the midpoint and truncated only line 2;
line 1 was emitted verbatim, never measured. Measured with resvg's own shaping, the card's
right edge was **1378.6 on a 1200px canvas** — the description ran off mid-word
("…written as exe") in every unfurl. `test/ogCards.test.ts` never imported
`buildDefaultCardSvg` at all, and every assertion in it is `svg.includes(…)` on the SVG
source: a `<text>` element that runs to x=1489 contains the same characters as one that
fits. There is now a `getBBox()` width gate on all five variants.

⚠️ **The first version of that gate was itself broken, and its canary caught it.**
`new Resvg(svg, { font: { loadSystemFonts: false } })` with no `fontFiles` loads no font,
so every glyph shapes to zero width and the bbox collapses to the background rect —
exactly 1200. It would have reported "nothing overflows" for every card ever built. The
two-sided canary failed, which is the only reason it was found.

**The published standard pages never loaded the site's fonts.** The fonts come from a
`<link>` in `viewer/index.html`; there is no `@import` or `@font-face` in `theme.css`. The
standalone shell copied the stylesheet href and nothing else, so `--font-display` fell all
the way through to `-apple-system`. A missing webfont degrades to a system font rather than
to an error — the typography was being tuned against a face that was never on the page.

**`PUBLIC_BRAND_NAME`'s fallback was `"AI Visibility"`** — the retired product's name,
carrying a permanently banned word, in the `<title>`. Production sets the variable, so
every vocabulary sweep passed; they lint `copy.ts`, not a default that only appears when
the variable is missing. A default is a value that ships.

**`/methodology` carried the same one-word drift CP-D exists to fix.** Its own summary said
a requirement is reported as "**pass**, not proven, or requires store access" — on our
site, while gating the other one on `proven`.

---

## 5. CP-A — the Example test

`klatchcoffee.com`, chosen by a mechanical gate over all 100 v3.2-audited coffee products:
every passing row adjudicated `true_pass` (no confirmed, no borderline), all 10 executable
entries asked, undegraded, zero replay misses. `build_fixture.mjs` **aborts** if that stops
being true, so the fixture cannot quietly become one of the ten known defects.

```
5 proven · 5 not proven          10 of 10 entries asked, 0 excluded
contract  c1s-9c7e475b            standard hash f8ec2780…
capture   2026-07-27, 5 responses, 141 kB gzipped, round-trip identical
```

Design decisions worth keeping:

- **It runs the engine, it does not serve a stored answer.** A stored answer drifts: change
  the matcher and the published page keeps showing yesterday's verdict while claiming to be
  what the product does today. The cost is that a matcher change now silently moves a public
  claim about a real business — so `test/buyerTestDemo.test.ts` pins all ten rows. If it
  fails, someone decides whether the new answer is right, not just updates the number.
- **The capture is committed.** The page quotes this store's own sentences; a quote whose
  source a reader cannot fetch is not evidence. This is a deliberate, narrow exception to
  the repo's rule against committing fetched third-party HTML — one page, one store, the
  one the site names.
- **Untruncated evidence is recovered by running the REAL `presentableQuote`** over each
  evidence sentence and taking the one that reproduces the stored quote exactly. Exact, not
  fuzzy: a prefix match would attribute the wrong sentence, and a wrong receipt is worse
  than none. `Assertion` lives in a matcher file and was not touched.
- **The option list is keyed on the requirement KIND, not on `surfacesChecked`.** A claim
  row lists "variant options" among the surfaces it looked at, so keying on that attached
  the store's whole option list to the organic, fair-trade and single-origin rows as though
  it were their evidence — the same defect as crediting a variant value to "product copy",
  pointed the other way.
- **The delivery row names the shipping policy PAGE**, with its URL. That surface sits next
  to the v2.8 policy-chrome false positive, and precise attribution is the row's point.
- **The engine's own `surfacesChecked` does not contain `shipping policy`** for that row,
  because the policy is fetched after the list is computed. That is real output from a
  matcher file this session may not edit, so the page states the discrepancy rather than
  hiding it.

---

## 6. CP-B — Coffee Standard v1.1

Issued as a **mechanical transform** of v1.0 (`standards/coffee/issue_v1_1.ts`), not by
hand: 42 entries with a dozen nested fields each, and retyping them loses one silently.

```
v1.0 hash 334389c4…  UNCHANGED, pinned to a literal in standards/__tests__/version.test.ts
v1.1 hash f8ec2780…  agrees three ways: stored, recomputed, and served in X-Standard-Hash
42 entries carried forward, 0 withdrawn, every one naming its predecessor in `supersedes`
```

Grammar 1.1 adds `applied_by_author`, `measured_discrimination`, `supersedes` and
`measured_fitness` — every addition optional and the status enum a superset, so a
grammar-1.0 document validates unchanged and v1.0's bytes are untouched.

`applied_by_author` exists because v1.0 spent a day in a state where `draft` was false (it
had been executed against 100 real products and published at a stable URL) and `published`
would have been a lie (nobody else had touched it). **The promotion rule is written into
the document**: `published` requires a second party to have run it without us — the same
bar as `independently_applied`, so the document's own bar survives its own promotion.

Two gates the mutation proof forced, and both are improvements:

- Loosening `grammar_version` from `const` and `predicted_discrimination.measured` from
  `const: false` left `const` unproved. It is now proved on
  `standard_hash.canonicalisation`, which is the strongest place for it: the hash is only
  reproducible by a third party because the canonicalisation is fixed.
- The new numeric bounds needed `minimum`/`maximum` mutations. A fail rate over 100% or a
  denominator of zero is the shape a broken counter produces.

Two governance invariants had hard-coded facts about the world and went false the day the
world changed. `measured === false` asserted unconditionally with the message *"this
standard has never been run"*; it now asserts the **consistency** — the flag and the
evidence must agree in both directions. And `every changelog entry_id resolves` could not
see across a version boundary, which would force a reissue to rewrite its own history.

---

## 7. CP-E — three false facts in a document about a false fact

The AGENTS.md fork carried a deploy claim that was wrong and had briefed an independent
reviewer off it. Replacing it with a pointer was the easy half. The adversarial pass found
the correction had missed **three more live instances**, one of them a third variant that
put migrations at BUILD time:

```
src/start.ts:3     "railway.json runs `npm run migrate; npm start`"
DEPLOY.md:891      the same, asserted rather than quoted
DEPLOY.md:843      "Build runs `npm run build && npm run migrate`"
```

Plus `DEPLOY.md` labelling **v2.3 as "(pending)"** when it had long shipped — verified from
git ancestry, not from the label — and that stale label copied into the new release index.

**The durable fix is `test/deployFacts.test.ts`**, which reads `railway.json` and
`migrate.ts` rather than a sentence about them, and sweeps every document for the false
form while allowing it where it is quoted in order to be corrected. It has its own
two-sided canary. This fact has been wrong twice and hand-corrected twice; a hand
correction of something nobody can check gets re-broken.

---

## 8. Traps hit, all previously documented

- **A shell heredoc ate one backslash.** `\\s` reached the test file as `\s`, which a JS
  template literal resolved to a plain `s`; the pattern became `description:s*PRODUCT_…`
  and failed against a file that plainly contained the text. Same class as the `\b` that
  landed here as a literal 0x08. Files get written with an editor.
- **A bare-substring absence check found ordinary English.** Asserting that v1.0's artifact
  does not contain "Superseded" failed immediately: its own prose says *"Superseded seals
  remain in circulation"*. The property that matters is the hash, so that is what is
  asserted.
- **`npm run test:db` hangs rather than failing** when the local Supabase stack is down —
  it looks like a slow suite, not a missing dependency. Recorded in `AGENTS.md`.
- **A path argument was mangled by MSYS**: `/standards/coffee/1.1` became
  `C:/Program Files/Git/standards/coffee/1.1`. `MSYS_NO_PATHCONV=1`.

---

## 9. Deploy ordering — this one matters

**ShopifyACO must deploy before ThirdOcular.** `check-copy.mjs` is wired into
`npm run build`, and it correctly refuses to pass a check it cannot perform. Until
`/api/brand.json` is live, the next push to `thirdocular`'s `main` goes red — by design,
and in the right direction.

---

## 10. Deliberately not done

- **The `mpn` defect stays open.** It is a one-line-scoped fix and it is still a matcher
  change; those do not ship without an independent adversarial pass, which is its own
  session. It is published instead — named on the standard's page, counted in the bound,
  and shown as three real stores' bytes on the worked example.
- **`IMPLEMENTATION_STATUS.md`, `README.md`, `TODO.md` and `CLAUDE.md`'s first 37 lines**
  are stale, as the brief says. Out of scope, still stale.
- **The `AI VISIBILITY REPORT` / `AI VISIBILITY INDEX` card family** carries banned
  vocabulary in its headers. Those are the retired-but-live report and Index surfaces;
  renaming them means redesigning three cards, which `src/server/index.ts` already records
  as a follow-up. The engine-name footer is accurate on those cards and was left.
- **`thirdocular.com/og.png` is stale in PALETTE**, not in copy: `scripts/og.html` moved
  from `#06070a` to `#1b2131` without the PNG being regenerated. Already documented in that
  repo's README; not touched.
