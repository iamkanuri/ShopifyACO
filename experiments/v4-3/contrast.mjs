// §1b — THE CONTRAST PASS, COMPUTED.
//
// Every token×surface pair in actual use, recomputed for the light theme, against the
// WCAG 2.1 4.5:1 floor for small text. Where a supplied hex cannot clear it, this script
// searches the SAME HUE for the nearest lightness that does — so an adjustment is a
// measured minimum rather than a taste call, and the report can state it.
//
//   node experiments/v4-3/contrast.mjs
//
// Two-sided canary: a pair known to pass and a pair known to fail are computed first.
// A contrast checker that returns the same verdict for everything is the flattering-
// direction instrument this repo keeps recording.

const hex = (h) => {
  const s = h.replace("#", "");
  const n = s.length === 3 ? s.split("").map((c) => c + c) : [s.slice(0, 2), s.slice(2, 4), s.slice(4, 6)];
  return n.map((c) => parseInt(c, 16));
};
const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = (h) => { const [r, g, b] = hex(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// ---- hsl round-trip, so an adjustment keeps the hue the palette specified ----
function toHsl(h) {
  const [r, g, b] = hex(h).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let hu = 0;
  if (d !== 0) {
    if (max === r) hu = 60 * (((g - b) / d) % 6);
    else if (max === g) hu = 60 * ((b - r) / d + 2);
    else hu = 60 * ((r - g) / d + 4);
  }
  return { h: (hu + 360) % 360, s, l };
}
function fromHsl({ h, s, l }) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

/** Darken at constant hue+saturation until every surface clears `floor`. */
function darkenUntil(start, surfaces, floor) {
  const { h, s } = toHsl(start);
  for (let l = toHsl(start).l; l >= 0; l -= 0.002) {
    const cand = fromHsl({ h, s, l });
    if (surfaces.every(([, bg]) => ratio(cand, bg) >= floor)) return cand;
  }
  return null;
}

// ---------------------------------------------------------------------------
// THE SUPPLIED PALETTE (§1b)
// ---------------------------------------------------------------------------
const SUPPLIED = {
  navy: "#24273A",   // primary text, nav, primary CTA background (white text)
  slate: "#5B6F92",  // links, evidence chrome, secondary emphasis
  pale: "#C7D1DA",   // borders, quiet containers, alternating bands
  crimson: "#BF3A4F", // failure / not-proven ONLY
  sand: "#CEB78E",   // requires-store-access + selective highlights
};

// The page field, the card, and the recessed tier. Warm off-white per §1b.
const BG = "#F7F5F1";        // the page
const SURFACE = "#FFFFFF";   // a card
const SURFACE_2 = "#EFEDE8"; // recessed / alternating band
const BAND = "#E9EDF1";      // the pale blue-gray section band

const SURFACES = [["--bg", BG], ["--surface", SURFACE], ["--surface-2", SURFACE_2], ["band", BAND]];

console.log("=".repeat(90));
console.log("TWO-SIDED CANARY — a checker that says the same thing about everything is broken");
console.log("=".repeat(90));
const canaryPass = ratio("#000000", "#FFFFFF");
const canaryFail = ratio("#EEEEEE", "#FFFFFF");
console.log(`  black on white  = ${canaryPass.toFixed(2)}:1   expect >= 20   ${canaryPass >= 20 ? "OK" : "BROKEN"}`);
console.log(`  #EEE  on white  = ${canaryFail.toFixed(2)}:1   expect <  1.2  ${canaryFail < 1.2 ? "OK" : "BROKEN"}`);
if (!(canaryPass >= 20 && canaryFail < 1.2)) { console.log("CANARY COLLAPSED — refusing to report"); process.exit(1); }

console.log("\n" + "=".repeat(90));
console.log("SUPPLIED HEXES, AS GIVEN, ON EVERY SURFACE IN USE (floor 4.5:1 small text)");
console.log("=".repeat(90));
const rows = [];
for (const [name, c] of Object.entries(SUPPLIED)) {
  for (const [sn, bg] of SURFACES) {
    const r = ratio(c, bg);
    rows.push({ token: name, hex: c, surface: sn, bg, r });
  }
}
for (const row of rows) {
  console.log(`  ${row.token.padEnd(9)} ${row.hex}  on ${row.surface.padEnd(11)} ${row.bg}  ${row.r.toFixed(2)}:1  ${row.r >= 4.5 ? "PASS" : "FAIL"}`);
}

console.log("\n" + "=".repeat(90));
console.log("ADJUSTMENTS — nearest lightness at the SAME hue that clears 4.5:1 everywhere");
console.log("=".repeat(90));
for (const [name, c] of Object.entries(SUPPLIED)) {
  if (name === "pale") continue; // a border, not text — judged against 3:1 non-text below
  const worst = Math.min(...SURFACES.map(([, bg]) => ratio(c, bg)));
  if (worst >= 4.5) { console.log(`  ${name.padEnd(9)} ${c}  worst ${worst.toFixed(2)}:1 — NO ADJUSTMENT NEEDED`); continue; }
  const fixed = darkenUntil(c, SURFACES, 4.5);
  const h0 = toHsl(c), h1 = toHsl(fixed);
  console.log(`  ${name.padEnd(9)} ${c} → ${fixed}   worst ${worst.toFixed(2)}:1 → ${Math.min(...SURFACES.map(([, bg]) => ratio(fixed, bg))).toFixed(2)}:1`);
  console.log(`            hue ${h0.h.toFixed(1)}° → ${h1.h.toFixed(1)}°   L ${(h0.l * 100).toFixed(1)}% → ${(h1.l * 100).toFixed(1)}%`);
}

console.log("\n" + "=".repeat(90));
console.log("NON-TEXT (borders, hairlines) — WCAG 1.4.11 floor is 3:1, and a hairline is decorative");
console.log("=".repeat(90));
for (const [sn, bg] of SURFACES) {
  console.log(`  pale ${SUPPLIED.pale} on ${sn.padEnd(11)} ${ratio(SUPPLIED.pale, bg).toFixed(2)}:1`);
}

console.log("\n" + "=".repeat(90));
console.log("CTA — navy background with off-white text (the §1b deviation: sand keeps its state meaning)");
console.log("=".repeat(90));
console.log(`  ${BG} text on ${SUPPLIED.navy} button = ${ratio(BG, SUPPLIED.navy).toFixed(2)}:1`);
console.log(`  #FFFFFF text on ${SUPPLIED.navy} button = ${ratio("#FFFFFF", SUPPLIED.navy).toFixed(2)}:1`);
