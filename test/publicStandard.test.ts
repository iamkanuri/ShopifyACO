import { test } from "node:test";
import assert from "node:assert/strict";

import { peerRatesFor } from "../src/server/publicStandard.js";
import { loadPublishedStandards, currentOf, measuredOf } from "../src/server/standardsSite.js";

// ===========================================================================
// THE PEER LINE — every figure DERIVED, and the denominator trap closed.
//
// "X of 100 coffee stores don't state this" is the single most legible sentence this data
// supports, and it is false for HALF the entries. Five of the ten measured coffee entries
// were asked of fewer than 100 products, each for a recorded reason: 24 products publish no
// Product structured data, so IDENT-001 was asked of 76; one product is pre-portioned, so
// the FORMAT and GRIND entries were asked of 99.
//
// Worse, DELIV-001 was ASKED of 100 and could only be DECIDED on 74 — the other 26 returned
// "requires store access". Counting an undecided row as a pass is a different measurement,
// and this project has published both by accident: v1.1 stated 45% (failures over ASKED)
// and the adjudicated reading is 60.8%. A 15.8-point gap, from one denominator choice.
//
// So the rule these tests enforce: a peer figure is read through `measuredOf`, its
// denominator is the ADJUDICATED count, and any undecided rows are carried so the rendered
// sentence can name them.
// ===========================================================================

loadPublishedStandards();

const coffee = currentOf("coffee");

test("[peer] every peer rate is derived, and pass + fail reconciles to the denominator", () => {
  assert.ok(coffee, "no current coffee standard");
  const ids = coffee!.doc.entries.map((e) => e.id);
  const peers = peerRatesFor(coffee!, ids);
  assert.ok(peers.length >= 10, `only ${peers.length} measured entries — the peer line has lost its data`);
  for (const p of peers) {
    assert.equal(p.passed + p.failed, p.adjudicated, `${p.entryId}: pass+fail does not equal the denominator`);
    assert.ok(p.passed >= 0 && p.failed >= 0, `${p.entryId}: a negative count`);
    assert.ok(p.adjudicated > 0, `${p.entryId}: an empty denominator would render "0 of 0"`);
    assert.equal(p.undecided, p.asked - p.adjudicated, `${p.entryId}: undecided does not reconcile`);
    assert.ok(p.undecided >= 0, `${p.entryId}: more rows adjudicated than asked`);
  }
});

test("[peer] the denominator is NOT assumed to be 100 — and it must not be", () => {
  // Anti-vacuity in both directions: if every entry really were n=100 this test would be
  // asserting nothing, so it requires the mixed case to still exist in the artifact.
  const peers = peerRatesFor(coffee!, coffee!.doc.entries.map((e) => e.id));
  const denominators = new Set(peers.map((p) => p.adjudicated));
  assert.ok(
    denominators.size > 1,
    `every measured entry now shares one denominator (${[...denominators]}) — re-read this test's ` +
    "header before relaxing it; the whole point is that a peer sentence must name its own n",
  );
  const notHundred = peers.filter((p) => p.adjudicated !== 100);
  assert.ok(
    notHundred.length >= 3,
    `only ${notHundred.length} entries have a denominator other than 100 — a hard-coded "of 100" ` +
    "would now be nearly right, which is exactly when someone writes it",
  );
});

test("[peer] at least one entry carries UNDECIDED rows, and they are excluded from the denominator", () => {
  const peers = peerRatesFor(coffee!, coffee!.doc.entries.map((e) => e.id));
  const withUndecided = peers.filter((p) => p.undecided > 0);
  assert.ok(
    withUndecided.length >= 1,
    "no entry carries undecided rows — the case this whole distinction exists for has vanished " +
    "from the artifact, so the rendering rule is now untested",
  );
  for (const p of withUndecided) {
    // The failure rate must be over the ADJUDICATED rows. Over `asked` it would be lower,
    // which is the flattering direction and the one v1.1 published.
    const overAdjudicated = (100 * p.failed) / p.adjudicated;
    const overAsked = (100 * p.failed) / p.asked;
    assert.ok(Math.abs(p.failPct - overAdjudicated) < 0.05,
      `${p.entryId}: the published rate is not over the adjudicated rows`);
    assert.ok(overAsked < overAdjudicated,
      `${p.entryId}: the two readings coincide, so this assertion is not covering the gap it exists for`);
  }
});

test("[peer] rates come from measuredOf, NOT from the raw document field", () => {
  // ⚠️ v1.3 carries IDENT-001's rate in its SIDECAR and the other nine inside the document.
  // Reading `standard.json` directly publishes the superseded number for that one entry —
  // 94.7% (72 of 76) where the current record is 97.4% (74 of 76). This is the fourth
  // distinct place in this codebase where reading a raw measurement field instead of the
  // normaliser produced a confidently wrong page, and the first three all shipped.
  const ident = coffee!.doc.entries.find((e) => /IDENT-001$/.test(e.id));
  assert.ok(ident, "IDENT-001 is gone — this guard no longer covers anything");
  const m = measuredOf(coffee!, ident!);
  assert.ok(m, "IDENT-001 has no measured record");
  const peers = peerRatesFor(coffee!, [ident!.id]);
  assert.equal(peers.length, 1);
  assert.equal(peers[0]!.failed, m!.fail_count, "the peer rate disagrees with the normaliser");

  const raw = (ident as unknown as { measured_discrimination?: { fail_count?: number } }).measured_discrimination;
  if (raw?.fail_count !== undefined && raw.fail_count !== m!.fail_count) {
    assert.notEqual(
      peers[0]!.failed, raw.fail_count,
      "the peer rate is reading the RAW document field, which the sidecar supersedes",
    );
  }
});
