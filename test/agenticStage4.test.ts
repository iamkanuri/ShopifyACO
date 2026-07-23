import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

// ===========================================================================
// AGENTIC INSTRUMENT TEST — STAGE 4 automated tests (spec S4 §5, tests 36–43).
// Pure and deterministic: the fault injector takes injectable IO, so ordering
// and restoration content are provable with zero network.
// ===========================================================================

process.env.AGENTIC_STAGE1_RESULTS_DIR = join(mkdtempSync(join(tmpdir(), "agentic-stage4-test-")), "results");
process.env.AGENTIC_INSTRUMENT_TEST_ENABLED = process.env.AGENTIC_INSTRUMENT_TEST_ENABLED ?? "true";

import {
  injectFault,
  revertFault,
  computeFaultedHtml,
  assertStateMatchesGroundTruth,
  CEDAR_ALUMINUM_SENTENCE,
  type FaultIO,
  type PendingRevertMarker,
} from "../src/agentic-test/store-fault.js";
import { safeConstraintId } from "../src/agentic-test/compiler.js";

const LIVE_HTML = `<p>Small-batch deodorant made in Florida for people who read ingredient labels. ${CEDAR_ALUMINUM_SENTENCE} Every stick is a one-time purchase, no subscription required, and we never auto-enroll you in anything.</p>`;
const LIVE_MF = { namespace: "custom", key: "aluminum_free", value: "true", type: "boolean" };

function recordingIO(): { io: FaultIO; calls: string[]; writes: Record<string, unknown> } {
  const calls: string[] = [];
  const writes: Record<string, unknown> = {};
  return {
    calls,
    writes,
    io: {
      writeMarker: (m) => {
        calls.push("marker");
        writes.marker = m;
      },
      writeDescription: async (_gid, html) => {
        calls.push("description");
        writes.description = html;
      },
      setMetafield: async (_gid, mf) => {
        calls.push("setMetafield");
        writes.metafield = mf;
      },
      deleteMetafield: async () => {
        calls.push("deleteMetafield");
      },
    },
  };
}

// ---- 36. marker is written BEFORE any live-store fault write ---------------

test("36. pending-revert marker is written before any store write", async () => {
  const { io, calls, writes } = recordingIO();
  const marker = await injectFault(io, { descriptionHtml: LIVE_HTML, metafield: LIVE_MF }, "2026-07-23T00:00:00Z");
  assert.equal(calls[0], "marker", "marker write is the FIRST operation");
  assert.ok(calls.indexOf("marker") < calls.indexOf("description"));
  assert.ok(calls.indexOf("marker") < calls.indexOf("deleteMetafield"));
  // The marker carries the EXACT restoration content.
  assert.equal(marker.restore.descriptionHtml, LIVE_HTML);
  assert.deepEqual(marker.restore.metafield, LIVE_MF);
  assert.equal(marker.status, "pending");
  // The faulted description no longer contains the sentence (or any fragment).
  assert.ok(!(writes.description as string).includes("aluminum"));
  // A store already missing the sentence must refuse (fault would be a no-op).
  await assert.rejects(
    injectFault(io, { descriptionHtml: "<p>Nothing here.</p>", metafield: LIVE_MF }),
    /not present verbatim/,
  );
  // A store already missing the metafield must refuse.
  await assert.rejects(injectFault(io, { descriptionHtml: LIVE_HTML, metafield: null }), /metafield not present/);
});

// ---- 37. revert-fault restores exact content from the marker ---------------

test("37. revert-fault restores the exact marker content (dry-run)", async () => {
  const { io: injectIo } = recordingIO();
  const marker = await injectFault(injectIo, { descriptionHtml: LIVE_HTML, metafield: LIVE_MF }, "2026-07-23T00:00:00Z");

  const { io: revertIo, writes } = recordingIO();
  await revertFault(revertIo, marker);
  assert.equal(writes.description, LIVE_HTML, "description restored verbatim");
  assert.deepEqual(writes.metafield, LIVE_MF, "metafield restored verbatim");
});

// ---- 38. diagnosis→proposal adapter maps EVIDENCE_GAP → exact restoration --

test("38. adapter maps an EVIDENCE_GAP diagnosis to the exact restoration proposal", async () => {
  const { buildRestorationProposal } = await import("../src/agentic-test/fix-adapter.js");
  const { injectFault } = await import("../src/agentic-test/store-fault.js");
  const { io } = recordingIO();
  const marker = await injectFault(io, { descriptionHtml: LIVE_HTML, metafield: LIVE_MF }, "2026-07-23T00:00:00Z");
  const scan = {
    snapshotId: "s", contractId: "c",
    perConstraint: [{ constraintId: "x1aluminumfree", attribute: "aluminum_free", verdict: "absent" as const, explicitHits: [], outOfScopeHits: [], contraryHits: [], conflictHits: [], relevantSurfaces: [] }],
  };
  const proposal = buildRestorationProposal(
    { constraintId: "x1aluminumfree", attribute: "aluminum_free", rootCause: "EVIDENCE_GAP", scan, searchedSurfaces: ["product description", "metafields"] },
    marker,
  );
  assert.equal(proposal.kind, "write_products");
  assert.equal(proposal.target, "descriptionHtml");
  assert.equal(proposal.proposedValue, LIVE_HTML, "restores the EXACT pre-fault content");
  assert.ok(proposal.proposedValue.includes(CEDAR_ALUMINUM_SENTENCE));
  assert.ok(!proposal.basedOn!.includes("aluminum"), "conflict baseline is the FAULTED normalized text");
  assert.ok(proposal.rationale.includes("product description"));
  // Non-gap diagnoses are refused.
  assert.throws(
    () => buildRestorationProposal({ constraintId: "x1aluminumfree", attribute: "aluminum_free", rootCause: "CONTRADICTION" as never, scan, searchedSurfaces: [] }, marker),
    /EVIDENCE_GAP/,
  );
});

// ---- 39. rollback verification detects success and failure -----------------

test("39. rollback verification logic detects successful and unsuccessful restores", async () => {
  const { verifyRollback } = await import("../src/agentic-test/fix-adapter.js");
  assert.equal(verifyRollback(null, null), true);
  assert.equal(verifyRollback(null, ""), true, "unset and empty are the same state");
  assert.equal(verifyRollback("original seo", "original seo"), true);
  assert.equal(verifyRollback("original seo", "stage4 rollback probe"), false, "simulated unsuccessful restore detected");
  assert.equal(verifyRollback(null, "leftover probe text"), false);
});

// ---- 40. identical-rerun guard refuses version drift -----------------------

test("40. identical-rerun guard refuses when versions differ", async () => {
  const { assertIdenticalRunConfig } = await import("../src/agentic-test/fix-adapter.js");
  const base = { contractId: "stage4-case-p1", promptVersion: "stage4-v1", providers: ["openai", "gemini"] };
  assert.doesNotThrow(() => assertIdenticalRunConfig(base, { ...base, providers: ["gemini", "openai"] }));
  assert.throws(() => assertIdenticalRunConfig(base, { ...base, promptVersion: "stage4-v2" }), /promptVersion differs/);
  assert.throws(() => assertIdenticalRunConfig(base, { ...base, contractId: "other" }), /contract differs/);
  assert.throws(() => assertIdenticalRunConfig(base, { ...base, providers: ["openai"] }), /providers differ/);
});

// ---- 42. contract id generator emits round-trip-safe ids -------------------

test("42. constraint id generator emits round-trip-safe ids (property test)", () => {
  const attributes = [
    "aluminum_free", "required_variant_in_stock", "variant_price", "delivery_timing",
    "subscription_required", "baking_soda_free", "UPPER_case-Mixed.attr", "weird!!chars##", "a".repeat(60),
  ];
  for (let i = 0; i < attributes.length; i++) {
    const id = safeConstraintId(attributes[i]!, i);
    assert.match(id, /^[a-z0-9]+$/, `no separators or case to mangle: ${id}`);
    assert.ok(id.length <= 32, `≤32 chars: ${id}`);
    assert.ok(id.startsWith(`x${i + 1}`), "position-prefixed");
  }
  // Distinct attributes at the same index stay distinct.
  assert.notEqual(safeConstraintId("aluminum_free", 0), safeConstraintId("vegan", 0));
});

// ---- 43. final-state assertion helper --------------------------------------

test("43. store-state vs ground-truth assertion on the evidence fields", () => {
  const good = assertStateMatchesGroundTruth({ descriptionHtml: LIVE_HTML, metafield: { key: "aluminum_free", value: "true" } });
  assert.equal(good.ok, true);

  const missingSentence = assertStateMatchesGroundTruth({
    descriptionHtml: "<p>Small-batch deodorant.</p>",
    metafield: { key: "aluminum_free", value: "true" },
  });
  assert.equal(missingSentence.ok, false);
  assert.ok(missingSentence.problems[0]!.includes("sentence"));

  const missingMetafield = assertStateMatchesGroundTruth({ descriptionHtml: LIVE_HTML, metafield: null });
  assert.equal(missingMetafield.ok, false);
  assert.ok(missingMetafield.problems[0]!.includes("metafield"));
});
