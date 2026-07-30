// Why do 4 of 142 items on /standards/coffee/1.3 read present-in-DOM, absent-in-PDF?
// Written with the Write tool, NOT a heredoc: a bash heredoc ate one backslash from
// `/\\s+/g` and sent `/s+/g` to the page, which replaced every literal "s" and made a
// throwaway check report 124 phantom misses. Same family as the repo's `node -e` rule.
import { Browser } from "./cdp.mjs";
import { readFileSync } from "node:fs";
import { extractText, pdfHas } from "./pdftext.mjs";

const pdfText = extractText(readFileSync(new URL("./std_AFTER.pdf", import.meta.url)));
const b = await Browser.launch();
try {
  const p = await b.newPage();
  await p.goto("http://127.0.0.1:8787/standards/coffee/1.3");
  const items = await p.eval(`(() => { const out = [];
    for (const d of document.querySelectorAll('details')) {
      for (const el of Array.from(d.children).filter(c => c.tagName !== 'SUMMARY')) {
        const kids = el.querySelectorAll('li, p, dd, td');
        if (kids.length) for (const k of kids) out.push((k.textContent || '').replace(/\\s+/g, ' ').trim());
        else out.push((el.textContent || '').replace(/\\s+/g, ' ').trim());
      } } return out.filter(Boolean); })()`);

  // CANARY: a string we know is on the page must be found, or the extractor is dead.
  const canary = pdfHas(pdfText, "Can I buy this as whole beans");
  const miss = items.filter((x) => !pdfHas(pdfText, x));
  console.log(JSON.stringify({
    extractor_canary_ok: canary,
    items: items.length,
    missing: miss.length,
  }, null, 2));
  if (!canary) { console.log("INCOMPLETE: canary failed"); process.exit(1); }

  for (const m of miss) {
    // Binary-search the longest prefix that IS present — that is where extraction breaks.
    let lo = 0, hi = m.length;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (pdfHas(pdfText, m.slice(0, mid))) lo = mid; else hi = mid - 1; }
    console.log(`\nLEN=${m.length} longest_present_prefix=${lo}`);
    console.log(`  ok  …${JSON.stringify(m.slice(Math.max(0, lo - 45), lo))}`);
    console.log(`  BREAKS AT ${JSON.stringify(m.slice(lo, lo + 60))}`);
  }
} finally { await b.close(); }
