// §1b — THE FINAL LIGHT TOKEN SET, DERIVED AND MEASURED.
//
// Every value below is either a supplied hex that cleared its floor unchanged, or the
// nearest lightness at the SAME hue that does. Nothing is eyeballed. The table this
// prints is the table that goes in the report.
//
//   node experiments/v4-3/tokens.mjs

const hex = (h) => { const s = h.replace("#", ""); return [s.slice(0,2), s.slice(2,4), s.slice(4,6)].map((c) => parseInt(c, 16)); };
const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = (h) => { const [r, g, b] = hex(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
function toHsl(h) {
  const [r, g, b] = hex(h).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2, s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let hu = 0;
  if (d !== 0) { if (max === r) hu = 60 * (((g - b) / d) % 6); else if (max === g) hu = 60 * ((b - r) / d + 2); else hu = 60 * ((r - g) / d + 4); }
  return { h: (hu + 360) % 360, s, l };
}
function fromHsl({ h, s, l }) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c,x,0] : h < 120 ? [x,c,0] : h < 180 ? [0,c,x] : h < 240 ? [0,x,c] : h < 300 ? [x,0,c] : [c,0,x];
  const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}
function darkenUntil(start, bgs, floor) {
  const { h, s } = toHsl(start);
  for (let l = toHsl(start).l; l >= 0; l -= 0.001) {
    const cand = fromHsl({ h, s, l });
    if (bgs.every((bg) => ratio(cand, bg) >= floor)) return cand;
  }
  return null;
}

const BG = "#F7F5F1", SURFACE = "#FFFFFF", SURFACE_2 = "#EFEDE8", BAND = "#E9EDF1";
const BGS = [BG, SURFACE, SURFACE_2, BAND];
const NAVY = "#24273A";

// secondary + tertiary ink: the navy hue, lightened only as far as 4.5:1 allows.
function lightestAt(hue, sat, floor) {
  let best = null;
  for (let l = 0.05; l <= 0.95; l += 0.001) {
    const cand = fromHsl({ h: hue, s: sat, l });
    if (BGS.every((bg) => ratio(cand, bg) >= floor)) best = cand;
  }
  return best;
}
const nh = toHsl(NAVY);
const INK2 = lightestAt(nh.h, 0.20, 7.0);
const INK3 = lightestAt(nh.h, 0.16, 4.5);
const SLATE = darkenUntil("#5B6F92", BGS, 4.5);
const SAND  = darkenUntil("#CEB78E", BGS, 4.5);
const CRIMSON = "#BF3A4F";
const PALE = "#C7D1DA";
const CONTROL = darkenUntil(PALE, BGS, 3.0); // a form-control edge is a UI component: 1.4.11 → 3:1

const T = [
  ["--ink       (primary text)",        NAVY,    4.5, "supplied #24273A, unchanged"],
  ["--ink-2     (secondary text)",      INK2,    7.0, `derived at navy hue ${nh.h.toFixed(0)}°, s=20%`],
  ["--ink-3     (tertiary/meta text)",  INK3,    4.5, `derived at navy hue ${nh.h.toFixed(0)}°, s=16%`],
  ["--pass      (proven ✓ / links)",    SLATE,   4.5, "supplied #5B6F92 darkened 1.2% L"],
  ["--not-proven(not proven ✕)",        CRIMSON, 4.5, "supplied #BF3A4F, unchanged"],
  ["--requires-access (○)",             SAND,    4.5, "supplied #CEB78E darkened at hue 38°"],
];

console.log("=".repeat(104));
console.log("FINAL LIGHT TOKENS — every text token against every surface it is used on (floor 4.5:1)");
console.log("=".repeat(104));
console.log(`  surfaces: --bg ${BG} · --surface ${SURFACE} · --surface-2 ${SURFACE_2} · band ${BAND}\n`);
console.log(`  ${"token".padEnd(34)} ${"hex".padEnd(9)} ${"--bg".padEnd(7)} ${"surf".padEnd(7)} ${"surf-2".padEnd(7)} ${"band".padEnd(7)} verdict`);
let allOk = true;
for (const [name, c, floor, note] of T) {
  const rs = BGS.map((bg) => ratio(c, bg));
  const ok = rs.every((r) => r >= floor);
  allOk = allOk && ok;
  console.log(`  ${name.padEnd(34)} ${c.padEnd(9)} ${rs.map((r) => r.toFixed(2).padEnd(7)).join(" ")} ${ok ? "PASS" : "FAIL"}  (${note})`);
}
console.log(`\n  --border    (hairline, decorative)  ${PALE}  ${BGS.map((bg)=>ratio(PALE,bg).toFixed(2)).join(" / ")}   non-text, no floor`);
console.log(`  --border-ui (control edge, 1.4.11)  ${CONTROL}  ${BGS.map((bg)=>ratio(CONTROL,bg).toFixed(2)).join(" / ")}   floor 3:1  ${BGS.every((bg)=>ratio(CONTROL,bg)>=3) ? "PASS" : "FAIL"}`);
console.log(`\n  CTA: ${SURFACE} text on ${NAVY} = ${ratio(SURFACE, NAVY).toFixed(2)}:1   (primary button)`);
console.log(`  CTA: ${BG} text on ${NAVY} = ${ratio(BG, NAVY).toFixed(2)}:1`);

console.log("\n" + "=".repeat(104));
console.log("HUE-BAND CHECK — the palette test rejects any literal in the reserved bands");
console.log("=".repeat(104));
const band = (h) => { const { h: hu, s, l } = toHsl(h); if (s < 0.25 || l < 0.12 || l > 0.88) return null; if (hu >= 325 || hu <= 15) return "crimson"; if (hu >= 25 && hu <= 55) return "tan"; return null; };
for (const [n, c] of [["ink", NAVY], ["ink-2", INK2], ["ink-3", INK3], ["pass", SLATE], ["not-proven", CRIMSON], ["requires-access", SAND], ["border", PALE], ["border-ui", CONTROL], ["bg", BG], ["surface-2", SURFACE_2], ["band", BAND]]) {
  const b = band(c);
  const expect = n === "not-proven" ? "crimson" : n === "requires-access" ? "tan" : null;
  const ok = b === expect;
  console.log(`  ${n.padEnd(18)} ${c}  band=${String(b).padEnd(8)} expect=${String(expect).padEnd(8)} ${ok ? "OK" : "⚠️  COLLISION"}`);
  allOk = allOk && ok;
}
console.log("\n" + "=".repeat(104));
console.log(allOk ? "completion: VERIFIED_CLEAN" : "completion: DEFECTS_FOUND");
process.exit(allOk ? 0 : 1);
