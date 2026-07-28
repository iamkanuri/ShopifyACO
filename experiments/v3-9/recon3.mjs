// v3.9 recon 3: (a) the tally overlap, (b) the full pass_evidenced claim population
// including quoteless ones, (c) locate the 36 domain collisions.
import fs from "node:fs";
import path from "node:path";

const out = {};

// ---------- (a) tally overlap in the v3.8 merge ----------
const g = JSON.parse(fs.readFileSync("experiments/v3-8/out/g14_merged.json", "utf8"));
const confirmedIds = new Set(g.confirmed.map((c) => c.groupId));
out.tally = {
  declared: g.tally,
  sum: Object.values(g.tally).reduce((a, b) => a + b, 0),
  groups: g.groups_expected,
  overcount: Object.values(g.tally).reduce((a, b) => a + b, 0) - g.groups_expected,
  refutedAway: g.tally.refutedAway,
  overcountEqualsRefutedAway:
    Object.values(g.tally).reduce((a, b) => a + b, 0) - g.groups_expected === g.tally.refutedAway,
  confirmedUnique: confirmedIds.size,
  confirmedArray: g.confirmed.length,
  refuterSeenOnConfirmed: g.confirmed.filter((c) => c.refuterSeen).length,
};

// ---------- (b) full claim population from the A/B dump ----------
const rows = fs.readFileSync("experiments/v3-8/out/ab_after_3b.jsonl", "utf8")
  .split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

// The 13 engine claim keys, lifted from the engine source (not guessed).
const src = fs.readFileSync("src/server/productTest.ts", "utf8");
const m = src.match(/ENGINE_CLAIM_KEYS[^=]*=\s*\[([^\]]*)\]/);
const engineClaimKeys = m
  ? m[1].split(",").map((s) => s.trim().replace(/^["']|["'],?$/g, "")).filter(Boolean)
  : null;
out.engineClaimKeys = engineClaimKeys;
out.engineClaimKeyCount = engineClaimKeys ? engineClaimKeys.length : null;

// CLAIM_TERMS label field: find how a claim requirement's label is built
const labelHits = [...src.matchAll(/label:\s*`?["'`]?([^"'`\n]{0,60})/g)].slice(0, 40).map((x) => x[1]);
out.labelConstructions = labelHits;

fs.writeFileSync("experiments/v3-9/out/recon3.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.tally, null, 2));
console.log("ENGINE_CLAIM_KEYS =", JSON.stringify(engineClaimKeys));
