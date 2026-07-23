import { ENV } from "../server/env.js";
import { DEV_SHOP_ID } from "./contract.js";

// ===========================================================================
// Stage 4 dev-store client — the Amendment-1 write path as a small library.
// Every mutating call path MUST call assertDevStoreIdentity() first (Rule 3:
// identity-asserted before every write). Token: SHOPIFY_DEV_STORE_TOKEN only.
// ===========================================================================

function token(): string {
  const t = process.env.SHOPIFY_DEV_STORE_TOKEN?.trim();
  if (!t) throw new Error("SHOPIFY_DEV_STORE_TOKEN is not set");
  return t;
}

export async function gqlDevStore<T = Record<string, unknown>>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(`https://${DEV_SHOP_ID}/admin/api/${ENV.shopify.apiVersion}/graphql.json`, {
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
export async function assertDevStoreIdentity(): Promise<void> {
  const data = await gqlDevStore<{ shop?: { myshopifyDomain?: string } }>("{ shop { myshopifyDomain } }");
  const domain = data.shop?.myshopifyDomain;
  if (domain !== DEV_SHOP_ID) throw new Error(`REFUSING: token identifies as '${domain}', not ${DEV_SHOP_ID}`);
}

export interface RawProductState {
  id: string;
  descriptionHtml: string;
  metafield: { namespace: string; key: string; value: string; type: string } | null;
}

/** Read the RAW product state relevant to the Stage 4 fault (verbatim HTML). */
export async function readProductState(productGid: string): Promise<RawProductState> {
  const data = await gqlDevStore<{
    product?: { id?: string; descriptionHtml?: string; metafield?: { namespace: string; key: string; value: string; type: string } | null };
  }>(
    `query($id: ID!) { product(id: $id) { id descriptionHtml metafield(namespace: "custom", key: "aluminum_free") { namespace key value type } } }`,
    { id: productGid },
  );
  if (!data.product?.id) throw new Error(`product ${productGid} not found`);
  return {
    id: data.product.id,
    descriptionHtml: data.product.descriptionHtml ?? "",
    metafield: data.product.metafield ?? null,
  };
}

export async function writeDescriptionHtml(productGid: string, descriptionHtml: string): Promise<void> {
  const data = await gqlDevStore<{ productUpdate?: { userErrors?: Array<{ message?: string }> } }>(
    `mutation($input: ProductInput!) { productUpdate(input: $input) { product { id } userErrors { message } } }`,
    { input: { id: productGid, descriptionHtml } },
  );
  const errs = data.productUpdate?.userErrors ?? [];
  if (errs.length) throw new Error(`productUpdate userErrors: ${JSON.stringify(errs).slice(0, 300)}`);
}

export async function setMetafield(
  productGid: string,
  mf: { namespace: string; key: string; value: string; type: string },
): Promise<void> {
  const data = await gqlDevStore<{ metafieldsSet?: { userErrors?: Array<{ message?: string }> } }>(
    `mutation($metafields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $metafields) { metafields { id } userErrors { message } } }`,
    { metafields: [{ ownerId: productGid, namespace: mf.namespace, key: mf.key, value: mf.value, type: mf.type }] },
  );
  const errs = data.metafieldsSet?.userErrors ?? [];
  if (errs.length) throw new Error(`metafieldsSet userErrors: ${JSON.stringify(errs).slice(0, 300)}`);
}

export async function deleteMetafield(productGid: string, namespace: string, key: string): Promise<void> {
  const data = await gqlDevStore<{ metafieldsDelete?: { userErrors?: Array<{ message?: string }> } }>(
    `mutation($metafields: [MetafieldIdentifierInput!]!) { metafieldsDelete(metafields: $metafields) { deletedMetafields { key } userErrors { message } } }`,
    { metafields: [{ ownerId: productGid, namespace, key }] },
  );
  const errs = data.metafieldsDelete?.userErrors ?? [];
  if (errs.length) throw new Error(`metafieldsDelete userErrors: ${JSON.stringify(errs).slice(0, 300)}`);
}
