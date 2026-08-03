// §0.1 / §6 — THE PALETTE GATE, MUTATION-RE-PROVED.
//
//   node experiments/v4-3/mutate_palette.mjs
//
// A guard whose removal breaks nothing is decorative, and this repo has already paid
// for those: when the adversarial corpus first ran its mutation proof, 4 of 12 guards
// read as decorative because every case written for them was already a known gap.
//
// v4.3 rewrote two things in test/palette.test.ts — the two reserved hexes (the site
// flipped to a light default) and the block-identity assertion (the duplicated light
// blocks are gone, so it now asserts the DEFECT: a theme that omits a colour token).
// A re-pin that nobody proves still bites is a re-pin that might have been deleted.
//
// Each mutation below breaks ONE property and names the test that must fail. A mutation
// that leaves the suite green is reported as DECORATIVE — a real finding, not a pass.
//
// Every file is restored in a finally block, and the script verifies byte-identity at
// the end: a mutation harness that corrupts the tree is worse than no harness.

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const THEME = "viewer/src/theme.css";
const COPY = "viewer/src/copy.ts";
const MARK = "viewer/src/components/Mark.tsx";

const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const baseline = Object.fromEntries([THEME, COPY, MARK].map((p) => [p, readFileSync(p, "utf8")]));
const baseHash = Object.fromEntries(Object.keys(baseline).map((p) => [p, sha(p)]));

/** Run the palette suite. Returns the set of failing test names. */
function runSuite() {
  let out = "";
  try {
    out = execFileSync("node", ["--import", "tsx", "--test", "test/palette.test.ts"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 180_000,
    });
  } catch (e) {
    out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
  const failing = new Set();
  for (const m of out.matchAll(/^not ok \d+ - (.+)$/gm)) failing.add(m[1].trim());
  const ran = [...out.matchAll(/^(?:not )?ok \d+ - (.+)$/gm)].length;
  return { failing, ran, out };
}

const MUTATIONS = [
  {
    name: "crimson used as chrome (a delete button)",
    expect: "crimson is declared ONLY as the not-proven token",
    apply: () => writeFileSync(THEME, baseline[THEME] + "\n.btn-danger { color: #BF3A4F; }\n"),
  },
  {
    name: "a non-not-proven selector reaches var(--not-proven)",
    expect: "every rule that reaches --not-proven is a not-proven selector",
    apply: () => writeFileSync(THEME, baseline[THEME] + "\n.regression-bar { background: var(--not-proven); }\n"),
  },
  {
    name: "crimson literal escapes into a component",
    expect: "crimson appears in NO file but theme.css — not in viewer/src, not in the OG cards",
    apply: () => writeFileSync(MARK, baseline[MARK].replace("export function Mark", "const _leak = \"#BF3A4F\";\nexport function Mark")),
  },
  {
    name: "sand used as a decorative highlight",
    expect: "tan is declared ONLY as the requires-store-access token",
    apply: () => writeFileSync(THEME, baseline[THEME] + "\n.pull { border-left-color: #826738; }\n"),
  },
  {
    name: "a non-requires-access selector reaches var(--requires-access)",
    expect: "every rule that reaches --requires-access is a requires-store-access selector",
    apply: () => writeFileSync(THEME, baseline[THEME] + "\n.eyebrow { color: var(--requires-access); }\n"),
  },
  {
    name: "sand literal escapes into a component",
    expect: "tan appears in NO file but theme.css",
    apply: () => writeFileSync(MARK, baseline[MARK].replace("export function Mark", "const _leak = \"#826738\";\nexport function Mark")),
  },
  {
    name: "an OFF-HUE red on a destructive control (the hue-band guard)",
    expect: "no colour literal anywhere lands in the reserved crimson or tan band",
    // Deliberately NOT either reserved hex — this is the regression the exact-hex
    // assertions cannot see, and the reason the band check exists at all.
    apply: () => writeFileSync(MARK, baseline[MARK].replace("export function Mark", "const _leak = \"#D4405A\";\nexport function Mark")),
  },
  {
    name: "the dark theme drops a colour token (the --border-strong defect, replayed)",
    expect: "every theme-override block declares exactly the tokens the base declares",
    apply: () => writeFileSync(THEME, baseline[THEME].replace(
      /\n  --border-strong: rgba\(123, 155, 199, 0\.34\);/, "")),
  },
  {
    name: "a second, hand-maintained theme block reappears (prefers-color-scheme)",
    expect: "every theme-override block declares exactly the tokens the base declares",
    apply: () => writeFileSync(THEME, baseline[THEME] +
      "\n@media (prefers-color-scheme: dark) {\n  :root:not([data-theme]) { --bg: #171C29; }\n}\n"),
  },
  {
    name: "a requirement state loses its glyph (colour becomes the only carrier)",
    expect: "each requirement state ships a glyph, not just a colour",
    apply: () => writeFileSync(COPY, baseline[COPY].replace('"requires-access": "○"', '"requires-access": ""')),
  },
];

const results = [];
try {
  // ---- 0. two-sided canary: the UNMUTATED tree must be green ----
  const clean = runSuite();
  if (clean.failing.size !== 0 || clean.ran < 9) {
    console.log(`CANARY COLLAPSED — the unmutated suite is not green (${clean.ran} ran, ${clean.failing.size} failing).`);
    console.log("Every mutation below would 'fail' for a reason that has nothing to do with the mutation.");
    console.log([...clean.failing].join("\n"));
    process.exit(1);
  }
  console.log(`canary: unmutated suite green, ${clean.ran} assertions ran\n`);

  for (const m of MUTATIONS) {
    for (const [p, text] of Object.entries(baseline)) writeFileSync(p, text); // reset
    m.apply();
    const { failing } = runSuite();
    const bit = failing.has(m.expect);
    results.push({ ...m, bit, failing: [...failing] });
    console.log(`${bit ? "BITES     " : "DECORATIVE"}  ${m.name}`);
    console.log(`            expected to fail: ${m.expect}`);
    if (!bit) console.log(`            actually failed: ${[...failing].join(" | ") || "(nothing — the suite stayed green)"}`);
  }
} finally {
  for (const [p, text] of Object.entries(baseline)) writeFileSync(p, text);
}

// ---- restore verification: a harness that corrupts the tree is worse than none ----
const restored = Object.keys(baseline).every((p) => sha(p) === baseHash[p]);
console.log("\n" + "=".repeat(78));
const decorative = results.filter((r) => !r.bit);
console.log(`restore verified byte-identical: ${restored}`);
console.log(`guards proved load-bearing: ${results.length - decorative.length}/${results.length}`);
const state = !restored ? "INCOMPLETE" : decorative.length ? "DEFECTS_FOUND" : "VERIFIED_CLEAN";
console.log(`completion: ${state}`);
process.exit(state === "VERIFIED_CLEAN" ? 0 : 1);
