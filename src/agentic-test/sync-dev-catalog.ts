import "dotenv/config";
import { syncCatalog } from "../catalog/sync.js";
import { storeCredentials, upsertShop } from "../db/shops.js";
import { closePg, pgQuery } from "../db/pg.js";
import { DEV_SHOP_ID } from "./contract.js";
import { assertLocalDatabase, assertRunnable } from "./preflight.js";

// ===========================================================================
// Stage 2: sync the REAL dev-store catalog into the LOCAL stack through the
// EXISTING ingestion pipeline (upsertShop → storeCredentials → syncCatalog →
// products tables), exactly the path production uses. Read-only against
// Shopify (read_products). Guards: feature flag + allowlist + local-DB-only.
//
// Run: AGENTIC_INSTRUMENT_TEST_ENABLED=true APP_ENCRYPTION_KEY=<any 32B b64> \
//        npx tsx src/agentic-test/sync-dev-catalog.ts
// ===========================================================================

async function main(): Promise<void> {
  assertRunnable(process.env, DEV_SHOP_ID);
  assertLocalDatabase(process.env.DATABASE_URL);
  if ((process.env.SHOPIFY_MODE ?? "live") !== "live") {
    throw new Error("SHOPIFY_MODE must be live (or unset) — this step ingests the REAL dev catalog");
  }
  const token = process.env.SHOPIFY_DEV_STORE_TOKEN?.trim();
  if (!token) throw new Error("SHOPIFY_DEV_STORE_TOKEN is not set");

  await upsertShop(DEV_SHOP_ID, { status: "active", scopes: "read_products" });
  await storeCredentials(DEV_SHOP_ID, token, "read_products");
  const r = await syncCatalog(DEV_SHOP_ID);
  console.log(`[sync] real catalog synced: ${r.productsSynced} products (sync ${r.syncId}, removed ${r.productsRemoved})`);

  const { rows } = await pgQuery<{
    product_gid: string; title: string; desc_len: number; metafields: number; variants: number;
  }>(
    `select p.product_gid, p.title, length(coalesce(p.description,'')) as desc_len,
            jsonb_array_length(p.metafields) as metafields,
            (select count(*)::int from product_variants v where v.shop_domain=p.shop_domain and v.product_gid=p.product_gid) as variants
       from products p where p.shop_domain=$1 order by p.title`,
    [DEV_SHOP_ID],
  );
  for (const row of rows) {
    console.log(`[sync] ${row.title} (${row.product_gid}) — desc ${row.desc_len} chars, ${row.metafields} metafields, ${row.variants} variants`);
  }

  const cedar = rows.find((x) => x.title === "Cedar Hollow Natural Deodorant");
  const harbor = rows.find((x) => x.title === "Harbor Lane Shave Soap");
  if (!cedar || cedar.variants !== 4 || cedar.metafields < 2) {
    throw new Error("verification failed: Cedar Hollow missing or incomplete after sync");
  }
  if (!harbor || harbor.variants !== 1) {
    throw new Error("verification failed: Harbor Lane missing or incomplete after sync");
  }
  const { rows: mf } = await pgQuery<{ metafields: unknown }>(
    "select metafields from products where shop_domain=$1 and product_gid=$2",
    [DEV_SHOP_ID, cedar.product_gid],
  );
  const keys = (mf[0]?.metafields as Array<{ namespace: string; key: string; value: string }> | undefined)
    ?.map((m) => `${m.namespace}.${m.key}=${m.value}`) ?? [];
  console.log(`[sync] Cedar Hollow metafields: ${keys.join(", ")}`);
  if (!keys.some((k) => k.startsWith("custom.aluminum_free=")) || !keys.some((k) => k.startsWith("custom.price="))) {
    throw new Error("verification failed: expected custom.aluminum_free + custom.price metafields");
  }
  const { rows: avail } = await pgQuery<{ variant_gid: string; title: string; price: string; available: boolean }>(
    "select variant_gid, title, price, available from product_variants where shop_domain=$1 and product_gid=$2 order by title",
    [DEV_SHOP_ID, cedar.product_gid],
  );
  for (const v of avail) console.log(`[sync]   variant ${v.title} $${v.price} available=${v.available}`);
  if (!avail.every((v) => v.available)) throw new Error("verification failed: some Cedar Hollow variant is not available");
  console.log("[sync] verification PASSED: seeded content arrived through the real ingestion pipeline");
}

main()
  .then(() => closePg())
  .catch(async (err) => {
    console.error(`[sync] FAILED: ${(err as Error).message}`);
    await closePg();
    process.exit(1);
  });
