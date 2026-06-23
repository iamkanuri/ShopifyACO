import pg from "pg";
import { ENV } from "../server/env.js";

// Runtime raw-Postgres pool for the durable job queue (Phase 1). supabase-js cannot
// express `FOR UPDATE SKIP LOCKED` or multi-statement transactions with row locks,
// which atomic job claiming and spend reservation require. Everything else still
// goes through supabase-js. Lazy + graceful: if DATABASE_URL is unset, hasPg() is
// false and callers fall back to the legacy in-process path.

let pool: pg.Pool | null = null;

export function hasPg(): boolean {
  return Boolean(ENV.databaseUrl);
}

/**
 * SSL config for a Postgres connection. Supabase **cloud** requires SSL, but a **local**
 * dev Postgres (localhost — e.g. the Supabase CLI stack) speaks plaintext and rejects an
 * SSL handshake. Detect localhost / `sslmode=disable` and turn SSL off there; everything
 * else (prod) keeps SSL on. Lets dev point at a local DB without touching prod behavior.
 */
export function pgSslConfig(connectionString: string | undefined): false | { rejectUnauthorized: boolean } {
  const s = (connectionString ?? "").toLowerCase();
  const isLocal = /@(localhost|127\.0\.0\.1)(:|\/)/.test(s) || s.includes("sslmode=disable");
  return isLocal ? false : { rejectUnauthorized: false };
}

function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: ENV.databaseUrl,
      ssl: pgSslConfig(ENV.databaseUrl),
      max: Number(process.env.PG_POOL_MAX ?? 8),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
    });
    pool.on("error", (err) => console.error("[pg] idle client error:", err.message));
  }
  return pool;
}

export async function pgQuery<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params as never[]);
}

/** Run `fn` inside a transaction; commits on success, rolls back on throw. */
export async function pgTx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      /* ignore rollback error */
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function closePg(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
