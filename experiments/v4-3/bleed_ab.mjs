// WHICH RULE ACTUALLY STOPS THE SIDEWAYS SCROLL? Scored, not guessed.
//
// `body { overflow-x: clip }` was applied and the page still scrolled at all four widths.
// The v4.2 print work established the method for exactly this situation: enumerate the
// candidate rules, inject each one into the live page, and MEASURE which ones do
// anything. Four of the five "obvious" print fixes measured inert there; the same is
// likely here, and a rule that changes nothing is a rule this repo does not ship.
import { Browser } from "../v4-2/cdp.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:8787";
const WIDTHS = [375, 1280];

const CANDIDATES = [
  ["(none — baseline)", ""],
  ["body { overflow-x: clip }", "body{overflow-x:clip!important}"],
  ["html { overflow-x: clip }", "html{overflow-x:clip!important}"],
  ["html { overflow-x: hidden }", "html{overflow-x:hidden!important}"],
  ["html,body { overflow-x: clip }", "html,body{overflow-x:clip!important}"],
  ["band uses 100% not 100vw", ".v43-band{margin-left:0!important;margin-right:0!important;padding-left:24px!important;padding-right:24px!important}"],
];

const CAN_SCROLL = `(() => {
  const d = document.documentElement;
  const before = d.scrollLeft || document.body.scrollLeft || 0;
  window.scrollTo(9999, 0);
  const after = d.scrollLeft || document.body.scrollLeft || 0;
  window.scrollTo(before, 0);
  const band = document.querySelector('.v43-band');
  const bb = band ? band.getBoundingClientRect() : null;
  return { canScrollX: after > before + 1, maxScrollLeft: after - before,
           bandLeft: bb ? Math.round(bb.left) : null, bandW: bb ? Math.round(bb.width) : null,
           clientW: d.clientWidth };
})()`;

let browser; const table = [];
try {
  browser = await Browser.launch();
  const page = await browser.newPage();
  for (const w of WIDTHS) {
    for (const [label, css] of CANDIDATES) {
      await page.send("Emulation.setDeviceMetricsOverride", { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
      await page.goto(`${BASE}/?w=${w}`, { waitMs: 500 });
      if (css) await page.eval(`(() => { const s=document.createElement('style'); s.textContent=${JSON.stringify(css)}; document.head.appendChild(s); void document.body.offsetHeight; return true })()`);
      const r = await page.eval(CAN_SCROLL);
      table.push({ w, label, ...r });
    }
  }
} catch (e) { console.log(`INCOMPLETE: ${e.message}`); process.exit(1); }
finally { if (browser) await browser.close().catch(() => {}); }

console.log("=".repeat(100));
console.log(`${"width".padEnd(7)}${"rule".padEnd(36)}${"scrolls X".padEnd(11)}${"max".padEnd(6)}${"band left/width".padEnd(18)}client`);
console.log("=".repeat(100));
for (const r of table) {
  console.log(
    `${String(r.w).padEnd(7)}${r.label.padEnd(36)}${String(r.canScrollX).padEnd(11)}` +
    `${String(r.maxScrollLeft).padEnd(6)}${`${r.bandLeft}/${r.bandW}`.padEnd(18)}${r.clientW}`,
  );
}

// Two-sided canary: the BASELINE must scroll (or there is nothing to fix and every
// candidate would score "works"), and at least one candidate must not.
const base = table.filter((r) => r.label.startsWith("(none"));
const baselineScrolls = base.every((r) => r.canScrollX);
const winners = CANDIDATES.slice(1)
  .map(([label]) => ({ label, ok: table.filter((r) => r.label === label).every((r) => !r.canScrollX) }))
  .filter((c) => c.ok);
console.log(`\nbaseline scrolls at every width : ${baselineScrolls}  ${baselineScrolls ? "" : "⚠️ CANARY COLLAPSED — nothing to measure"}`);
console.log(`rules that stop it at BOTH widths: ${winners.length ? winners.map((w) => w.label).join(" | ") : "NONE"}`);
console.log(`completion: ${baselineScrolls ? (winners.length ? "VERIFIED_CLEAN" : "DEFECTS_FOUND") : "INCOMPLETE"}`);
