import type { Request, Response } from "express";
import { ENV } from "./env.js";
import { shopOf } from "./shopify.js";
import { enqueue } from "../queue/jobs.js";
import {
  countFeedItems, getFeed, getFeedItems, getFeedRecords, getFeedVersion,
  listFeedVersions, listFeeds, latestFeedVersion, upsertFeed, type FeedRow, type FeedVersionRow,
} from "../db/feeds.js";
import { generateFeed, NoCatalogError } from "../feeds/generate.js";
import { assertFeedQuota, gateDenial } from "../billing/enforce.js";
import { specManifest } from "../feeds/spec.js";
import { exportFeed } from "../feeds/export.js";
import { isExportFormat } from "../feeds/spec.js";
import type { FeedConfig } from "../feeds/map.js";

// Shop-scoped Product-Feed API (Phase 9). requireShop sets req.shopDomain; every
// handler is tenant-isolated. Generation is $0 + no network; the only externally-
// effectful concept (delivery to OpenAI) is config-gated and never faked.

const SUPPORTED_FORMATS = ["openai"]; // gemini/copilot/shopify_catalog: storage ready, mappers later

/** Whitelist config to known keys (don't persist arbitrary attacker-controlled jsonb). */
function sanitizeConfig(raw: unknown): FeedConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const b = (v: unknown) => (typeof v === "boolean" ? v : undefined);
  const list = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean).slice(0, 50) : undefined;
  return {
    currency: s(c.currency),
    isEligibleSearch: b(c.isEligibleSearch),
    isEligibleCheckout: b(c.isEligibleCheckout),
    sellerName: s(c.sellerName),
    sellerUrl: s(c.sellerUrl),
    sellerPrivacyPolicy: s(c.sellerPrivacyPolicy),
    sellerTos: s(c.sellerTos),
    returnPolicy: s(c.returnPolicy),
    targetCountries: list(c.targetCountries),
    storeCountry: s(c.storeCountry),
    condition: s(c.condition),
    includeDrafts: b(c.includeDrafts),
  };
}

const feedSummary = (f: FeedRow, latest: FeedVersionRow | null) => ({
  id: f.id, name: f.name, format: f.format, specVersion: f.spec_version, config: f.config,
  createdAt: f.created_at, updatedAt: f.updated_at,
  latestVersion: latest
    ? { version: latest.version, score: latest.readiness_score, itemCount: latest.item_count, errorCount: latest.error_count, createdAt: latest.created_at }
    : null,
});

// ---- ownership helpers -----------------------------------------------------
async function ownedFeed(req: Request, res: Response): Promise<FeedRow | null> {
  const id = Number(req.params.id);
  const feed = Number.isInteger(id) ? await getFeed(id) : null;
  if (!feed || feed.shop_domain !== shopOf(req)) {
    res.status(404).json({ error: "Feed not found for this shop." });
    return null;
  }
  return feed;
}
async function ownedVersion(req: Request, res: Response): Promise<FeedVersionRow | null> {
  const vid = Number(req.params.vid);
  const v = Number.isInteger(vid) ? await getFeedVersion(vid) : null;
  if (!v || v.shop_domain !== shopOf(req)) {
    res.status(404).json({ error: "Feed version not found for this shop." });
    return null;
  }
  return v;
}

// ---- handlers --------------------------------------------------------------
/** POST /app/api/feeds { name, format?, config? } — create/update a feed definition. */
export async function createFeedHandler(req: Request, res: Response): Promise<void> {
  const shop = shopOf(req);
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "name is required." });
    return;
  }
  const format = typeof req.body?.format === "string" ? req.body.format : "openai";
  if (!SUPPORTED_FORMATS.includes(format)) {
    res.status(400).json({ error: `Unsupported format "${format}". Supported: ${SUPPORTED_FORMATS.join(", ")}.` });
    return;
  }
  // Entitlement gate (Phase 11, dormant until BILLING_ENFORCED=1): cap the number of
  // distinct feeds per plan. Updating an existing feed (same name) never counts.
  const existing = await listFeeds(shop);
  const isNew = !existing.some((f) => f.name === name);
  if (isNew) {
    const quota = await assertFeedQuota(shop, existing.length);
    if (!quota.allowed) { res.status(402).json(gateDenial(quota)); return; }
  }
  const id = await upsertFeed(shop, { name, format, config: sanitizeConfig(req.body?.config) });
  res.json({ id, name, format });
}

/** GET /app/api/feeds — list feeds with their latest version summary. */
export async function listFeedsHandler(req: Request, res: Response): Promise<void> {
  const feeds = await listFeeds(shopOf(req));
  const withLatest = await Promise.all(feeds.map(async (f) => feedSummary(f, await latestFeedVersion(f.id))));
  res.json({ count: withLatest.length, feeds: withLatest });
}

/** POST /app/api/feeds/:id/generate — generate a new version from the synced catalog.
 *  Free + no network; enqueued when the worker is on, else run inline. */
export async function generateFeedHandler(req: Request, res: Response): Promise<void> {
  const feed = await ownedFeed(req, res);
  if (!feed) return;
  const shop = shopOf(req);
  if (ENV.jobQueueEnabled) {
    // Key on the feed's updated_at (changes on every config edit and after each
    // generation) so a config change → regenerate is NOT deduped, while rapid
    // double-clicks with no intervening change still collapse to one job.
    const { id, created } = await enqueue({
      type: "feed_generate",
      payload: { shop, feedId: feed.id },
      shop,
      idempotencyKey: `feed_generate:${feed.id}:${feed.updated_at}`,
    });
    res.json({ queued: true, jobId: id, deduped: !created });
    return;
  }
  try {
    const r = await generateFeed(shop, feed.id);
    res.json({ queued: false, versionId: r.versionId, version: r.version, readiness: r.readiness });
  } catch (err) {
    if (err instanceof NoCatalogError) {
      res.status(409).json({ error: err.message, code: "no_catalog" });
      return;
    }
    res.status(502).json({ error: (err as Error).message });
  }
}

/** GET /app/api/feeds/:id/versions — version history for a feed. */
export async function listVersionsHandler(req: Request, res: Response): Promise<void> {
  const feed = await ownedFeed(req, res);
  if (!feed) return;
  const versions = await listFeedVersions(feed.id);
  res.json({ feedId: feed.id, count: versions.length, versions });
}

/** GET /app/api/feeds/versions/:vid — one version (readiness + summary). */
export async function getVersionHandler(req: Request, res: Response): Promise<void> {
  const v = await ownedVersion(req, res);
  if (!v) return;
  res.json({ version: v });
}

/** GET /app/api/feeds/versions/:vid/items?status=&limit=&offset= — per-item validation. */
export async function listItemsHandler(req: Request, res: Response): Promise<void> {
  const v = await ownedVersion(req, res);
  if (!v) return;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const limit = Number(req.query.limit) || 100;
  const offset = Number(req.query.offset) || 0;
  const [items, total] = await Promise.all([
    getFeedItems(v.id, { status, limit, offset }),
    countFeedItems(v.id, { status }),
  ]);
  res.json({ versionId: v.id, total, count: items.length, items });
}

/** GET /app/api/feeds/versions/:vid/export?format=csv|tsv|json|jsonl — download the feed. */
export async function exportVersionHandler(req: Request, res: Response): Promise<void> {
  const v = await ownedVersion(req, res);
  if (!v) return;
  const format = req.query.format;
  if (!isExportFormat(format)) {
    res.status(400).json({ error: "format must be one of: csv, tsv, json, jsonl." });
    return;
  }
  const feed = await getFeed(v.feed_id);
  const records = await getFeedRecords(v.id);
  const out = exportFeed(records, format, { feedName: feed?.name, version: v.version });
  res.setHeader("Content-Type", out.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${out.filename}"`);
  res.setHeader("X-Feed-Format-Official", String(out.official));
  res.send(out.body);
}

/** GET /app/api/feeds/spec — the spec we validate against (transparency, not a black box). */
export async function feedSpecHandler(_req: Request, res: Response): Promise<void> {
  res.json(specManifest("openai"));
}

/** GET /app/api/feeds/delivery/status — honest delivery state. Generating a feed is
 *  NOT submitting it; OpenAI onboarding/delivery is an external, config-gated step. */
export async function deliveryStatusHandler(_req: Request, res: Response): Promise<void> {
  res.json({
    enabled: ENV.feeds.deliveryEnabled,
    configured: ENV.feeds.deliveryEnabled,
    message: ENV.feeds.deliveryEnabled
      ? "Feed delivery is enabled by configuration."
      : "Feed delivery is not configured. Generating/exporting a feed does not submit it — OpenAI merchant onboarding + a delivery endpoint are an external step (see LAUNCH_CHECKLIST item 8). Export the file and submit it through OpenAI's process.",
  });
}
