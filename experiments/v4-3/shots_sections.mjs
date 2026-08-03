// Section-by-section captures of the redesigned landing page. The full-page shot is
// 10,000px tall and unreadable; these clip to each section's own box so the rhythm
// between them (field / band, document / list / rail / diff) can actually be judged.
import { Browser } from "../v4-2/cdp.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:8787";
const OUT = "experiments/v4-3/shots";
mkdirSync(OUT, { recursive: true });
const IDS = ["deliver", "workflow", "how", "example", "rerun", "difference", "validation", "rigor", "pilot"];

let browser; let n = 0;
try {
  browser = await Browser.launch();
  const page = await browser.newPage();
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.goto(`${BASE}/`, { waitMs: 1000 });
  const got = await page.eval("innerWidth");
  if (got !== 1280) { console.log(`INCOMPLETE: asked 1280, page saw ${got}`); process.exit(1); }
  for (const id of IDS) {
    const box = await page.eval(`(() => {
      const el = document.getElementById(${JSON.stringify(id)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: 0, y: Math.round(r.top + scrollY), width: 1280, height: Math.min(Math.round(r.height), 2400) };
    })()`);
    if (!box) { console.log(`#${id}: ABSENT`); continue; }
    const shot = await page.send("Page.captureScreenshot", {
      format: "png", captureBeyondViewport: true, clip: { ...box, scale: 1 },
    });
    writeFileSync(`${OUT}/sec-${id}.png`, Buffer.from(shot.data, "base64"));
    console.log(`#${id}  ${box.height}px  ->  ${OUT}/sec-${id}.png`);
    n++;
  }
} catch (e) { console.log(`INCOMPLETE: ${e.message}`); process.exit(1); }
finally { if (browser) await browser.close().catch(() => {}); }
console.log(`\ncaptured ${n}/${IDS.length}`);
console.log(`completion: ${n === IDS.length ? "VERIFIED_CLEAN" : "INCOMPLETE"}`);
