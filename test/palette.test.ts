import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// ===========================================================================
// THE PALETTE RESERVATION.
//
// Two colours in this product are not design choices. CRIMSON means one thing —
// a requirement that could not be proven — and TAN means one thing: a
// requirement that requires store access. Everything else on the page (a
// button, a link, the logo, a heading, a hover state, an error banner, an
// invalid input, a "danger" tile, a regression bar) is neutral, because none of
// those is a failed requirement.
//
// The reason this is a TEST and not a convention: in a product whose entire
// pitch is proof, the rarest colour on the page has to be the one that means
// "not proven". That property survives exactly as long as nobody reaches for
// the red because it looked good on a delete button. Reading the CSS is the
// only way to know, and reading it once is not the same as knowing it stayed
// true — so it is asserted on every run, the same standard the adversarial
// corpus holds the matchers to.
//
// Each assertion below fails LOUDLY and explains the rule, because the failure
// is a design regression, not a typo.
// ===========================================================================

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const THEME_CSS = join(ROOT, "viewer/src/theme.css");
const VIEWER_SRC = join(ROOT, "viewer/src");
const OG_CARD = join(ROOT, "src/server/ogCard.ts");

const read = (p: string) => readFileSync(p, "utf8");
const rel = (p: string) => relative(ROOT, p).replace(/\\/g, "/");

// The reserved values, per theme (dark lifts crimson for readability on navy,
// light darkens sand for readability on the off-white field — both keep their hue).
//
// ⚠️ v4.3 re-pin. The site flipped to a light default and both reserved colours moved
// with it: crimson #C7304A → #BF3A4F (light) and sand #876022 → #826738 (light). The dark
// values are unchanged because the dark theme's surfaces did not move. Every value here
// was recomputed against the four surfaces actually in use rather than carried over —
// see experiments/v4-3/tokens.mjs and the contrast table in viewer/src/theme.css.
const CRIMSON = ["#BF3A4F", "#EC657C"];
const TAN = ["#D9B478", "#826738"];

// A rule may reach a reserved token only if EVERY comma-separated part of its
// selector names the state it belongs to.
const NOT_PROVEN_SELECTOR = /not[-_]proven|unproven/i;
const REQUIRES_ACCESS_SELECTOR = /requires[-_](store[-_])?access/i;

// ---------------------------------------------------------------------------
// a very small CSS reader: strip comments, then walk braces so that at-rule
// wrappers (@media, @keyframes) recurse instead of being read as selectors.
// ---------------------------------------------------------------------------
interface Rule { selector: string; body: string }

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function parseRules(css: string, out: Rule[] = []): Rule[] {
  let i = 0;
  let buf = "";
  while (i < css.length) {
    const ch = css[i];
    if (ch === "{") {
      let depth = 1;
      let j = i + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === "{") depth++;
        else if (css[j] === "}") depth--;
        j++;
      }
      const inner = css.slice(i + 1, j - 1);
      const selector = buf.trim();
      if (inner.includes("{")) parseRules(inner, out);
      else out.push({ selector, body: inner });
      buf = "";
      i = j;
    } else {
      buf += ch;
      i++;
    }
  }
  return out;
}

const declarations = (body: string) =>
  body
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const k = d.indexOf(":");
      return { prop: d.slice(0, k).trim(), value: d.slice(k + 1).trim() };
    })
    .filter((d) => d.prop);

/** A `:root` / `:root[data-theme=…]` / `:root:not([data-theme])` token block. */
const isTokenBlock = (selector: string) => /^:root\b/.test(selector.trim());

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkFiles(p, out);
    else out.push(p);
  }
  return out;
}

const themeRules = parseRules(stripComments(read(THEME_CSS)));

// ---------------------------------------------------------------------------
// 1. Crimson is the value of the not-proven token, and nothing else.
// ---------------------------------------------------------------------------
test("crimson is declared ONLY as the not-proven token", () => {
  const offenders: string[] = [];
  for (const rule of themeRules) {
    for (const { prop, value } of declarations(rule.body)) {
      if (!CRIMSON.some((hex) => value.toUpperCase().includes(hex))) continue;
      if (isTokenBlock(rule.selector) && prop === "--not-proven") continue;
      offenders.push(`${rule.selector} { ${prop}: ${value} }`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "Crimson may only ever be the value of --not-proven. It is the one colour on the " +
      "page that means a requirement could not be proven; spending it anywhere else " +
      "spends the signal. Use --attention (neutral) for errors, invalid input and " +
      "destructive actions, and give them the ✕ glyph instead.\nFound:\n  " +
      offenders.join("\n  "),
  );
});

test("every rule that reaches --not-proven is a not-proven selector", () => {
  const offenders: string[] = [];
  for (const rule of themeRules) {
    if (isTokenBlock(rule.selector)) continue;
    if (!/var\(\s*--not-proven/.test(rule.body)) continue;
    const parts = rule.selector.split(",").map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      if (!NOT_PROVEN_SELECTOR.test(part)) offenders.push(`${part}  ←  in "${rule.selector}"`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "A rule may reach var(--not-proven) only if its selector says so — every " +
      "comma-separated part must name not_proven / not-proven / unproven. A " +
      "selector that does not is claiming something is a failed requirement when " +
      "it isn't.\nFound:\n  " + offenders.join("\n  "),
  );
});

// ---------------------------------------------------------------------------
// 2. Crimson appears in no other source file.
// ---------------------------------------------------------------------------
test("crimson appears in NO file but theme.css — not in viewer/src, not in the OG cards", () => {
  const files = [...walkFiles(VIEWER_SRC), OG_CARD].filter((p) => p !== THEME_CSS);
  const offenders: string[] = [];
  for (const p of files) {
    let text: string;
    try { text = read(p); } catch { continue; }
    for (const hex of CRIMSON) {
      if (text.toUpperCase().includes(hex)) offenders.push(`${rel(p)} contains ${hex}`);
    }
    for (const triple of ["199, 48, 74", "199,48,74", "236, 101, 124", "236,101,124"]) {
      if (text.includes(triple)) offenders.push(`${rel(p)} contains rgb ${triple}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "Crimson is reachable ONLY through var(--not-proven), which is declared once " +
      "per theme in viewer/src/theme.css. A literal crimson anywhere else — a " +
      "component style, an inline style, an SVG share card — routes around the " +
      "reservation.\nFound:\n  " + offenders.join("\n  "),
  );
});

// ---------------------------------------------------------------------------
// 3. The same, for tan / requires store access.
// ---------------------------------------------------------------------------
test("tan is declared ONLY as the requires-store-access token", () => {
  const offenders: string[] = [];
  for (const rule of themeRules) {
    for (const { prop, value } of declarations(rule.body)) {
      if (!TAN.some((hex) => value.toUpperCase().includes(hex))) continue;
      if (isTokenBlock(rule.selector) && prop === "--requires-access") continue;
      offenders.push(`${rule.selector} { ${prop}: ${value} }`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "Tan may only ever be the value of --requires-access. It is the third state — " +
      "the honesty machinery made visible — and it means one thing: public data " +
      "cannot settle this, a connected store can. Use --advisory for caveats, " +
      "sample badges and moderate-confidence pills.\nFound:\n  " + offenders.join("\n  "),
  );
});

test("every rule that reaches --requires-access is a requires-store-access selector", () => {
  const offenders: string[] = [];
  for (const rule of themeRules) {
    if (isTokenBlock(rule.selector)) continue;
    if (!/var\(\s*--requires-access/.test(rule.body)) continue;
    for (const part of rule.selector.split(",").map((s) => s.trim()).filter(Boolean)) {
      if (!REQUIRES_ACCESS_SELECTOR.test(part)) offenders.push(`${part}  ←  in "${rule.selector}"`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "A rule may reach var(--requires-access) only if its selector names the state.\nFound:\n  " +
      offenders.join("\n  "),
  );
});

test("tan appears in NO file but theme.css", () => {
  const files = [...walkFiles(VIEWER_SRC), OG_CARD].filter((p) => p !== THEME_CSS);
  const offenders: string[] = [];
  for (const p of files) {
    let text: string;
    try { text = read(p); } catch { continue; }
    for (const hex of TAN) {
      if (text.toUpperCase().includes(hex)) offenders.push(`${rel(p)} contains ${hex}`);
    }
  }
  assert.deepEqual(offenders, [], "Tan is reachable ONLY through var(--requires-access).\nFound:\n  " + offenders.join("\n  "));
});

// ---------------------------------------------------------------------------
// 4. The reservation is about the COLOUR, not about two specific hex strings.
//    An exact-hex test cannot see `color: #d43f5a` on a delete button, which is
//    the actual regression this file exists to stop — so every colour literal
//    in the styled surface is checked against the two reserved hue bands.
// ---------------------------------------------------------------------------
function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const n = hex.length === 4
    ? hex.slice(1).split("").map((c) => parseInt(c + c, 16))
    : [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((c) => parseInt(c, 16));
  const [r, g, b] = n.map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h: (h + 360) % 360, s, l };
}

/** Crimson band (red/rose) and tan band (amber/gold), at a saturation and
 *  lightness where the colour actually reads as one of the two states. */
function reservedBand(hex: string): "crimson" | "tan" | null {
  const { h, s, l } = hexToHsl(hex);
  if (s < 0.25 || l < 0.12 || l > 0.88) return null;
  if (h >= 325 || h <= 15) return "crimson";
  if (h >= 25 && h <= 55) return "tan";
  return null;
}

test("no colour literal anywhere lands in the reserved crimson or tan band", () => {
  const files = [...walkFiles(VIEWER_SRC), OG_CARD];
  const allowed = new Set([...CRIMSON, ...TAN].map((h) => h.toUpperCase()));
  const offenders: string[] = [];
  for (const p of files) {
    let text: string;
    try { text = read(p); } catch { continue; }
    if (p === THEME_CSS) text = stripComments(text);
    for (const m of text.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) ?? []) {
      const band = reservedBand(m);
      if (!band) continue;
      if (p === THEME_CSS && allowed.has(m.toUpperCase())) continue;
      offenders.push(`${rel(p)}: ${m} sits in the reserved ${band} band`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "A colour does not escape the reservation by being a different shade of red. " +
      "The crimson band (hue ≥325° or ≤15°) belongs to a not-proven requirement " +
      "and the tan band (hue 25–55°) to requires-store-access; neither is " +
      "available for chrome, at any shade. Reach for --attention, --advisory, " +
      "--slate, --ink or --ink-2.\nFound:\n  " + offenders.join("\n  "),
  );
});

// ---------------------------------------------------------------------------
// 5. EVERY THEME DECLARES EVERY TOKEN, and there is only one theme to keep up.
//
//    THE BUG THIS REPLACES, AND WHY THE REPLACEMENT IS STRONGER. There used to be
//    two hand-maintained LIGHT blocks — `[data-theme="light"]` and a
//    `prefers-color-scheme: light` copy — and the assertion here was that their
//    declarations matched. What had actually gone wrong was narrower and worse: the
//    media copy was MISSING `--border-strong`, so system-light visitors who had never
//    touched the toggle silently lost every emphasized hairline. The old test caught
//    that only as a side effect of comparing two duplicates.
//
//    v4.3 removed the duplication rather than asserting it: light is the base `:root`
//    and dark is one explicit opt-in block, with no media query anywhere. So the
//    assertion is now the DEFECT ITSELF — a theme override that omits a token the base
//    declares falls back to the base's value, which is the wrong theme's colour, and
//    nothing throws. That is the silent-render family, in CSS.
//
//    It also refuses a SECOND override block, because the moment there are two the old
//    drift is back and this test would be comparing one of them against nothing.
// ---------------------------------------------------------------------------
test("every theme-override block declares exactly the tokens the base declares", () => {
  const base = themeRules.filter((r) => r.selector.trim() === ":root");
  assert.equal(base.length, 1, "expected exactly one base :root block (the light theme)");

  const overrides = themeRules.filter(
    (r) => isTokenBlock(r.selector) && r.selector.trim() !== ":root",
  );
  assert.equal(
    overrides.length, 1,
    "expected exactly ONE theme-override block. Two hand-maintained copies is the shape " +
      "that drifted before — the bug reached only visitors who never touched the toggle, " +
      "which is the hardest group to notice.\nFound: " +
      overrides.map((r) => r.selector.trim()).join(", "),
  );
  assert.equal(
    overrides[0]!.selector.trim(), ':root[data-theme="dark"]',
    "the one override must be the explicit dark opt-in. A `prefers-color-scheme` block " +
      "would hand a dark-OS visitor a different product from the one every screenshot, " +
      "share card and standards page is designed as — and viewer/src/theme.ts defaults " +
      "to light unconditionally, so the two would disagree.",
  );

  // Token NAMES, not values — the values are meant to differ, that is what a theme is.
  //
  // ⚠️ SCOPED TO THE TOKENS THAT CARRY COLOUR, AND MECHANICALLY RATHER THAN BY A LIST.
  // `--radius: 14px` and `--font-display: "Source Serif 4", …` are theme-INVARIANT: they
  // belong in the base exactly once, and re-declaring them in every theme is the
  // duplication this test just finished removing. A hand-kept exception list would be a
  // closed list used as the protector — the failure shape this repo has recorded four
  // times, where the miss always fails in the damaging direction. So the partition is
  // computed from the VALUE: anything carrying a hex, an rgb/rgba, a color-mix or a
  // reference to another token is theme-dependent and owes a dark declaration.
  const colourish = (v: string) =>
    /#[0-9a-fA-F]{3,8}\b/.test(v) || /\brgba?\(/.test(v) || /\bcolor-mix\(/.test(v) || /\bvar\(--/.test(v);
  const tokens = (r: Rule) =>
    declarations(r.body).filter((d) => d.prop.startsWith("--"));

  const baseColour = tokens(base[0]!).filter((d) => colourish(d.value)).map((d) => d.prop).sort();
  const baseInvariant = tokens(base[0]!).filter((d) => !colourish(d.value)).map((d) => d.prop).sort();
  const darkNames = tokens(overrides[0]!).map((d) => d.prop).sort();

  const missing = baseColour.filter((n) => !darkNames.includes(n));
  const extra = darkNames.filter((n) => !baseColour.includes(n));
  assert.deepEqual(
    { missing, extra }, { missing: [], extra: [] },
    "The dark theme must declare every COLOUR token the base does, and no others. One it " +
      "omits silently falls back to the LIGHT value — an off-white surface or a near-black " +
      "ink on the wrong theme — and nothing throws; `--border-strong` went missing exactly " +
      "that way. One it adds that the base lacks has no light counterpart at all.\n" +
      `  missing from dark: ${missing.join(", ") || "(none)"}\n` +
      `  present only in dark: ${extra.join(", ") || "(none)"}`,
  );

  // Anti-vacuity, both halves. If the colour set were empty the deepEqual above passes
  // while asserting nothing, and if the invariant set were empty the partition is not
  // actually partitioning — either way the test has quietly stopped covering the file.
  assert.ok(baseColour.length > 25, `only ${baseColour.length} colour tokens found — the base block looks truncated`);
  assert.ok(baseInvariant.length > 0, "no theme-invariant tokens found — the colourish() split is matching everything");
  assert.ok(
    baseInvariant.includes("--font-display"),
    "--font-display is being read as a colour token. It is the display typeface and belongs " +
      "in the base exactly once; if colourish() now matches it, the split is wrong.",
  );
});

// ---------------------------------------------------------------------------
// 6. Colour is never the only carrier of a state.
// ---------------------------------------------------------------------------
test("each requirement state ships a glyph, not just a colour", () => {
  const landing = read(join(VIEWER_SRC, "copy.ts"));
  for (const [state, glyph] of [["proven", "✓"], ["neutral", "–"], ["unproven", "✕"], ["requires-access", "○"]]) {
    assert.ok(
      new RegExp(`${state}"?:\\s*"${glyph}"`).test(landing),
      `RESULT_GLYPH is missing "${glyph}" for the ${state} state. The glyph carries ` +
        "half the signal so the three states survive colourblindness and a " +
        "greyscale print; a state that is colour-only is not readable by everyone.",
    );
  }
  const productTest = read(join(ROOT, "viewer/src/pages/ProductTestPage.tsx"));
  for (const glyph of ["✓", "–", "✕", "○"]) {
    assert.ok(productTest.includes(glyph), `the public result table lost the ${glyph} glyph`);
  }
});
