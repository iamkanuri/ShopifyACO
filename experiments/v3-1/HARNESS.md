# How to execute a probe in this repo (read before writing any code)

Working directory: `C:\Users\iamka\Documents\projects\ShopifyACO`

## Hard rules — every one of these has burned a previous session

1. **Write a SCRIPT FILE and run it.** `npx tsx -e "..."` and `python -c "..."` produce
   **no output and exit 0** in this environment's shell. A silent one-liner is
   indistinguishable from a clean sweep. Put your probe in
   `experiments/v3-1/attack/<yourid>_<name>.ts` and run:
   ```
   node --import tsx experiments/v3-1/attack/<yourid>_<name>.ts
   ```
2. **Never use bare `npx tsc`** — a previous session had `npx` fetch a bogus package and
   exit 0. Use `./node_modules/.bin/tsc`.
3. **Never edit anything under `src/` or `test/`.** You are measuring, not fixing. If
   you need to compare against another commit, use `git worktree add`, never a file swap.
4. **A probe that produced no output is INCOMPLETE, not clean.** Print a count of probes
   run, and assert it is what you expected. Zero is the most dangerous number a broken
   instrument returns, because it is also what a healthy one returns.
5. `Grep`/ripgrep respects `.gitignore`, and `experiments/` is ignored. Use `Read`, or a
   walker, if you need to sweep artefacts.

## The API you probe through

Everything below runs the **real production evaluator**. Never re-implement a matcher.

```ts
import {
  statusOf, verdictOf, mkProduct, requirementsFor,
  attr, claimReq, deliveryReq, idsReq,
} from "../../../test/support/adversarial.js";
import { evaluate } from "../../../src/server/productTest.js";
import { buildEvidence } from "../../../src/server/testEvidence.js";

// The status a single sentence of PRODUCT COPY produces:
statusOf("Machine wash cold.", attr("care"), { title: "Merino Crew", productType: "apparel" });
//   -> "pass_evidenced" | "pass_no_blocking" | "not_proven" | "requires_store_access"

// Status PLUS the rendered quote and detail. A pass with the wrong quote, or a
// "states the opposite" detail on compliant copy, is a defect that status alone
// cannot see — use this, not statusOf, whenever the damage might be in the words.
verdictOf("Tested on animals: never.", claimReq("cruelty_free"));
//   -> { status, quote, detail, surface }

// Evidence on a NON-description surface (delivery evidence usually lives here):
evaluate(
  mkProduct({
    evidence: buildEvidence([{ surface: "shipping_policy", text: SENTENCE }]),
    policyStatus: "readable",   // without this the row returns requires_store_access
  }),
  deliveryReq(),
);
```

Requirement constructors: `attr("materials"|"dimensions"|"care")`, `claimReq(key)` for any
of `aluminum_free baking_soda_free cruelty_free vegan fragrance_free paraben_free
sulfate_free single_origin organic fair_trade gluten_free third_party_tested bpa_free`,
`deliveryReq()`, `idsReq()`.

## Two traps specific to these rows

- **`care` is category-gated.** Pass `{ title: "Merino Crew", productType: "apparel" }`
  (or a cookware/leather type) or the requirement is never asked at all and every
  sentence returns the same thing for a reason that has nothing to do with your probe.
- **`delivery` needs `policyStatus: "readable"`**, and its rows are additionally passed
  through the claim linter first — a sentence containing `guarantee`, `lifetime`,
  `#1`, `best`, `rank` and similar is DROPPED before matching. If a sentence returns
  `not_proven` unexpectedly, check `lintStrings([s])` from
  `../../../src/server/claimLinter.js` before concluding anything about the matcher.

## What counts as a finding

A sentence a real merchant could plausibly write, where the engine's answer is wrong,
**with the direction stated**:

- `false_pass` — the row claims something is stated that is not. Worse.
- `false_fail` — the row says nothing is stated when the copy plainly states it.

Report the sentence **verbatim**, the requirement, the **executed** status (and quote /
detail where relevant), the honest answer, and how realistic the sentence is
(`common` | `plausible` | `contrived`). A `contrived` sentence is still worth reporting;
label it honestly rather than dressing it up.
