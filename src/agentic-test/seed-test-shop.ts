import "dotenv/config";
import { syncCatalog } from "../catalog/sync.js";
import { storeCredentials, upsertShop } from "../db/shops.js";
import { closePg, pgQuery } from "../db/pg.js";
import { TEST_PRODUCT_ID, TEST_SHOP_ID } from "./contract.js";
import { assertLocalDatabase, assertRunnable } from "./preflight.js";

// ===========================================================================
// Seed the Stage 1 test shop into the LOCAL database (spec 4.2 / AUDIT.md §9).
//
// Mirrors the repo's own DB-gated pattern (test/catalog.test.ts): mock install
// → mock catalog sync through the EXISTING ingestion pipeline. Then applies the
// merchant's truthful product content (the aluminum-free statement + metafield,
// exactly matching ground truth) to the test-store copy AT THE DATABASE LEVEL.
// No Shopify store is ever written (Rule 1); the DB refuses to be non-local.
//
// Requires: AGENTIC_INSTRUMENT_TEST_ENABLED=true, SHOPIFY_MODE=mock,
// APP_ENCRYPTION_KEY (ephemeral is fine — the token is never needed again),
// DATABASE_URL pointing at 127.0.0.1/localhost.
//
// Run: npx tsx src/agentic-test/seed-test-shop.ts
// ===========================================================================

/** The merchant's truthful statement (ground truth: aluminum_free = true).
 *  One sentence, so the fault mutator's sentence-level removal excises it whole.
 *  Contains two approved matching terms: "aluminum-free" and "no aluminum". */
export const MERCHANT_ALUMINUM_SENTENCE =
  "This pan is completely aluminum-free: the ceramic cooking surface and steel core contain no aluminum.";

export const MERCHANT_ALUMINUM_METAFIELD = {
  namespace: "custom",
  key: "aluminum_free",
  value: "true",
  type: "boolean",
};

export async function seedTestShop(): Promise<void> {
  assertRunnable(process.env, TEST_SHOP_ID);
  assertLocalDatabase(process.env.DATABASE_URL);
  if (process.env.SHOPIFY_MODE !== "mock") {
    throw new Error("refusing to seed: SHOPIFY_MODE must be 'mock' (Stage 1 never contacts a real Shopify store)");
  }

  await upsertShop(TEST_SHOP_ID, { status: "active", scopes: "read_products" });
  await storeCredentials(TEST_SHOP_ID, "mock_token", "read_products");
  const sync = await syncCatalog(TEST_SHOP_ID);
  console.log(`[seed] mock catalog synced: ${sync.productsSynced} products (sync ${sync.syncId})`);

  // Merchant edit on the local test-store copy: append the truthful aluminum-free
  // sentence (idempotent) and set the attribute metafield.
  const { rows } = await pgQuery<{ description: string | null; metafields: unknown }>(
    "select description, metafields from products where shop_domain=$1 and product_gid=$2",
    [TEST_SHOP_ID, TEST_PRODUCT_ID],
  );
  const row = rows[0];
  if (!row) throw new Error(`seed failed: ${TEST_PRODUCT_ID} not found after sync`);

  const description = row.description ?? "";
  const newDescription = description.includes(MERCHANT_ALUMINUM_SENTENCE)
    ? description
    : `${description} ${MERCHANT_ALUMINUM_SENTENCE}`.trim();

  const metafields = Array.isArray(row.metafields) ? (row.metafields as Array<Record<string, unknown>>) : [];
  const withoutOurs = metafields.filter(
    (m) => !(m.namespace === MERCHANT_ALUMINUM_METAFIELD.namespace && m.key === MERCHANT_ALUMINUM_METAFIELD.key),
  );
  const newMetafields = [...withoutOurs, MERCHANT_ALUMINUM_METAFIELD];

  await pgQuery(
    "update products set description=$3, metafields=$4::jsonb, updated_at=now() where shop_domain=$1 and product_gid=$2",
    [TEST_SHOP_ID, TEST_PRODUCT_ID, newDescription, JSON.stringify(newMetafields)],
  );
  console.log(`[seed] merchant edit applied to ${TEST_PRODUCT_ID} (description sentence + custom.aluminum_free=true)`);
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("agentic-test/seed-test-shop.ts");
if (isMain) {
  seedTestShop()
    .then(() => closePg())
    .catch(async (err) => {
      console.error(`[seed] FAILED: ${(err as Error).message}`);
      await closePg();
      process.exit(1);
    });
}
