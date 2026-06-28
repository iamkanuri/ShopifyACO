// Pure mapping from a Shopify GraphQL product node to our normalized catalog shape.
// Deterministic + dependency-free so it's fully unit-testable and reused by every
// future agentic-commerce adapter (Phase 9). Treats all input as untrusted.

export interface NormalizedVariant {
  variantGid: string;
  title: string | null;
  sku: string | null;
  barcode: string | null;
  price: number | null;
  available: boolean | null;
  inventoryQuantity: number | null;
  options: Array<{ name: string; value: string }>;
}

export interface NormalizedCollection {
  collectionGid: string;
  handle: string | null;
  title: string | null;
}

export interface NormalizedProduct {
  productGid: string;
  handle: string | null;
  title: string | null;
  description: string | null;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  status: string | null;
  onlineUrl: string | null;
  imageUrl: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  metafields: Array<{ namespace: string; key: string; value: string; type: string | null }>;
  variants: NormalizedVariant[];
  collections: NormalizedCollection[];
  /** True if any nested connection (variants/collections/metafields) was capped by the
   *  page size, so the synced data is a partial view. Surfaced in the catalog UI. */
  nestedTruncated: boolean;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Strip HTML to plain text (descriptions arrive as descriptionHtml). */
export function stripHtml(html: unknown): string | null {
  if (typeof html !== "string") return null;
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

interface RawNode {
  id?: string;
  title?: string;
  handle?: string;
  descriptionHtml?: string;
  vendor?: string;
  productType?: string;
  tags?: unknown;
  status?: string;
  onlineStoreUrl?: string;
  seo?: { title?: string; description?: string } | null;
  featuredImage?: { url?: string } | null;
  variants?: { nodes?: unknown[]; pageInfo?: { hasNextPage?: boolean } } | null;
  collections?: { nodes?: unknown[]; pageInfo?: { hasNextPage?: boolean } } | null;
  metafields?: { nodes?: unknown[]; pageInfo?: { hasNextPage?: boolean } } | null;
}

export function normalizeProduct(node: RawNode): NormalizedProduct | null {
  const productGid = str(node.id);
  if (!productGid) return null; // a product without an id is unusable

  const tags = Array.isArray(node.tags)
    ? node.tags.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean)
    : typeof node.tags === "string"
      ? node.tags.split(",").map((t) => t.trim()).filter(Boolean)
      : [];

  const variants: NormalizedVariant[] = (node.variants?.nodes ?? []).flatMap((raw) => {
    const v = raw as Record<string, unknown>;
    const variantGid = str(v.id);
    if (!variantGid) return [];
    const opts = Array.isArray(v.selectedOptions)
      ? (v.selectedOptions as Array<Record<string, unknown>>)
          .map((o) => ({ name: String(o.name ?? ""), value: String(o.value ?? "") }))
          .filter((o) => o.name)
      : [];
    return [{
      variantGid,
      title: str(v.title),
      sku: str(v.sku),
      barcode: str(v.barcode),
      price: num(v.price),
      available: typeof v.availableForSale === "boolean" ? v.availableForSale : null,
      inventoryQuantity: num(v.inventoryQuantity) === null ? null : Math.trunc(num(v.inventoryQuantity)!),
      options: opts,
    }];
  });

  const collections: NormalizedCollection[] = (node.collections?.nodes ?? []).flatMap((raw) => {
    const c = raw as Record<string, unknown>;
    const collectionGid = str(c.id);
    return collectionGid ? [{ collectionGid, handle: str(c.handle), title: str(c.title) }] : [];
  });

  const metafields = (node.metafields?.nodes ?? []).flatMap((raw) => {
    const m = raw as Record<string, unknown>;
    const namespace = str(m.namespace);
    const key = str(m.key);
    return namespace && key ? [{ namespace, key, value: String(m.value ?? ""), type: str(m.type) }] : [];
  });

  const nestedTruncated = Boolean(
    node.variants?.pageInfo?.hasNextPage ||
    node.collections?.pageInfo?.hasNextPage ||
    node.metafields?.pageInfo?.hasNextPage,
  );

  return {
    productGid,
    handle: str(node.handle),
    title: str(node.title),
    description: stripHtml(node.descriptionHtml),
    vendor: str(node.vendor),
    productType: str(node.productType),
    tags,
    status: str(node.status),
    onlineUrl: str(node.onlineStoreUrl),
    imageUrl: str(node.featuredImage?.url),
    seoTitle: str(node.seo?.title),
    seoDescription: str(node.seo?.description),
    metafields,
    variants,
    collections,
    nestedTruncated,
  };
}
