// The idempotency key that ties a paid_report (by session_id) to its durable generation job.
// Centralized in ONE place so the enqueue side and the reconciliation join can NEVER drift — a
// mismatch would silently break the dead-letter→held detection and strand a paid customer's
// payment (the exact no-silent-failure guarantee). Change the format here or nowhere.
export const PAID_JOB_PREFIX = "paid_report:";

export function paidJobKey(sessionId: string): string {
  return PAID_JOB_PREFIX + sessionId;
}
