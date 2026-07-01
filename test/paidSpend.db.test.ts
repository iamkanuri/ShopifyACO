import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { pgQuery } from "../src/db/pg.js";
import { reserveSpend, currentSpendDbUsd } from "../src/queue/spend.js";
import { reservePaidSpend, settlePaidSpend, releasePaidSpend, currentPaidSpendUsd } from "../src/queue/paidSpend.js";

// Paid-report Phase 2, decision (b): PAID budget is HARD-isolated — its own counter
// (paid_spend_days), untouchable by the shared queue counter (spend_days, used by
// benchmarks/monitoring). A busy day of queue jobs must NOT starve a paying customer.
//   RUN_DB_TESTS=1 npm run test:db

const DB = process.env.RUN_DB_TESTS === "1";

async function clean() {
  await pgQuery("delete from paid_spend_days where day = current_date").catch(() => {});
  await pgQuery("delete from spend_reservations where run_id like 'paidisotest:%'").catch(() => {});
  await pgQuery("delete from spend_days where day = current_date").catch(() => {});
}

test("PAID budget is isolated: a busy shared-queue day cannot starve paid (nor vice-versa)", { skip: !DB }, async () => {
  await clean();
  try {
    // Simulate a BUSY monitoring/benchmark day: fill the SHARED spend_days to (near) its cap.
    const shared = await reserveSpend("paidisotest:busy", 9.5, 10);
    assert.equal(shared.ok, true, "shared queue reserved 9.5/10");
    assert.equal(await currentSpendDbUsd(), 9.5);

    // Paid reservation must STILL succeed — it draws on paid_spend_days, not spend_days.
    const paid = await reservePaidSpend(1.5, 5);
    assert.equal(paid.ok, true, "a busy shared-queue day must NOT block paid generation");
    assert.equal(paid.spentUsd, 0, "paid counter started at 0 — the shared 9.5 is invisible to it");

    // …and paid did NOT touch the shared counter (isolation both ways).
    assert.equal(await currentSpendDbUsd(), 9.5, "the shared counter is unchanged by a paid reservation");
    assert.equal(await currentPaidSpendUsd(), 1.5, "the paid counter holds only paid spend");
  } finally {
    await clean();
  }
});

test("PAID budget enforces its OWN cap + settle/release adjust correctly", { skip: !DB }, async () => {
  await clean();
  try {
    assert.equal((await reservePaidSpend(4, 5)).ok, true, "4/5 ok");
    assert.equal((await reservePaidSpend(2, 5)).ok, false, "4+2 > 5 → rejected by the paid cap");

    await settlePaidSpend(4, 1); // reconcile the first reservation's estimate (4) to real cost (1)
    assert.equal(await currentPaidSpendUsd(), 1, "settle moved 4 → 1");

    assert.equal((await reservePaidSpend(2, 5)).ok, true, "now 1+2 <= 5 → ok");
    await releasePaidSpend(2); // that job failed before spending → release its estimate
    assert.equal(await currentPaidSpendUsd(), 1, "release returned the 2");
  } finally {
    await clean();
  }
});
