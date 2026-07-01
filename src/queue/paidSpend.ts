import { pgQuery, pgTx } from "../db/pg.js";

// Paid-report Phase 2 — HARD budget isolation. Paid deep-report generation reserves against its
// OWN daily counter (paid_spend_days), a SEPARATE table from the shared queue counter (spend_days,
// used by benchmarks/monitoring) and from the free funnel's counter (runs.cost_usd). Result: no
// other workload — however busy — can starve a paying customer's generation. Atomic (row locked
// FOR UPDATE), so concurrent paid jobs across worker replicas serialize and the cap can't be exceeded.
//
// Paid generation is short (~minutes), so settle/release use current_date; a job spanning midnight
// is a non-issue here (unlike long benchmarks, which is why the shared machinery tracks per-day).

export interface PaidReserveResult {
  ok: boolean;
  spentUsd: number;
  capUsd: number;
}

/** Reserve `estimateUsd` against today's PAID-ONLY cap. Atomic; ok=false (no reservation) if it
 *  would exceed `capUsd`. */
export async function reservePaidSpend(estimateUsd: number, capUsd: number): Promise<PaidReserveResult> {
  return pgTx(async (c) => {
    await c.query("insert into paid_spend_days (day) values (current_date) on conflict (day) do nothing");
    const { rows } = await c.query<{ spent_usd: string }>(
      "select spent_usd from paid_spend_days where day = current_date for update",
    );
    const spentUsd = Number(rows[0]?.spent_usd ?? 0);
    if (spentUsd + estimateUsd > capUsd) return { ok: false, spentUsd, capUsd };
    await c.query(
      "update paid_spend_days set spent_usd = spent_usd + $1, updated_at = now() where day = current_date",
      [estimateUsd],
    );
    return { ok: true, spentUsd, capUsd };
  });
}

/** Reconcile a paid reservation's estimate to its real cost (move estimate → actual). */
export async function settlePaidSpend(estimateUsd: number, actualUsd: number): Promise<void> {
  await pgQuery(
    "update paid_spend_days set spent_usd = greatest(0, spent_usd + $1), updated_at = now() where day = current_date",
    [actualUsd - estimateUsd],
  );
}

/** Release a paid reservation that never spent (generation failed before any cost). */
export async function releasePaidSpend(estimateUsd: number): Promise<void> {
  await pgQuery(
    "update paid_spend_days set spent_usd = greatest(0, spent_usd - $1), updated_at = now() where day = current_date",
    [estimateUsd],
  );
}

/** Today's paid spend (admin/health). */
export async function currentPaidSpendUsd(): Promise<number> {
  const { rows } = await pgQuery<{ spent_usd: string }>(
    "select spent_usd from paid_spend_days where day = current_date",
  );
  return Number(rows[0]?.spent_usd ?? 0);
}
