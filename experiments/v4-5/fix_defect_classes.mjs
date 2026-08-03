// v4.5 — THE CLASS TABLE MUST SUM TO THE CONFIRMED COUNT.
//
// An independent verifier found this LIVE on /standards/coffee/1.3: `defect_classes`
// summed to 18 while `confirmed_false_positives` said 5 and `surviving_defects` listed 5.
// The table also said "$0.00 treated as a price — no guard addresses it", which v4.5 makes
// false. A published page disagreeing with itself by 13 is the "site disagrees with its own
// JSON" defect one level up, and it was shipped by re-measuring the RATE without re-deriving
// the DECOMPOSITION beside it.
//
// ⚠️ SEVEN OF THE THIRTEEN HAVE BEEN STALE SINCE v3.8, not v4.5 — the non-USD class (5) and
// the integer-cents class (2) were closed by that release and left in the table. So this is
// not a defect this session introduced; it is one this session's re-measurement made
// arithmetically visible. Both facts go in the record.
//
// The closed classes are not deleted. They move to `closed_classes` with the release that
// closed them, because "which errors this engine used to make, and when it stopped" is the
// most useful thing this sidecar knows.
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const FIT = path.join(here, "..", "..", "standards", "coffee", "v1.3", "fitness.json");
const fit = JSON.parse(fs.readFileSync(FIT, "utf8"));
const g = fit.samples.find((s) => s.name === "general");

const CLOSED = {
  "$0.00 treated as a price": { by: "v4.5", how: "zeroAwareMin refuses when every readable price on the product is zero, and evaluate re-tests the zero at the branch that renders." },
  "A non-USD price rendered with a US dollar sign": { by: "v3.8", how: "declaredCurrency is read from the store's own bytes and the price row refuses a US-dollar cap against a non-USD price rather than converting one it never measured." },
  "Integer CENTS read as dollars — a factor of 100": { by: "v3.8", how: "priceToUsd became tier-aware: .json serves decimal dollars, .js serves integer cents, measured across 349 stores with zero exceptions." },
};

const before = g.defect_classes;
const sumBefore = before.reduce((n, c) => n + c.count, 0);
const surviving = before.filter((c) => !CLOSED[c.klass]);
const closed = before.filter((c) => CLOSED[c.klass]).map((c) => ({ ...c, closed_by: CLOSED[c.klass].by, closed_how: CLOSED[c.klass].how }));
const sumAfter = surviving.reduce((n, c) => n + c.count, 0);

// THE GATE: the table must now sum to the confirmed count, or nothing is written.
if (sumAfter !== g.confirmed_false_positives) {
  console.error(`REFUSING: surviving classes sum to ${sumAfter} but confirmed_false_positives is ${g.confirmed_false_positives}. The decomposition and the rate must agree or neither should be published.`);
  process.exit(2);
}
if (surviving.length === 0 || closed.length === 0) {
  console.error("REFUSING: a split with an empty side is not a split — check the class names still match.");
  process.exit(2);
}

g.defect_classes = surviving;
g.closed_classes = closed;
g.defect_classes_note =
  `The classes below sum to ${sumAfter}, which is this sample's confirmed_false_positives. ` +
  `Classes an engine release has closed move to closed_classes rather than being deleted — which errors this engine used to make, and when it stopped, is the most useful thing this record holds. ` +
  `⚠️ Until v4.5 this table summed to ${sumBefore} against a confirmed count of ${g.confirmed_false_positives}, and it was rendered on the published page that way. Seven of the thirteen had been stale since v3.8; six were closed by v4.5. The rate was re-measured without the decomposition beside it being re-derived.`;

fs.writeFileSync(FIT, `${JSON.stringify(fit, null, 2)}\n`);
console.log(JSON.stringify({
  sum_before: sumBefore, confirmed: g.confirmed_false_positives, sum_after: sumAfter,
  surviving: surviving.map((c) => `${c.klass} (${c.count})`),
  closed: closed.map((c) => `${c.klass} (${c.count}) — ${c.closed_by}`),
}, null, 2));
