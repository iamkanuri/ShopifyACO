// The OpenAI Agentic Commerce product-feed specification, encoded as data.
//
// PROVENANCE (so the validator is auditable, never a stale guess):
//   Source : https://developers.openai.com/commerce  (Products / Product Feed spec)
//   Fetched: 2026-06-21 (read-only web fetch during the Phase 9 build)
//   Spec   : OpenAI marks the schema "Stable"; the rendered docs page does not expose
//            a machine-readable version string. Third-party trackers cite the current
//            stable revision as "2026-01-30". We record that as SPEC_VERSION but flag
//            it `versionConfirmed: false` — treat as best-effort until OpenAI publishes
//            a canonical version identifier we can pin to.
//
// Pure + dependency-free so the whole feed pipeline is unit-testable at $0. Storage
// is engine-agnostic (a `format` discriminator) so Gemini/Copilot/Shopify-Catalog
// specs can be added as sibling modules without touching the DB or orchestrator.

export type FeedFormat = "openai" | "gemini" | "copilot" | "shopify_catalog";

/** Field obligation tiers. `conditional` = required only when a predicate holds. */
export type FieldTier = "required" | "conditional" | "recommended" | "optional";

export interface SpecField {
  name: string;
  tier: FieldTier;
  type: "string" | "number" | "boolean" | "url" | "enum" | "list" | "date" | "object";
  /** Human-readable obligation note (esp. for conditional fields). */
  note?: string;
  /** Allowed values for enum fields. */
  enum?: readonly string[];
  /** Max length for string fields (UTF-8 chars). */
  maxLen?: number;
}

export const SPEC_SOURCE_URL = "https://developers.openai.com/commerce";
export const SPEC_FETCHED_AT = "2026-06-21";
export const SPEC_VERSION = "2026-01-30";
export const SPEC_VERSION_CONFIRMED = false;

// Officially supported upload formats per the docs. We EXPORT csv/tsv/json (all
// official) plus jsonl as a convenience (line-delimited JSON — submit the `json`
// array to OpenAI; jsonl is for streaming/inspection). `official` is surfaced so we
// never imply jsonl is an accepted upload format when it isn't.
export const EXPORT_FORMATS = {
  csv: { label: "CSV", contentType: "text/csv; charset=utf-8", ext: "csv", official: true },
  tsv: { label: "TSV", contentType: "text/tab-separated-values; charset=utf-8", ext: "tsv", official: true },
  json: { label: "JSON", contentType: "application/json; charset=utf-8", ext: "json", official: true },
  jsonl: { label: "JSONL", contentType: "application/x-ndjson; charset=utf-8", ext: "jsonl", official: false },
} as const;
export type ExportFormat = keyof typeof EXPORT_FORMATS;
export const isExportFormat = (v: unknown): v is ExportFormat =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(EXPORT_FORMATS, v);

// Enums from the spec (exact spellings matter — validation rejects anything else).
export const AVAILABILITY = ["in_stock", "out_of_stock", "pre_order", "backorder", "unknown"] as const;
export type Availability = (typeof AVAILABILITY)[number];
export const CONDITION = ["new", "used", "refurbished"] as const;
export const AGE_GROUP = ["newborn", "infant", "toddler", "kids", "adult"] as const;

// The field catalog. Tiers reflect the CURRENT spec (fetched above):
//  - required (always): the 14 fields the docs' required-only view lists.
//  - conditional: required only when a predicate holds (checkout eligibility, pre_order,
//    presence of a companion field, multi-variant). Predicates live in validate.ts.
//  - recommended: factual ranking/trust signals OpenAI advises but doesn't mandate.
//  - optional: everything else we can map.
//
// ⚠️ `return_policy`: the Products docs table lists it "Required" but the required-only
// view omits it. We classify it `conditional` (required when is_eligible_checkout) and
// note the discrepancy here rather than silently picking one reading.
export const OPENAI_FIELDS: readonly SpecField[] = [
  // Eligibility flags (required).
  { name: "is_eligible_search", tier: "required", type: "boolean", note: "Must be explicitly set; default false means invisible." },
  { name: "is_eligible_checkout", tier: "required", type: "boolean", note: "Requires is_eligible_search=true." },
  { name: "is_eligible_ads", tier: "optional", type: "boolean" },
  // Core identity (required).
  { name: "item_id", tier: "required", type: "string", maxLen: 100, note: "Stable, unique per variant." },
  { name: "title", tier: "required", type: "string", maxLen: 150, note: "Avoid all-caps." },
  { name: "description", tier: "required", type: "string", maxLen: 5000, note: "Plain text." },
  { name: "url", tier: "required", type: "url", note: "Must resolve HTTP 200; HTTPS preferred." },
  { name: "brand", tier: "required", type: "string", maxLen: 70 },
  { name: "image_url", tier: "required", type: "url", note: "JPEG/PNG; HTTPS preferred." },
  { name: "price", tier: "required", type: "string", note: "Amount + ISO 4217 code, e.g. '95.00 USD'." },
  { name: "availability", tier: "required", type: "enum", enum: AVAILABILITY },
  { name: "seller_name", tier: "required", type: "string", maxLen: 70 },
  { name: "seller_url", tier: "required", type: "url" },
  { name: "target_countries", tier: "required", type: "list", note: "ISO 3166-1 alpha-2 codes." },
  { name: "store_country", tier: "required", type: "string", note: "ISO 3166-1 alpha-2." },
  // Conditional.
  { name: "seller_privacy_policy", tier: "conditional", type: "url", note: "Required if is_eligible_checkout=true." },
  { name: "seller_tos", tier: "conditional", type: "url", note: "Required if is_eligible_checkout=true." },
  { name: "return_policy", tier: "conditional", type: "url", note: "Required if is_eligible_checkout=true (docs discrepancy — see spec.ts)." },
  { name: "availability_date", tier: "conditional", type: "date", note: "Required if availability=pre_order (ISO 8601)." },
  { name: "group_id", tier: "conditional", type: "string", note: "Recommended/expected when the product has multiple variants." },
  { name: "variant_dict", tier: "conditional", type: "object", note: "Option name→value map; expected with variants." },
  // Recommended (factual signals).
  { name: "gtin", tier: "recommended", type: "string", note: "8–14 digits, valid check digit." },
  { name: "mpn", tier: "recommended", type: "string", maxLen: 70 },
  { name: "condition", tier: "recommended", type: "enum", enum: CONDITION },
  { name: "product_category", tier: "recommended", type: "string", note: "'>'-separated hierarchy." },
  { name: "sale_price", tier: "recommended", type: "string", note: "≤ price; amount + ISO 4217." },
  { name: "review_count", tier: "recommended", type: "number", note: "Non-negative integer." },
  { name: "star_rating", tier: "recommended", type: "string", note: "0–5 scale." },
  { name: "additional_image_urls", tier: "recommended", type: "string", note: "Comma-separated URLs." },
  // Optional (mapped when available).
  { name: "item_group_title", tier: "optional", type: "string", maxLen: 150 },
  { name: "color", tier: "optional", type: "string", maxLen: 40 },
  { name: "size", tier: "optional", type: "string", maxLen: 20 },
  { name: "material", tier: "optional", type: "string", maxLen: 100 },
] as const;

export const requiredFields = (): SpecField[] => OPENAI_FIELDS.filter((f) => f.tier === "required");
export const recommendedFields = (): SpecField[] => OPENAI_FIELDS.filter((f) => f.tier === "recommended");
export const fieldByName = (name: string): SpecField | undefined => OPENAI_FIELDS.find((f) => f.name === name);

/** A serializable description of the spec we validate against — surfaced to merchants
 *  (and the UI) so the readiness score is auditable, never an opaque grade. */
export function specManifest(format: FeedFormat = "openai") {
  return {
    format,
    specVersion: SPEC_VERSION,
    versionConfirmed: SPEC_VERSION_CONFIRMED,
    source: SPEC_SOURCE_URL,
    fetchedAt: SPEC_FETCHED_AT,
    exportFormats: Object.entries(EXPORT_FORMATS).map(([key, v]) => ({ key, ...v })),
    fields: OPENAI_FIELDS,
    note:
      "Validated against the OpenAI Agentic Commerce product-feed spec fetched on " +
      `${SPEC_FETCHED_AT}. The docs mark the schema 'Stable' but do not expose a ` +
      "canonical version string; '2026-01-30' is a best-effort identifier (versionConfirmed=false). " +
      "Generating a feed does not submit it — OpenAI onboarding/delivery is a separate, external step.",
  };
}
