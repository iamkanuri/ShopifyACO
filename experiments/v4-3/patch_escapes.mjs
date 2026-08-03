// The two line-separator characters are INVISIBLE in an editor and do not survive a
// match-and-replace round trip, so this rewrites the tail of heroArtifact.ts at the byte
// level. Same reason experiments/v3-1/fix_ctl.mjs exists: every layer of `node -e` /
// heredoc quoting eats one backslash, and a script file has none to eat.
import { readFileSync, writeFileSync } from "node:fs";

const F = "src/server/heroArtifact.ts";
const src = readFileSync(F, "utf8");
const i = src.indexOf("export function heroArtifactScript");
if (i < 0) { console.log("MARKER NOT FOUND — refusing to write"); process.exit(1); }

const tail = [
  "export function heroArtifactScript(a: HeroArtifact): string {",
  "  // ⚠️ THE TWO LINE-SEPARATOR CHARACTERS ARE WRITTEN AS \\u ESCAPES, NEVER AS THEMSELVES.",
  "  // U+2028 and U+2029 are invisible in an editor and survive a copy-paste as ordinary",
  "  // whitespace, so a literal pair here is indistinguishable from a no-op replace that has",
  "  // quietly stopped escaping the one thing it exists for. Same family as the `\\b` that",
  "  // reached this repo as a literal 0x08 byte and the `\\s` a heredoc ate down to a plain",
  "  // `s`. They are legal in JSON and illegal in a JavaScript string literal, which is what",
  "  // a JSON block inside a document is parsed as by some readers.",
  "  const json = JSON.stringify(a)",
  '    .replace(/</g, "\\\\u003c")',
  '    .replace(/>/g, "\\\\u003e")',
  '    .replace(/\\u2028/g, "\\\\u2028")',
  '    .replace(/\\u2029/g, "\\\\u2029");',
  '  return `<script type="application/json" id="${HERO_ARTIFACT_SCRIPT_ID}">${json}</script>`;',
  "}",
  "",
].join("\n");

writeFileSync(F, src.slice(0, i) + tail);

// Two-sided canary: the written file must contain the ESCAPE TEXT and must NOT contain
// the raw characters anywhere in the replace calls.
const after = readFileSync(F, "utf8");
const hasEscapes = after.includes("\\\\u2028") && after.includes("\\\\u2029");
// Built from char codes: writing U+2028 literally here TERMINATES THE LINE in JavaScript
// source, which is how the first run of this very script died with "Invalid regular
// expression: missing /". The hazard demonstrating itself inside the tool written to
// guard against it is worth the two extra lines.
const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
const hasRaw = after.includes(LS) || after.includes(PS);
console.log(`escape text present : ${hasEscapes}`);
console.log(`raw char in replace : ${hasRaw}`);
console.log(hasEscapes && !hasRaw ? "completion: VERIFIED_CLEAN" : "completion: DEFECTS_FOUND");
process.exit(hasEscapes && !hasRaw ? 0 : 1);
