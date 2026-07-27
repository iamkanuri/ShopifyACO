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
// light darkens tan for readability on ice — both are the same hue).
const CRIMSON = ["#C7304A", "#EC657C"];
const TAN = ["#D9B478", "#876022"];

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
// 5. The two light-theme blocks must stay identical.
//    The media-query copy used to be missing --border-strong, so a visitor on
//    system-light who had never touched the toggle silently lost every
//    emphasized hairline. A duplicated block that drifts is worse than a
//    duplicated block, so the duplication is now asserted rather than trusted.
// ---------------------------------------------------------------------------
test("the two light-theme token blocks declare an identical set of tokens", () => {
  const light = themeRules.filter((r) => /^:root\[data-theme="light"\]$/.test(r.selector.trim()));
  const media = themeRules.filter((r) => /^:root:not\(\[data-theme\]\)$/.test(r.selector.trim()));
  assert.equal(light.length, 1, "expected exactly one :root[data-theme=\"light\"] block");
  assert.equal(media.length, 1, "expected exactly one prefers-color-scheme:light block");

  const norm = (r: Rule) =>
    declarations(r.body).map((d) => `${d.prop}: ${d.value.replace(/\s+/g, " ")}`).sort();
  assert.deepEqual(
    norm(media[0]),
    norm(light[0]),
    "The explicit light theme and the system-light theme must declare the same " +
      "tokens with the same values. They are a hand-maintained duplicate — when " +
      "they drift, the bug only reaches visitors who never touched the toggle, " +
      "which is the hardest group to notice.",
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
