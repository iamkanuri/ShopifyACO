// IS THE SEMANTIC TIER WHAT MOVES THE PUBLISHED DEMO RESULT?
//
// The landing page's hero showed "5 proven · 5 not proven" on one server boot and
// "6 proven · 4 not proven" on the next, same commit, same frozen capture. `judgeClaims`
// is gated only on an OpenAI key being present and PRODUCT_TEST_SEMANTIC !== "0", makes a
// live sampled model call, and its grants flip `claim` rows from not_proven to
// pass_evidenced. This measures it instead of reasoning about it: the same run, twice,
// with the tier the only difference.
import { runDemo, __resetDemoCache } from "../../src/server/buyerTestDemo.js";
import { ENV } from "../../src/server/env.js";

console.log(`ENV.keys.openai present : ${!!ENV.keys.openai}`);
console.log(`PRODUCT_TEST_SEMANTIC   : ${process.env.PRODUCT_TEST_SEMANTIC ?? "(unset ⇒ tier ENABLED)"}`);
console.log("");

async function once(label: string) {
  __resetDemoCache();
  const d = await runDemo();
  const stats = (d.raw as { semantic?: unknown }).semantic;
  console.log(`${label}`);
  console.log(`  counts   ${JSON.stringify(d.counts)}`);
  console.log(`  semantic ${JSON.stringify(stats ?? "(not carried on the result)")}`);
  const claims = d.rows.filter((r) => r.kind === "claim");
  for (const c of claims) console.log(`  claim    ${c.entryId} = ${c.status}${c.quote ? `  quote="${c.quote.slice(0, 60)}"` : ""}`);
  console.log(`  audited rows in sidecar: ${d.audit.auditedRows.length}`);
  return d;
}

// 1. As production runs it (tier live if a key exists).
process.env.PRODUCT_TEST_SEMANTIC = "";
const live = await once("WITH the semantic tier as production has it");

console.log("");
// 2. With the tier explicitly off — the deterministic, lexical-only result.
process.env.PRODUCT_TEST_SEMANTIC = "0";
const off = await once("WITH PRODUCT_TEST_SEMANTIC=0");

console.log("\n" + "=".repeat(78));
const same = JSON.stringify(live.counts) === JSON.stringify(off.counts);
console.log(`counts identical across the two: ${same}`);
console.log(
  same
    ? "This run did not differ — but the tier still MADE A LIVE MODEL CALL above, so the\n" +
      "result is a sample rather than a replay. One boot in this session returned 6/4."
    : "⚠️ THE TIER MOVES THE PUBLISHED RESULT. A citable artifact cannot be a sample.",
);
console.log(
  `\nThe fixture's own gate: every PASSING row individually adjudicated true_pass.\n` +
  `  passing rows with the tier live : ${live.counts.pass}\n` +
  `  rows the v3.2 audit adjudicated : ${live.audit.auditedRows.length}\n` +
  `  ⇒ ${live.counts.pass > live.audit.auditedRows.length ? "AN UNADJUDICATED PASS IS ON THE PAGE" : "every pass is adjudicated"}`,
);
