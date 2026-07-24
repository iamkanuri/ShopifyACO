// ===========================================================================
// PHASE B — the CLAIM LINTER (ported from the experiment branch's blocking linter).
//
// The deterministic honesty spine for every string a merchant reads. It refuses
// four families of claim we have no standing to make from public data:
//   • PRODUCT TRUTH   — "your product is not aluminum-free" (we test EVIDENCE
//                       AVAILABILITY, never what the product is)
//   • RANKING         — "you'll rank higher in AI answers"
//   • REVENUE         — "you're losing $4,200/month"
//   • CAUSAL/PREDICTIVE — "this fix will get you recommended"
//
// A result that can't meet the standard is NOT shown. This runs over the rendered
// result strings before they leave the server: a regression in copy fails loudly
// here instead of quietly shipping an overclaim.
// Pure, deterministic, no model calls.
// ===========================================================================

export interface LintViolation { rule: string; excerpt: string }
export interface LintResult { ok: boolean; violations: LintViolation[] }

const FORBIDDEN: Array<{ re: RegExp; rule: string }> = [
  // --- product-truth assertions about the merchant's product -----------------
  { re: /\byour (product|item|formula|deodorant|soap|coffee)\s+(is|isn'?t|is not|lacks|contains|doesn'?t|does not)\b/i, rule: "product-truth" },
  { re: /\b(is|are)\s+not\s+(aluminum|aluminium|fragrance|paraben|sulfate|gluten|bpa|cruelty|baking)[- ]free\b/i, rule: "product-truth" },
  { re: /\byour product does not (have|contain|include)\b/i, rule: "product-truth" },
  // --- revenue / loss --------------------------------------------------------
  { re: /\blos(e|es|ing|t)\s+\$?\d/i, rule: "revenue-loss" },
  { re: /\b(costing|missing out on|leaving|forfeiting)\s+\$?\d/i, rule: "revenue" },
  { re: /\$\d[\d,]*\s*(per|\/)\s*(month|year|day|week)\b/i, rule: "revenue-projection" },
  { re: /\b(increase|boost|grow)\s+(your\s+)?(sales|revenue|conversions?)\b/i, rule: "revenue-promise" },
  // --- ranking ---------------------------------------------------------------
  { re: /\brank(s|ed|ing)?\s+(higher|first|top|better)\b/i, rule: "ranking-prediction" },
  { re: /\b(get|be|become)\s+(recommended|ranked|featured)\s+(by|in|more)\b/i, rule: "ranking-prediction" },
  { re: /\bshare of voice\b/i, rule: "ranking-metric" },
  // --- causal / predictive ---------------------------------------------------
  { re: /\bwill\s+(improve|increase|boost|rank|win|fix|convert|drive|make ai|get you)\b/i, rule: "predictive" },
  { re: /\bthis (edit|fix|change|correction) will\b/i, rule: "predictive-fix" },
  { re: /\byou'?ll\s+(get|see|rank|win|earn|recover|start)\b/i, rule: "predictive" },
  { re: /\bguarantee(s|d|ing)?\b/i, rule: "guarantee" },
  { re: /\b(caused|because of this|as a result of|leads? to|results? in)\s+(your|the)\s+(loss|drop|ranking|invisibility)\b/i, rule: "causal" },
  // --- evidence mis-scoping (the Rule-4 defensive check) ---------------------
  // Price is ALWAYS public on a Shopify product: any "price not stated" phrasing
  // is a mis-scoped evidence claim.
  { re: /(does not state|doesn'?t state|missing|no evidence of)[^.]{0,30}\b(price|cost)\b/i, rule: "price-is-always-public" },
  // "Missing" is never how we describe a surface we simply cannot see.
  { re: /\b(missing|absent)\s+(metafields?|policy|policies)\b/i, rule: "not-inspectable-mislabeled" },
];

/** Lint one string. */
export function lintText(text: string): LintResult {
  const violations: LintViolation[] = [];
  for (const { re, rule } of FORBIDDEN) {
    const m = re.exec(text);
    if (m) {
      violations.push({ rule, excerpt: text.slice(Math.max(0, m.index - 24), m.index + m[0].length + 24).trim() });
    }
  }
  return { ok: violations.length === 0, violations };
}

/** Lint every merchant-visible string in a rendered result. */
export function lintStrings(strings: Array<string | null | undefined>): LintResult {
  const violations: LintViolation[] = [];
  for (const s of strings) {
    if (!s) continue;
    violations.push(...lintText(s).violations);
  }
  return { ok: violations.length === 0, violations };
}
