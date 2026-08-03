// §0.4 / §2.3 — the peer rates and their TRUE denominators, executed.
// The "of 100" trap: five of ten entries were asked of fewer than 100 products.
import { runDemo } from "../../src/server/buyerTestDemo.js";
import { peerRatesFor } from "../../src/server/publicStandard.js";
import { peerSentence } from "../../viewer/src/peerSentence.js";
import { currentOf } from "../../src/server/standardsSite.js";
import { compileStandard } from "../../standards/compile.js";

const d = await runDemo();
const ids = d.rows.map((r) => r.entryId).filter((x): x is string => !!x);

// The join key the renderers use: the compiled requirement's label, not the entry question.
const published = currentOf("coffee")!;
const { requirements } = compileStandard(JSON.parse(published.rawJson));
const labelById = new Map<string, string>();
for (const r of requirements) {
  if (r.standardEntryId) labelById.set(r.standardEntryId, r.label);
}
console.log(`compiled requirements: ${requirements.length}, labelById size: ${labelById.size}`);

const peers = peerRatesFor(published, ids, labelById);
console.log(`peer records: ${peers.length} for ${ids.length} rows\n`);

let joined = 0;
for (const row of d.rows) {
  const p = peers.find((x) => x.entryId === row.entryId);
  if (p) joined++;
  const passed = row.status === "pass_evidenced" || row.status === "pass_no_blocking";
  console.log(`${row.entryId}`);
  console.log(`  engine label      : ${row.label}`);
  console.log(`  peer.requirementLabel: ${p?.requirementLabel ?? "(none)"}`);
  console.log(`  LABEL JOIN MATCHES: ${p?.requirementLabel === row.label}`);
  console.log(`  asked=${p?.asked} adjudicated=${p?.adjudicated} failed=${p?.failed} undecided=${p?.undecided} failPct=${p?.failPct}`);
  console.log(`  sentence          : ${p ? peerSentence(p, passed) : "(no peer rate)"}`);
  console.log("");
}
console.log(`JOINED ${joined}/${d.rows.length} rows`);
