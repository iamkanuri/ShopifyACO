import { registerHandler } from "../queue/handlers.js";
import { loadNormalizedProducts } from "../db/catalog.js";
import { getFeed, saveFeedVersion, type PersistItem } from "../db/feeds.js";
import { mapCatalog, resolveConfig } from "./map.js";
import { validateFeed } from "./validate.js";
import { computeReadiness, summarizeIssues } from "./readiness.js";
import { SPEC_VERSION } from "./spec.js";
import type { Readiness } from "./readiness.js";

// ===========================================================================
// Feed generation orchestrator (Phase 9). Reads the normalized catalog (Phase 3)
// for a shop, maps it to the target spec, validates (factual checks only), scores
// readiness, and persists a NEW versioned snapshot. This NEVER spends money and
// makes NO network calls — it's pure local computation over already-synced catalog
// rows. (Submitting/delivering the feed to OpenAI is a separate external step,
// config-gated — see deliveryStatus().) Re-generating preserves history as v+1.
// ===========================================================================

export class NoCatalogError extends Error {
  constructor(message = "No products found for this shop. Run a catalog sync before generating a feed.") {
    super(message);
    this.name = "NoCatalogError";
  }
}

export interface GenerateResult {
  feedId: number;
  versionId: number;
  version: number;
  format: string;
  specVersion: string;
  readiness: Readiness;
}

/** Generate one version of a feed from the shop's synced catalog. Tenant-checked:
 *  the feed must belong to `shop`. Throws NoCatalogError if the catalog is empty. */
export async function generateFeed(shop: string, feedId: number): Promise<GenerateResult> {
  const feed = await getFeed(feedId);
  if (!feed || feed.shop_domain !== shop) throw new Error("Feed not found for this shop.");

  const products = await loadNormalizedProducts(shop);
  if (!products.length) throw new NoCatalogError();

  const cfg = resolveConfig(shop, feed.config);
  const mapped = mapCatalog(products, cfg);
  if (!mapped.length) {
    throw new NoCatalogError(
      `All ${products.length} product(s) were filtered out (ARCHIVED, or DRAFT without includeDrafts). Nothing to put in the feed.`,
    );
  }

  const validated = validateFeed(mapped);
  const readiness = computeReadiness(validated);
  const summary = summarizeIssues(validated);

  const persist: PersistItem[] = validated.map((v) => ({
    productGid: v.item.productGid,
    variantGid: v.item.variantGid,
    itemId: typeof v.item.record.item_id === "string" ? v.item.record.item_id : null,
    status: v.status,
    record: v.item.record,
    issues: v.issues,
  }));

  const { versionId, version } = await saveFeedVersion(
    shop, feedId,
    { format: feed.format, specVersion: SPEC_VERSION, readiness, summary },
    persist,
  );

  return { feedId, versionId, version, format: feed.format, specVersion: SPEC_VERSION, readiness };
}

/** Register the worker handler. Feed generation is $0 + no network, so there is no
 *  mock/live distinction — it runs the same everywhere. */
export function registerFeedJobs(): void {
  registerHandler("feed_generate", async (payload) => {
    const shop = String(payload.shop ?? "");
    const feedId = Number(payload.feedId);
    if (!shop || !Number.isInteger(feedId)) throw new Error("feed_generate: missing shop/feedId");
    const r = await generateFeed(shop, feedId);
    return { versionId: r.versionId, version: r.version, score: r.readiness.score, items: r.readiness.itemCount };
  });
}
