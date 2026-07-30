// Smoke test for the CDP client: does print emulation actually change layout, and
// does printToPDF return a real PDF? Two-sided by construction — the SAME element must
// be visible in screen media and absent in print media. If both sides do not move,
// the instrument is not measuring print and the run is INCOMPLETE.
import { Browser } from "./cdp.mjs";
import { writeFileSync } from "node:fs";

const HTML = `<!doctype html><html><head><style>
  body { font: 16px sans-serif; }
  .screen-only { display: block; }
  @media print { .screen-only { display: none !important; } }
</style></head><body>
  <h1>ALWAYS-VISIBLE-ANCHOR</h1>
  <p class="screen-only">SCREEN-ONLY-CANARY</p>
  <details><summary>SUMMARY-TEXT</summary><p>COLLAPSED-BODY-TEXT</p></details>
</body></html>`;

const b = await Browser.launch();
try {
  const page = await b.newPage();
  await page.setContent(HTML);

  const read = async () => page.eval(`document.body.innerText`);

  const screen = await read();
  await page.emulatePrint(true);
  const print = await read();

  const report = {
    screen_has_anchor: screen.includes("ALWAYS-VISIBLE-ANCHOR"),
    screen_has_canary: screen.includes("SCREEN-ONLY-CANARY"),
    print_has_anchor: print.includes("ALWAYS-VISIBLE-ANCHOR"),
    print_has_canary: print.includes("SCREEN-ONLY-CANARY"),
    screen_has_collapsed_body: screen.includes("COLLAPSED-BODY-TEXT"),
    print_has_collapsed_body: print.includes("COLLAPSED-BODY-TEXT"),
  };

  // TWO-SIDED LIVENESS. The anchor must survive both media and the canary must survive
  // exactly one. If the canary is present in print, emulation did not take; if it is
  // absent from screen, the fixture is wrong. Either way we measured nothing.
  const live = report.screen_has_anchor && report.print_has_anchor
    && report.screen_has_canary && !report.print_has_canary;

  const pdf = await page.pdf();
  writeFileSync(new URL("./smoke.pdf", import.meta.url), pdf);

  console.log(JSON.stringify({
    completion: live ? "VERIFIED_CLEAN" : "INCOMPLETE",
    canary_live: live,
    ...report,
    pdf_bytes: pdf.length,
  }, null, 2));
  if (!live) process.exitCode = 1;
} finally {
  await b.close();
}
