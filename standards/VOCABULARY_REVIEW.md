# THE VOCABULARY REVIEW GATE

What an adversarial pass on a *vocabulary* consists of, who may perform it, and what a vocabulary
must clear before a standard may reference it.

This is deliberately stricter than the entry-level adversarial pass in [`METHOD.md`](METHOD.md) §4,
for a measured reason: **an assertion that is too loose produces a weak finding; a term list that is
too loose produces a false statement about a real store.** The engine has three recorded instances of
the second, and one of them is still live in a shipped built-in list.

---

## 0. The gate, in one line

> A vocabulary may be referenced by a standard entry only when `validateVocabulary` returns
> **`VERIFIED_CLEAN`**, an **independent attacker** has attacked it, an **independent refuter** has
> attacked the attacker's findings, and `review.state` is not `incomplete`.

`incomplete` **blocks**. It does not read as clean, and it does not read as a small number of
defects. This is `src/measure/completion.ts`'s rule applied to review rather than to measurement, and
it is here because the identical bug has now shipped four times in this project, always in the
flattering direction.

---

## 1. Who may perform it

| role | may be | may not be |
|---|---|---|
| **author** | anyone | — |
| **attacker** | anyone who did not author the term lists | the author |
| **refuter** | anyone who is neither author nor attacker | either |

The separation is not ceremony. The author of a term list has already decided what the terms mean,
and the specific failure mode — a term that *sounds* like it names something specific — is invisible
from inside that decision. `review.attacker` and `review.refuter` are required fields precisely so
that "I reviewed it myself" is unrepresentable rather than merely discouraged.

> **A standing caution from this project's own history:** *"5 sessions running, my own probe set
> cleared a change an independent pass then killed."* An author's self-attack is evidence about the
> author, not about the vocabulary.

---

## 2. What the attack consists of

The attacker works from the vocabulary artifact and the engine mechanics in
[`VOCABULARY_MECHANISM.md`](VOCABULARY_MECHANISM.md), and must produce **verbatim store copy**, not
descriptions of copy. Six obligatory attack classes, one per structural hazard the mechanism has:

1. **Satisfy the letter, mislead the buyer.** For every supporting term, write the sentence that
   matches it and leaves a shopper with a false impression. This is the entry-level attack from
   `METHOD.md` §4, applied per term.
2. **The adjacent vocabulary.** Find a *different* domain that uses the same words about the same
   product. Coffee produced the canonical instance: `Process: Washed` names the post-harvest
   treatment, and a decaffeination check keyed on `process` reads a drying method as a solvent
   disclosure.
3. **The wrong subject.** Put each supporting term on packaging, on the shipment, on a bundled item,
   on a competitor, and inside a review quote. The engine's aboutness guards catch some of these and
   the corpus pins others open; the attacker's job is to find which.
4. **The merchant-controlled string.** Put each supporting term in a product title, a product type,
   and a variant option value. Two of the six evidence surfaces are merchant-controlled and the
   engine cannot be told to ignore them ([`VOCABULARY.md`](VOCABULARY.md) §5), so any term that
   reads naturally as a *product name* is a standing false-pass channel.
5. **The orthography attack.** Write every supporting term as a store that is being *careful* would
   write it — with `®`, with `™`, hyphenated, abbreviated, in a spec block, in a sentence that a
   period splits. A term that only matches the casual spelling fails exactly the sellers most likely
   to be telling the truth.
6. **The violation attack.** For every violating term, write the sentence in which a **compliant**
   store trips it. This is the class that produces the unrecoverable error, and it is the one an
   author is least likely to attempt against their own list.

Each finding resolves to exactly one `review.adversarial_findings[].outcome`:

`term_removed` · `term_narrowed` · `term_added_as_variant` · `moved_to_insufficient` ·
`limit_recorded` · `survived_unchanged`

**A `survived_unchanged` finding with no `residual_risk` should be read as an attacker who was not
trying** — the same rule `SCHEMA.md` §3 applies to entries. And a review recording *zero* findings
is rejected outright by `vocabulary.ts`.

---

## 3. What the refuter does

The refuter attacks **the attacker's findings**, not the vocabulary. Default to refuting anything
that cannot be independently confirmed. Three questions per finding:

1. **Does the attack sentence actually do what is claimed?** Re-execute it. The engine's history is
   full of proofs that were right and inferences from them that were wrong — the `FL`/`flounce` note
   in `productTest.ts` is the canonical one, where a correct regex differential licensed a false
   conclusion.
2. **Is the proposed fix a fix, or a narrowing that costs more than it saves?** The `origin`
   removal is the precedent: the narrowing that closed every false pass in the hand-built sets cost
   17 true statements per 0 false passes gained on naturally-occurring copy. A fix must be measured
   against realistic frequency, not against the attacker's own set.
3. **Is the grounding for each term real?** A term's grounding must establish that **stores write
   this string** — not that the phrase exists, not that the process exists. A process licensor's own
   page is authority on how a mark may be written and is **not** independent evidence that anyone
   writes it. That is why `kind` carries `process_licensor` and `search_result_snippet` as distinct
   values.

---

## 4. The gate, in full

A standard entry may bind to a vocabulary only when **all** of these hold:

| # | condition | checked by |
|---|---|---|
| 1 | `validateVocabulary` returns `VERIFIED_CLEAN` | `vocabulary.ts`, executed in the test suite |
| 2 | every insufficient example fails, and every positive example passes | V4 / V5b, executed |
| 3 | `review.state` is `verified_clean` or `defects_found_and_resolved` | `vocabulary.ts` |
| 4 | `review.attacker` ≠ author, `review.refuter` ∉ {author, attacker} | the review record; a human gate |
| 5 | at least one adversarial finding is recorded | `vocabulary.ts` |
| 6 | all six attack classes in §2 were attempted, and any not attempted are recorded as `limits` | the review record; a human gate |
| 7 | `limits` is non-empty | schema `minItems: 1` |
| 8 | `vocabulary_hash` covers the content | V12 |

Conditions 4 and 6 are **not machine-checkable** and are marked as such rather than being given a
field that would imply they were verified. A format that claimed to check them would be doing the
thing this whole gate exists to prevent.

---

## 5. Re-review triggers

A vocabulary must be re-reviewed, not merely re-validated, when any of these happen:

- **a weakening change** (`supporting_term_added`, `violating_term_removed`,
  `insufficient_probe_removed`) — by definition, the review that cleared the old form did not see
  the new one;
- **an engine change to the matching layer** — `normalize`, `termMatches`, `NEGATOR`,
  `CLAUSE_BOUNDARY`, `CONTEXT_VETO`, `nonProductSubject`, `presentableQuote`, or the claim branch's
  option set. Every one of these silently redefines what the published terms mean. The artifact
  records `matching.engine_call_site` so this is detectable rather than assumed;
- **a claim-linter change** — the linter drops evidence *before* matching, so a new rule can make a
  vocabulary stop seeing sentences it was reviewed against;
- **first contact with real stores.** Nothing in this session's gate has been run against merchant
  copy at scale. The engine's own record is unambiguous about what that is worth: v2.3 audited seven
  stores and found zero false positives, then v2.4 ran 959 deliberate probes and confirmed 131
  defects. **Sampling real stores catches artefacts; only executing the matcher against deliberately
  chosen input catches logic — and a vocabulary needs both.**
