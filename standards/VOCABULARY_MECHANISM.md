# THE CLAIM MECHANISM, AS IT ACTUALLY IS

What a `claim` requirement does today, derived from source and **confirmed by executing the real
engine** rather than by reading it. Every table below was produced by running
`src/server/testEvidence.ts` and `src/server/productTest.ts#evaluate` against the sentences shown.

This document exists because the vocabulary format specified in [`VOCABULARY.md`](VOCABULARY.md) has
to make three historical failures *unrepresentable*, and you cannot make a failure unrepresentable
until you know which line of code produced it. Two of the three turned out not to be what the brief
said they were.

Line references are to `989b33d`. **⚠️ A concurrent session is editing `src/` right now.** Everything
here was measured against the working tree as of this session's start; the measurements are
reproducible from `standards/__tests__/vocabulary.engine.test.ts`, which re-executes them.

---

## 0. Corrections to the brief and to G-06

Six consecutive briefs in this project have contained errors that only checking caught. This one
contains five. They are recorded first because three of them change the design.

| # | stated | actual |
|---|---|---|
| 1 | *"pinned at `96ceacd`"* | `HEAD` is **`989b33d`** — the prior standards session committed the assertion grammar and the coffee standard on top of `96ceacd`. Nothing was lost; the pin is simply one commit stale, and `ENGINE_GAPS.md`'s own "line references are to commit `96ceacd`" header is likewise stale. |
| 2 | *"`gluten_free` — the violating term `contains gluten` is a substring of the supporting term `contains gluten-free`"* | **There is no supporting term `contains gluten-free`.** `CLAIM_TERMS.gluten_free.support` is `["gluten-free", "gluten free", "no gluten"]` (`:58`). The real geometry is not term-inside-term at all: it is *two term lists matching overlapping spans of the same **sentence***. `"Contains gluten-free rolled oats"` matches violating `contains gluten` at `[0,15)` and supporting `gluten-free` at `[9,20)`. The distinction matters because a rule phrased as "no violating term may be a substring of a supporting term" **would not have caught this pair** — neither term contains the other. |
| 3 | *"`organic` matched inside `inorganic` because `wholeWord` was not set"* | **Fixed, and fixed before this session.** The claim branch passes `{ wholeWord: true }` explicitly (`:1113`), and the comment there records the v2.5 fix. Measured: `"Made with inorganic pigments."` → `not_proven`. This is a *historical* failure, not a live one — but the design rule survives for a different reason, given in §7. |
| 4 | *"CP3 … unblocking `ALS-COFFEE-1.0-DECAF-001` and `-DECAF-003`"*, and G-06's *"`-DECAF-003` (`chemical-free` is explicitly insufficient)"* | **Wrong entry.** `-DECAF-003` is *residual caffeine* (`operator: matches_format`, blocked by **G-03 and G-06**); the `chemical-free` entry is **`-DECAF-002`**. A vocabulary does not unblock `-DECAF-003` at all — that needs the format/quantity work in G-03. The brief inherited the error from G-06, which has it too. |
| 5 | *"Close it and most of the 32 blocked coffee entries become candidates"* | The coffee standard has **16 `blocked`** entries, not 32. (42 entries: 10 executable, 16 blocked, 11 advisory, 5 not_discriminating.) Of the 16, G-06 is named on **6**. "32" appears to be `42 − 10 executable`, which counts advisory and not_discriminating entries as blocked; those are deliberately not executable and a vocabulary does not change them. |

**And the largest correction, which is mine rather than the brief's:** a claim vocabulary answers
*"is a term present?"*. `-DECAF-001`'s operator is `equals_one_of` — *which member is stated* — which
is **G-03**, a different gap. So this session's vocabulary makes a **narrower** assertion executable
than `-DECAF-001` asks. That is stated plainly in [`VOCABULARY.md`](VOCABULARY.md) §7 and in the
vocabulary artifact itself rather than being quietly glossed as "unblocked".

---

## 1. What `CLAIM_TERMS` is

```ts
interface ClaimTerms { support: string[]; violating: string[] }
const CLAIM_TERMS: Record<string, ClaimTerms> = { … }   // src/server/productTest.ts:47
```

Thirteen keys, no `export`. A parallel `CLAIM_LABEL` map (`:62`) supplies a display string and is
**not** consulted by `evaluate` — a new key works without it, because the requirement carries its own
`label`. `CLAIM_TERMS` has exactly one reader in the repo: the `claim` branch of `evaluate`.

`standards/compile.ts:77` keeps a **hand-copied mirror** of the key list, with a comment saying it can
drift and that the containment is `executable.test.ts` rather than the copy. That mirror is the thing
a registry replaces.

### An unknown key throws — measured

```
evaluate(p, { kind: "claim", claim: "decaf_method_named", … })
  → TypeError: Cannot read properties of undefined (reading 'violating')
```

`const fx = CLAIM_TERMS[req.claim!]!` (`:1087`) is a non-null assertion over a possibly-absent key.
The exception is not caught in `evaluate`. **Consequence for the registry: a vocabulary that fails to
resolve must be caught before `evaluate` is entered, and must produce a loud, named error — never an
empty conformance result.** `compileStandard` already refuses unknown keys for this exact reason, and
that behaviour is the model.

### ⚠️ And that crash is already reachable from the engine's own code, with no standard involved

Found by an independent mechanism pass and **confirmed here by execution**, not by reading:

`contractFromPublicResult` (`src/server/buyerTests.ts:139-154`) rebuilds a pinned contract from a
*rendered* public result, which stores assertion **labels** rather than `Requirement` objects. It
recognises price, option, stock, subscription and delivery labels by regex and **falls through to
`claim` for everything else**, inventing a key with `claimKeyFromLabel`. The three shipped
`attribute` rows are among the commonest rows there are, and none of them matches a regex:

| rendered label | reconstructed as | `evaluate` |
|---|---|---|
| `Materials are stated` | `claim`, key `materials_are_stated` | **TypeError** |
| `Measurements are stated` | `claim`, key `measurements_are_stated` | **TypeError** |
| `Care or use instructions are stated` | `claim`, key `care_or_use_instructions_are_stated` | **TypeError** |
| `Organic` | `claim`, key `organic` | `pass_evidenced` |

`runAuthenticatedTest` evaluates with a bare `requirements.map((r) => evaluate(snapshot, r))`
(`src/server/authenticatedTest.ts:207`) — **no try/catch** — so the exception propagates out of the
run. A merchant who imports a public buyer test whose table contained a materials or measurements row
has pinned a contract that throws when re-run.

**This is not this session's to fix**, and it changes how G-06 should be read: the closed dictionary
is not only a *blocking* gap for new claims, it is a **live availability defect** on the engine's own
import path. Two independent causes, both of which the registry work touches: `contractFromPublicResult`
discards the requirement *kind*, and the lookup fails hard instead of failing closed.

---

## 2. The `claim` branch, in order

```
p.evidence
  → filter: lintStrings([e.text]).ok            (:1092)   ← evidence the linter would refuse is DROPPED
  → if violating.length: findViolation(quotable, violating, support)     (:1105)
        hit ⇒ not_proven, detail "Your public copy states the opposite of this requirement."
  → findSupport(quotable, support, { wholeWord: true })                  (:1113)
        hit ⇒ pass_evidenced, detail "Stated in your {surface}."
  → not_proven, "Checked {surfaces} — no statement an AI buyer could verify."
```

Three properties of this ordering are load-bearing for a vocabulary and none is obvious:

1. **Violation is checked first and wins outright.** There is no weighing. One violating match
   anywhere in the evidence discards every supporting match in the whole product.
2. **`findViolation` is called with no options.** Its own default is `opts.wholeWord !== false`, so
   the effective value is **`true`** — the same as support. (It does *not* inherit the explicit
   `{ wholeWord: true }`; it arrives at the same value independently.)
3. **Neither call passes `allowContainerSubject` or `allowLogisticsSubject`.** A claim row therefore
   gets the strictest aboutness reading available. For coffee this is mostly right and occasionally
   costly — see §5.

The status vocabulary has **no "contradicted" state**. A violation returns `not_proven` with a
*detail string* that says the opposite was stated, and quotes the sentence. So a false violation does
not merely lose a pass — it prints an accusation next to the merchant's own compliant sentence.

---

## 3. Matching: `normalize`, `termMatches`, longest-match-first

`normalize` (`testEvidence.ts:67`) lowercases, folds Unicode dashes `‐-―` to `-`, folds curly
apostrophes, collapses whitespace, trims. **It does not strip anything else.** Measured:

| input | normalized |
|---|---|
| `Swiss Water® Process` | `swiss water® process` |
| `Swiss Water™ Process` | `swiss water™ process` |
| `Swiss Water(R) Process` | `swiss water(r) process` |
| `Swiss‑Water` (U+2011) | `swiss-water` |
| `CO₂ process` | `co₂ process` |

`termMatches` bounds a match by testing whether the neighbouring character matches `/[a-z]/i`
(`:262`). **Only ASCII letters block a match.** Digits, hyphens, dots, slashes, `®`, `™`, `(`, and
every non-Latin character are all treated as boundaries. Measured:

| term | haystack | result |
|---|---|---|
| `co2` | `co2-processed beans` | match |
| `co2` | `co2s` | **no match** (`s` is a letter) |
| `co2` | `eco2 blend` | **no match** |
| `e.a.` | `decaffeinated via the e.a. process` | match |
| `ea` | `sugarcane ea decaf` | match |
| `ea` | `great tea and coffee` | no match |
| `swiss water` | `swisswater` | no match |
| `swp` | `swpdecaf` | no match |

Matches are sorted **longest first**, tie-broken by position (`:272`). `findSupport` then takes the
first match that clears aboutness — so a shorter term *can* win if the longer one is vetoed.

Two consequences of "only ASCII letters block", both measured:

| term | haystack | result |
|---|---|---|
| `organic` | `organic's`, `organic-grown`, `organic3`, `organic®`, **`organicé`** | **match** |
| `organic` | `inorganic` | no match |

A **non-ASCII letter does not block a match** — the predicate has no `/u` flag — so a term can fire
inside an accented word. And a zero-width space or soft hyphen **inside** a word silently destroys a
match, because matching is `indexOf` over the normalised string and `normalize` folds neither:

| haystack | `organic` matches? |
|---|---|
| `certified organic beans.` | yes |
| `certified or­ganic beans.` (soft hyphen) | **NO** |
| `certified or​ganic beans.` (zero-width space) | **NO** |

Shopify's rich-text editor emits both. This is not fixable from a vocabulary and belongs in every
artifact's declared limits.

### ⚠️ `findSupport`'s `wholeWord` default is FALSE

```ts
const matches = termMatches(n, terms, opts.wholeWord === true);   // findSupport, :292
const wholeWord = opts.wholeWord !== false;                        // findViolation, :336
```

The two functions default in **opposite directions**, and the one that produces a **pass** defaults
to raw substring matching. Measured: `findSupport(ev("Made with inorganic mineral pigments."),
["organic"])` returns `organic`; with `{ wholeWord: true }` it returns `null`.

The claim branch is safe because it passes the flag explicitly. **Any new code path that forwards a
registered vocabulary to `findSupport` without setting it silently reinstates the exact
`organic`/`inorganic` defect G-06 cites as history.** That is a requirement on the registry, recorded
in G-06.

### And the same omission is a live false pass in a shipped requirement

`findTimingSupport` (`:381-386`) calls `findSupport` **without** `wholeWord`, so the `delivery` row
matches its timing terms as raw substrings. Measured against the real function:

| sentence | matched term |
|---|---|
| `Ships internationally to 40 countries.` | **`ships in`** |

`ships in` is a substring of `ships internationally`, and `requireDigit` is satisfied by the
unrelated `40`. A store that ships internationally and publishes **no delivery window** is reported
as having stated one. Not a vocabulary problem and **not this session's to fix** — recorded in
`ENGINE_GAPS.md` G-08 alongside the other `delivery` defect.

### ⚠️ The trademark symbol defeats a multi-word term. This is the single most consequential mechanic for a decaf vocabulary.

A registered mark is exactly what a licensed roaster writes, so the failure is **inverted against the
truth: the more carefully a store attributes the process, the more likely it fails.** Measured, with
only the term `swiss water process` in the list:

| sentence | result |
|---|---|
| `Decaffeinated with the Swiss Water Process.` | PASS |
| `Decaffeinated with the SWISS WATER PROCESS.` | PASS |
| `Decaffeinated with the Swiss Water® Process.` | **not_proven** |
| `Decaffeinated with the Swiss Water™ Process.` | **not_proven** |
| `Decaffeinated with the Swiss Water (R) Process.` | **not_proven** |
| `Decaffeinated with the Swiss-Water Process.` | **not_proven** |

Adding the bare short term `swiss water` rescues all four — and immediately false-passes on ordinary
English:

| sentence | with `swiss water` / `mountain water` added |
|---|---|
| `Swiss water is the softest water in Europe.` | **PASS** |
| `Mountain water from the Sierra Madre.` | **PASS** |
| `Bottled in the Swiss Alps with mountain water.` | **PASS** |

Neither option is acceptable, and the tension is not resolvable by choosing more carefully between
them. The format's answer is in [`VOCABULARY.md`](VOCABULARY.md) §4: **enumerated orthographic
variants per term, forced by a validation rule that every positive example must be matched by some
supporting term.** The engine-side answer — fold `®`/`™` in `normalize` — is a one-line change that
would improve every existing vocabulary at once, and it is recorded as a proposal in
[`ENGINE_GAPS.md`](ENGINE_GAPS.md) G-06 rather than made here.

---

## 4. `findViolation`'s overlap rule, and the four geometries

```ts
if (support.some((s) => v.index < s.end && s.index < v.end && s.end > v.end)) continue;
```
`testEvidence.ts:354`. The violation is discarded only when a supporting match overlaps it **and ends
strictly beyond it**. The four possible geometries:

| geometry | example | discarded? |
|---|---|---|
| violating strictly inside support, support ends later | `contains gluten` inside `Contains gluten-free rolled oats` | **yes** — correct |
| **suffix-aligned** (same end) | `added fragrance` in `no added fragrance`; `tested on animals` in `not tested on animals`; `solvents` in `free of solvents` | **NO** — `s.end > v.end` is false |
| prefix-aligned (same start), support shorter | — | no |
| support strictly inside violating | `vegan` inside `non-vegan` | **no** — deliberate, and the comment at `:348` records why |

**The suffix-aligned case is the whole problem.** It is not rescued by the overlap rule; it is
rescued — *if at all* — by the negation guard, which only fires when the extra prefix happens to be
in a **closed list of negators** (`NEGATOR`, `:106`). Measured membership of the prefixes a
free-from vocabulary would actually use:

| prefix | is a listed negator? |
|---|---|
| `no`, `not`, `never`, `without`, `zero`, `minus`, `devoid of`, `excludes` | **yes** |
| **`free of`**, **`free from`**, **`sans`**, **`non`**, **`absent of`** | **NO** |

### The consequence, executed

A plausible vocabulary — supporting `free of solvents`, violating `solvents` — produces this:

```
"Free of solvents."                  -> states the opposite (term=solvents)
"This decaf is free of solvents."    -> states the opposite (term=solvents)
"Our process is free from solvents." -> states the opposite (term=solvents)
"Made without solvents."             -> PASS
"No solvents are used."              -> PASS
```

**A store stating the claim is told its own copy states the opposite, with that sentence quoted as
the proof.** This is the `gluten_free` damage class, live, reachable today, and reachable by a
vocabulary that looks entirely reasonable. It is the single strongest argument for structural
validation, and it is the reason [`VOCABULARY.md`](VOCABULARY.md)'s rule V1 is phrased over
*substrings in both directions with a negator exemption* rather than as the brief's flat ban (§7).

### The same defect is live in a shipped built-in vocabulary

`cruelty_free` has violating `tested on animals` suffix-aligned inside supporting
`not tested on animals`. Run through the **real `evaluate`**:

| sentence | real `evaluate` status | detail |
|---|---|---|
| `This product is not tested on animals.` | `pass_evidenced` | correct |
| `Tested on animals: never.` | `not_proven` | **"Your public copy states the opposite of this requirement."**, quoting `"Tested on animals: never."` |
| `Never tested on animals.` | `not_proven` | no support term matches — a false *fail* |

`:` is a `CLAUSE_BOUNDARY` (`:122`), so the trailing `never` cannot reach back to negate. A
spec-block row reading `Tested on animals: Never` is ordinary merchant formatting.

`fragrance_free` has the same geometry (`added fragrance` in `no added fragrance`) and is rescued,
because `no` *is* a listed negator — but `"Zero added fragrance in this bar."` still returns
`not_proven`, because `zero` suppresses the violation without any supporting term matching.

**Neither of these is this session's to fix** — they are in `src/`. They are recorded here, and in
G-06, as measured evidence that hand-written term lists fail in this specific geometry even under
careful review, which is the premise the whole vocabulary format is built on.

---

## 5. What a claim row inherits whether it wants to or not

`findSupport` → `passesAboutness` (`:189`) applies, in order: negation (`isNegated`), three
whole-sentence `CONTEXT_VETO` regexes, the subject reading (`nonProductSubject`, `subject.ts`), and
`MODIFIED_SUBJECT`.

> **`MODIFIED_SUBJECT` is an ADJACENCY test, not a window** — a correction to how it is usually
> described, including in the brief for this session. The 24 is only the length of the slice taken
> after the term; the regex is `^`-anchored with `\W{0,3}`, so at most **three non-word characters**
> may separate the term from the container noun. One intervening *word* defeats it entirely. So
> `"aluminum-free packaging"` is caught and `"aluminum-free outer packaging"` is not.

Measured against ordinary specialty-coffee copy, with supporting terms
`["swiss water process", "swiss water decaf"]`:

| sentence | result | cause |
|---|---|---|
| `Swiss Water Process beans, ground to order.` | PASS | — |
| `Our Swiss Water Process decaf is packed in a resealable bag.` | PASS | the token after the term is `decaf`, so the adjacency test cannot reach `bag` — and bare `bag` is deliberately absent from the container list anyway |
| `Swiss Water Process decaf, delivered every 2 weeks.` | **not_proven** | `CONTEXT_VETO` subscription-widget: `/deliver(y\|ed)? every/` |
| `Pairs well with our Swiss Water Process decaf.` | **not_proven** | `CONTEXT_VETO` related-product: `pairs? (well )?with` |
| `One reviewer said our Swiss Water Process decaf is the best.` | not_proven | review veto — correct |
| `We do not offer a Swiss Water Process decaf.` | not_proven | negation — correct |
| `Also available in decaf, which uses the Swiss Water Process.` | not_proven | related-product veto — defensible |
| `Most cheap decafs are made with methylene chloride.` | not_proven | no supporting term |

The first two vetoed rows are **false fails caused by category-typical copy**: coffee is sold on
subscription and cross-sold constantly, and a merchant who states the process *in the same sentence*
as a delivery cadence loses the pass. A vocabulary cannot switch these off, and should not pretend
it can — it belongs in the artifact's declared limits.

**What a claim row does *not* get:** `SUBJECT_BEFORE_VETO` (`productTest.ts:325`) is applied only
inside `findAttributeSupport`, never in the claim branch. So the packaging-subject-in-front shape
— `"Our packaging is decaffeinated…"` is nonsense, but `"Our gift boxes use Swiss Water Process
decaf."` is not — reaches a claim row with only `nonProductSubject` between it and a pass.

---

## 6. Surfaces, quotes, and sentence splitting

The public path builds evidence from **six** surfaces, in this array order
(`productTest.ts:771-778`): `product_description`, `structured_data`, `product_faq`,
**`product_title`**, **`product_options`**, `meta_description`.

`findSupport` returns the **first supporting sentence in array order**. There is no surface priority
and no way for a requirement to restrict which surfaces it will accept. Measured:

| probe | result |
|---|---|
| `single_origin`, evidence = title `"Single Origin Colombia Huila 12oz"` only | **`pass_evidenced`**, quoting the title |
| `single_origin`, evidence = variant options `"Single Origin Whole Bean"` only | **`pass_evidenced`**, quoting the option |
| `organic`, evidence = title `"Organic Decaf"` only | **`pass_evidenced`**, **no quote at all** — detail reads "Stated in your product title." |

**Both `product_title` and `product_options` are merchant-controlled strings**, and
`SCHEMA.md` §2 already names that class as insufficient evidence (class 6). So `accepted_evidence`
in a published standard — `-DECAF-001` accepts only `product_description` and `structured_data` — is
**documentation that nothing enforces**, exactly parallel to the `applicability` finding in G-10.
The last row is the worst of the three: a pass, on a merchant-chosen two-word title, with no quote,
because `presentableQuote` requires ≥3 words (`:226`) and a match with a null quote still passes
(`:1117`).

**Sentence splitting** breaks after any `.` `!` `?` followed by whitespace, and on newlines
(`:71`). Measured on decaf-typical copy:

| text | fragments |
|---|---|
| `Decaffeinated via the E.A. process. Roasted weekly.` | `["Decaffeinated via the E.A.", "process.", "Roasted weekly."]` |
| `Swiss Water® Process. 12 oz bag.` | `["Swiss Water® Process.", "12 oz bag."]` |

So **any term containing `. ` is structurally unmatchable in prose** — `e.a. process` can never fire,
though `e.a.` alone can, because the split leaves it at the end of a fragment. The format forbids
such terms outright rather than shipping a term that silently never matches (rule V6).

**`lintStrings` drops evidence before matching.** Measured: `"Freshness guaranteed: decaffeinated
with the Swiss Water Process."` is dropped (the `guarantee` rule), so the sentence that states the
process is invisible to the matcher. Freshness-guarantee language is ordinary coffee copy. This is
the pre-filter working as designed — it protects the whole report — but it is a false-fail channel a
coffee vocabulary must declare.

---

## 7. What this forces the vocabulary format to do

Each of these is a rule in [`VOCABULARY.md`](VOCABULARY.md), traced to the mechanic above rather
than to a preference.

| mechanic | rule it forces |
|---|---|
| suffix-aligned violation not rescued by the overlap rule; `free of`/`free from`/`sans`/`non` are not negators (§4) | **V1** — no violating term may be a substring of a supporting term unless the extra prefix is a **listed** negator, verified by executing `isNegated`, not by inspection. The brief's flat both-directions ban would also forbid `vegan`/`non-vegan`, which is deliberate shipped behaviour. |
| `wholeWord: true` is hardcoded at the call site (§2) | **V2** — whole-word is not merely the default, it is **the only setting the engine can express**. A vocabulary may not request otherwise; the field exists to record that, and a `false` value is a validation error today rather than a justification prompt. |
| `no added fragrance` is rescued only by a closed negator list (§4) | **V3** — a supporting term containing a negator is permitted (they are the commonest honest phrasings) but must be *executed* against `isNegated` in a minimal frame and must not self-negate. Behavioural, not lexical. |
| the whole of §4 | **V4** — the insufficient set is mandatory, non-empty, and **executed**: every entry must fail. |
| the ® measurement (§3) | **V5** — every supporting term needs a positive example, **and every positive example must be matched by some supporting term**. The second half is what catches the trademark-symbol hole. |
| `. ` splits a sentence (§6) | **V6** — no term may contain `. `, and no term may be empty or whitespace-only. |
| unknown key throws (§1) | the registry must resolve at compile time and fail loudly; `evaluate` must never be reached with an unresolvable key. |
| title/options are quotable and merchant-controlled (§6) | the vocabulary must declare `accepted_surfaces`, and G-06 must ask the engine to **enforce** it — today it cannot. |
| context vetoes, linter pre-filter (§5, §6) | the artifact carries a `limits` block naming the false-fail channels, rather than claiming immunity. |

---

## 8. Two findings that change what G-06 should ask for

Both from independent mechanism passes, both re-verified against source here.

### 8.1 Option (a) is not implementable as G-06 describes it

G-06 offers *"export the dictionaries and accept a `claimVocabulary` override in `RunOptions`"* as the
small-and-dangerous option. **`RunOptions` cannot reach the matcher.** `evaluate(p, req)` is a
two-argument pure function with no dependency channel, and it is called from two modules that do not
share a `RunOptions` value — the public path (`productTest.ts`) and `runAuthenticatedTest`
(`authenticatedTest.ts:207`), whose signature has no `RunOptions` at all.

So (a) is not "the cheap one". Delivering a vocabulary to `evaluate` requires either a third
parameter on a pure function called from two places, or a module-level mutable registry — and a
module-level mutable registry with per-request contents is a cross-tenant leak waiting to happen in a
multi-shop server. **The argument for (b) is therefore stronger than G-06 makes it: (b) is not the
slower correct option, it is closer to the only one that does not require making `evaluate` impure or
stateful.**

### 8.2 Half the registration work already exists — in the semantic tier

`judgeClaims` (`src/server/semanticTier.ts:109`) takes `attributes: Array<{ key, label }>` as an
**argument**, builds its allow-list from that argument (`const known = new Set(attributes.map(a => a.key))`),
interpolates the key and label into the prompt, and **never consults `CLAIM_TERMS`**. The semantic
tier is already vocabulary-agnostic.

Only the **lexical** half is closed. That materially changes the shape of the ask: the registry does
not need to invent a way to describe a claim to the whole engine, only to hand the lexical matcher
the two term lists the semantic tier already accepts as data.

⚠️ With the standing caveat this project has recorded twice: `judgeClaims` returns empty with no API
key, so **anything routed through the semantic tier cannot be measured by the offline acceptance
gate** — and a fix the gate cannot measure is not a fix. The vocabulary format is deliberately
lexical-only for that reason.
