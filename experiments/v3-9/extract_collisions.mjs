// v3.9 CP-1B — lift the 36 authored domain collisions out of v3.8's adjudication blob
// and write them as a REAL context file, so the standing corpus can reach them.
//
// v3.8 authored them into a subagent return value that `g14_merge.mjs` and `g14_table.mjs`
// never read (`src.domains` is loaded and dropped), so `adjacent_vocabulary` has read
// ~0 for the domain-collision half at all 13 keys ever since. Nothing was broken; the
// data simply had no consumer.
import fs from "node:fs";

const blob = JSON.parse(fs.readFileSync("experiments/v3-8/out/g14_adjudications.json", "utf8"));
const holder = Array.isArray(blob.domains) ? blob.domains : [];
const entry = holder.find((h) => h && Array.isArray(h.domains));
if (!entry) { console.error("INCOMPLETE — no `domains` array found"); process.exit(1); }

const domains = entry.domains;
const sentences = domains.reduce((a, d) => a + (d.sentences?.length ?? 0), 0);
const keys = new Set();
for (const d of domains) for (const k of d.claim_keys ?? []) keys.add(k);

// Validate against the AdjacentDomain shape BEFORE writing — parseContext drops a
// malformed entry with a problem, and a silently-dropped collision is a coverage
// reduction that reads as "this key has no collisions".
const bad = [];
domains.forEach((d, i) => {
  const ok = d && typeof d.domain === "string" &&
    Array.isArray(d.collidesWith) && d.collidesWith.every((s) => typeof s === "string") &&
    Array.isArray(d.sentences) && d.sentences.every((s) => typeof s === "string") &&
    typeof d.why === "string";
  if (!ok) bad.push(i);
});

const ctx = {
  id: "generic-collisions",
  productNoun: "product", productPlural: "products", unitNoun: "batch",
  siblingDescriptor: "other", competitor: "Northbank", bundleNoun: "gift set",
  packagingNoun: "carton", facilityNoun: "warehouse",
  specLabels: ["Specification", "Method"],
  adjacentDomains: domains.map((d) => ({
    domain: d.domain, collidesWith: d.collidesWith, sentences: d.sentences, why: d.why,
  })),
};

fs.mkdirSync("standards/attack/contexts", { recursive: true });
fs.writeFileSync("standards/attack/contexts/generic-collisions.json", JSON.stringify(ctx, null, 2) + "\n");
fs.writeFileSync("experiments/v3-9/out/collisions_src.json",
  JSON.stringify({ domains, sentences, keys: [...keys], malformed: bad, notes: entry.notes ?? null }, null, 2));

console.log(JSON.stringify({
  domains: domains.length,
  sentences,
  claim_keys_covered: [...keys].sort(),
  claim_key_count: keys.size,
  malformed: bad.length,
  keys_with_no_collision: entry.keys_with_no_collision ?? null,
  wrote: "standards/attack/contexts/generic-collisions.json",
}, null, 2));
