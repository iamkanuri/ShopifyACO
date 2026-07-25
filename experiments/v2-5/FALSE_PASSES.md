# v2.5 — closing the false passes

**Date:** 2026-07-25 · **Branch:** `feat/v2-5-false-passes` · **Production at session start:** `a3505c7`
**Gate:** the adversarial corpus. **`EXPECTED_OPEN_GAPS` 65 → 31.**

## What moved

| | before | after |
|---|---|---|
| Pinned open gaps | 65 | **31** |
| — closed by CP1 (mechanical) | | 21 |
| — closed by CP2 (aboutness) | | 19 |
| — newly found and pinned | | +6 |
| Corpus cases | 112 | **121** |
| Mutation proof | 12/12 | **23/26 applied** (3 documented redundancies) |

## CP1 — the mechanical class

- **Term order.** `findSupport` iterated terms in list order, so "Orders are not delivered within 3
  business days" matched `business days` (3rd) before `delivered within` (10th) and bypassed a
  working negation guard. Replaced with `termMatches`, longest-match-first, positions reported.
- **Negation scope.** A 14-character window requiring the negator to sit immediately before the term
  missed the ordinary way merchants write a denial ("We do **not offer** next-day shipping"). Replaced
  with a clause-scoped scan. The clause bound is load-bearing in *both* directions and the boundary
  set was chosen by measuring the alternatives — unbounded turns "Our cups are not dishwasher safe,
  and they are made from stoneware." into a false fail.
- **Substring collisions.** `contains gluten` is a substring of `contains gluten-free`, and the
  violating list is checked first, so a store *stating* it is gluten-free was told its copy "states
  the opposite", quoting its own compliant sentence. Fixed by `findViolation` with an overlap rule.
  Claims are now word-bounded too (`organic` was matching inside `inorganic`).
- **Place detection.** The capitalisation heuristic was replaced with a gazetteer — see the warning below.
- **Interrogatives.** A sentence ending in `?` is no longer evidence. The FAQ answer remains reachable
  because `splitSentences` already breaks after `?`.

## CP2 — the aboutness class: Path B, and why

Path A (wire the semantic tier to aboutness) was **rejected on a measurable constraint, not taste**:

1. **The acceptance gate runs offline.** `judgeClaims` returns empty without an API key, so a semantic
   aboutness gate could not close a single corpus case, and the mutation proof could not reach it.
   A fix the gate cannot measure is not a fix.
2. It would put a network call on the critical path of every test.

The v2.4 claim that "deterministic cannot decide aboutness" was demonstrated against a *character
window and a noun list* — not against reading the subject, which had never been tried. `src/server/subject.ts`
reads the subject span and the verb frame, and closed **19 of the 25 aboutness gaps**. The semantic
tier remains the right tool for **paraphrase** (recovering true statements no term list can match),
which is what it was built for — not aboutness.

## The fresh adversarial pass — and why it changed the deploy decision

517 probes over the four changed surfaces, each claim re-executed by an independent verifier.
**41 confirmed defects, 15 of them false passes.** The fix had to be fixed:

- **`clauseBefore` is backwards-only** → "Next-day shipping is not available." passed, quoting the
  denial as its proof. The same denial as the pinned case, words reordered. Fixed.
- **The NEGATOR vocabulary was ad-hoc** → 21 of 41 ordinary denial phrasings passed. `nothing` was the
  cruellest: `not` is visibly inside it, but the word-bound rejects the substring. Fixed with the
  measured set.
- **The overlap rule backfired** → "This is a non-vegan product" had its violation discarded because
  `vegan` overlapped `non-vegan`. Fixed: a support match only cancels a violation when it *extends
  beyond* it.
- **The gazetteer was a net loss on ordinary copy** — specificity 32%, recall 63%. Dropping the capital
  requirement made every entry match in its ordinary-noun sense ("Made in china clay", "Roasted in
  jordan almonds"). Fixed by requiring a capital only for the entries that are also ordinary words.

**11 of the 15 were fixed in-session. The other 4 are pinned.** All four were then measured against
production's own code at `a3505c7` and are **byte-identical there** — they are pre-existing defects
this pass discovered, not regressions.

The honest structural result: **`CLAUSE_BOUNDARY` is serving two incompatible jobs.** The boundaries
that stop a negation leaking forward onto an unrelated statement are the same boundaries that stop it
reaching a coordinated conjunct it genuinely governs ("We do not offer weekend pickup, or overnight
shipping."). One boundary set cannot serve both. That needs scope, not another list, and it is the
next session's subject.

## Depth did not collapse

Paired on the same stores — v2.3 production result vs the v2.5 engine over each store's captured
snapshot. **n = 7**, not 15: only 7 of 21 snapshot captures succeeded during the v2.3 pass.

| | before | after |
|---|---|---|
| median genuine findings | 3 | **4** |
| median `pass_evidenced` | 3 | **3** |
| thin-result rate | 0% | **0%** |
| stores with zero `pass_evidenced` | 0 | **0** |
| distinct failing sets | — | **7 of 7** |

**All 18 `pass_evidenced` rows audited individually: 0 false positives.** The one that needed eyes —
an origin credited from a spec blob whose quote truncates at 180 chars — is genuine: the blob really
does read `Country of Origin: Japan`.

## A correction shipped in code

An in-code comment claimed the cross-term negation check was "redundant by measurement" because the
mutation proof showed removing it broke no corpus case. The adversarial pass then measured it against
ordinary copy: removing it flips 12 of 86 probes to `pass_evidenced`. The comment was true about the
corpus and false about the code, and left as-is it would have invited a later session to delete a
working guard. Corrected in place.

## Not done

- **CP4 (`storefront_host` backfill + the reconciliation test).** Not started. It is the one item that
  needs live Shopify calls and a migration, and it was not reached. Both fixtures still exist.
- **`origin` re-measurement and the narrowing decision.** The matcher is better but its measured
  specificity is still 32% on adversarial input, so its discrimination rate remains an unreliable basis
  for a narrowing decision. Re-measure after the gazetteer's head-noun problem is addressed.
