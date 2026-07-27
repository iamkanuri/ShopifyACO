# v3.1 — MAKE THE MEASUREMENT VALID. Fitness record and exit verdict.

## 0. The one-paragraph version

Four defects live in production are closed, the standard was re-run on a sample it
actually applies to, and G-10 shipped. But the session's real output is two corrections
to things this project believed on the strength of a broken instrument. **v3.0's
attribution A/B reported zero regressions where there were nine**, and the brief was built
on that number. And **an independent adversarial pass then found 28 regressions in v3.1's
own fixes** — none of which any probe written by the author had reached. Both were caught
by the same move: execute every claim against the commit serving production and diff.
Neither was caught by reading anything.

**The exit verdict is HAND BACK, not deploy**, and §7 states exactly why and what would
change it.

---

## 1. CP0 — the deploy gate failed, and the failure was the instrument

The brief made shipping conditional on re-verifying two v3.0 claims.

**Claim 2 held.** Both CP5 false positives reproduce at `8cb39a5`, the commit serving
production. Discovered, not introduced.

**Claim 1 was refuted.** v3.0 reported *"all 53 attacker sentences produce identical
verdicts, 0 regressions, 0 status changes at all."* Re-measured from three independently
checked-out worktrees: **nine change status**, every one `pass_evidenced → not_proven`,
every one a real care instruction.

The mechanism was `CARE_REFERENCE` tested against the whole sentence, when the commonest
way to write a care instruction is `<pointer frame>: <the instruction>`. The published
counts (`residual 35 / pre-existing 18`) are exactly what you get when the "pre" probe
returns the POST answers — a swap that did not take. Sound method, unreproducible result.

**What was changed so this run is harder to fool:** full `git worktree` checkouts instead
of a file swap, three trees where two must agree, a two-sided liveness canary that forces
`INCOMPLETE` if it collapses, and quote equality rather than status alone.

Full record: [`AB_CARE.md`](AB_CARE.md).

---

## 2. What shipped

| CP | gap | outcome |
|---|---|---|
| CP0 | the `care` guard's scope | 9 deleted true statements restored; the v2.9 false positive stays closed |
| CP0 | `feat/standards-v1` | merged; both standards gates green |
| CP1 | the crash in the merchant path | closed three ways; reproduced before fixing |
| CP2a | `cruelty_free` post-term denial | closed across all 9 claim keys with a violating list |
| CP2b | `findTimingSupport` word boundaries | closed; `shipping times` / `working days` added so the boundary costs no recall |
| CP2c | `delivery` value guard | closed; the last digit-bearing requirement without one |
| CP3 | G-10 applicability gating | shipped with exclusion reporting and an INCOMPLETE state |
| CP4 | the standard on a valid sample | 43 brands; run 1's conclusions tested |

### CP1, in one paragraph, because it is the one a merchant felt

`contractFromPublicResult` rebuilt a pinned contract from RENDERED LABELS with a keyword
ladder whose last rung was an unconditional `kind: "claim"`. Four labels the public path
emits on ordinary stores missed every rung, so `"Materials are stated"` became the claim
key `materials_are_stated`, and the next line read `.violating` off `undefined` — inside a
bare `.map()`, so **one bad row destroyed every other row's verdict on the merchant's
re-run**. Fixed at three layers: reconstruction derived from the tables that GENERATE the
labels (plus `LEGACY_LABELS`, enumerated by sweeping every past revision rather than from
memory), `evaluate` made total, and per-row containment. Reproduced before fixing: all
three new tests fail at the parent commit with the exact `TypeError`.

---

## 3. The independent adversarial pass, and what it did to the fixes

5 attackers on distinct lenses, **2,249 executed probes**, **123 unique claims**, each
re-executed by a separate refuter.

**The refuter verdicts are not the finding.** They ran while the code they were attacking
was being changed, and nine of their confirmations were one defect fixed mid-run. So every
claim was re-executed mechanically against `8cb39a5` and against the branch, and diffed
(`reexec.ts` + `attribute.mjs`). That diff is the authority.

### First attribution run: 28 regressions. All mine.

| n | cause |
|---|---|
| 16 | `ABSENCE_FRAME` not anchored to the term — `free of X` reached a *different* substance later in the sentence and suppressed a genuine violation |
| 7 | `DURATION_NUMBER` required whitespace between number and unit — deleted `3-Business Days`, `10+ business days`, `(3-5) business days`, `1-2 wks.`, `3 workdays`, `3-5 *business days*`, `7 to 10 days` |
| 3 | the care guard re-tested `CARE_REFERENCE` inside the imperative clause, and had no ` and ` boundary |
| 2 | `LABEL_DENIAL` had no terminator — "Tested on animals: never **by us, always by our EU distributor**" ADMITS it |

Not one of these was reached by any probe the author wrote. The 16 in particular are the
commonest thing personal-care copy does — deny one ingredient, admit another — and the
guard that suppressed them was written the same hour.

Before that, the same pass killed the **first** version of the CP0 care fix: clause-scoping
the pointer and then accepting any `CARE_DIRECTIVE` match hands the guard a NOUN PHRASE
(*"…printed on the hangtag, and a washing symbol guide is on our site."*). The rule is now
grammatical rather than positional — a framed sentence needs an **imperative** clause, verb
first, base form.

### After the four fixes: 2 regressions, both kept, both pinned

- **A care instruction in the sentence AFTER its pointer.** Evidence is sentence-scoped by
  construction, so no formulation of this guard can see both; the v3.0 guard fails it
  identically. The guard closes 1 measured real-store false positive plus 12
  independently-confirmed pointer false passes, and costs this one shape.
- **`"Delivery information: allow 7 to 10 days…"`.** Production passes it by matching
  `delivery in` INSIDE the word `Delivery information` — the same substring accident that
  renders *"Ships internationally to 40 countries."* as a delivery window. The boundary
  cannot be added for one and not the other, and both cheap repairs are worse (a bare
  `days` term passes *"30 days to return"*).

Both are **false FAILS accepted to close false PASSES**. A missed finding is recoverable; a
false statement about a store is not.

### The rest of the 123

| bucket | n | meaning |
|---|---|---|
| CLOSED by the branch | 12 | production is wrong here and v3.1 fixes it |
| REGRESSION | 2 | above |
| RESIDUAL — wrong in **both** | 75 | already live in production; 8 lenses' worth of pre-existing gaps |
| requirement not reconstructable | 8 | **UNRESOLVED — never counted as fixed** |

The 75 residual are the honest headline of the pass: **the branch is not the problem, the
engine is**, and an attacker pointed at any of these rows finds plenty without touching
anything v3.1 wrote.

---

## 4. G-10 — applicability gating

`applicability` was three prose fields nothing executed. Running the shipped predicate over
**run 1's own snapshots** measures the cost: **16 of 25 products should never have been
asked** (13 out of category, 3 unclassifiable). Run 1 reported 11 by hand; the predicate is
stricter because it refuses what it cannot classify rather than guessing.

Two honesty properties, both tested, both from G-10's own risk note:

- **Every exclusion is reported with a reason.** A conformance list that quietly drops
  entries is worse than one that runs them all, because the reader cannot tell passing from
  not being asked.
- **Excluding everything is a loud error**, `includedCount: null` rather than `0`. Applying
  an EMPTY requirement list is INCOMPLETE too — otherwise a compile that produced nothing
  and was then "applied" looks identical to a product asked everything and passing.

Tags are excluded **structurally**: `ClassifiableProduct` has no tags field, so the module
cannot read them even when they are handed in.

The rules sit in a sidecar beside `standard.json` rather than inside it, because
`standard_hash` covers the document's bytes and a published citation resolves through it.
Encoding the executable reading of prose already there must not invalidate every citation
made against v1.0.

---

## 5. Standard run 2 → [`STANDARD_RUN_2.md`](STANDARD_RUN_2.md)

43 brands, 42 evaluated, COMPLETE, $0. **Bands HELD 2/10, and all 8 misses HIGH** — run 1's
"7 of 8 high" loses its counter-example. Three of run 1's ten verdicts were artefacts of
n=9: `WEIGHT-001` (11.1% → **48.8%**) and `DELIV-001` (MISSED low 33.3pp → **HELD**) were
about to be reclassified as carrying no information, and both are among the standard's best
entries. `organic` re-checked: **1 of 43** pages carries a readable organic claim, and it is
a practices claim rather than a certification.

---

## 6. The bound, both samples

| | general | **coffee** |
|---|---|---|
| stores | 172 | 42 |
| pass rows, all audited individually | 507 | 69 |
| confirmed false positives | **0** | **3** |
| point estimate | 0% | 4.35% |
| naive 95% upper | 0.59% | 11.23% |
| **cluster-adjusted (ICC 0.2)** | **0.83%** | **13.68%** |
| per store | 1.78% | 7.1% |

Depth on the general sample is unchanged: **median 3 findings, thin rate 7.6%**, 56 distinct
failing sets across 172 stores.

Branch versus production across 172 real stores: **exactly 2 status changes** — one false
positive closed (the care warranty sentence), one true positive gained (a `working days`
delivery window). Two additional sweeps written for the shapes this session learned —
delivery passes with no duration in the evidence, and rows told their copy "states the
opposite" — return **0 of 56** and **0 of 1304** respectively.

**Why the two bounds differ by 16×.** Same engine, same day, same audit discipline. Two of
the three coffee defects fire on vocabulary a coffee page contains and a general DTC page
does not: a brewing recipe, a caffeine dose per serving, soil described as rich in organic
matter. v2.8 said *"zero across 55 rows was a statement about sample size"*; v3.0 sharpened
it to *"sample SHAPE"*; v3.1 measures it. **The general-sample bound estimates the error
rate on copy that looks like the average of every category at once — which is copy no
individual merchant writes.** The number that matters to a coffee roaster is 13.68%.

---

## 7. Exit position — HAND BACK

The brief's deploy gate has five conditions. Two are met, three are not:

| condition | state |
|---|---|
| gated suite passes | ✅ 706 tests, 0 fail; typecheck root + standards clean; mutation proof 23/24 load-bearing, 0 skipped |
| `EXPECTED_OPEN_GAPS` did not increase | ❌ **31 → 30 → 32** |
| mechanical A/B shows no regression | ❌ **2 regressions**, both deliberate, both pinned |
| no new false positive in either audit | ❌ **2 new** in the coffee audit (serving size; `organic matter`) |
| every independent pass **completed** | ⚠️ see below |

**None of the three failures is a surprise or a defect in the work; all three are the
measurement working.** The two regressions are false FAILS traded for false PASSES and
argued at their corpus cases. The gap count rose because those trades were recorded rather
than hidden. The two new false positives are defects the general sample structurally cannot
see, found because this session built the instrument that can.

But the gate is the gate, and it says hand back. That is also the right call on the merits:
`organic matter` and the serving-size class are **live in production** and now
*characterised*, so the next session can close them with a measured guard instead of
discovering them again.

### Recommendation

1. **Ship CP1 on its own.** It is a crash in the merchant path — a merchant who imports a
   public test containing a materials, measurements, care or identifiers row has a contract
   that throws on every re-run. It contains **no matcher change**, so it is outside every
   failing condition above, and it is reproduced-before-fixed with three tests.
2. Then close the two named false positives (`NUTRIENT`/`PER_SERVING` widening for a
   serving size; an `organic matter|compounds|growth` guard on the `organic` claim term),
   re-audit the coffee sample, and ship the rest together.
3. **Do not attempt a fifth `dimensions` guard without measuring recall first.** That row
   has now cost real positives twice.

---

## 8. What this session got wrong, recorded so the next one does not inherit it

- **The first care fix was wrong** and an independent pass caught it. Splitting on a bare
  comma reopened nine pointer sentences. Positional scoping was the wrong idea; the
  distinction is grammatical.
- **The first CP2a fix was wrong** in the more dangerous direction: it suppressed 16 genuine
  violations. Written and self-verified in the same hour, and every probe the author wrote
  passed.
- **The first `mutate.mjs` refresh had two anchors that silently SKIPped**, one because a
  scripted patch wrote `\b` through a non-raw string and the file received a real BACKSPACE
  — the exact trap CLAUDE.md records, hit twice in one session. `experiments/v3-1/fix_ctl.mjs`
  now repairs it, and builds the byte with `fromCharCode` so the hygiene sweep is not
  tripped by its own tool.
- **The workflow's own cap made it non-decisive.** A CEILING of 40 refuters against 123
  claims means the pass reports INCOMPLETE by construction. The mechanical re-execution
  covers all 123 and is what the conclusions rest on, but a pass whose completion state is
  INCOMPLETE cannot be cited as a clean adversarial verdict, and this one is not.
- **An adversarial agent ran `npm install` mid-session and emptied `node_modules`.** Nothing
  was lost, but a capture had to be killed and resumed. Agents given a repo need to be told
  not to run package managers.
- **`src/` was edited while the refuters were running**, which is why their verdicts had to
  be demoted to candidates. Freeze the tree for the duration of an independent pass.
