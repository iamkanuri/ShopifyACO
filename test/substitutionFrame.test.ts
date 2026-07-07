import { test } from "node:test";
import assert from "node:assert/strict";
import { selectSubstitutionFrame, type FrameRival } from "../src/analysis/substitutionFrame.js";

const R = (name: string, recCount: number, source: "configured" | "discovered" = "discovered"): FrameRival => ({ name, recCount, source });
const frame = (brand: string, category: string, own: number, total: number, rivals: FrameRival[], score = 40) =>
  selectSubstitutionFrame({ brand, category, merchantRec: { count: own, total }, nameableRivals: rivals, score });

// SEVERITY-SELECTED presentation of the fragmented/losing case. BRUTAL (well-sampled shutout) leads with
// the stark number; MILD (the bare number shrugs) leads with the reframe; STARK is the graceful middle.

// BRUTAL: a well-sampled zero — the number IS the punch, minimal prose, and "never" is defensible.
test("BRUTAL (Death Wish 0/24, top 5=21%): number-led 'never', spare prose, open-slot tail", () => {
  const f = frame("Death Wish Coffee", "coffee", 0, 24, [R("La Colombe", 5), R("Intelligentsia", 3), R("Stumptown", 2, "configured"), R("Lavazza", 2), R("Cafe Bustelo", 2)]);
  assert.equal(f.bucket, "losing_fragmented");
  assert.equal(f.severity, "brutal");            // well-sampled zero (Wilson upper ≈ 0.14 ≤ 0.22)
  assert.match(f.headline, /never recommends Death Wish Coffee/);
  assert.match(f.headline, /0 of 24 answers/);   // the stark number leads
  assert.match(f.subline, /La Colombe/);         // terse rival proof
  assert.match(f.subline, /slot is there to take|no single brand owns/); // top 21% < 35% → open
  assert.doesNotMatch(f.headline, /rotating cast|one of many|barely/);   // no shrug/dilution
});

// STARK (near-total positive): own===1 is the owner-flagged ambiguous 1/N — number-prominent + reframe.
test("STARK (quip 1/22, Oral-B 12/22=55%): 'just 1 of 22' number-prominent + entrenched reframe, NO open-slot", () => {
  const f = frame("quip", "electric toothbrushes", 1, 22, [R("Oral-B", 12, "configured"), R("Philips Sonicare", 10, "configured"), R("usmile", 7)]);
  assert.equal(f.bucket, "losing_fragmented");
  assert.equal(f.severity, "stark");             // rate 4.5% < 7% → near-total shutout, count still leads
  assert.match(f.headline, /just 1 of 22/);      // the stark count leads
  assert.doesNotMatch(f.headline, /never/);      // 1 recommendation → "never" would be false
  assert.match(f.subline, /displacing entrenched names/);
  assert.doesNotMatch(f.subline, /slot is open/); // Oral-B holds 55% — the category is NOT open
});

// STARK (thin zero): a 0 the sample can't back as "never" — honest "didn't come up", NOT brutal.
test("THIN ZERO (0/6) is STARK not BRUTAL — the sample can't carry 'AI never picks you'", () => {
  const f = frame("NewCo", "kettlebells", 0, 6, [R("Rogue", 2), R("Bells of Steel", 2), R("REP Fitness", 1)]);
  assert.equal(f.bucket, "losing_fragmented");
  assert.equal(f.severity, "stark", "0/6 Wilson upper ≈ 0.39 > 0.22 → too thin for a brutal 'never'");
  assert.match(f.headline, /didn't recommend NewCo/);
  assert.match(f.headline, /thin sample/);       // honest hedge on low data
  assert.doesNotMatch(f.headline, /never recommends/); // must NOT overclaim on 6 answers
});

test("DOMINANT fires ONLY when one rival genuinely dominates the share (EltaMD 14/45, next 4)", () => {
  const f = frame("Supergoop", "mineral sunscreen", 2, 45, [R("EltaMD", 14), R("Blue Lizard", 4), R("Badger Balm", 2)]);
  assert.equal(f.bucket, "losing_dominant");
  assert.match(f.headline, /recommends EltaMD by name/);
  assert.match(f.subline, /14 of 45/);
  assert.equal(f.namedRivals.length, 1);
});

test("EVEN — merchant neck-and-neck with one rival (Olipop 11 / Poppi 11)", () => {
  const f = frame("Olipop", "prebiotic soda", 11, 22, [R("Poppi", 11, "configured"), R("Culture Pop", 1)]);
  assert.equal(f.bucket, "even");
  assert.match(f.headline, /Olipop and Poppi are the two names/);
});

test("WINNING requires a CLEAR lead — Native 6 vs 3 (2× margin) → owns it", () => {
  const f = frame("Native", "natural deodorant", 6, 22, [R("Tom's of Maine", 3), R("Megababe", 3)]);
  assert.equal(f.bucket, "winning");
  assert.match(f.headline, /owns the AI recommendation/);
  assert.match(f.subline, /Tom's of Maine \(3\)/);
});

test("BOUNDARY: a 1-point lead in a crowded field is CONTESTED, not 'winning/owns' (ARMRA 6 vs 5 vs 4)", () => {
  const f = frame("ARMRA", "colostrum supplements", 6, 20, [R("Elm & Rye", 5), R("Bulk Supplements", 4), R("California Gold Nutrition", 2)]);
  assert.equal(f.bucket, "even", "narrow lead + clustered field ≠ owning it");
  assert.doesNotMatch(f.headline, /owns/);
  assert.match(f.headline, /crowded field with no clear leader/);
  assert.match(f.subline, /ARMRA 6, Elm & Rye 5/); // honest cluster breakdown
});

test("DISCOVERED THREAT — beats configured rivals, but an unlisted brand out-recommends", () => {
  const f = frame("Ritual", "multivitamins", 5, 24, [R("Nature Made", 9, "discovered"), R("Athletic Greens", 2, "configured")]);
  assert.equal(f.bucket, "discovered_threat");
  assert.match(f.headline, /didn't list/);
  assert.match(f.headline, /Nature Made/);
});

test("NOBODY — only when NO brand is recommended more than once (genuinely no picks)", () => {
  const f = frame("NewCo", "widgets", 1, 20, [R("A", 1), R("B", 1), R("C", 1)]);
  assert.equal(f.bucket, "nobody");
  assert.match(f.headline, /no brand is named in more than one answer/);
});

// MILD: the bare number shrugs at 8%, so the reframe leads (the validated OUAI treatment).
test("MILD (OUAI 2/24 = 8%): scattered field → reframe-led, NOT 'nobody', open-slot action-frame", () => {
  const f = frame("OUAI", "haircare", 2, 24, [R("Olaplex", 3), R("Redken", 3), R("Kérastase", 3), R("Nécessaire", 2), R("Living Proof", 1)]);
  assert.equal(f.bucket, "losing_fragmented", "brands ARE recommended (scattered) → fragmented, not no-picks");
  assert.equal(f.severity, "mild");            // rate 8.3% ≥ 7% → the number shrugs, reframe leads
  assert.match(f.headline, /barely in the running/);
  assert.match(f.headline, /recommends 5 different brands/); // consideration-set framing leads
  assert.match(f.subline, /the slot is open/); // top 3/24=12% < 35% → open
});

// A well-sampled zero in an OWNED field is still BRUTAL, but must NOT claim an open slot.
test("BRUTAL but OWNED — well-sampled zero, one rival entrenched → number-led, no false open-slot", () => {
  const f = frame("Upstart", "electric toothbrushes", 0, 22, [R("Oral-B", 12, "configured"), R("Philips Sonicare", 8, "configured")]);
  assert.equal(f.severity, "brutal");
  assert.match(f.headline, /never recommends Upstart/);
  assert.doesNotMatch(f.subline, /slot is there to take|no single brand owns/); // Oral-B 55% → not open
  assert.match(f.subline, /own that slot today/);
});

// GRACEFUL DEGRADATION across the boundary: 0→1→2 recommendations slide brutal→stark→mild, never a
// jarring snap. Same field, only the merchant's own count moves.
test("graceful degradation: own 0 → 1 → 2 slides brutal → stark → mild (no hard snap)", () => {
  const rivals = [R("La Colombe", 5), R("Intelligentsia", 3), R("Stumptown", 2, "configured")];
  assert.equal(frame("X", "coffee", 0, 24, rivals).severity, "brutal");
  assert.equal(frame("X", "coffee", 1, 24, rivals).severity, "stark");
  assert.equal(frame("X", "coffee", 2, 24, rivals).severity, "mild");
});

test("every named rival carries a real recommendation count; score is demoted to proof", () => {
  const f = frame("Death Wish Coffee", "coffee", 0, 24, [R("La Colombe", 5), R("Intelligentsia", 3)], 8);
  assert.ok(f.namedRivals.every((r) => r.recCount > 0));
  assert.match(f.scoreProof, /Score of 8\/100/);
  assert.match(f.scoreProof, /0 of 24 answers recommend/);
});
