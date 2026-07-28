// Pull the agent return values straight out of a workflow journal.
//
// The documented resume path. Two agents (the CP-1B completeness critic and the
// CP-1A adjacent-domain author) are still running, and both are ENRICHMENT — the
// core measurement is the 10 adjudicators + 4 refuters and the 6 authors, all of
// which have returned. Waiting on enrichment to read a finished measurement would
// be the same mistake as treating a partial run as clean, in the other direction.
//
// ⚠️ It identifies agents BY CONTENT (`batch`, `cluster`, `verdicts`), not by
// position, because the journal carries no label. A positional guess that silently
// mislabels a batch would corrupt the merge without failing it.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
mkdirSync(OUT, { recursive: true });

const BASE = "C:/Users/iamka/.claude/projects/C--Users-iamka-Documents-projects-ShopifyACO/e161b886-d146-4c63-a2b6-24b6bc69f93f/subagents/workflows";

const read = (wf) => {
  const out = [];
  for (const line of readFileSync(join(BASE, wf, "journal.jsonl"), "utf8").split("\n")) {
    if (!line.trim()) continue;
    const o = JSON.parse(line);
    if (o.type === "result" && o.result !== undefined) out.push(o.result);
  }
  return out;
};

// ---- CP-1A ---------------------------------------------------------------
const a = read("wf_59bba7bc-538");
const adjudications = a.filter((r) => r && typeof r === "object" && Array.isArray(r.groups) && typeof r.batch === "number");
const refutations = a.filter((r) => r && typeof r === "object" && Array.isArray(r.verdicts));
const domains = a.filter((r) => r && typeof r === "object" && Array.isArray(r.domains));

writeFileSync(join(OUT, "g14_adjudications.json"), JSON.stringify({ adjudications, refutations, domains }, null, 2));
console.log("CP-1A");
console.log(`  adjudication batches : ${adjudications.length}  (batches: ${adjudications.map((x) => x.batch).sort((p, q) => p - q).join(",")})`);
console.log(`  groups returned      : ${adjudications.reduce((n, x) => n + x.groups.length, 0)}`);
console.log(`  refuter reports      : ${refutations.length}  (${refutations.reduce((n, x) => n + x.verdicts.length, 0)} verdicts)`);
console.log(`  domain-collision sets: ${domains.length}`);

// ---- CP-1B ---------------------------------------------------------------
const b = read("wf_4d850e6a-19d");
const clusters = b.filter((r) => r && typeof r === "object" && Array.isArray(r.cases));
const recon = b.filter((r) => typeof r === "string");
const critic = b.filter((r) => r && typeof r === "object" && Array.isArray(r.additional_cases));

const allCases = clusters.flatMap((c) => c.cases.map((x) => ({ ...x, cluster: c.cluster })));
writeFileSync(join(OUT, "fetch_cases_raw.json"), JSON.stringify({ clusters, recon, critic, caseCount: allCases.length }, null, 2));
writeFileSync(join(HERE, "fetch_cases.json"), JSON.stringify(allCases, null, 2));
console.log("\nCP-1B");
console.log(`  recon reports    : ${recon.length}`);
console.log(`  author clusters  : ${clusters.length}  (${clusters.map((c) => c.cluster).join(", ")})`);
console.log(`  cases            : ${allCases.length}`);
console.log(`  critic reports   : ${critic.length}`);
const unreachable = allCases.filter((c) => c.unreachable_by_real_store_sample).length;
console.log(`  authors' own "unreachable by a real-store sample" claim : ${unreachable}/${allCases.length}`);
const byCluster = {};
for (const c of allCases) byCluster[c.cluster] = (byCluster[c.cluster] ?? 0) + 1;
for (const [k, v] of Object.entries(byCluster)) console.log(`    ${k.padEnd(24)} ${v}`);
