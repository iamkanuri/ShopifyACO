import { AVAILABILITY, CONDITION, fieldByName, requiredFields } from "./spec.js";
import type { FeedRecord } from "./map.js";

// Pure feed validation (Phase 9). FACTUAL / structural checks ONLY — presence of
// required fields, type correctness, enum membership, URL well-formedness, GTIN
// check-digit, ISO-3166 country codes, ISO-4217-shaped currency, price format, and
// documented length limits. No subjective "quality" judgement and no network calls
// (we never fetch a URL to confirm it 200s — that's a documented limit, not a claim).
//
// Two levels:
//   error   → the feed item would be rejected / can't be listed (missing required,
//             invalid enum, malformed price, broken eligibility invariant).
//   warning → accepted but weaker (non-HTTPS URL, over documented length, invalid
//             GTIN check digit, sale_price > price, recommended field malformed).

export interface Issue {
  level: "error" | "warning";
  code: string;
  field: string;
  message: string;
}
export type ItemStatus = "valid" | "warning" | "error";

export const statusOf = (issues: Issue[]): ItemStatus =>
  issues.some((i) => i.level === "error") ? "error" : issues.some((i) => i.level === "warning") ? "warning" : "valid";

// ---- format helpers (exported for unit tests) ------------------------------
export function isHttpUrl(v: unknown): boolean {
  if (typeof v !== "string" || !v.trim()) return false;
  try {
    const u = new URL(v.trim());
    return (u.protocol === "http:" || u.protocol === "https:") && Boolean(u.hostname);
  } catch {
    return false;
  }
}
export const isHttpsUrl = (v: unknown): boolean => isHttpUrl(v) && (v as string).trim().toLowerCase().startsWith("https:");

// Complete ISO 3166-1 alpha-2 set (the spec requires real codes for target/store
// country, so we validate against the registry, not just a 2-letter shape).
const ISO_3166_1_ALPHA2 = new Set(
  ("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
   "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO " +
   "FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE " +
   "JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO " +
   "MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW " +
   "PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM " +
   "TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW").split(" "),
);
export const isIsoCountry = (v: unknown): boolean => typeof v === "string" && ISO_3166_1_ALPHA2.has(v.trim().toUpperCase());

// Currency is validated structurally (3 uppercase letters). Full ISO-4217 registry
// validation is a documented follow-up; the price format check below relies on this.
export const isCurrencyCode = (v: unknown): boolean => typeof v === "string" && /^[A-Z]{3}$/.test(v.trim());

export function isIso8601Date(v: unknown): boolean {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(v.trim())) return false;
  return !Number.isNaN(Date.parse(v.trim()));
}

/** GTIN-8/12/13/14 check-digit validation (mod-10). */
export function isValidGtin(v: unknown): boolean {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(s)) return false;
  const digits = s.split("").map(Number);
  const check = digits.pop()!;
  // Weight 3/1 from the rightmost data digit leftward.
  let sum = 0;
  for (let i = digits.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += digits[i]! * w;
  return (10 - (sum % 10)) % 10 === check;
}

/** Parse a "95.00 USD" price → { amount, currency } or null if malformed. */
export function parsePrice(v: unknown): { amount: number; currency: string } | null {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d+(?:\.\d+)?)\s+([A-Za-z]{3})$/);
  if (!m) return null;
  const amount = Number(m[1]);
  if (!Number.isFinite(amount)) return null;
  return { amount, currency: m[2]!.toUpperCase() };
}

const present = (v: unknown): boolean => {
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true; // booleans/numbers are present once set
};

// ---- per-record validation -------------------------------------------------
export function validateRecord(rec: FeedRecord): Issue[] {
  const issues: Issue[] = [];
  const err = (code: string, field: string, message: string) => issues.push({ level: "error", code, field, message });
  const warn = (code: string, field: string, message: string) => issues.push({ level: "warning", code, field, message });

  // 1) Required fields present.
  for (const f of requiredFields()) {
    if (!present(rec[f.name])) err("missing_required", f.name, `Required field "${f.name}" is missing.`);
  }

  // 2) Conditional requirements.
  if (rec.is_eligible_checkout === true) {
    for (const f of ["seller_privacy_policy", "seller_tos", "return_policy"]) {
      if (!present(rec[f])) err("missing_checkout_field", f, `"${f}" is required when is_eligible_checkout is true.`);
    }
  }
  if (rec.availability === "pre_order" && !present(rec.availability_date)) {
    err("missing_availability_date", "availability_date", "availability_date is required when availability is pre_order.");
  }

  // 3) Eligibility invariant.
  if (rec.is_eligible_checkout === true && rec.is_eligible_search !== true) {
    err("eligibility_invariant", "is_eligible_checkout", "is_eligible_checkout=true requires is_eligible_search=true.");
  }

  // 4) Enums.
  if (present(rec.availability) && !(AVAILABILITY as readonly string[]).includes(String(rec.availability))) {
    err("invalid_enum", "availability", `availability must be one of: ${AVAILABILITY.join(", ")}.`);
  }
  if (present(rec.condition) && !(CONDITION as readonly string[]).includes(String(rec.condition))) {
    warn("invalid_enum", "condition", `condition should be one of: ${CONDITION.join(", ")}.`);
  }

  // 5) URLs (https preferred → warn on http).
  for (const f of ["url", "image_url", "seller_url", "seller_privacy_policy", "seller_tos", "return_policy"]) {
    const v = rec[f];
    if (!present(v)) continue;
    if (!isHttpUrl(v)) err("invalid_url", f, `"${f}" is not a valid http(s) URL.`);
    else if (!isHttpsUrl(v)) warn("insecure_url", f, `"${f}" should use HTTPS.`);
  }

  // 6) Price + sale_price.
  const price = parsePrice(rec.price);
  if (present(rec.price) && !price) err("invalid_price", "price", "price must be 'amount CUR' (e.g. '95.00 USD').");
  else if (price) {
    if (price.amount <= 0) err("invalid_price", "price", "price must be greater than 0.");
    if (!isCurrencyCode(price.currency)) warn("invalid_currency", "price", "price currency should be a 3-letter ISO 4217 code.");
  }
  if (present(rec.sale_price)) {
    const sale = parsePrice(rec.sale_price);
    if (!sale) warn("invalid_price", "sale_price", "sale_price must be 'amount CUR'.");
    else if (price && sale.amount > price.amount) warn("sale_gt_price", "sale_price", "sale_price should be ≤ price.");
  }

  // 7) Country codes.
  if (Array.isArray(rec.target_countries)) {
    for (const c of rec.target_countries) {
      if (!isIsoCountry(c)) err("invalid_country", "target_countries", `"${c}" is not a valid ISO 3166-1 alpha-2 country code.`);
    }
  }
  if (present(rec.store_country) && !isIsoCountry(rec.store_country)) {
    err("invalid_country", "store_country", `"${String(rec.store_country)}" is not a valid ISO 3166-1 alpha-2 country code.`);
  }

  // 8) Dates.
  if (present(rec.availability_date) && !isIso8601Date(rec.availability_date)) {
    err("invalid_date", "availability_date", "availability_date must be an ISO 8601 date.");
  }

  // 9) GTIN check digit (recommended → warning).
  if (present(rec.gtin) && !isValidGtin(rec.gtin)) {
    warn("invalid_gtin", "gtin", "gtin failed the GTIN check-digit validation (must be 8/12/13/14 digits).");
  }

  // 10) Length limits + all-caps title (documented maxima → warnings, not hard rejects).
  for (const f of ["title", "description", "brand", "mpn", "item_group_title", "color", "size", "material"]) {
    const spec = fieldByName(f);
    const v = rec[f];
    if (spec?.maxLen && typeof v === "string" && v.length > spec.maxLen) {
      warn("too_long", f, `"${f}" exceeds the ${spec.maxLen}-character limit (${v.length}).`);
    }
  }
  if (typeof rec.title === "string" && rec.title.length >= 6 && rec.title === rec.title.toUpperCase() && /[A-Z]/.test(rec.title)) {
    warn("all_caps_title", "title", "title is all-caps; mixed case is recommended.");
  }

  // 11) review_count / star_rating shape.
  if (present(rec.review_count) && !(Number.isInteger(Number(rec.review_count)) && Number(rec.review_count) >= 0)) {
    warn("invalid_number", "review_count", "review_count must be a non-negative integer.");
  }
  if (present(rec.star_rating)) {
    const r = Number(rec.star_rating);
    if (!(Number.isFinite(r) && r >= 0 && r <= 5)) warn("invalid_number", "star_rating", "star_rating must be 0–5.");
  }

  // 12) Variant coherence (recommended).
  if (present(rec.variant_dict) && !present(rec.group_id)) {
    warn("variant_no_group", "group_id", "variant_dict is set but group_id is missing — set group_id to tie variants together.");
  }

  return issues;
}

export interface ValidatedItem<T = { productGid: string; variantGid: string | null; record: FeedRecord }> {
  item: T;
  issues: Issue[];
  status: ItemStatus;
}

/** Validate every record, then layer FEED-LEVEL checks (duplicate item_id — every
 *  feed item must be uniquely addressable). Returns per-item issues + status. */
export function validateFeed<T extends { record: FeedRecord }>(items: T[]): ValidatedItem<T>[] {
  const out = items.map((item) => {
    const issues = validateRecord(item.record);
    return { item, issues, status: statusOf(issues) };
  });

  // Duplicate item_id across the feed.
  const seen = new Map<string, number>();
  for (const v of out) {
    const id = typeof v.item.record.item_id === "string" ? v.item.record.item_id : null;
    if (id) seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  for (const v of out) {
    const id = typeof v.item.record.item_id === "string" ? v.item.record.item_id : null;
    if (id && (seen.get(id) ?? 0) > 1) {
      v.issues.push({ level: "error", code: "duplicate_item_id", field: "item_id", message: `item_id "${id}" is used by more than one feed item.` });
      v.status = statusOf(v.issues);
    }
  }
  return out;
}
