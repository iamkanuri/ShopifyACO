// §2.4 — what the STANDARD itself publishes as accepted evidence for the rows that
// did not pass. The "after" half of a before/after must come from the standard's own
// published examples, never from a sentence this session invented.
import { runDemo } from "../../src/server/buyerTestDemo.js";

const d = await runDemo();
for (const r of d.rows) {
  if (r.status === "pass_evidenced" || r.status === "pass_no_blocking") continue;
  console.log(`${r.entryId}  [${r.kind}]`);
  console.log(`  Q: ${r.question}`);
  console.log(`  detail: ${r.detail}`);
  console.log(`  accepted evidence:`);
  for (const a of r.acceptedEvidence) {
    console.log(`    - surface=${a.surface ?? "-"} form=${a.form ?? "-"}`);
    console.log(`      example: ${a.example ? JSON.stringify(a.example) : "(none)"}`);
  }
  console.log("");
}
