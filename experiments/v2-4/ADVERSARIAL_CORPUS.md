# v2.4 — what adversarial execution found in the evidence engine

**Date:** 2026-07-25 · **Branch:** `feat/v2-4-harden` · **Production at session start:** `cf2ce2d`
**Method:** 7 parallel agents, one per matcher surface, each writing and RUNNING probe scripts
against the real evaluator; every claimed defect then re-executed by an independent agent
instructed to refute it.

## The headline

| | |
|---|---|
| Probes executed | **959** |
| Defects claimed by the attack pass | 172 |
| **Confirmed** by independent re-execution | **145** (131 after discarding an unsound pairing, below) |
| Refuted (expectation over-reached, or documented intent) | 27 |
| Confirmed **false passes** — the unrecoverable direction | **93** |
| Guards proven load-bearing by mutation | **12 / 12** |

The v2.3 session audited 7 real stores, found zero false positives, and treated that as
evidence the matchers were sound. It was evidence about those 7 stores. **Sampling real
stores catches artefacts; only executing the matcher against deliberately chosen input
catches logic.**

## A flaw in this session's own method, and its correction

Findings were paired to verdicts by `sentence`. The verify schema did not carry `setup`, so
any matcher whose cases reuse a sentence cannot be paired. All 12 `identifiers` findings
shared the sentence `"A thing."` (the varying data is in `setup`), and 2 `dimensions` cases
collided. **158 of 172 pairings are sound; 14 were not**, and the identifier results were
discarded and re-measured directly (52 cases, executed here). The corrected confirmed count
is **131 + the independently established identifier set**.

Recorded because the same trap will recur: a schema that omits the field which distinguishes
two cases makes downstream aggregation silently wrong, and the aggregate still looks
plausible.

## Root causes, not symptom counts

Most of the 131 collapse into a small number of structural causes:

1. **Closed noun lists guarding an open class.** `SUBJECT_BEFORE_VETO` enumerates 10
   packaging nouns; 13 more (`label`, `gift box`, `hang tag`, `sleeve`, `envelope`, `tin`,
   `poly bag`, …) pass, as do the *plurals* of 7 of the 10 that are listed.
2. **Anchored windows.** `MODIFIED_SUBJECT` inspects the 24 chars right after the term, so
   one two-word adjective defeats it (`"Comes in 100% recycled kraft paper packaging."`
   passes; `"Shipped in 100% recycled packaging."` correctly fails). `SUBJECT_BEFORE_VETO`
   ends `[^.]{0,48}$`, so a relative clause launders the subject.
3. **No subject signal at all.** `"Every order is wrapped in 100% cotton muslin."` carries no
   vetoed noun. No extension of a noun list can reach it — the *verb* is the signal, and
   nothing reads it.
4. **First-match-wins over term-list order.** `findSupport` iterates terms in list order, so
   `"Orders are not delivered within 3 business days"` matches `business days` (3rd) before
   `delivered within` (10th) — a working negation guard bypassed structurally. The same
   mechanism renders a returns window as the delivery proof.
5. **Capitalisation used as a proxy for place-ness.** `statesAPlace` requires a capital, so
   Title Case marketing copy passes (`"Made in Very Small Batches."`) while ordinary
   lowercase copy fails (`"made in vermont"`). Wrong in both directions.
6. **Substring collisions.** `contains gluten` is a substring of `contains gluten-free`, and
   the violating list is checked first — so a store *stating* the claim is told it states the
   opposite. `organic` matches inside `inorganic` (claims never set `wholeWord`).
7. **Questions treated as statements.** `"Is same-day shipping available?"` is rendered as the
   proof; in the live FAQ shape the answer that denies it is never consulted.
8. **Anchored placeholder lists.** `^(n\/?a|tbd|…)$` missed every affixed form — 24 of 34
   placeholder identifier values passed as published identifiers. **Fixed this session.**

## What was fixed

Only `identifiers`, because it is self-contained and its blast radius is one row:

- `isPlaceholderIdentifier` replaces the anchored token list: separators stripped, a length
  floor, a repeated-character rule, and token+affix forms. 34 placeholder values now fail;
  4 real MPNs still pass.
- GTINs are normalised (`0-36000-29145-2`, `400 638 133 3931`) before validation — those were
  false *fails* on the separators printed on the barcode. Normalisation is done at the call
  site, **not** in `isValidGtin`, which is shared with the feed validator where the spec
  genuinely requires digits only.
- All-zero GTINs rejected: they satisfy the check-digit arithmetic and identify nothing.

**52/52 identifier cases now agree.** Nothing else was changed. The remaining 65 corpus gaps
touch `findSupport`/`passesAboutness`, which every requirement shares; changing them to fix a
false pass is exactly how a new false pass gets introduced, and that is the one unrecoverable
failure. They are pinned, not accepted — see below.

## How the debt is held

`test/adversarialCorpus.test.ts`. Each case carries `correct` (the honest answer) and, where
the engine disagrees, `actual` (a measured gap). The suite asserts `actual ?? correct`, so it
is green on today's behaviour while every defect is pinned in code, and it fails in **both**
directions — fix a gap and its case fails; regress and its case fails. `EXPECTED_OPEN_GAPS`
is asserted exactly so gaps cannot multiply quietly.

**Mutation proof** (`mutate.mjs`): each guard is disabled in turn and a specific corpus case
must fail. First run reported 4 of 12 guards as decorative — because every case written for
those guards was *already a known gap*, so removing the guard changed nothing. That is a
corpus coverage hole, not a useless guard. Adding a control case each guard currently catches
took it to **12/12 load-bearing**.

## Method notes worth keeping

- `npx tsx -e` and `python -c` emit **no output and exit 0** in this environment's PowerShell.
  A silent one-liner is indistinguishable from a clean result. Use script files.
- Ripgrep respects `.gitignore`. A repo-wide search for the send-pack renderer found nothing
  because the artefacts live under the ignored `experiments/`; a direct walker found them.
- The mutation harness must restore source on **uncaught throw**, not only in `finally`. An
  `execSync` `maxBuffer` overflow killed one run mid-loop and left the tree mutated.
