type MigrationClient = {query(sql: string): Promise<{rows: Array<{migration_table?: string | null}>}>};

/** A fully migrated database needs no DDL on restart. Pending migrations still
 * run normally and any failure still stops startup through `migrate && start`. */
export async function ensureMigrationTable(client: MigrationClient): Promise<void> {
  const result = await client.query("select to_regclass('public.schema_migrations')::text as migration_table");
  if (result.rows[0]?.migration_table) return;
  await client.query("create table if not exists schema_migrations (filename text primary key, applied_at timestamptz not null default now())");
}
