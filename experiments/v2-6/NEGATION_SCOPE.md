# v2.6 — negation scope: built, measured, reverted

**Date:** 2026-07-26 · **Branch:** `feat/v2-6-scope` · **Outcome: REVERTED, on evidence.**

## What was built

`CLAUSE_BOUNDARY` was serving two incompatible jobs — the boundaries that stop a negation leaking
onto an unrelated statement are the same ones that stop it reaching a conjunct it genuinely
governs. The replacement was real scope: a clause ends at a sentence terminator, a semicolon, a
contrastive conjunction, or a coordinator/colon whose following text has its own subject and
finite verb; a negator anywhere in a clause negates the whole clause, which also fixes the
backwards-only defect structurally.

**On the cases it was designed against, it worked**: 16/16 denials and 12/12 true statements,
both directions, and it closed 5 pinned corpus gaps (31 → 26) including the two coordination
cases and the colon case.

## Why it was reverted

The mandatory fresh adversarial pass (358 probes, 2 attackers + 2 independent verifiers)
measured it as a **net regression against the code it replaced**, and proved it the only way
that counts: by re-executing v2.5's `isNegated` verbatim from `git show HEAD~1` on every
disagreement.

| | |
|---|---|
| Confirmed defects | **55** (7 false passes, 46 false fails) |
| Denials probed | 49 → **31 false passes** |
| True statements probed | 41 → **25 false fails** |
| Of those, caused BY the rewrite | **7 false passes** v2.5 caught and v2.6 does not; **10 of 13** sampled false fails v2.5 got right |

Six mechanisms, all measured with minimal pairs (37/37 ablations of the genuine half returned
`pass_evidenced`, so no false fail is a term-recall gap misattributed to scope):

1. **Deleted coverage that was never carried across.** `POST_TERM_DENIAL` listed `unavailable`,
   `un(available|offered)`, `discontinued`, `no longer …`. The rewrite removed it on the theory
   that clause scope subsumes it — but those words were never added to `NEGATOR_G`. "Next-day
   shipping is unavailable." now passes as a stated delivery window.
2. **A dead constant documented as the live one.** `NEGATOR` is no longer referenced anywhere;
   `NEGATOR_G` is what runs, and it drops `unable to`, `aside from`, `other than`, `rather than`,
   `instead of`. The "measured, not guessed, CLOSED list" comment sits above the dead one — the
   exact misleading-comment failure v2.5 corrected, reintroduced.
3. **`FINITE_VERB` cannot tell a finite verb from a bare infinitive.** "We do not ship overnight,
   or offer delivery in 2 business days." is cut because `offer` matches, so a bare VP conjunct
   sharing the subject escapes the negation. The code does not do what its own comment specifies
   ("its OWN subject and finite verb" — there is no subject test).
4. **Sibling-denial cancellation.** The self-containment exemption covers only a negator inside
   the matched term, so two denial-shaped support terms in one clause cancel each other.
   **"No aluminum, no baking soda." loses BOTH rows** — the exact claim pair `CATEGORY_CLAIMS`
   asks every deodorant store, and deodorant is its first entry. Splitting the same text into two
   sentences passes both, so the verdict turns on punctuation alone.
5. **Boundary set too narrow** (24 cases): em dash, comma splice, `so`, `because`, parentheses are
   not boundaries; and a sentence-initial `While`/`Although` never cuts, because both patterns
   require leading whitespace.
6. **The 6-word window is a knife-edge.** "…and every pan in the collection is made from…" passes;
   "…and every pan in our flagship collection is made from…" fails. The verdict turns on subject
   length.

## The structural read

Three of these point at the same limit: **a lexicon is being asked to do constituency.**
`FINITE_VERB` is simultaneously too permissive (fires on bare infinitives) and too small (misses
`comprises`, `should <verb>`), and the window trades one against the other — widening it fixes
one finding and worsens another. There is no way to express "an adjunct like `with no X` does not
govern the clause head" in this design.

Also found, and still true after the revert: **two clause splitters with different rules run in
the same pipeline** — `subject.ts` has its own `CLAUSE_SPLIT` which treats `, so ` and a bare `:`
as boundaries, while `testEvidence.ts` did not.

## What this costs and what it buys

Reverting returns `EXPECTED_OPEN_GAPS` to 31 and re-opens 5 gaps, including the two coordination
cases the rewrite was written for. Those 5 remain genuine defects and are pinned.

It buys not shipping 7 new false passes and 46 new false fails into the one product whose entire
differentiation is that it only claims what it can prove. The corpus was green at 26 the whole
time — it simply contains none of these shapes, which is the argument for the fresh adversarial
pass being mandatory rather than a formality.

## For the next attempt

Do not extend the lexicon again. Either:
- **Parse for constituency** — identify the subject span and the predicate head properly, which
  is what every one of these six mechanisms actually needs; or
- **Keep v2.5's narrow, working guard** and attack the specific shapes it misses one at a time,
  each with its own corpus case, accepting that coordination distribution stays open.

The cheap partial fixes the pass itself suggested — restoring `unavailable`/`unable to` into the
live vocabulary, giving `;` the colon's conditional test, allowing the boundary patterns to match
at string start, and exempting a trailing `with no …` adjunct — are worth doing on top of
whichever path is chosen, but none of them addresses the constituency limit.
