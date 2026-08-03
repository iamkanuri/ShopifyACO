// §0.4 — WHAT ACTUALLY EXISTS TO SHOW. Executed, not assumed.
// Runs the pinned Klatch demo and prints every row's status, question, quote and surface,
// plus the peer rates and their true denominators.
import { runDemo } from "../../src/server/buyerTestDemo.js";
import { peerRatesFor } from "../../src/server/publicStandard.js";

const d = await runDemo();

console.log("=".repeat(78));
console.log(`host           ${d.host}`);
console.log(`productUrl     ${d.productUrl}`);
console.log(`storeName      ${d.storeName}`);
console.log(`productName    ${d.productName}`);
console.log(`capturedAt     ${d.capturedAt}`);
console.log(`standard       ${d.standard.doc.id ?? "?"} v${d.standard.publicVersion}`);
console.log(`standardHash   ${d.standardHash}`);
console.log(`contractVer    ${d.contractVersion}`);
console.log(`counts         ${JSON.stringify(d.counts)}`);
console.log(`degraded       ${d.degraded}`);
console.log(`applicability  ${JSON.stringify({ included: (d.applicability as any).includedCount, excluded: (d.applicability as any).excluded?.length })}`);
console.log("=".repeat(78));

for (const r of d.rows) {
  console.log(`\n[${r.status}]  ${r.entryId ?? "(no entry id)"}   kind=${r.kind}`);
  console.log(`  Q      : ${r.question ?? "(none)"}`);
  console.log(`  label  : ${r.label}`);
  console.log(`  detail : ${r.detail}`);
  console.log(`  surface: ${r.evidenceSurface ?? "-"}  url=${r.evidenceUrl ?? "-"}`);
  console.log(`  quote  : ${r.quote ? JSON.stringify(r.quote.slice(0, 160)) : "(none)"}`);
  console.log(`  full   : ${r.fullSentence ? JSON.stringify(r.fullSentence.slice(0, 200)) : "(none)"}`);
  console.log(`  audit  : ${r.audit ? `${r.audit.verdict} — ${r.audit.why.slice(0, 90)}` : "(none)"}`);
  console.log(`  options: ${r.optionValues ? r.optionValues.join(" | ") : "-"}`);
}

console.log("\n" + "=".repeat(78));
console.log("PEER RATES (the of-100 trap: denominators must be per-entry)");
console.log("=".repeat(78));
try {
  const peers = peerRatesFor("coffee", d.standard.publicVersion);
  if (!peers) console.log("peerRatesFor returned null/undefined");
  else {
    for (const p of peers as any[]) {
      console.log(`  ${JSON.stringify(p)}`);
    }
  }
} catch (e) {
  console.log(`peerRatesFor threw: ${String((e as Error).message)}`);
}
