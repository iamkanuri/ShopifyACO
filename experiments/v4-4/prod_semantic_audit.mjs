// v4.4 §1.1 + §2 — IS THE TIER ON IN PRODUCTION, AND WHAT DID IT PERMANENTLY MINT?
//
// Two questions, one connection, because they read the same database:
//   §1.1  Did the DEPLOYED process invoke the tier? `funnel_events.semantic_invoked`
//         is written by the live server (src/server/index.ts:954) from
//         `Boolean(result.semantic)`, and `result.semantic` is set only when
//         `outcome.stats.called` — i.e. only when a model call actually happened.
//         This is evidence FROM THE PROCESS, not from reading the code.
//   §2    How many PERMANENT rows in `public_tests` contain a tier-granted pass?
//         A grant is `result.semantic.granted > 0` (general) or
//         `result.result.semantic.granted > 0` (standard).
//
// ⚠️ TWO-SIDED CANARY. A grant count of zero is meaningless unless the query can be
// shown to see the field at all. So the script separately counts rows where the
// `semantic` OBJECT is present (tier ran, granted 0 or more) and rows where it is
// ABSENT (tier never ran). If NO row anywhere carries the object, the JSON path is
// unproven and the run resolves INCOMPLETE rather than reporting a flattering zero.
// The same rule for §1.1: `semantic_invoked` true on 0 of 0 events is not "off".
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const repo = path.resolve(here, "..", "..");

// Prod creds live in the gitignored .env.prod.bak. Read here, never printed.
const envFile = process.env.PROD_ENV_FILE || path.join(repo, ".env.prod.bak");
if (!fs.existsSync(envFile)) { console.error(`no ${envFile}`); process.exit(2); }
const conn = fs.readFileSync(envFile, "utf8")
  .split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))?.slice("DATABASE_URL=".length).trim()
  .replace(/^["']|["']$/g, "");
if (!conn) { console.error("no DATABASE_URL in prod env file"); process.exit(2); }

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
const out = { completion: "INCOMPLETE", reasons: [] };

async function q(sql, params = []) { return (await client.query(sql, params)).rows; }

try {
  await client.connect();
  const [{ now }] = await q("select now()::text as now");
  console.log(`connected to production · server time ${now}\n`);

  // ---------------------------------------------------------------- §1.1
  console.log("=".repeat(78));
  console.log("§1.1 — DID THE DEPLOYED PROCESS INVOKE THE TIER?");
  console.log("=".repeat(78));

  const fe = await q(`
    select count(*)::int                                              as total,
           count(*) filter (where semantic_invoked is true)::int       as invoked_true,
           count(*) filter (where semantic_invoked is false)::int      as invoked_false,
           count(*) filter (where semantic_invoked is null)::int       as invoked_null,
           coalesce(sum(semantic_cost_usd), 0)::float                  as cost_usd,
           min(at)::text                                              as first_event,
           max(at)::text                                              as last_event
      from funnel_events`);
  const f = fe[0];
  console.log(`funnel_events rows            ${f.total}`);
  console.log(`  semantic_invoked = true     ${f.invoked_true}`);
  console.log(`  semantic_invoked = false    ${f.invoked_false}`);
  console.log(`  semantic_invoked = null     ${f.invoked_null}`);
  console.log(`  summed semantic spend       $${f.cost_usd.toFixed(5)}`);
  console.log(`  window                      ${f.first_event} .. ${f.last_event}`);

  // Which event names carry it, and the most recent invocation.
  const byName = await q(`
    select name, count(*)::int as n,
           count(*) filter (where semantic_invoked is true)::int as invoked,
           max(at)::text as last
      from funnel_events group by name order by n desc`);
  console.log("\n  by event name:");
  for (const r of byName) console.log(`    ${r.name.padEnd(26)} n=${String(r.n).padEnd(5)} invoked=${String(r.invoked).padEnd(5)} last=${r.last}`);

  const recent = await q(`
    select at::text as at, name, semantic_invoked, semantic_cost_usd
      from funnel_events where semantic_invoked is true
      order by at desc limit 10`);
  if (recent.length) {
    console.log("\n  most recent invocations:");
    for (const r of recent) console.log(`    ${r.at}  ${r.name}  $${Number(r.semantic_cost_usd ?? 0).toFixed(5)}`);
  }

  // CANARY for §1.1: the column must be shown to carry BOTH values, or "false
  // everywhere" is indistinguishable from a column nothing ever writes.
  const t11 = f.invoked_true > 0, fa11 = f.invoked_false > 0 || f.invoked_null > 0;
  console.log(`\n  canary: column carries true=${t11} and false/null=${fa11}`);
  if (f.total === 0) out.reasons.push("§1.1: funnel_events is empty — cannot read the deployed process");
  else if (!t11 && !fa11) out.reasons.push("§1.1: semantic_invoked is uniformly unwritten");

  // ---------------------------------------------------------------- §2
  console.log("\n" + "=".repeat(78));
  console.log("§2 — PERMANENT RESULTS THAT MAY CONTAIN A TIER-GRANTED PASS");
  console.log("=".repeat(78));

  const pt = await q(`
    select count(*)::int as total,
           count(*) filter (where kind = 'standard')::int as standard,
           count(*) filter (where kind = 'general')::int  as general,
           min(created_at)::text as first_row, max(created_at)::text as last_row
      from public_tests`);
  const p = pt[0];
  console.log(`public_tests rows             ${p.total}   (standard ${p.standard} · general ${p.general})`);
  console.log(`  window                      ${p.first_row} .. ${p.last_row}`);

  // The semantic object, looked for at BOTH shapes. coalesce picks whichever exists.
  const sem = await q(`
    with s as (
      select token, kind, store_host, product_url, created_at, ran_at, engine_version,
             standard_version, shared_at, superseded_by,
             coalesce(result->'semantic', result->'result'->'semantic') as semantic
        from public_tests
    )
    select count(*)::int                                                     as total,
           count(*) filter (where semantic is not null)::int                 as has_object,
           count(*) filter (where semantic is null)::int                     as no_object,
           count(*) filter (where (semantic->>'called')::boolean is true)::int as called_true,
           count(*) filter (where (semantic->>'granted')::int > 0)::int      as granted_gt0,
           count(*) filter (where (semantic->>'granted')::int = 0)::int      as granted_eq0,
           count(*) filter (where (semantic->>'vetoed')::int  > 0)::int      as vetoed_gt0,
           coalesce(sum((semantic->>'granted')::int), 0)::int                as grants_total
      from s`);
  const s = sem[0];
  console.log(`\n  rows carrying a semantic object   ${s.has_object}`);
  console.log(`  rows with NO semantic object      ${s.no_object}   (tier never ran / never stored)`);
  console.log(`  semantic.called = true            ${s.called_true}`);
  console.log(`  semantic.granted > 0              ${s.granted_gt0}    <-- AFFECTED PERMANENT RESULTS`);
  console.log(`  semantic.granted = 0              ${s.granted_eq0}`);
  console.log(`  semantic.vetoed  > 0              ${s.vetoed_gt0}`);
  console.log(`  total grants across all rows       ${s.grants_total}`);

  // CANARY for §2: the JSON path must be shown to resolve on at least one row, or
  // "granted > 0 on zero rows" is indistinguishable from a path that matches nothing.
  const pathLive = s.has_object > 0;
  console.log(`\n  canary: JSON path resolves on >=1 row = ${pathLive}`);
  if (p.total === 0) out.reasons.push("§2: public_tests is empty");
  else if (!pathLive) out.reasons.push("§2: the semantic JSON path resolved on NO row — path unproven, zero is not a measurement");

  // Name every affected row in full.
  if (s.granted_gt0 > 0) {
    const rows = await q(`
      with s as (
        select token, kind, store_host, product_url, created_at, ran_at, engine_version,
               standard_slug, standard_version, shared_at, superseded_by, result,
               coalesce(result->'semantic', result->'result'->'semantic') as semantic
          from public_tests
      )
      select * from s where (semantic->>'granted')::int > 0 order by created_at`);
    console.log("\n  AFFECTED ROWS, named:");
    for (const r of rows) {
      console.log(`\n  --- ${r.token} (${r.kind}) ---`);
      console.log(`      store        ${r.store_host}`);
      console.log(`      url          ${r.product_url}`);
      console.log(`      created      ${r.created_at}`);
      console.log(`      engine       ${r.engine_version}  standard ${r.standard_slug ?? "-"} ${r.standard_version ?? ""}`);
      console.log(`      shared_at    ${r.shared_at ?? "not shared"}   superseded_by ${r.superseded_by ?? "-"}`);
      console.log(`      semantic     ${JSON.stringify(r.semantic)}`);
      const res = r.kind === "standard" ? (r.result.result ?? {}) : r.result;
      const passes = (res.assertions ?? []).filter((a) => a.status === "pass_evidenced");
      console.log(`      pass rows    ${passes.length}`);
      for (const a of passes) {
        console.log(`        · ${a.label}`);
        console.log(`          detail: ${a.detail}`);
        console.log(`          quote:  ${a.evidenceQuote ? JSON.stringify(a.evidenceQuote) : "(none)"}`);
        console.log(`          surface:${a.evidenceSurface ?? "-"}`);
      }
    }
    fs.writeFileSync(path.join(here, "affected_rows.json"), JSON.stringify(rows, null, 2));
    console.log(`\n  full rows written to experiments/v4-4/affected_rows.json`);
  }

  // The exposure window, from the record, regardless of the count.
  const win = await q(`
    select date_trunc('day', created_at)::date::text as day, count(*)::int as n,
           count(*) filter (where kind='standard')::int as std
      from public_tests group by 1 order by 1`);
  console.log("\n  public_tests minted per day:");
  for (const w of win) console.log(`    ${w.day}   n=${String(w.n).padEnd(4)} standard=${w.std}`);

  out.grantedRows = s.granted_gt0;
  out.hasObject = s.has_object;
  out.total = p.total;
  out.invokedTrue = f.invoked_true;

  if (!out.reasons.length) out.completion = "VERIFIED_CLEAN";
  else out.completion = "INCOMPLETE";
} catch (e) {
  out.reasons.push(`EXCEPTION: ${e.message}`);
  out.completion = "INCOMPLETE";
  console.error(`\nFAILED: ${e.message}`);
} finally {
  await client.end().catch(() => {});
}

console.log("\n" + "=".repeat(78));
console.log(`completion: ${out.completion}`);
for (const r of out.reasons) console.log(`  reason: ${r}`);
console.log(JSON.stringify(out));
