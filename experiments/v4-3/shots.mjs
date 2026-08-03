// Screenshots of the redesigned surfaces, via the system Chromium over CDP.
//
//   node experiments/v4-3/shots.mjs
//
// The Browser pane cannot composite this session, so `computer{action:"screenshot"}`
// times out. CDP renders headlessly and captures regardless, which is also how v4.2
// measured the print path. Written to experiments/v4-3/shots/ (gitignored).
import { Browser } from "../v4-2/cdp.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:8787";
const OUT = "experiments/v4-3/shots";
mkdirSync(OUT, { recursive: true });

const SHOTS = [
  ["landing-desktop", "/", 1280, 900, false],
  ["landing-desktop-full", "/", 1280, 900, true],
  ["landing-mobile", "/", 390, 844, false],
  ["demo", "/demo", 1280, 900, false],
  ["standard", "/standards/coffee/1.3", 1280, 900, false],
  ["test", "/test", 1280, 900, false],
];

let browser;
const done = [];
try {
  browser = await Browser.launch();
  const page = await browser.newPage();
  for (const [name, path, w, h, full] of SHOTS) {
    await page.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await page.goto(`${BASE}${path}`, { waitMs: 900 });
    const got = await page.eval("innerWidth");
    if (Math.abs(got - w) > 1) { console.log(`${name}: INCOMPLETE — asked ${w}px, page saw ${got}px`); continue; }
    const r = await page.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: full,
      ...(full ? { clip: { x: 0, y: 0, width: w, height: Math.min(await page.eval("document.documentElement.scrollHeight"), 12000), scale: 1 } } : {}),
    });
    const file = `${OUT}/${name}.png`;
    writeFileSync(file, Buffer.from(r.data, "base64"));
    done.push(`${file}  (${w}x${h}${full ? " full-page" : ""})`);
    console.log(`captured ${file}`);
  }
} catch (e) {
  console.log(`INCOMPLETE: ${e.message}`);
  process.exit(1);
} finally {
  if (browser) await browser.close().catch(() => {});
}
console.log(`\ncaptured ${done.length}/${SHOTS.length}`);
console.log(`completion: ${done.length === SHOTS.length ? "VERIFIED_CLEAN" : "INCOMPLETE"}`);
