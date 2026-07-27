# CP0 — the deploy gate failed, and what the failure was

v3.1's brief made shipping the `feat/v3-0-bridge` branch conditional on
independently re-verifying two claims. One held. One did not, and the way it did not
is the more useful finding.

---

## Claim 2 — CONFIRMED

> Both CP5 false positives reproduce at the pre-change commit.

Verified by running `experiments/v3-0/cp5_fp_probe.ts` inside a worktree checked out at
**`8cb39a5`, the commit currently serving production**, rather than at a branch commit:

```
DELIV-001  "Shipping times vary depending on your proximity to our Los Angeles origin zip code: 90038."
           pass_evidenced          ← the ZIP code satisfies requireDigit
           not_proven              ← same sentence, digits removed
WEIGHT-001 "…(just shy of 1/4 cup) for 4 ounces water and 4 ounces ice…"
           pass_evidenced          ← a brewing recipe read as the bag's mass
           pass_evidenced          ← "For 4 ounces water and 4 ounces ice." isolated
```

Both are **live in production today**. They are discovered, not introduced, and holding
the branch to avoid shipping them would have kept a fix out while changing nothing about
the defects.

---

## Claim 1 — REFUTED

> All 53 attacker sentences produce identical verdicts pre- and post-change:
> `regressions 0  closed 0  residual 35  pre-existing 18`.

Re-measured. **Nine of the 53 change status**, every one `pass_evidenced → not_proven`,
and every one a real care instruction:

```
Follow these care instructions: wash cold, lay flat to dry.
Care instructions are printed on the tag: rinse in cool water and dry immediately.
Follow these care instructions: rinse in cool water and dry immediately.
Per the care instructions, sanitize the board with diluted vinegar weekly.
Care instructions provided by our workshop: polish monthly with the cloth you got.
Care instructions are printed on the underside: wash at 30°C.
Our care instructions are void of jargon — rinse, dry, done.
Care instructions: condition the leather twice a year.
Follow these care instructions: rinse in cold water, then lay flat to dry.
```

### The mechanism

`statesCareInstruction` tested `CARE_REFERENCE` against the **whole sentence** and
returned false on a match. But the overwhelmingly common way a merchant writes a care
instruction is `<pointer frame>: <the instruction>` — the frame is a true statement about
where the instructions also live, and says nothing about the clause that follows it. Eight
of the nine are that shape. The ninth is `condition`, deliberately excluded from
`CARE_DIRECTIVE` on the argument that `conditions apply` is ordinary terms copy; the
argument was right about the noun and wrong about the transitive verb.

### Why the original measurement said zero

The v3.0 harness swapped one file (`src/server/productTest.ts`) into the working tree and
ran a probe before and after. That mechanism is sound — reproduced here, it recovers the
pre-change answers exactly. The published numbers are nonetheless not reproducible:
`residual 35 / pre-existing 18` is precisely what you get when the "pre" probe returns the
**post** answers, since the nine changed rows are non-passing after the change and would
be counted as unchanged-and-not-passing. Whatever caused the swap not to take on that run,
the result was an instrument returning the flattering answer — the same failure class
`src/measure/completion.ts` was written for, one layer up.

### How this run was made harder to fool

- **Full worktrees, not a file swap.** `git worktree add` at `ce462f4` (pre-guard),
  `b8a1fff` (the guard alone) and `8cb39a5` (production). Every module comes from that
  commit, so a swap that silently fails to apply is not a possible failure mode.
- **Three trees, two of which must agree.** `ce462f4` vs `b8a1fff` isolates the guard
  commit; `ce462f4` vs branch tip confirms no later commit masks it. Both report 9.
- **A liveness canary in the probe.** Two sentences with known-different answers. If they
  collapse, the diff exits `INCOMPLETE` rather than reporting zero differences.
- **Quote equality, not just status.** A pass with a different quote is a different answer
  to the merchant.

---

## The fix

`CARE_REFERENCE` is now scoped to its own clause: the sentence counts when **some clause
carries a care action and is not itself a pointer**.

`CARE_CLAUSE_SPLIT` is deliberately NOT `CLAUSE_BOUNDARY` from `testEvidence.ts`. That
splitter is already documented in CLAUDE.md as serving two incompatible jobs for negation
scope; a third would make all three harder to change. This one answers a narrower question
and therefore splits *more* aggressively — including on a bare comma and a dash — which
makes the guard more permissive, the direction it is documented to fail in.

`condition` is admitted only as a transitive verb (`condition the …`), which
`warranty conditions apply` cannot reach. Both directions are pinned by corpus cases.

## What the fix measures

| measurement | result |
|---|---|
| 53 attacker sentences, `ce462f4` vs fixed | **0 status changes, 0 quote changes** |
| the guard's own class (17 hand-built must-pass / must-fail) | **17/17** |
| the v2.9 false positive it was built to close | **still closed** |
| 172 captured real stores vs the v3.0 branch tip | **0 rows changed** |
| 172 captured real stores vs the pre-guard v2.9 baseline | **1 row changed** — exactly the target false positive (679 → 678 passing rows) |
| `EXPECTED_OPEN_GAPS` | 31 → 31 |

The 172-store delta is the honest headline: **the nine deleted true statements do not
occur in the general sample at all.** The guard was measured as "1 row changed, zero
collateral" and that was accurate about those 172 stores and silent about the class. It is
the v3.0 sample-shape lesson again, from the other direction — a broad sample cannot see a
defect whose trigger it does not happen to contain, in either direction.

## Reproduce

```
git worktree add .ab-pre b8a1fff^
cp experiments/v3-1/ab_probe_tpl.ts ./_ab_probe.ts
cp experiments/v3-1/ab_probe_tpl.ts .ab-pre/_ab_probe.ts
node --import tsx .ab-pre/_ab_probe.ts experiments/v3-0/.ab_sentences.json > experiments/v3-1/ab_pre.json
node --import tsx ./_ab_probe.ts        experiments/v3-0/.ab_sentences.json > experiments/v3-1/ab_post.json
node experiments/v3-1/ab_diff.mjs experiments/v3-1/ab_pre.json experiments/v3-1/ab_post.json
node --import tsx experiments/v3-1/care_scope_probe.ts
```
