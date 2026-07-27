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
descriptions of copy.

> **Generation is now a script.** [`attack/`](attack/README.md) produces the sentences for these
> classes from any vocabulary artifact, deterministically and seeded, with a coverage report that
> names every term left untested in every class. Run it first; §2.1 says exactly what it does not
> do. Six of the eight classes are mechanical; two are not, and the report says which per term.
>
> ```bash
> node --import tsx standards/attack/cli.ts <vocabulary.json> --context <category>
> ```

**Eight obligatory attack classes**, one per structural hazard the mechanism has. Six were derived
from the mechanism; the last two were forced by measurement, and how they arrived is part of why
this list should be treated as open rather than complete.

1. **Satisfy the letter, mislead the buyer.** For every supporting term, write the sentence that
   matches it and leaves a shopper with a false impression. This is the entry-level attack from
   `METHOD.md` §4, applied per term. ⚠️ **Its most valuable half is not generatable** — the
   near-synonym (`chemical-free` for a named process), the generic abbreviation (`WP`), the bare
   quantity (`99.9% of the caffeine`), the geography (`decaffeinated at origin`). In every one the
   hostile string is **not the term**, so it cannot be derived from the term. That half is human
   work, and it is the half that fills `insufficient_evidence`.
2. **The adjacent vocabulary.** Find a *different* domain that uses the same words about the same
   product. Coffee produced the canonical instance: `Process: Washed` names the post-harvest
   treatment, and a decaffeination check keyed on `process` reads a drying method as a solvent
   disclosure. ⚠️ **Also not generatable.** The script emits *fragment probes* — each term's
   maximal proper prefix and suffix, which reaches the `water process` inside `Sparkling Water
   Process` shape — and it *replays* whatever domain collisions a human has written into
   `attack/contexts/{category}.json`. With that file empty it produces none, and says so.
3. **The wrong subject.** Put each term on packaging, on the shipment, on a bundled item, on a
   competitor, in a review quote, in industry-generic copy, in a comparative, and **on a sibling
   product** (`"Our Ethiopian decaf uses…"`). The sibling case was under-weighted in the first
   version of this list and the decaf review showed it is unclosable by any term list.
4. **The merchant-controlled string.** Put each term in a **product title** and a **variant option
   value** — and on the four other surfaces a claim reaches that nobody probed before the decaf
   review's refuting pass.

   > ⚠️ **Two corrections, both measured by execution rather than reasoned about.**
   > **The surface count is NINE, not six.** `QuotableSurface` defines nine, and the claim branch
   > filters `p.evidence` on the claim linter alone and restricts **no** surface — so
   > `shipping_policy`, `product_metafield` and `seo_description` all accept a match.
   > **`product_type` is NOT an evidence surface.** An earlier version of this list told attackers
   > to place a term in the product type. `productType` is read only for category inference and is
   > never folded into the evidence index, so that probe can never fire — and an attacker following
   > the instruction records a pass that means nothing. Both are pinned bidirectionally in
   > `__tests__/attack.test.ts`: if the engine ever indexes `product_type`, that test fails and this
   > paragraph must be corrected back.
5. **The orthography attack.** Write every term as a store that is being *careful* would write it —
   with `®`, with `™`, hyphenated, pluralised, possessive, in a spec block, in a sentence that a
   period splits. A term that only matches the casual spelling fails exactly the sellers most likely
   to be telling the truth. **Fully mechanical**, and the position of a symbol is decisive: a
   trailing `®` is harmless because word bounding blocks only on ASCII letters, while an internal
   one defeats a multi-word term outright.
6. **The violation attack.** For every violating term, write the sentence in which a **compliant**
   store trips it. This is the class that produces the unrecoverable error, and it is the one an
   author is least likely to attempt against their own list. **Mechanical, including the step a
   human had to invent**: violating terms are required to be *framed*
   ([`VOCABULARY.md`](VOCABULARY.md) §3.2), and a compliant store writes the **bare substance**, so
   the generator strips the frame by rule to reach `"Our decaf is free of methylene chloride."`
7. **Tense and modality.** `"Until 2024 we used X"`, `"we are switching to X"`, `"we may use X"`,
   `"X is available on request"`, `"we are evaluating X"`, `"we asked our supplier about X"`.
   **Added by measurement**: the decaf review closed *zero* of these, and none of them is a subject
   problem. Nothing in the engine reads tense or modality, and the distinguishing word is never the
   matched term.
8. **The denial of a SUPPORTING term.** `"We do not offer a Swiss Water Process decaf in this
   range."`, `"Our decaf is free of methylene chloride."`, `"Methylene chloride: never."`,
   `"We avoid the Swiss Water Process altogether."`

   > **Found by measuring the generator against the corpus, not by review.** Class 6 covers the
   > denial shape for **violating** terms only. The mirror had no class here — and it is one of only
   > **two** classes the decaf review measured as genuinely closed (5/5). A class that produced
   > measured closures and had no name is a hole in the gate. Take the eight as open, not complete:
   > this one was found by taking sentences four humans actually wrote and asking which class each
   > belonged to. Two belonged to none.

Each finding resolves to exactly one `review.adversarial_findings[].outcome`:

`term_removed` · `term_narrowed` · `term_added_as_variant` · `moved_to_insufficient` ·
`limit_recorded` · `survived_unchanged`

**A `survived_unchanged` finding with no `residual_risk` should be read as an attacker who was not
trying** — the same rule `SCHEMA.md` §3 applies to entries. And a review recording *zero* findings
is rejected outright by `vocabulary.ts`.

---

## 2.1 What the script does, and what it emphatically does not

**It buys COVERAGE. It buys nothing at all for INDEPENDENCE.**

A generated attack set is still the **author's own set**. §1 separates author, attacker and refuter
because the failure mode — a term that *sounds* like it names something specific — is invisible from
inside the decision that created it, and no script changes who is inside it.

The decaf review is the proof, and it is unambiguous. Its author applied 21 narrowings and verified
them by re-running **the attackers' own sentences** — *"which felt independent and isn't, because
those are precisely the sentences the change was tuned to stop."* An independent refuter then found
a **false statement** in the committed review record: a class reported as 5/5 closed was 13/13 still
failing. Running a generator would not have caught that; it would have produced the same sentences
the author was already re-running.

| step | who does it |
|---|---|
| write the hostile copy for classes 3–8 | **the script** |
| supply class 2's adjacent domains (`attack/contexts/{category}.json`) | a human, per category |
| write class 1's near-synonym / abbreviation / quantity / geography phrasings | a human, per category |
| judge whether a generated sentence is **genuinely misleading** to a shopper | a human |
| judge whether the generated copy is copy a **merchant would actually write** | a human |
| decide `term_removed` vs `term_narrowed` vs `limit_recorded` | a human |
| **be a different person from the author** | unchanged, and not machine-checkable |

Two of those deserve emphasis because they are easy to skip once a tool exists.

**Naturalness is a gate, not a nicety.** A generated sentence no merchant would write cannot be
judged for misleadingness by anyone, so it is not an attack — it is noise that inflates a coverage
count. Every phrase builder in `attack/templates.ts` was corrected by *executing* it; reading the
template table was not enough.

**A count is not a closure.** The decaf review's finding was about *which classes* closed, not how
many sentences were written, and the same author read "21 sentences stopped" as a class being
closed when a rewrite of that class passed 13 of 13. The script reports per class for that reason,
and it names what it left out: untested term/class cells, classes that ran against nothing, and
everything the per-cell cap dropped.

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
| 6 | all **eight** attack classes in §2 were attempted, and any not attempted are recorded as `limits` | partly; see below |
| 7 | `limits` is non-empty | schema `minItems: 1` |
| 8 | `vocabulary_hash` covers the content | V12 |

**Condition 4 is not machine-checkable and never will be.** Whether the attacker is a different
party from the author is a fact about people, and a field asserting it would be doing the thing this
whole gate exists to prevent.

**Condition 6 is now HALF machine-checkable, and the halves must not be confused.** The templatizer
reports, per term and per class, whether any attack sentence was *generated* — and a restricted run
reports `incomplete` rather than a small clean number. That is a real check and it replaces a step
that used to be an assertion.

What it cannot check is whether the attempt was **serious**: whether a human read the generated
sentences, judged which are genuinely misleading, and pursued the two classes the script cannot
generate. A coverage report showing 803 sentences across 8 classes and a reviewer who read none of
them produce the same artifact. So:

> **Generated coverage is a floor, not a review.** Record in `review.attacker` what was generated
> (tool, seed, per-cell limit, and the coverage verdict) *and* what a human added on top —
> specifically for classes 1 and 2, which the script cannot produce. A review whose attacker field
> names only a tool is a review nobody performed.

---

## 4.1 The classes the tool cannot reach, stated once so they are not skipped

Measured against the corpus in `attack/corpus/decaf-review.json` and pinned exactly in
`__tests__/attack.test.ts`:

> **The generator covers the classes that are a function of the TERM. It cannot cover the classes
> that are a function of the DOMAIN.**

Six of the eight are term-functions and are mechanical. The two domain-functions are class 1's
near-miss half and class 2's collision half, and both are precisely where the highest-value findings
have historically come from — `chemical-free`, `naturally decaffeinated`, `Process: Washed`,
`carbonic natural`. **The tool makes the cheap classes free; it does not make the expensive ones
cheaper, and a review that stops when the script stops has skipped the part that mattered.**

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
