import type {
  EvidenceReference,
  SnapshotEvidenceItem,
  StoreSnapshot,
} from "./types.js";
import { normalizeForMatch } from "./util.js";

// ===========================================================================
// Store retrieval tools (spec 4.5). Four tools, all reading ONLY the pinned
// snapshot. Deterministic given (snapshot, input). Outputs never add inferred
// facts; every returned claim carries an EvidenceReference. This module must
// never import ground-truth (test-enforced).
// ===========================================================================

const ref = (snapshot: StoreSnapshot, e: SnapshotEvidenceItem): EvidenceReference => ({
  evidenceId: e.evidenceId,
  surface: e.surface,
  sourceObjectId: e.sourceObjectId,
  exactText: e.exactText,
  structuredValue: e.structuredValue,
  snapshotId: snapshot.id,
});

export interface SearchMatch {
  objectType: "product" | "page" | "policy";
  objectId: string;
  title: string | null;
  snippet: string;
  evidenceReferences: EvidenceReference[];
}

/** Deterministic normalized lexical search over the snapshot's evidence index. */
export function searchStore(snapshot: StoreSnapshot, input: { query: string }): { matches: SearchMatch[] } {
  const query = normalizeForMatch(String(input.query ?? ""));
  if (!query) return { matches: [] };
  const tokens = query.split(" ").filter((t) => t.length >= 3);

  const productTitle = new Map(snapshot.products.map((p) => [p.productId, p.title]));
  const byObject = new Map<string, SearchMatch>();

  for (const e of snapshot.evidence) {
    const text = e.exactText ?? "";
    if (!text) continue;
    const norm = normalizeForMatch(text);
    const hit = norm.includes(query) || tokens.some((t) => norm.includes(t));
    if (!hit) continue;

    // Group hits under their owning object (product / page / policy).
    const productId = e.sourceObjectId.split("#")[0] ?? e.sourceObjectId;
    const isProduct = productId.startsWith("gid://shopify/Product/") || productTitle.has(productId)
      || e.surface.startsWith("product_");
    const ownerId = isProduct
      ? (productTitle.has(productId) ? productId : findOwnerProduct(snapshot, e) ?? productId)
      : e.sourceObjectId;
    const objectType: SearchMatch["objectType"] =
      e.surface === "faq" || e.surface === "structured_data" ? "page"
        : e.surface === "shipping_policy" || e.surface === "returns_policy" ? "policy"
          : "product";
    const key = `${objectType}:${ownerId}`;
    const existing = byObject.get(key);
    if (existing) {
      if (existing.evidenceReferences.length < 8) existing.evidenceReferences.push(ref(snapshot, e));
    } else {
      byObject.set(key, {
        objectType,
        objectId: ownerId,
        title: objectType === "product" ? (productTitle.get(ownerId) ?? null) : null,
        snippet: text.slice(0, 240),
        evidenceReferences: [ref(snapshot, e)],
      });
    }
  }

  // Deterministic ordering: by objectId.
  const matches = [...byObject.values()].sort((a, b) => a.objectId.localeCompare(b.objectId)).slice(0, 10);
  return { matches };
}

function findOwnerProduct(snapshot: StoreSnapshot, e: SnapshotEvidenceItem): string | null {
  if (e.surface === "product_variants" || e.surface === "product_options") {
    const variantId = e.sourceObjectId.split("#")[0]!;
    for (const p of snapshot.products) {
      if (p.variants.some((v) => v.variantId === variantId)) return p.productId;
    }
  }
  return null;
}

/** Full product read: every field carries its evidence references. */
export function getProduct(snapshot: StoreSnapshot, input: { productId: string }) {
  const p = snapshot.products.find((x) => x.productId === String(input.productId ?? ""));
  if (!p) return { found: false as const, product: null, evidenceReferences: [] as EvidenceReference[] };

  const evFor = (surface: string, pred?: (e: SnapshotEvidenceItem) => boolean) =>
    snapshot.evidence
      .filter((e) => e.surface === surface && (pred ? pred(e) : e.sourceObjectId.startsWith(p.productId)))
      .map((e) => ref(snapshot, e));

  const variantIds = new Set(p.variants.map((v) => v.variantId));
  return {
    found: true as const,
    product: {
      productId: p.productId,
      title: p.title,
      description: p.description,
      vendor: p.vendor,
      productType: p.productType,
      tags: p.tags,
      status: p.status,
      options: p.variants.flatMap((v) => v.options),
      variants: p.variants.map((v) => ({
        variantId: v.variantId,
        title: v.title,
        sku: v.sku,
        price: v.price,
        available: v.available,
        options: v.options,
      })),
    },
    fieldEvidence: {
      title: evFor("product_title", (e) => e.sourceObjectId === p.productId),
      description: evFor("product_description", (e) => e.sourceObjectId === p.productId),
      variants: snapshot.evidence
        .filter((e) => e.surface === "product_variants" && variantIds.has(e.sourceObjectId))
        .map((e) => ref(snapshot, e)),
      options: snapshot.evidence
        .filter((e) => e.surface === "product_options" && variantIds.has(e.sourceObjectId.split("#")[0]!))
        .map((e) => ref(snapshot, e)),
    },
    evidenceReferences: [
      ...evFor("product_title", (e) => e.sourceObjectId === p.productId),
      ...evFor("product_description", (e) => e.sourceObjectId === p.productId),
    ],
  };
}

/** Metafields for one product, each with its evidence reference. */
export function getProductMetafields(snapshot: StoreSnapshot, input: { productId: string }) {
  const productId = String(input.productId ?? "");
  const p = snapshot.products.find((x) => x.productId === productId);
  if (!p) return { found: false as const, metafields: [], evidenceReferences: [] as EvidenceReference[] };
  const items = snapshot.evidence.filter(
    (e) => e.surface === "product_metafields" && e.sourceObjectId.startsWith(`${productId}#`),
  );
  return {
    found: true as const,
    metafields: items.map((e) => ({
      ...(e.structuredValue as { namespace: string; key: string; value: string; type: string | null }),
      evidenceReference: ref(snapshot, e),
    })),
    evidenceReferences: items.map((e) => ref(snapshot, e)),
  };
}

/** FAQ / policy content — or an EXPLICIT empty result when the surface is absent
 *  from the snapshot (spec 4.5.4: absence is stated, never fabricated). */
export function getFaqOrPolicy(snapshot: StoreSnapshot, input: { topic: string }) {
  const topic = normalizeForMatch(String(input.topic ?? ""));
  const pageHits = snapshot.pages.filter(
    (pg) => !topic || normalizeForMatch(pg.text).includes(topic) || normalizeForMatch(pg.title ?? "").includes(topic),
  );
  const policyHits = snapshot.policies.filter((pol) => !topic || normalizeForMatch(pol.text).includes(topic));
  const results = [
    ...pageHits.map((pg) => ({
      surface: pg.surface,
      id: pg.pageId,
      title: pg.title,
      text: pg.text,
      evidenceReferences: snapshot.evidence.filter((e) => e.sourceObjectId === pg.pageId).map((e) => ref(snapshot, e)),
    })),
    ...policyHits.map((pol) => ({
      surface: pol.surface,
      id: pol.policyId,
      title: null as string | null,
      text: pol.text,
      evidenceReferences: snapshot.evidence.filter((e) => e.sourceObjectId === pol.policyId).map((e) => ref(snapshot, e)),
    })),
  ];
  return {
    results,
    surfacesAbsentFromStore: snapshot.surfacesAbsent,
    note: results.length
      ? undefined
      : "No FAQ or policy content exists in this store snapshot. The listed surfaces are absent — this is an explicit empty result, not an error.",
  };
}

// ---- dispatch --------------------------------------------------------------

export const STORE_TOOL_NAMES = [
  "search_store",
  "get_product",
  "get_product_metafields",
  "get_faq_or_policy",
] as const;
export type StoreToolName = (typeof STORE_TOOL_NAMES)[number];

/** Execute a tool by name against the pinned snapshot. Throws on unknown tool. */
export function executeStoreTool(
  snapshot: StoreSnapshot,
  name: string,
  args: Record<string, unknown>,
): { output: unknown; evidenceReferences: EvidenceReference[] } {
  switch (name) {
    case "search_store": {
      const out = searchStore(snapshot, { query: String(args.query ?? "") });
      return { output: out, evidenceReferences: out.matches.flatMap((m) => m.evidenceReferences) };
    }
    case "get_product": {
      const out = getProduct(snapshot, { productId: String(args.productId ?? "") });
      const refs = out.found
        ? [
            ...out.fieldEvidence.title,
            ...out.fieldEvidence.description,
            ...out.fieldEvidence.variants,
            ...out.fieldEvidence.options,
          ]
        : [];
      return { output: out, evidenceReferences: refs };
    }
    case "get_product_metafields": {
      const out = getProductMetafields(snapshot, { productId: String(args.productId ?? "") });
      return { output: out, evidenceReferences: out.evidenceReferences };
    }
    case "get_faq_or_policy": {
      const out = getFaqOrPolicy(snapshot, { topic: String(args.topic ?? "") });
      return { output: out, evidenceReferences: out.results.flatMap((r) => r.evidenceReferences) };
    }
    default:
      throw new Error(`unknown store tool: ${name}`);
  }
}
