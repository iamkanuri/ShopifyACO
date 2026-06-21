import { recommendedFields, requiredFields } from "./spec.js";
import type { Issue, ItemStatus, ValidatedItem } from "./validate.js";

// ---------------------------------------------------------------------------
// Agentic-readiness score — a documented, deterministic 0..100 formula over the
// FACTUAL validation results. NOT a black box: every component (weight, value,
// points contributed, the count behind it) is exposed so a merchant sees exactly
// why their catalog scored what it did. No subjective judgement enters here.
//
//   score = 100 × Σ (weight_i × value_i)
//
//   Validity              weight 0.45   value = items with no errors / items
//   Required completeness weight 0.25   value = required cells valid / required cells
//   Recommended coverage  weight 0.20   value = recommended cells present+valid / cells
//   Identifier coverage   weight 0.10   value = items with a valid GTIN or MPN / items
// ---------------------------------------------------------------------------

const WEIGHTS = { validity: 0.45, required: 0.25, recommended: 0.2, identifier: 0.1 } as const;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

const present = (v: unknown): boolean => {
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
};

export interface ReadinessComponent {
  key: string;
  label: string;
  weight: number;
  value: number;        // 0..1
  contribution: number; // points added to the 0..100 score
  detail: string;
}

export interface Readiness {
  score: number;
  components: ReadinessComponent[];
  formula: string;
  itemCount: number;
  validCount: number;   // status === valid
  warningCount: number; // status === warning
  errorCount: number;   // status === error
}

/** Issue counts by code (stored as the version's machine-readable summary). */
export function summarizeIssues(validated: ValidatedItem[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of validated) for (const i of v.issues) out[i.code] = (out[i.code] ?? 0) + 1;
  return out;
}

const statusCount = (validated: ValidatedItem[], s: ItemStatus) => validated.filter((v) => v.status === s).length;
const hasErrorOn = (issues: Issue[], field: string) => issues.some((i) => i.level === "error" && i.field === field);
const hasInvalidOn = (issues: Issue[], field: string) => issues.some((i) => i.field === field && i.code !== "missing_required");

export function computeReadiness(validated: ValidatedItem[]): Readiness {
  const n = validated.length;
  const reqNames = requiredFields().map((f) => f.name);
  const recNames = recommendedFields().map((f) => f.name);

  const errorCount = statusCount(validated, "error");
  const warningCount = statusCount(validated, "warning");
  const validCount = statusCount(validated, "valid");

  // Validity: items with zero error-level issues.
  const validityValue = n > 0 ? (n - errorCount) / n : 0;

  // Required completeness: required (item × field) cells with no error on them.
  const reqCells = n * reqNames.length;
  let reqBad = 0;
  for (const v of validated) for (const f of reqNames) if (hasErrorOn(v.issues, f)) reqBad++;
  const requiredValue = reqCells > 0 ? clamp01(1 - reqBad / reqCells) : 1;

  // Recommended coverage: recommended cells that are present AND not flagged invalid.
  const recCells = n * recNames.length;
  let recCovered = 0;
  for (const v of validated) for (const f of recNames) if (present(v.item.record[f]) && !hasInvalidOn(v.issues, f)) recCovered++;
  const recommendedValue = recCells > 0 ? recCovered / recCells : 0;

  // Identifier coverage: a valid GTIN (no invalid_gtin warning) or any MPN.
  let withId = 0;
  for (const v of validated) {
    const goodGtin = present(v.item.record.gtin) && !v.issues.some((i) => i.code === "invalid_gtin");
    const hasMpn = present(v.item.record.mpn);
    if (goodGtin || hasMpn) withId++;
  }
  const identifierValue = n > 0 ? withId / n : 0;

  const components: ReadinessComponent[] = [
    {
      key: "validity", label: "Listing validity", weight: WEIGHTS.validity, value: validityValue,
      contribution: WEIGHTS.validity * validityValue * 100,
      detail: `${n - errorCount}/${n} items have no error-level issues (would be accepted).`,
    },
    {
      key: "required", label: "Required-field completeness", weight: WEIGHTS.required, value: requiredValue,
      contribution: WEIGHTS.required * requiredValue * 100,
      detail: `${reqCells - reqBad}/${reqCells} required fields are present and valid across all items.`,
    },
    {
      key: "recommended", label: "Recommended-field coverage", weight: WEIGHTS.recommended, value: recommendedValue,
      contribution: WEIGHTS.recommended * recommendedValue * 100,
      detail: `${recCovered}/${recCells} recommended fields (gtin, mpn, condition, category, reviews, sale price…) are populated.`,
    },
    {
      key: "identifier", label: "Product-identifier coverage", weight: WEIGHTS.identifier, value: identifierValue,
      contribution: WEIGHTS.identifier * identifierValue * 100,
      detail: `${withId}/${n} items carry a valid GTIN or an MPN (helps the assistant match your product).`,
    },
  ];

  const score = Math.round(components.reduce((s, c) => s + c.contribution, 0));
  return {
    score,
    components,
    formula: "score = 100 × (0.45·validity + 0.25·requiredCompleteness + 0.20·recommendedCoverage + 0.10·identifierCoverage)",
    itemCount: n,
    validCount,
    warningCount,
    errorCount,
  };
}
