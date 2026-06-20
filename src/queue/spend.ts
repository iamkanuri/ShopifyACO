import { pgQuery, pgTx } from "../db/pg.js";

// Atomic, multi-instance-safe spend control (Phase 1). The legacy guard used
// max(in-memory, DB sum) — correct only for ONE process. Here a single per-day
// counter row (`spend_days`) is locked FOR UPDATE inside a transaction, so concurrent
// reservations across web/worker replicas serialize and the cap can never be exceeded.
// Each scan reserves its worst-case estimate BEFORE work, then reconciles to actuals.

export interface ReserveResult {
  ok: boolean;
  reservationId?: number;
  spentUsd: number; // reserved + actual already held today
  capUsd: number;
}

/** Reserve `estimateUsd` against today's cap. Atomic: returns ok=false (no reservation)
 *  if it would exceed `capUsd`. */
export async function reserveSpend(runId: string | undefined, estimateUsd: number, capUsd: number): Promise<ReserveResult> {
  return pgTx(async (c) => {
    // Ensure today's counter row exists, then lock it (serializes all reservations).
    await c.query("insert into spend_days (day) values (current_date) on conflict (day) do nothing");
    const { rows } = await c.query<{ reserved_usd: string; actual_usd: string }>(
      "select reserved_usd, actual_usd from spend_days where day = current_date for update",
    );
    const reserved = Number(rows[0]?.reserved_usd ?? 0);
    const actual = Number(rows[0]?.actual_usd ?? 0);
    const spentUsd = reserved + actual;
    if (spentUsd + estimateUsd > capUsd) {
      return { ok: false, spentUsd, capUsd };
    }
    const ins = await c.query<{ id: string }>(
      "insert into spend_reservations (run_id, estimate_usd, status) values ($1, $2, 'active') returning id",
      [runId ?? null, estimateUsd],
    );
    await c.query(
      "update spend_days set reserved_usd = reserved_usd + $1, updated_at = now() where day = current_date",
      [estimateUsd],
    );
    return { ok: true, reservationId: Number(ins.rows[0]!.id), spentUsd, capUsd };
  });
}

/** Reconcile a reservation to its real cost: move estimate→actual on the day counter. */
export async function reconcileSpend(reservationId: number, actualUsd: number): Promise<void> {
  await pgTx(async (c) => {
    const { rows } = await c.query<{ estimate_usd: string; status: string }>(
      "select estimate_usd, status from spend_reservations where id = $1 for update",
      [reservationId],
    );
    const row = rows[0];
    if (!row || row.status !== "active") return; // already settled — idempotent
    const estimate = Number(row.estimate_usd);
    await c.query(
      "update spend_reservations set actual_usd = $1, status = 'reconciled', updated_at = now() where id = $2",
      [actualUsd, reservationId],
    );
    await c.query(
      "update spend_days set reserved_usd = greatest(0, reserved_usd - $1), actual_usd = actual_usd + $2, updated_at = now() where day = current_date",
      [estimate, actualUsd],
    );
  });
}

/** Release a reservation that never spent (job failed/cancelled before any cost). */
export async function releaseSpend(reservationId: number): Promise<void> {
  await reconcileSpend(reservationId, 0);
}

/** Today's committed+held spend (DB-authoritative). */
export async function currentSpendDbUsd(): Promise<number> {
  const { rows } = await pgQuery<{ reserved_usd: string; actual_usd: string }>(
    "select reserved_usd, actual_usd from spend_days where day = current_date",
  );
  return Number(rows[0]?.reserved_usd ?? 0) + Number(rows[0]?.actual_usd ?? 0);
}

export interface UsageRow {
  runId?: string;
  shop?: string;
  engine?: string;
  model?: string;
  plan?: string;
  promptTokens?: number;
  completionTokens?: number;
  costUsd: number;
}

/** Append-only usage ledger by shop/run/engine/model/plan. */
export async function recordUsage(u: UsageRow): Promise<void> {
  await pgQuery(
    `insert into usage_ledger (run_id, shop, engine, model, plan, prompt_tokens, completion_tokens, cost_usd)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [u.runId ?? null, u.shop ?? null, u.engine ?? null, u.model ?? null, u.plan ?? null,
     u.promptTokens ?? null, u.completionTokens ?? null, u.costUsd],
  );
}
