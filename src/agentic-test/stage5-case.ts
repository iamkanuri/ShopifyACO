import type { Claim } from "./case-render.js";
import type { ProspectDiagnostic, WinnerContrast } from "./stage5-diagnose.js";

// ===========================================================================
// STAGE 5 — real-store case renderer + CLAIM LINTER (spec 4.6). The linter is
// the safety spine: every claim is scoped to EVIDENCE AVAILABILITY, never to
// product truth (Rule 4). A case that fails the linter is NOT rendered.
// ===========================================================================

// ---- the claim linter (deterministic, blocking) ---------------------------

export interface LintResult {
  ok: boolean;
  violations: Array<{ pattern: string; excerpt: string }>;
}

/** Forbidden phrasings (Rule 4): product-truth assertions, revenue/causal/
 *  predictive language. Case-insensitive; matched against rendered TEXT only. */
const FORBIDDEN_PATTERNS: Array<{ re: RegExp; label: string }> = [
  // Product-truth assertions about the store's product.
  { re: /\byour product (is|isn't|is not|lacks|contains|doesn't|does not)\b/i, label: "product-truth assertion" },
  { re: /\byour (deodorant|item|formula) (is|isn't|is not|lacks|contains)\b/i, label: "product-truth assertion" },
  { re: /\bis not (aluminum|vegan|baking)/i, label: "product-truth assertion" },
  // Revenue / loss.
  { re: /\blos(e|es|ing) \$?\d/i, label: "revenue-loss claim" },
  { re: /\b(costing|missing out on|leaving) \$?\d/i, label: "revenue claim" },
  { re: /\$\d[\d,]*\s*(per|\/)\s*(month|year|day|week)\b/i, label: "revenue projection" },
  // Causal / predictive.
  { re: /\bwill (improve|increase|boost|rank|win|fix|convert|drive)\b/i, label: "predictive claim" },
  { re: /\b(caused|because of this|as a result of|leads? to|results? in) (your|the) (loss|drop|ranking)/i, label: "causal claim" },
  { re: /\brank(s|ed)? higher\b/i, label: "ranking-prediction claim" },
  { re: /\bguarantee(s|d)?\b/i, label: "guarantee claim" },
  { re: /\byou'?ll (get|see|rank|win|earn|recover)\b/i, label: "predictive claim" },
  { re: /\bthis (edit|fix|change) will\b/i, label: "predictive fix claim" },
  // Rule 4 defensive: never say a store "does not state"/"is missing" a PRICE —
  // price is always public on a Shopify store, so any price-not-stated claim is
  // a mis-scoped evidence claim (readable-but-unmet must be excluded upstream).
  { re: /(does not state|doesn't state|missing|absent|can't verify|cannot verify)[^.]{0,40}\b(price|variant[- ]?price|cost)\b/i, label: "price-is-always-public (mis-scoped evidence claim)" },
];

/** Lint rendered case TEXT. `numbers` are every numeric token that MUST be
 *  present in the claims map; any number in the text not in the map is a
 *  violation (prevents smuggling unsourced figures). */
export function lintCaseText(text: string, claimsMap: Record<string, Claim>): LintResult {
  const violations: LintResult["violations"] = [];
  for (const { re, label } of FORBIDDEN_PATTERNS) {
    const m = re.exec(text);
    if (m) violations.push({ pattern: label, excerpt: text.slice(Math.max(0, m.index - 20), m.index + m[0].length + 20) });
  }
  // Every number in the rendered text must appear in a claims-map value.
  const claimValues = Object.values(claimsMap).map((c) => c.value).join("  ");
  const numbers = text.match(/\$?\d[\d,]*(?:\.\d+)?%?/g) ?? [];
  for (const n of new Set(numbers)) {
    // Allow bare state numbers 1–12 (the case's own step headings) and years.
    if (/^\d{1,2}$/.test(n) && Number(n) <= 12) continue;
    if (/^20\d{2}$/.test(n)) continue;
    if (!claimValues.includes(n)) violations.push({ pattern: "unsourced-number", excerpt: n });
  }
  return { ok: violations.length === 0, violations };
}

// ---- human-readable labels (evidence-availability phrasing only) -----------

/** Neutral, evidence-availability phrasing for an attribute. Never a product-
 *  truth claim — always "state that …" framing the linter accepts. */
const ATTR_LABEL: Record<string, string> = {
  subscription_required: "that it's a one-time purchase (not a subscription)",
  aluminum_free: "that it's aluminum-free",
  baking_soda_free: "that it's baking-soda-free",
  vegan: "that it's vegan",
  fragrance_free: "that it's fragrance-free / unscented",
  tallow_free: "that it's tallow-free",
  single_origin: "that it's single-origin",
  organic: "that it's organic",
  roast_date_disclosed: "when it was roasted (roast date / roasted-to-order)",
  decaf_method_disclosed: "how it's decaffeinated (the decaf process)",
  variant_price: "its price",
};
export function attrLabel(a: string): string {
  return ATTR_LABEL[a] ?? a.replace(/_/g, " ");
}
const SURFACE_LABEL: Record<string, string> = {
  product_description: "product description",
  structured_data: "structured data",
  product_title: "product title",
  faq: "FAQ",
};
const surfaceLabel = (s?: string) => (s ? SURFACE_LABEL[s] ?? s.replace(/_/g, " ") : "public product data");
const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---- claims map (all numbers/quotes trace to the diagnostic) ---------------

export function buildStage5Claims(
  d: ProspectDiagnostic,
  storeName: string,
  competitorName: string,
  competitorMentions: number,
  winnerContrast?: WinnerContrast,
): Record<string, Claim> {
  const src = (u: string) => `${u} (fetched ${d.fetchedAt})`;
  const catalogUrl = d.fetchUrls.catalog ?? d.origin;
  // Rule 4: ONLY genuine evidence gaps (nothing readable) may be reported as
  // "not stated". A readable-but-unmet value (e.g. price over the cap) is NOT
  // an evidence gap — the store states it fine — and is excluded here.
  const gapFindings = d.findings.filter((f) => f.genuineEvidenceGap);
  const evidencedFindings = d.findings.filter((f) => f.scanVerdict === "evidenced");
  const missingList = gapFindings.map((f) => f.attribute.replace(/_/g, "-")).join(", ") || "none";
  const failingJourneys = d.journeyOutcomes.filter((j) => j.outcome === "MISSING_EVIDENCE").length;

  // Stage 6.1: register the winner's verbatim quotes as claims so any numbers
  // they contain are SOURCED (the linter blocks unsourced figures). Provenance
  // cites the winner's own public page.
  const winnerClaims: Record<string, Claim> = {};
  for (const [i, f] of (winnerContrast?.facts ?? []).entries()) {
    if (f.winnerEvidences && f.winnerQuote) {
      winnerClaims[`winnerQuote${i}`] = {
        value: f.winnerQuote,
        source: `Store Diagnostic Scan over ${competitorName}'s public ${f.winnerSurface ?? "product data"} (verbatim quote)`,
      };
    }
  }

  return {
    ...winnerClaims,
    storeName: { value: storeName, source: src(catalogUrl) },
    competitorName: { value: competitorName, source: "battery.jsonl (deterministic brand extraction over probe responses)" },
    competitorMentions: { value: String(competitorMentions), source: "battery.jsonl (brand mention count across channels)" },
    batteryTotal: { value: String(d.battery.batteryTotal), source: "battery.jsonl (total probes)" },
    storeAppearances: { value: String(d.battery.brandMentions), source: "battery.jsonl (this store's brand mention count)" },
    journeyCount: { value: String(d.journeyOutcomes.length), source: "stage5 diagnostic (2 models × 2 trials)" },
    failingJourneys: { value: String(failingJourneys), source: "stage5 diagnostic (journeys returning MISSING_EVIDENCE)" },
    missingEvidence: { value: missingList, source: `Store Diagnostic Scan over ${src(catalogUrl)}` },
    inspectedSurfaces: { value: "your product title, description, variants and prices", source: src(catalogUrl) },
    notInspectableList: { value: d.surfacesNotInspectable.map((s) => s.replace(/_/g, " ")).join(", "), source: "public-data limitation (metafields/policies not exposed publicly)" },
    evidencedList: { value: evidencedFindings.map((f) => f.attribute.replace(/_/g, "-")).join(", ") || "none", source: `Store Diagnostic Scan over ${src(catalogUrl)}` },
  };
}

// ---- renderer (public-data variant of the Stage 4 case) --------------------

/** Render the Stage 6.1 winner-contrast block (evidence-availability, both
 *  directions). Returns "" when there is no distinct winner or no gap to
 *  contrast. Every sentence is claim-lintable; quotes are verbatim + escaped. */
export function renderWinnerContrast(contrast: WinnerContrast | undefined, claims: Record<string, Claim>): string {
  if (!contrast || !contrast.distinct || contrast.facts.length === 0) return "";
  const name = escHtml(claims.competitorName?.value ?? contrast.brand);
  const mentions = claims.competitorMentions?.value ?? String(contrast.mentions);
  const items: string[] = [];
  for (const f of contrast.facts) {
    const label = attrLabel(f.attribute);
    if (f.winnerEvidences && f.winnerQuote) {
      items.push(
        `<li><b>${name}</b> — recommended ${mentions} times in our test — states ${label} in its public ${surfaceLabel(f.winnerSurface)}: <i>“${escHtml(f.winnerQuote)}”</i>. Your public store doesn't state it anywhere an AI assistant can read.</li>`,
      );
    } else if (f.winnerEvidences) {
      items.push(
        `<li><b>${name}</b> — recommended ${mentions} times in our test — states ${label} in its public ${surfaceLabel(f.winnerSurface)}. Your public store doesn't state it anywhere an AI assistant can read.</li>`,
      );
    } else {
      items.push(
        `<li>Even <b>${name}</b>, the most-recommended store in our test, doesn't state ${label} in a form an AI assistant can verify — so stating it is an open advantage.</li>`,
      );
    }
  }
  return `\n<h2>3 · How the category leader compares</h2>\n<p>Same test, run on the public data of the store AI assistants recommend most:</p>\n<ul>\n${items.join("\n")}\n</ul>\n`;
}

/** The merchant-facing case BODY (states) — this is what the claim linter
 *  gates. Provenance metadata (URLs, timestamp, model versions) is appended
 *  separately by renderStage5Case and is NOT claim-linted (it is factual
 *  provenance, not a claim, and legitimately contains version/date numbers).
 *  `opts.contrastHtml` (Stage 6.1) is spliced in as section 3 and IS linted
 *  with the body (its quotes are registered as claims by buildStage5Claims). */
export function renderStage5CaseBody(claims: Record<string, Claim>, opts: { contrastHtml?: string } = {}): string {
  const resolve = (t: string) =>
    t.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
      const c = claims[k];
      if (!c) throw new Error(`orphan claim placeholder: {{${k}}}`);
      return c.value;
    });
  const body = `<div class="case">
<p class="disclosure">This diagnostic uses only your publicly available store data. It reports what AI shopping assistants can and cannot verify from your public storefront — not what is true about your products.</p>

<h2>1 · The live signal</h2>
<p>We asked AI assistants {{batteryTotal}} shopping questions in your category. Your store appeared in {{storeAppearances}}. <b>{{competitorName}}</b> was recommended {{competitorMentions}} times.</p>

<h2>2 · The test we ran</h2>
<p>We built a shopping test from those questions and ran it against your public store data: can an AI assistant confirm the things shoppers asked for — {{evidencedList}}, and {{missingEvidence}}?</p>
${opts.contrastHtml ?? ""}
<h2>4 · We shopped your store the way an AI does</h2>
<p>{{journeyCount}} automated shopping attempts across 2 AI models, using only {{inspectedSurfaces}}.</p>

<h2>5 · Where the attempts stopped</h2>
<p>{{failingJourneys}} of {{journeyCount}} attempts could not confirm one or more requirements from your public data. Specifically, your public store does not state the following in a form an AI assistant can verify: <b>{{missingEvidence}}</b>.</p>
<p><i>Not inspectable from public data (would need store access): {{notInspectableList}}. We do not report these as missing.</i></p>

<h2>7 · What this means</h2>
<p>Your public store data does not let an AI assistant verify {{missingEvidence}} for the product we tested. This is a statement about what is publicly readable, not about your product.</p>

<h2>8 · What we'd propose</h2>
<p>Add an explicit, machine-readable statement of {{missingEvidence}} to your public product description or structured data, so an AI assistant can confirm it the way it already confirms {{evidencedList}}.</p>
<p><i>Applying the change on your store, and verifying it fixed the test, requires installing AisleLens — that connects your store so we can propose the exact edit, apply it with your approval, and re-run this test to prove it resolved.</i></p>

<h2>What happens after you install</h2>
<ul>
<li><b>Confirm</b> — you confirm the facts (only you can; we never assert them from public data).</li>
<li><b>Approve</b> — you approve the exact edit before anything changes.</li>
<li><b>Verify</b> — we re-run the same test and show it now passes.</li>
<li><b>Recheck & monitor</b> — we recheck live assistants over time and save the test so it flags any future regression.</li>
</ul>
</div>`;
  return resolve(body);
}

/** Provenance footer — factual metadata, NOT claim-linted. */
export function renderProvenanceFooter(opts: { modelsUsed: string; provenanceUrls: string[]; fetchedAt: string }): string {
  return `<footer class="prov"><hr><p>Data source: ${opts.provenanceUrls.map((u) => `<code>${u}</code>`).join(", ")} · fetched ${opts.fetchedAt} · models: ${opts.modelsUsed}. This diagnostic uses only your publicly available store data.</p></footer>`;
}

export function renderStage5Case(
  claims: Record<string, Claim>,
  opts: { modelsUsed: string; provenanceUrls: string[]; fetchedAt: string; contrastHtml?: string },
): string {
  return renderStage5CaseBody(claims, { contrastHtml: opts.contrastHtml }) + renderProvenanceFooter(opts);
}

/** One-line plain-text contrast sentences (for message.txt), same asymmetry as
 *  the HTML block: evidenced → quote; not-evidenced → open-advantage. */
export function renderWinnerContrastPlain(contrast: WinnerContrast | undefined, claims: Record<string, Claim>): string[] {
  if (!contrast || !contrast.distinct || contrast.facts.length === 0) return [];
  const name = claims.competitorName?.value ?? contrast.brand;
  const mentions = claims.competitorMentions?.value ?? String(contrast.mentions);
  return contrast.facts.map((f) =>
    f.winnerEvidences
      ? `${name} (recommended ${mentions}× in our test) states ${attrLabel(f.attribute)}${f.winnerQuote ? `: "${f.winnerQuote}"` : ""} — your public store doesn't.`
      : `Even ${name}, the most-recommended store in our test, doesn't state ${attrLabel(f.attribute)} — stating it is an open advantage.`,
  );
}

/** Plain-text (message-pasteable) version. */
export function renderStage5Plain(
  claims: Record<string, Claim>,
  opts: { provenanceUrls: string[]; fetchedAt: string; contrast?: WinnerContrast },
): string {
  const c = (k: string) => claims[k]?.value ?? "";
  const contrastLines = renderWinnerContrastPlain(opts.contrast, claims);
  return [
    `AI shopping visibility — ${c("storeName")}`,
    ``,
    `We asked AI assistants ${c("batteryTotal")} shopping questions in your category. Your store appeared in ${c("storeAppearances")}. ${c("competitorName")} was recommended ${c("competitorMentions")} times.`,
    ``,
    `Running an AI shopping test against your PUBLIC store data (${c("journeyCount")} attempts, 2 models): ${c("failingJourneys")} could not confirm one or more requirements. Your public store does not state the following in an AI-verifiable form: ${c("missingEvidence")}. (It already evidences: ${c("evidencedList")}.)`,
    ...(contrastLines.length ? [``, `How the category leader compares:`, ...contrastLines.map((l) => `- ${l}`)] : []),
    ``,
    `Not inspectable from public data, so NOT reported as missing: ${c("notInspectableList")}.`,
    ``,
    `What we'd propose: add an explicit, machine-readable statement of ${c("missingEvidence")} to your public product description or structured data. Applying and verifying the fix requires installing AisleLens.`,
    ``,
    `This diagnostic uses only your publicly available store data. It reports what AI assistants can verify, not what is true about your products.`,
    `Source: ${opts.provenanceUrls.join(", ")} · fetched ${opts.fetchedAt}.`,
  ].join("\n");
}
