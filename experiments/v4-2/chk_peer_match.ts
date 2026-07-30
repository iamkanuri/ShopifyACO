// Do the peer records actually MATCH the assertion rows they are meant to annotate?
//
// The SPA and the one-pager both join with `x.label === a.label || x.entryId === a.label`.
// `peerRatesFor` sets `label: entry.question ?? entry.id`; `compileStandard` labels a
// requirement with the BINDING's label. If those are different strings the join finds
// nothing and every peer line silently disappears — which looks exactly like a standard
// with no published measurement.
import "dotenv/config";
import { runDemo } from "../../src/server/buyerTestDemo.js";
import { peerRatesFor } from "../../src/server/publicStandard.js";
import { findStandard } from "../../src/server/standardsSite.js";

const d = await runDemo();
const published = findStandard(d.standard.slug, String(d.standard.doc.version))!;
const askedIds = d.rows.map((r) => r.entryId).filter((x): x is string => Boolean(x));
const labelById = new Map(d.rows.filter((r) => r.entryId).map((r) => [r.entryId!, r.label]));

// The join the renderers perform.
const join = (peers: ReturnType<typeof peerRatesFor>, label: string) =>
  peers.find((x) => x.requirementLabel === label || x.label === label || x.entryId === label);

const count = (peers: ReturnType<typeof peerRatesFor>) =>
  d.raw.assertions.filter((a) => join(peers, a.label)).length;

// TWO-SIDED. Without the label map the join must still fail — that is the bug this
// change fixes, and if it stopped failing the "fix" would be measuring nothing.
const before = count(peerRatesFor(published, askedIds));
const after = count(peerRatesFor(published, askedIds, labelById));
const total = d.raw.assertions.length;

console.log("assertion label".padEnd(52), "| joins now | the buyer question it belongs to");
for (const a of d.raw.assertions) {
  const hit = join(peerRatesFor(published, askedIds, labelById), a.label);
  console.log(a.label.slice(0, 50).padEnd(52), "|",
    (hit ? "YES" : "no ").padEnd(9), "|", (hit?.label ?? "—").slice(0, 44));
}

console.log(`\nWITHOUT the label map: ${before}/${total} rows join  (the v4.1 behaviour)`);
console.log(`WITH    the label map: ${after}/${total} rows join`);
console.log(before === 0 && after === total
  ? "VERIFIED_CLEAN: the defect reproduces without the fix and is fully closed with it"
  : before !== 0
    ? "INCOMPLETE: the pre-fix path did NOT reproduce the defect — this is not measuring what it claims"
    : `DEFECTS_FOUND: only ${after}/${total} join even with the fix`);
