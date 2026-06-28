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
 * SSL handshake. Detect localhost / `sslmode=disable` and turn SSL off there.
 *
 * For cloud: when a CA cert is configured (DB_CA_CERT) we do STRICT verification
 * (`verify-full`: rejectUnauthorized + the CA), which defeats a MITM; without one we fall
 * back to encrypted-but-unverified (`rejectUnauthorized:false`) — the prior behavior — so a
 * deploy never breaks just because the CA isn't set yet. `caCert` is a param (defaulting to
 * ENV) so the branching is pure + unit-testable.
 */
export function pgSslConfig(
  connectionString: string | undefined,
  caCert: string | undefined = ENV.dbCaCert,
): false | { rejectUnauthorized: boolean; ca?: string } {
  const s = (connectionString ?? "").toLowerCase();
  const isLocal = /@(localhost|127\.0\.0\.1)(:|\/)/.test(s) || s.includes("sslmode=disable");
  if (isLocal) return false;
  if (caCert) return { ca: caCert, rejectUnauthorized: true };
  return { rejectUnauthorized: false };
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
