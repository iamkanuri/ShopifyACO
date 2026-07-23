import "dotenv/config";
import { DEV_SHOP_ID } from "../../src/agentic-test/contract.js";
import { assertRunnable } from "../../src/agentic-test/preflight.js";

// ===========================================================================
// STAGE 2 DEV-STORE SEED SCRIPT — Amendment 1 §A (recorded in AUDIT.md).
// Writes are permitted ONLY: to ai-visibility-dev.myshopify.com, ONLY with
// SHOPIFY_DEV_STORE_TOKEN (a custom-app token minted inside that store), ONLY
// after a live identity assertion, and ONLY the Appendix A content (+ the
// approved custom.price metafield). Idempotent (upsert by handle), everything
// tagged `agentic-stage2-seed`, with a --cleanup mode that deletes ONLY tagged
// objects. The script always prints the full mutation plan before writing.
//
// Usage:
//   npx tsx experiments/agentic-stage2/seed-dev-store.ts plan      # no writes
//   npx tsx experiments/agentic-stage2/seed-dev-store.ts apply     # plan + seed
//   npx tsx experiments/agentic-stage2/seed-dev-store.ts cleanup   # delete tagged
//
// Requires AGENTIC_INSTRUMENT_TEST_ENABLED=true.
// Inventory: the granted token includes write_inventory + read_locations, so
// variants are seeded TRACKED with quantity 10 at the store's first location
// (per the original Appendix A kit). If the location lookup fails, we fall
// back to untracked (availableForSale=true) and disclose it.
// ===========================================================================

const SEED_TAG = "agentic-stage2-seed";
const API_VERSION = process.env.SHOPIFY_API_VERSION?.trim() || "2026-01";

// ---- Appendix A content, verbatim -----------------------------------------

const CEDAR_DESCRIPTION =
  "Small-batch deodorant made in Florida for people who read ingredient labels. Our aluminum-free formula uses arrowroot and magnesium hydroxide to keep you fresh through a Tampa summer, with no baking soda to irritate sensitive skin. Every stick is a one-time purchase, no subscription required, and we never auto-enroll you in anything. Glides on clear, no white marks on dark shirts. If cedar isn't your thing, the Unscented version has zero added fragrance.";

const HARBOR_DESCRIPTION =
  "A 100% vegan shave soap with a sandalwood finish, whipped for a dense lather. Tallow-free and palm-free, $24 a puck, made to order weekly.";

const FAQ_BODY =
  "Do you offer returns? Yes. Free returns within 30 days of delivery, no questions asked. Is this a subscription? No. Everything in the store is a one-time purchase. Are your deodorants aluminum-free? Yes, every formula we sell is aluminum-free and always will be.";

const SHIPPING_BODY =
  "Orders placed before 2 PM ET ship the same day. Standard shipping arrives in 2 to 4 business days anywhere in the continental US. Tracking is emailed at fulfillment.";

const PRODUCTS = [
  {
    handle: "cedar-hollow-natural-deodorant",
    title: "Cedar Hollow Natural Deodorant",
    descriptionHtml: `<p>${CEDAR_DESCRIPTION}</p>`,
    productOptions: [
      { name: "Scent", values: [{ name: "Cedar & Sage" }, { name: "Unscented" }] },
      { name: "Size", values: [{ name: "2.5 oz" }, { name: "1 oz Travel" }] },
    ],
    variants: ["Cedar & Sage", "Unscented"].flatMap((scent) =>
      ["2.5 oz", "1 oz Travel"].map((size) => ({
        optionValues: [
          { optionName: "Scent", name: scent },
          { optionName: "Size", name: size },
        ],
        price: "14.00",
      })),
    ),
    metafields: [
      { namespace: "custom", key: "aluminum_free", type: "boolean", value: "true" },
      { namespace: "custom", key: "price", type: "single_line_text_field", value: "$14.00" },
    ],
  },
  {
    handle: "harbor-lane-shave-soap",
    title: "Harbor Lane Shave Soap",
    descriptionHtml: `<p>${HARBOR_DESCRIPTION}</p>`,
    productOptions: [{ name: "Title", values: [{ name: "Default Title" }] }],
    variants: [
      {
        optionValues: [{ optionName: "Title", name: "Default Title" }],
        price: "24.00",
      },
    ],
    metafields: [],
  },
];

const PAGES = [
  { title: "FAQ", body: FAQ_BODY, sentinel: "Free returns within 30 days" },
  { title: "Shipping", body: SHIPPING_BODY, sentinel: "ship the same day" },
];

// ---- GraphQL plumbing ------------------------------------------------------

function token(): string {
  const t = process.env.SHOPIFY_DEV_STORE_TOKEN?.trim();
  if (!t) throw new Error("SHOPIFY_DEV_STORE_TOKEN is not set (Amendment 1 §B)");
  return t;
}

async function gql<T = Record<string, unknown>>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`https://${DEV_SHOP_ID}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Shopify-Access-Token": token() },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${text.slice(0, 300)}`);
  const json = JSON.parse(text) as { data?: T; errors?: Array<{ message?: string }> };
  if (json.errors?.length) throw new Error(`GraphQL error: ${json.errors.map((e) => e.message).join("; ").slice(0, 400)}`);
  return json.data as T;
}

/** Amendment 1 §A.3: hard identity assertion before ANY write. */
async function assertDevStoreIdentity(): Promise<void> {
  const data = await gql<{ shop?: { myshopifyDomain?: string } }>("{ shop { myshopifyDomain } }");
  const domain = data.shop?.myshopifyDomain;
  if (domain !== DEV_SHOP_ID) {
    throw new Error(`REFUSING: token identifies as '${domain}', not ${DEV_SHOP_ID}`);
  }
  console.log(`[seed] identity verified: ${domain}`);
}

// ---- plan ------------------------------------------------------------------

function printPlan(): void {
  console.log("=== SEED PLAN (every mutation, in order) ===");
  for (const p of PRODUCTS) {
    console.log(
      `productSet (upsert by handle '${p.handle}'): "${p.title}", ${p.variants.length} variant(s) ` +
        `@ $${p.variants[0]!.price}, tracked inventory qty 10 @ primary location (fallback: untracked), ` +
        `tags=[${SEED_TAG}], metafields=[${p.metafields.map((m) => `${m.namespace}.${m.key}=${m.value}`).join(", ") || "none"}]`,
    );
  }
  for (const pg of PAGES) {
    console.log(`pageCreate/pageUpdate (upsert by title '${pg.title}'): ${pg.body.length} chars, published`);
  }
  console.log("=== END PLAN ===");
}

// ---- apply -----------------------------------------------------------------

async function getPrimaryLocationId(): Promise<string | null> {
  try {
    const data = await gql<{ locations?: { nodes?: Array<{ id: string; name?: string }> } }>(
      `{ locations(first: 1) { nodes { id name } } }`,
    );
    const loc = data.locations?.nodes?.[0];
    if (loc) console.log(`[seed] inventory location: ${loc.name} (${loc.id})`);
    return loc?.id ?? null;
  } catch (err) {
    console.warn(`[seed] ⚠️ location lookup failed (${(err as Error).message.slice(0, 120)}) — seeding untracked variants`);
    return null;
  }
}

async function findProductIdByHandle(handle: string): Promise<string | null> {
  const data = await gql<{ products?: { nodes?: Array<{ id: string }> } }>(
    `query($q: String!) { products(first: 1, query: $q) { nodes { id } } }`,
    { q: `handle:'${handle}'` },
  );
  return data.products?.nodes?.[0]?.id ?? null;
}

async function upsertProducts(locationId: string | null): Promise<void> {
  for (const p of PRODUCTS) {
    const existingId = await findProductIdByHandle(p.handle);
    const variants = p.variants.map((v) => ({
      ...v,
      inventoryItem: { tracked: Boolean(locationId) },
      ...(locationId
        ? { inventoryQuantities: [{ locationId, name: "available", quantity: 10 }] }
        : {}),
    }));
    const input: Record<string, unknown> = {
      ...(existingId ? { id: existingId } : {}),
      title: p.title,
      handle: p.handle,
      descriptionHtml: p.descriptionHtml,
      status: "ACTIVE",
      tags: [SEED_TAG],
      productOptions: p.productOptions,
      variants,
      metafields: p.metafields.length ? p.metafields : undefined,
    };
    const data = await gql<{
      productSet?: { product?: { id?: string; handle?: string }; userErrors?: Array<{ field?: string[]; message?: string }> };
    }>(
      `mutation($input: ProductSetInput!) {
         productSet(input: $input, synchronous: true) {
           product { id handle }
           userErrors { field message }
         }
       }`,
      { input },
    );
    const errs = data.productSet?.userErrors ?? [];
    if (errs.length) throw new Error(`productSet '${p.handle}' userErrors: ${JSON.stringify(errs).slice(0, 400)}`);
    console.log(`[seed] ${existingId ? "updated" : "created"} product ${data.productSet?.product?.handle} (${data.productSet?.product?.id})`);
  }
}

async function findPageByTitle(title: string): Promise<{ id: string; body?: string } | null> {
  const data = await gql<{ pages?: { nodes?: Array<{ id: string; title: string; body?: string }> } }>(
    `query($q: String!) { pages(first: 5, query: $q) { nodes { id title body } } }`,
    { q: `title:'${title}'` },
  );
  return data.pages?.nodes?.find((n) => n.title === title) ?? null;
}

/** Amendment 1 §A.6: page-write failures fall back to fixture-only carriage
 *  without blocking; the failure is disclosed, never hidden. */
async function upsertPages(): Promise<{ pagesSeeded: boolean; note?: string }> {
  try {
    for (const pg of PAGES) {
      const existing = await findPageByTitle(pg.title);
      if (existing) {
        const data = await gql<{ pageUpdate?: { userErrors?: Array<{ message?: string }> } }>(
          `mutation($id: ID!, $page: PageUpdateInput!) {
             pageUpdate(id: $id, page: $page) { page { id } userErrors { message } }
           }`,
          { id: existing.id, page: { title: pg.title, body: pg.body, isPublished: true } },
        );
        const errs = data.pageUpdate?.userErrors ?? [];
        if (errs.length) throw new Error(`pageUpdate '${pg.title}': ${JSON.stringify(errs).slice(0, 300)}`);
        console.log(`[seed] updated page '${pg.title}'`);
      } else {
        const data = await gql<{ pageCreate?: { userErrors?: Array<{ message?: string }> } }>(
          `mutation($page: PageCreateInput!) {
             pageCreate(page: $page) { page { id } userErrors { message } }
           }`,
          { page: { title: pg.title, body: pg.body, isPublished: true } },
        );
        const errs = data.pageCreate?.userErrors ?? [];
        if (errs.length) throw new Error(`pageCreate '${pg.title}': ${JSON.stringify(errs).slice(0, 300)}`);
        console.log(`[seed] created page '${pg.title}'`);
      }
    }
    return { pagesSeeded: true };
  } catch (err) {
    const note = `page writes failed (${(err as Error).message.slice(0, 200)}) — falling back to fixture-only carriage per Amendment 1 §A.6`;
    console.warn(`[seed] ⚠️ ${note}`);
    return { pagesSeeded: false, note };
  }
}

// ---- cleanup (deletes ONLY tagged/sentinel objects) ------------------------

async function cleanup(): Promise<void> {
  const data = await gql<{ products?: { nodes?: Array<{ id: string; title: string }> } }>(
    `{ products(first: 50, query: "tag:'${SEED_TAG}'") { nodes { id title } } }`,
  );
  for (const p of data.products?.nodes ?? []) {
    const del = await gql<{ productDelete?: { deletedProductId?: string; userErrors?: Array<{ message?: string }> } }>(
      `mutation($input: ProductDeleteInput!) { productDelete(input: $input) { deletedProductId userErrors { message } } }`,
      { input: { id: p.id } },
    );
    const errs = del.productDelete?.userErrors ?? [];
    if (errs.length) throw new Error(`productDelete '${p.title}': ${JSON.stringify(errs).slice(0, 300)}`);
    console.log(`[cleanup] deleted product "${p.title}" (${p.id})`);
  }
  for (const pg of PAGES) {
    const existing = await findPageByTitle(pg.title);
    if (!existing) continue;
    if (!existing.body?.includes(pg.sentinel)) {
      console.log(`[cleanup] skipping page '${pg.title}' — body does not match our seeded sentinel (not ours)`);
      continue;
    }
    const del = await gql<{ pageDelete?: { userErrors?: Array<{ message?: string }> } }>(
      `mutation($id: ID!) { pageDelete(id: $id) { deletedPageId userErrors { message } } }`,
      { id: existing.id },
    );
    const errs = del.pageDelete?.userErrors ?? [];
    if (errs.length) throw new Error(`pageDelete '${pg.title}': ${JSON.stringify(errs).slice(0, 300)}`);
    console.log(`[cleanup] deleted page '${pg.title}'`);
  }
  console.log("[cleanup] done (only tagged/sentinel objects were touched)");
}

// ---- main ------------------------------------------------------------------

const cmd = process.argv[2] ?? "";
async function main(): Promise<void> {
  assertRunnable(process.env, DEV_SHOP_ID);
  switch (cmd) {
    case "plan":
      printPlan();
      break;
    case "apply": {
      printPlan();
      await assertDevStoreIdentity();
      const locationId = await getPrimaryLocationId();
      await upsertProducts(locationId);
      const pages = await upsertPages();
      console.log(`[seed] complete. pagesSeeded=${pages.pagesSeeded}${pages.note ? ` note=${pages.note}` : ""}`);
      break;
    }
    case "cleanup":
      await assertDevStoreIdentity();
      await cleanup();
      break;
    default:
      console.error("usage: npx tsx experiments/agentic-stage2/seed-dev-store.ts <plan|apply|cleanup>");
      process.exitCode = 2;
  }
}
main().catch((err) => {
  console.error(`[seed] FAILED: ${(err as Error).message}`);
  process.exit(1);
});
