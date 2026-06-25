import { pgQuery, pgTx } from "./pg.js";
import type { FeedConfig, FeedRecord } from "../feeds/map.js";
import type { Issue, ItemStatus } from "../feeds/validate.js";
import type { Readiness } from "../feeds/readiness.js";

// Feed persistence (Phase 9). Shop-scoped. A `feed` is a named, configured target;
// each generation is a versioned `feed_version` snapshot with its readiness score; one
// `feed_item` row per mapped record. Storage is format-agnostic so future engine
// adapters reuse it. Re-generating creates a NEW version (history is preserved).

export interface FeedRow {
  id: number;
  shop_domain: string;
  name: string;
  format: string;
  spec_version: string | null;
  config: FeedConfig;
  created_at: string;
  updated_at: string;
}

export interface FeedVersionRow {
  id: number;
  feed_id: number;
  shop_domain: string;
  version: number;
  format: string;
  spec_version: string | null;
  status: string;
  item_count: number;
  valid_count: number;
  warning_count: number;
  error_count: number;
  readiness_score: number | null;
  readiness: Record<string, unknown>;
  summary: Record<string, number>;
  error: string | null;
  created_at: string;
}

function toFeed(r: Record<string, unknown>): FeedRow {
  return { ...(r as unknown as FeedRow), id: Number(r.id) };
}
function toVersion(r: Record<string, unknown>): FeedVersionRow {
  return {
    ...(r as unknown as FeedVersionRow),
    id: Number(r.id),
    feed_id: Number(r.feed_id),
    version: Number(r.version),
    readiness_score: r.readiness_score != null ? Number(r.readiness_score) : null,
  };
}

// ---- feed definitions ------------------------------------------------------
/** Create a feed, or update its config if the (shop,name) already exists. */
export async function upsertFeed(shop: string, input: { name: string; format?: string; config?: FeedConfig }): Promise<number> {
  const { rows } = await pgQuery<{ id: string }>(
    `insert into feeds (shop_domain, name, format, config)
     values ($1,$2,$3,$4::jsonb)
     on conflict (shop_domain, name) do update set
       format = excluded.format, config = excluded.config, updated_at = now()
     returning id`,
    [shop, input.name, input.format ?? "openai", JSON.stringify(input.config ?? {})],
  );
  return Number(rows[0]!.id);
}

export async function getFeed(id: number): Promise<FeedRow | null> {
  const { rows } = await pgQuery("select * from feeds where id=$1", [id]);
  return rows[0] ? toFeed(rows[0]) : null;
}

export async function listFeeds(shop: string): Promise<FeedRow[]> {
  const { rows } = await pgQuery("select * from feeds where shop_domain=$1 order by created_at desc", [shop]);
  return rows.map(toFeed);
}

// ---- versions + items ------------------------------------------------------
export interface PersistItem {
  productGid: string;
  variantGid: string | null;
  itemId: string | null;
  status: ItemStatus;
  record: FeedRecord;
  issues: Issue[];
}

/** Persist a generated version + all its items atomically. Version numbers are
 *  assigned under a row lock on the parent feed so concurrent generations don't
 *  collide on (feed_id, version). */
export async function saveFeedVersion(
  shop: string,
  feedId: number,
  meta: { format: string; specVersion: string; readiness: Readiness; summary: Record<string, number> },
  items: PersistItem[],
): Promise<{ versionId: number; version: number }> {
  return pgTx(async (c) => {
    // Lock the parent feed AND confirm it belongs to this shop before inserting a version
    // (defense in depth — never write a version for a missing/other-tenant feed).
    const lock = await c.query("select id from feeds where id=$1 and shop_domain=$2 for update", [feedId, shop]);
    if (!lock.rowCount) throw new Error("feed not found for this shop");
    const { rows: vr } = await c.query<{ next: string }>(
      "select coalesce(max(version),0)+1 as next from feed_versions where feed_id=$1",
      [feedId],
    );
    const version = Number(vr[0]!.next);
    const r = meta.readiness;
    const { rows: ins } = await c.query<{ id: string }>(
      `insert into feed_versions (feed_id, shop_domain, version, format, spec_version, status,
         item_count, valid_count, warning_count, error_count, readiness_score, readiness, summary)
       values ($1,$2,$3,$4,$5,'generated',$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb) returning id`,
      [feedId, shop, version, meta.format, meta.specVersion, r.itemCount, r.validCount, r.warningCount, r.errorCount,
       r.score, JSON.stringify(r), JSON.stringify(meta.summary)],
    );
    const versionId = Number(ins[0]!.id);

    // Batch insert items (8 cols/row, chunked to stay well under the bind-param limit).
    const COLS = 8;
    const CHUNK = 500;
    for (let i = 0; i < items.length; i += CHUNK) {
      const slice = items.slice(i, i + CHUNK);
      const values: string[] = [];
      const params: unknown[] = [];
      slice.forEach((it, j) => {
        const b = j * COLS;
        values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7}::jsonb,$${b + 8}::jsonb)`);
        params.push(versionId, shop, it.productGid, it.variantGid, it.itemId, it.status, JSON.stringify(it.record), JSON.stringify(it.issues));
      });
      await c.query(
        `insert into feed_items (feed_version_id, shop_domain, product_gid, variant_gid, item_id, status, record, issues)
         values ${values.join(",")}`,
        params,
      );
    }

    await c.query("update feeds set spec_version=$2, updated_at=now() where id=$1", [feedId, meta.specVersion]);
    return { versionId, version };
  });
}

export async function getFeedVersion(id: number): Promise<FeedVersionRow | null> {
  const { rows } = await pgQuery("select * from feed_versions where id=$1", [id]);
  return rows[0] ? toVersion(rows[0]) : null;
}

export async function listFeedVersions(feedId: number, limit = 50): Promise<FeedVersionRow[]> {
  const { rows } = await pgQuery(
    "select * from feed_versions where feed_id=$1 order by version desc limit $2",
    [feedId, Math.min(200, Math.max(1, limit))],
  );
  return rows.map(toVersion);
}

export async function latestFeedVersion(feedId: number): Promise<FeedVersionRow | null> {
  const { rows } = await pgQuery("select * from feed_versions where feed_id=$1 order by version desc limit 1", [feedId]);
  return rows[0] ? toVersion(rows[0]) : null;
}

export async function countFeedItems(versionId: number, opts: { status?: string } = {}): Promise<number> {
  const { rows } = await pgQuery<{ n: string }>(
    "select count(*)::int n from feed_items where feed_version_id=$1 and ($2::text is null or status=$2)",
    [versionId, opts.status ?? null],
  );
  return Number(rows[0]?.n ?? 0);
}

export async function getFeedItems(versionId: number, opts: { status?: string; limit?: number; offset?: number } = {}): Promise<Array<Record<string, unknown>>> {
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
  const offset = Math.max(0, opts.offset ?? 0);
  const { rows } = await pgQuery(
    `select product_gid, variant_gid, item_id, status, record, issues
       from feed_items where feed_version_id=$1 and ($2::text is null or status=$2)
       order by id asc limit $3 offset $4`,
    [versionId, opts.status ?? null, limit, offset],
  );
  return rows;
}

/** All records for a version, in order — used by the export serializers. */
export async function getFeedRecords(versionId: number): Promise<FeedRecord[]> {
  const { rows } = await pgQuery<{ record: FeedRecord }>(
    "select record from feed_items where feed_version_id=$1 order by id asc",
    [versionId],
  );
  return rows.map((r) => r.record);
}
