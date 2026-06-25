import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareProportions, MIN_COMPARE_N } from "../src/benchmarks/stats.js";
import { isValidRunId, runDir, newRunId } from "../src/server/runStore.js";

// P1-3: the difference interval must be honest at the extremes and small samples must
// stay inconclusive (no false certainty / cry-wolf). Regression test for the Codex review.
test("compareProportions: extreme small samples are inconclusive, not certain", () => {
  const r = compareProportions(0, 3, 3, 3); // 0/3 -> 3/3
  // Old Wald SE collapsed to a [1,1] "certain" interval; Newcombe must be wide.
  assert.ok(r.diffCiLow < 0.9, `diffCiLow should be well below 1, got ${r.diffCiLow}`);
  assert.ok(r.diffCiHigh <= 1);
  // n=3 < MIN_COMPARE_N → never call a direction.
  assert.equal(r.verdict, "inconclusive");
});

test("compareProportions: a real effect at adequate n is called; the diff CI excludes 0", () => {
  const up = compareProportions(2, 40, 24, 40); // 5% -> 60%
  assert.equal(up.verdict, "improved");
  assert.ok(up.diffCiLow > 0, `diffCiLow should exclude 0, got ${up.diffCiLow}`);

  const down = compareProportions(24, 40, 2, 40);
  assert.equal(down.verdict, "regressed");
  assert.ok(down.diffCiHigh < 0);
});

test("compareProportions: a big apparent jump below the min-n floor stays inconclusive", () => {
  const r = compareProportions(0, 10, 8, 10); // 0% -> 80% but only n=10
  assert.ok(MIN_COMPARE_N > 10);
  assert.equal(r.verdict, "inconclusive");
  assert.ok(r.diff != null && r.diff > 0.7); // the diff is still reported honestly
});

test("compareProportions: identical-ish rates are inconclusive", () => {
  assert.equal(compareProportions(20, 40, 21, 40).verdict, "inconclusive");
});

// P1-4: public :runId is validated before it can touch the filesystem.
test("isValidRunId accepts a generated id and rejects traversal / malformed shapes", () => {
  assert.equal(isValidRunId(newRunId()), true);
  assert.equal(isValidRunId("20260625-120000-deadbeefdeadbeefdead"), true); // 20 hex
  for (const bad of [
    "../../etc/passwd", "..", "", "foo", "20260625-120000-xyz",
    "20260625-120000-deadbeefdeadbeefdea", // 19 hex
    "20260625-120000-deadbeefdeadbeefdeadx", // 21 chars / non-hex
    "../20260625-120000-deadbeefdeadbeefdead",
  ]) {
    assert.equal(isValidRunId(bad), false, `should reject: ${bad}`);
  }
});

test("runDir throws on a path-escaping id (defense in depth)", () => {
  assert.doesNotThrow(() => runDir(newRunId()));
  for (const bad of ["../escape", "../../etc", "a/../../b"]) {
    assert.throws(() => runDir(bad), /invalid run id/);
  }
});
