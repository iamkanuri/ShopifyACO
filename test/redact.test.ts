import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { SHOP_SCOPED_DELETES } from "../src/db/redact.js";

// ---- pure: FK-safe ordering invariants (a bad reorder would break real deletes) ----
test("SHOP_SCOPED_DELETES deletes children before parents and the shop row last", () => {
  const order = SHOP_SCOPED_DELETES.map((d) => d.table);
  const idx = (t: string) => order.indexOf(t);

  assert.equal(order[order.length - 1], "shops", "shops must be deleted last");
  assert.ok(idx("shop_credentials") < idx("shops"), "credentials before shops");
  // internal cascade chains — children must precede parents
  assert.ok(idx("observations") < idx("benchmark_runs"), "observations before benchmark_runs");
  assert.ok(idx("benchmark_runs") < idx("benchmarks"), "benchmark_runs before benchmarks");
  assert.ok(idx("feed_items") < idx("feed_versions"), "feed_items before feed_versions");
  assert.ok(idx("feed_versions") < idx("feeds"), "feed_versions before feeds");
  assert.ok(idx("notifications") < idx("alerts"), "notifications before alerts");
  assert.ok(idx("experiments") < idx("interventions"), "experiments before interventions");

  assert.equal(new Set(order).size, order.length, "no duplicate tables");
  // the queue/usage tables key on `shop`, everything else on `shop_domain`
  for (const d of SHOP_SCOPED_DELETES) {
    assert.ok(d.col === "shop" ? ["jobs", "usage_ledger"].includes(d.table) : true, `${d.table} uses the right column`);
  }
});

// ---- DB-gated: real erasure, scoped to the one shop ----
const RUN_DB = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
test("redactShop erases the shop's rows and leaves other shops untouched", { skip: !RUN_DB }, async () => {
  const { pgQuery } = await import("../src/db/pg.js");
  const { redactShop } = await import("../src/db/redact.js");
  const { upsertShop, audit } = await import("../src/db/shops.js");
  const { upsertShopifyEntitlement } = await import("../src/db/entitlements.js");

  const victim = `redact-victim-${Date.now()}.myshopify.com`;
  const bystander = `redact-bystander-${Date.now()}.myshopify.com`;

  const seed = async (shop: string) => {
    await upsertShop(shop, { status: "active" });
    await pgQuery(`insert into pixel_events (shop_domain, session_id, event_type, consent) values ($1,'s1','session_start',true)`, [shop]);
    await upsertShopifyEntitlement(shop, "pro", "active", null);
    await audit(shop, "system", "seed", "shop");
  };

  try {
    await seed(victim);
    await seed(bystander);

    const summary = await redactShop(victim);
    assert.ok((summary["shops"] ?? 0) >= 1, "shops row removed");
    assert.ok((summary["pixel_events"] ?? 0) >= 1, "pixel_events removed");
    assert.ok((summary["entitlements"] ?? 0) >= 1, "entitlements removed");

    // victim fully erased
    for (const table of ["shops", "pixel_events", "entitlements", "audit_log"]) {
      const { rows } = await pgQuery(`select 1 from ${table} where shop_domain = $1`, [victim]);
      assert.equal(rows.length, 0, `${table} should be empty for the redacted shop`);
    }
    // bystander untouched
    const { rows: bShop } = await pgQuery(`select 1 from shops where shop_domain = $1`, [bystander]);
    assert.equal(bShop.length, 1, "bystander shop must remain");
    const { rows: bPixel } = await pgQuery(`select 1 from pixel_events where shop_domain = $1`, [bystander]);
    assert.equal(bPixel.length, 1, "bystander pixel_events must remain");
  } finally {
    await redactShop(bystander); // cleanup (victim already erased)
  }
});
