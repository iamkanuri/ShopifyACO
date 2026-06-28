import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import pg from "pg";
import { ENV } from "../server/env.js";
import { pgSslConfig } from "./pg.js";

// Owns the schema lifecycle. Runs every migrations/*.sql not yet applied, in
// order, each in a transaction, tracked in schema_migrations. Idempotent — safe
// to run locally and again on every Railway deploy.
//
//   npm run migrate

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// App-wide advisory-lock key serializing migrate runs across the web/worker/scheduler
// services that each execute `npm run migrate` on deploy. Without it they race the same DDL
// (a schema_migrations PK conflict / deadlock) — which, now that the start command is
// `migrate && start`, would FAIL a deploy. The lock makes one apply while the others WAIT,
// then find everything already applied. A session lock auto-releases if a holder dies.
const MIGRATION_LOCK_KEY = 918273645;

/** Connect with a few retries so a TRANSIENT DB blip on deploy doesn't fail the migrate (and
 *  thus, under `&&`, the whole deploy). A genuinely-unreachable DB still fails after retries. */
async function connectWithRetry(attempts = 4): Promise<pg.Client> {
  let lastErr: Error | undefined;
  for (let i = 1; i <= attempts; i++) {
    const client = new pg.Client({
      connectionString: ENV.databaseUrl,
      ssl: pgSslConfig(ENV.databaseUrl), // SSL for cloud Supabase; off for a local dev Postgres
      connectionTimeoutMillis: 15_000,
    });
    try {
      await client.connect();
      return client;
    } catch (err) {
      lastErr = err as Error;
      await client.end().catch(() => {});
      if (i < attempts) {
        console.warn(`[migrate] connect attempt ${i}/${attempts} failed: ${lastErr.message} — retrying in ${i}s`);
        await sleep(1000 * i);
      }
    }
  }
  throw lastErr ?? new Error("connect failed");
}

/** Block until this instance holds the migration lock (or give up after maxWaitMs). */
async function acquireMigrationLock(client: pg.Client, maxWaitMs = 120_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    const { rows } = await client.query<{ ok: boolean }>("select pg_try_advisory_lock($1) as ok", [MIGRATION_LOCK_KEY]);
    if (rows[0]?.ok) return;
    if (Date.now() - start > maxWaitMs) fail("Timed out waiting for the migration lock (another instance may be stuck).");
    await sleep(1000);
  }
}

async function main(): Promise<void> {
  if (!ENV.databaseUrl) {
    fail(
      "DATABASE_URL is not set. Add it to .env (Supabase → Project Settings → Database →\n" +
        "Connection string → Session pooler, port 5432). Then re-run `npm run migrate`.",
    );
  }

  let client: pg.Client;
  try {
    client = await connectWithRetry();
  } catch (err) {
    fail(
      `Could not connect to the database: ${(err as Error).message}\n` +
        "→ This is almost always the password placeholder in DATABASE_URL. Replace\n" +
        "  [YOUR-PASSWORD] with your real Supabase database password and re-run.",
    );
  }

  try {
    // Serialize concurrent migrate runs (web/worker/scheduler) before any DDL.
    await acquireMigrationLock(client);
    await client.query(
      "create table if not exists schema_migrations (filename text primary key, applied_at timestamptz not null default now())",
    );
    const applied = new Set(
      (await client.query<{ filename: string }>("select filename from schema_migrations")).rows.map((r) => r.filename),
    );

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`· already applied: ${file}`);
        continue;
      }
      const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
      console.log(`→ applying: ${file}`);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (filename) values ($1)", [file]);
        await client.query("commit");
        ran++;
      } catch (err) {
        await client.query("rollback");
        fail(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
    console.log(ran ? `\nApplied ${ran} migration(s).` : "\nNothing to apply — schema up to date.");

    // Confirm tables exist by querying them back.
    const tables = await client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema='public' and table_name = any($1)",
      [["leads", "runs", "events"]],
    );
    const found = tables.rows.map((r) => r.table_name).sort();
    console.log(`Verified tables: ${found.join(", ") || "(none!)"}`);
    for (const t of ["leads", "runs", "events"]) {
      const c = await client.query(`select count(*)::int as n from ${t}`);
      console.log(`  ${t}: ${c.rows[0].n} rows`);
    }
    if (found.length !== 3) fail("Expected leads, runs, events — some are missing.");
  } finally {
    await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => {});
    await client.end();
  }
}

function fail(msg: string): never {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

main().catch((err) => fail((err as Error).message));
