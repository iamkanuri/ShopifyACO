import { ENV } from "../server/env.js";
import { listHeldForRefund, markRefunded } from "../db/paidReports.js";
import { refundPayment, processAutoRefund } from "./refund.js";
import { alertOwner } from "./notify.js";

// The auto-refund fallback (Phase 2), run periodically by the scheduler. A paid report that
// failed to generate is HELD (owner gets a window to hand-fix); if it's still held past the
// window, this issues the refund — and if the refund itself fails, alerts LOUDLY for manual
// action. The owner alert never depends on the refund succeeding.

export async function sweepHeldRefunds(): Promise<{ considered: number; refunded: number; failed: number }> {
  const held = await listHeldForRefund(ENV.paidRefundAfterMin);
  let refunded = 0;
  let failed = 0;
  for (const row of held) {
    const { refunded: ok } = await processAutoRefund(row, {
      refund: refundPayment,
      alert: alertOwner,
      markRefunded,
    });
    if (ok) refunded++;
    else failed++;
  }
  return { considered: held.length, refunded, failed };
}
