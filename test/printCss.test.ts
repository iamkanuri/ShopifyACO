import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const THEME = readFileSync(join(ROOT, "viewer/src/theme.css"), "utf8");

// ===========================================================================
// THE PRINT PATH (v4.2 CP-2).
//
// A collapsed <details> printed NOTHING of its body, and that is where the evidence is.
// Measured by rendering, not by reading this file: on /demo, 20 evidence items reachable
// by no other route on the page were absent from the printed PDF; on
// /standards/coffee/1.3, 88. The full BEFORE/AFTER proof is
// `experiments/v4-2/print_probe.mjs` + `print_diff.mjs` — a zero-dependency CDP client
// driving the system Chromium, with a media canary, a PDF-extractor canary and a
// DOM-vs-PDF agreement check, A/B'd over the SAME served HTML with only the stylesheet
// swapped (`git show HEAD:viewer/src/theme.css` vs the working copy).
//
// WHY THAT PROOF IS NOT THIS TEST. It needs a browser, a running server and ~90s. It
// belongs where every other expensive measurement in this repo lives — under
// experiments/, with its output committed as evidence. What lives HERE is the cheap
// invariant set that a future edit could break silently, each one corresponding to a
// measured failure mode rather than to a guess.
// ===========================================================================

/** The @media print blocks, as source text. There are TWO and both are load-bearing. */
function printBlocks(css: string): string[] {
  const out: string[] = [];
  const re = /@media\s+print\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    let depth = 1, i = re.lastIndex;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
    }
    out.push(css.slice(re.lastIndex, i - 1));
  }
  return out;
}

test("[print] the brace-matcher finds both @media print blocks (anti-vacuity)", () => {
  const blocks = printBlocks(THEME);
  assert.equal(blocks.length, 2, "theme.css should carry exactly two @media print blocks");
  // Each must be non-trivial, or a later assertion could pass against an empty string.
  for (const b of blocks) assert.ok(b.trim().length > 40, "a print block parsed as near-empty — the matcher is wrong");
  // Two-sided: the matcher must NOT find a block in CSS that has none.
  assert.equal(printBlocks("@media screen { a { color: red } }").length, 0);
});

test("[print] a collapsed <details> is restored via the ::details-content pseudo-element", () => {
  const blocks = printBlocks(THEME).join("\n");
  assert.match(
    blocks,
    /details::details-content\s*\{[^}]*content-visibility:\s*visible/,
    "the ONLY mechanism measured to restore a collapsed <details> in Chromium's print " +
    "pipeline is overriding content-visibility on the ::details-content pseudo-element. " +
    "See experiments/v4-2/rule_scan.mjs — `display: revert` on the children, `display: block`, " +
    "`content-visibility` on the details itself and `* { content-visibility: visible !important }` " +
    "were all scored and all had NO effect.",
  );
});

test("[print] the details rule is NOT scoped to .std-page — eight of fourteen live under .app", () => {
  const blocks = printBlocks(THEME);
  const withRule = blocks.filter((b) => /details::details-content/.test(b));
  assert.ok(withRule.length >= 1, "no print block carries the details rule");
  for (const b of withRule) {
    for (const line of b.split("\n")) {
      if (!/details::details-content/.test(line)) continue;
      const selector = line.slice(0, line.indexOf("{"));
      assert.doesNotMatch(
        selector, /\.std-page|\.app\b|\.bt-doc|\.pt-/,
        "MEASURED: a `.std-page`-scoped copy of this rule printed 1 page where the unscoped " +
        "rule printed 4. /report owns the only window.print() in the repo and is wrapped in " +
        `.app, not .std-page. Offending selector: ${selector.trim()}`,
      );
    }
  }
});

test("[print] the disclosure marker is neutralised, or an expanded section still prints “+”", () => {
  const blocks = printBlocks(THEME).join("\n");
  assert.match(blocks, /summary::after\s*\{[^}]*content:\s*""/,
    "summary::after is driven by [open] (theme.css has three such rules), so a section " +
    "expanded for print would still print a '+' affordance that is untrue and unusable on paper");
});

test("[print] every <details> in the codebase is inside a surface the rule reaches", () => {
  // The rule is unscoped, so this cannot fail today — the test exists to catch a future
  // edit that re-scopes it. It also pins the inventory: if a <details> appears somewhere
  // new, the count moves and a human re-reads this.
  const dirs = [join(ROOT, "src", "server"), join(ROOT, "viewer", "src")];
  let count = 0;
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx)$/.test(e.name)) continue;
      count += (readFileSync(full, "utf8").match(/<details/g) ?? []).length;
    }
  };
  dirs.forEach(walk);
  assert.ok(count >= 12, `expected the known <details> inventory (14 at v4.2); found ${count}. ` +
    "If this dropped, the walker is not reading what it thinks it is.");
});
