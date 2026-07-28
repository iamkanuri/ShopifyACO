// v3.9 follow-up — batches for v3.8's 55 kills, under the NEW P-21 PROTOCOL.
//
// GOLD CASES ARE THE POINT. P-21's whole finding is that a refuter's accuracy was never
// measured, only assumed. So this pass seeds cases whose correct answer is not in dispute
// into every batch, blind and indistinguishable from the real units. A re-examiner that
// misses the gold has its verdicts discounted — measured, not trusted.
//
// Gold cases are EXECUTED against the real engine before being used, because a gold case
// the engine does not actually answer as expected is not gold, it is a second opinion.
import fs from "node:fs";
import { evaluate, type Requirement, type PublicProduct } from "../../src/server/productTest.js";
import { buildEvidence, type QuotableSurface } from "../../src/server/testEvidence.js";

const CONTRA = "Your public copy states the opposite of this requirement.";

function productWith(text: string, surface: QuotableSurface): PublicProduct {
  return {
    origin: "https://store.example", handle: "p", title: "Thing", vendor: "Acme",
    productType: "Thing", tags: [],
    descriptionText: surface === "product_description" ? text : "",
    variants: [{ title: "Default", priceUsd: 12, available: true, options: ["Default"] }],
    minPriceUsd: 12, optionNames: [], optionValues: [], extracted: null,
    evidence: buildEvidence([{ surface, text }]),
    ldAvailability: null, storefrontObjectId: null, policyStatus: "not_fetched",
    fetched: { json: true, page: false, js: false, policy: false },
    diagnostics: { attempted: [], answeredBy: "json", throttled: [], degraded: false, robots: "ok", throttleSource: null },
  } as unknown as PublicProduct;
}
const ask = (key: string, text: string) =>
  evaluate(productWith(text, "product_description"),
    { id: "c", kind: "claim", claim: key, label: key } as Requirement);

// ---------------------------------------------------------------------------
// THE GOLD SET. Each is a group-shaped unit whose correct answer is unambiguous.
//   expected "no"  = the refutation was WRONG; this really is a defect.
//   expected "yes" = the refutation was RIGHT; there is nothing to reinstate.
// ---------------------------------------------------------------------------
// Every one of these was probed against the real engine first (`gold_probe.ts`) and only
// the ones the engine PASSES are used. Three candidates were discarded for failing that
// check — the engine already refuses "the outer carton is vegan", the bundled-item and the
// review-quote shapes, so asking whether a refutation of them was right is incoherent.
// That discard is itself the gold check working.
const GOLD = [
  {
    gold: "no", claimKey: "vegan", attackClass: "wrong_subject", subclass: "gold_rival_excluded",
    original_verdict: "false_pass",
    original_reason: "The property is attributed to a NAMED RIVAL and the same sentence excludes this product.",
    text: "Northbank's cereal is vegan; ours contains honey.",
    why: "unambiguous: a competitor is the subject AND the clause after the semicolon denies the claim of this product",
  },
  {
    gold: "no", claimKey: "organic", attackClass: "wrong_subject", subclass: "gold_sibling",
    original_verdict: "false_pass",
    original_reason: "The subject is a DIFFERENT product in the same range.",
    text: "Our other blend, the House Roast, is certified organic.",
    why: "unambiguous: `Our other blend` names something that is not this product",
  },
  {
    gold: "no", claimKey: "fair_trade", attackClass: "wrong_subject", subclass: "gold_subject_matter",
    original_verdict: "false_pass",
    original_reason: "The term is the book's SUBJECT MATTER; nothing sources the book itself.",
    text: "This book explains how fair trade certification works.",
    why: "unambiguous: a book about fair trade is not a fair-trade product",
  },
  {
    gold: "yes", claimKey: "organic", attackClass: "wrong_subject", subclass: "gold_plain_true",
    original_verdict: "false_pass",
    original_reason: "The subject is inanimate and the claim rides in a participial phrase, so nothing is asserted.",
    text: "This coffee is certified organic.",
    why: "unambiguous: a direct present-tense assertion about this product. Nothing to reinstate.",
  },
  {
    gold: "yes", claimKey: "gluten_free", attackClass: "wrong_subject", subclass: "gold_plain_true2",
    original_verdict: "false_pass",
    original_reason: "The sentence lists several attributes at once, so no single one is asserted.",
    text: "These cookies are gluten-free, dairy-free and nut-free.",
    why: "unambiguous: a coordinated list still asserts each member of this product",
  },
  {
    gold: "yes", claimKey: "single_origin", attackClass: "wrong_subject", subclass: "gold_plain_true3",
    original_verdict: "false_pass",
    original_reason: "The fragment has no finite verb, so it predicates nothing of this product.",
    text: "A single-origin lot from Huila, Colombia.",
    why: "unambiguous: a verbless product descriptor still describes THIS product",
  },
];

// EXECUTE the gold before trusting it
const goldChecks = GOLD.map((g) => {
  const r = ask(g.claimKey, g.text);
  const outcome = r.status === "pass_evidenced" ? "pass"
    : r.detail === CONTRA ? "contradicted" : "not_proven";
  return { ...g, engineOutcome: outcome, engineStatus: r.status };
});
// Every gold unit must be one the engine PASSES — otherwise it is not a case about a false
// pass at all, and asking "was the refutation right" of it is incoherent.
const badGold = goldChecks.filter((g) => g.engineOutcome !== "pass");
if (badGold.length) {
  console.error("INCOMPLETE — gold cases the engine does not pass, so they are not gold:");
  for (const g of badGold) console.error(`  ${g.subclass}: ${g.engineOutcome} — ${JSON.stringify(g.text)}`);
  process.exit(2);
}

const { units } = JSON.parse(fs.readFileSync("experiments/v3-9/v38reexam/units.json", "utf8"));

// blend gold into the real units, ids carrying no information about origin
const N = Number(process.env.V38_BATCHES ?? 6);
const batches: any[][] = Array.from({ length: N }, () => []);
const key: any[] = [];

let i = 0;
for (const u of units) {
  const vid = `V${String(++i).padStart(3, "0")}`;
  key.push({ vid, kind: "real", groupId: u.groupId, attackClass: u.attackClass, claimKey: u.claimKey });
  batches[(i - 1) % N].push({
    vid, claimKey: u.claimKey, attackClass: u.attackClass, subclass: u.subclass,
    original_verdict: u.original_verdict, original_reason: u.original_reason,
    sentences_in_group: u.sentences_in_group, engine_passed: u.engine_passed,
    examples: u.examples,
  });
}
// one gold per batch, cycling the four so no batch gets the same one, and NOT all in the
// same position — a re-examiner that notices "the last unit is always odd" is not blind.
for (let b = 0; b < N; b++) {
  const g = goldChecks[b % goldChecks.length]!;
  const vid = `V${String(++i).padStart(3, "0")}`;
  key.push({ vid, kind: "gold", expected: g.gold, subclass: g.subclass, why: g.why });
  const unit = {
    vid, claimKey: g.claimKey, attackClass: g.attackClass, subclass: g.subclass,
    original_verdict: g.original_verdict, original_reason: g.original_reason,
    sentences_in_group: 1, engine_passed: 1,
    examples: [{ term: g.claimKey, termRole: "supporting", text: g.text, intent: "—" }],
  };
  const pos = (b * 3) % (batches[b]!.length + 1);
  batches[b]!.splice(pos, 0, unit);
}

fs.mkdirSync("experiments/v3-9/v38reexam", { recursive: true });
batches.forEach((b, n) =>
  fs.writeFileSync(`experiments/v3-9/v38reexam/v_b${n + 1}.json`,
    JSON.stringify({ batch: n + 1, of: N, units: b }, null, 2)));
fs.writeFileSync("experiments/v3-9/v38reexam/KEY.json", JSON.stringify({ key }, null, 2));

const placed = new Set(batches.flat().map((u: any) => u.vid));
console.log(JSON.stringify({
  real_units: units.length, gold_units: N, total: placed.size,
  expected: units.length + N,
  exactly_once: placed.size === units.length + N,
  gold_verified_against_engine: goldChecks.map((g) => ({ subclass: g.subclass, expected: g.gold, engine: g.engineOutcome })),
  batch_sizes: batches.map((b) => b.length),
  completion: placed.size === units.length + N ? "VERIFIED_CLEAN" : "INCOMPLETE",
}, null, 2));
