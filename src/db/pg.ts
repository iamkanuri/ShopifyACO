import pg from "pg";
import { readFileSync } from "node:fs";
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
 * Only exact loopback hosts may use plaintext for local development. Remote
 * connections always verify both certificate and hostname. Supabase's public CA
 * ships with the app; DB_CA_CERT can override it for a provider CA rollover.
 * Reject URL SSL options: node-postgres can otherwise replace this strict config.
 */
export function pgSslConfig(
  connectionString: string | undefined,
  caCert: string | undefined = ENV.dbCaCert,
): false | { rejectUnauthorized: boolean; ca?: string } {
  if (!connectionString) return { rejectUnauthorized: true };
  let url: URL;
  try { url = new URL(connectionString); }
  catch { throw new Error("DATABASE_URL must be a valid PostgreSQL URL"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("DATABASE_URL must use the postgres or postgresql scheme");
  }
  const host = url.hostname.toLowerCase();
  const connectionOverrides = ["host", "hostaddr", "port", "user", "password", "database"];
  if ([...url.searchParams.keys()].some(key => connectionOverrides.includes(key.toLowerCase()))) {
    throw new Error("DATABASE_URL query options must not override the connection destination or credentials");
  }
  if (["localhost", "127.0.0.1", "[::1]"].includes(host)) return false;
  if ([...url.searchParams.keys()].some(key => key.toLowerCase().startsWith("ssl"))) {
    throw new Error("Remove SSL query options from DATABASE_URL; remote TLS verification is managed by the application");
  }
  if (caCert) return { ca: caCert, rejectUnauthorized: true };
  if (/^db\.[a-z0-9]+\.supabase\.co$/.test(host) || /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(host)) {
    const ca = readFileSync(new URL("../../certs/supabase-prod-ca-2021.crt", import.meta.url), "utf8");
    return { ca, rejectUnauthorized: true };
  }
  return { rejectUnauthorized: true };
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
