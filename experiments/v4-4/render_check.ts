// v4.4 — render one AFFECTED row and one CLEAN row, and print what a reader sees.
import fs from "node:fs";
import path from "node:path";
const { renderStoredResult, resolveStored } = await import("../../src/server/resultPage.js");
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const rows = JSON.parse(fs.readFileSync(path.join(here, "..", "..", "test", "fixtures", "v4-4-affected-rows.json"), "utf8"));
for (const r of rows) {
  const row = { ...r, shop_domain: null, claimed_at: null, shared_at: null, rerun_of: null,
    superseded_by: null, standard_hash: null, contract_version: null, ran_at: r.created_at };
  const res = resolveStored(row as never);
  if (!res) { console.log(`${r.token}: resolveStored returned null`); continue; }
  const html = renderStoredResult(row as never, res, "https://lens.thirdocular.com").bodyHtml;
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const i = text.indexOf("Correction:") >= 0 ? text.indexOf("Correction:") : text.indexOf("Notice:");
  console.log(`\n${"=".repeat(76)}\n${r.token}  ${r.store_host}  (${r.kind})`);
  console.log(i >= 0 ? text.slice(i, i + 900) : "*** NO NOTICE RENDERED ***");
}
