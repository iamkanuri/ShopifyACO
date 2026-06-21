import type { Request, Response } from "express";
import { ENV } from "./env.js";
import { shopOf } from "./shopify.js";
import { syncCatalog } from "../catalog/sync.js";
import { countProducts, latestSync, listProducts } from "../db/catalog.js";
import { enqueue } from "../queue/jobs.js";

// Shop-scoped catalog API (Phase 3). requireShop sets req.shopDomain. Reads are free
// (Shopify Admin API), so triggering a sync never spends money.

/** POST /app/api/catalog/sync — start a full catalog sync (queued if the worker is on). */
export async function triggerSyncHandler(req: Request, res: Response): Promise<void> {
  const shop = shopOf(req);
  if (ENV.jobQueueEnabled) {
    // One in-flight sync per shop (idempotency key dedupes rapid re-clicks).
    const { id, created } = await enqueue({
      type: "catalog_sync",
      payload: { shop },
      shop,
      idempotencyKey: `catalog_sync:${shop}:${new Date().toISOString().slice(0, 13)}`,
    });
    res.json({ queued: true, jobId: id, deduped: !created });
    return;
  }
  // Inline (queue dormant): run now. Fine for dev/small catalogs.
  try {
    const r = await syncCatalog(shop, { resume: false });
    res.json({ queued: false, ...r });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
}

/** GET /app/api/catalog/sync/status — latest sync + product count. */
export async function syncStatusHandler(req: Request, res: Response): Promise<void> {
  const shop = shopOf(req);
  const [sync, products] = await Promise.all([latestSync(shop), countProducts(shop)]);
  res.json({ shop, products, lastSync: sync });
}

/** GET /app/api/catalog/products?q=&limit=&offset= — search/list catalog. */
export async function listProductsHandler(req: Request, res: Response): Promise<void> {
  const shop = shopOf(req);
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  const limit = Number(req.query.limit) || 50;
  const offset = Number(req.query.offset) || 0;
  const [items, total] = await Promise.all([listProducts(shop, { q, limit, offset }), countProducts(shop)]);
  res.json({ total, count: items.length, products: items });
}
