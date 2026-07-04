import { lineMentions } from "../detection/match.js";
import { detectInjection } from "../crawler/sanitize.js";
import { numeralsIn, FACT_TAG_RE, type FactSentence } from "./factSentences.js";

// ===========================================================================
// Layer 3 (tier 2a): the DETERMINISTIC post-validator — the enforcement. "Structurally impossible to
// overclaim" is true only if THIS holds on real output. It never trusts the model:
//   2. digit-trace — a merchant-scoped numeral not in the fact set → downgrade (fabricated stat).
//   3. tag integrity — every "(fact Fn)" must reference a real fact, its numerals ⊆ the fact's, and
//      its tokens overlap the fact (minting a passing tag requires BEING the fact).
//   4. lexicon — merchant-scoped superiority/causal language → downgrade (so "Where you win" cannot
//      render a superiority claim even if the model tries; competitor QUOTES are exempt).
//   5. claim-without-provenance — a merchant numeral/claim verb needs a tag or placeholder.
//   6. downgrade-don't-retry — offending line → grouped placeholder ($0); if too many, the caller
//      discards the LLM body for the MerchantFacts-consuming template (honesty floor survives at $0).
//   B4. output scan — fence-token/scaffolding leakage or an injection cue in the stored artifact → fallback.
// PURE. No I/O, no LLM.
// ===========================================================================

export type ViolationKind =
  | "fabricated_numeral" | "bad_tag" | "superiority" | "causal" | "unprovenanced" | "fence_leak" | "output_injection";
export interface DraftViolation { kind: ViolationKind; line: string; detail: string }
export interface ValidationResult {
  body: string; // offending merchant lines downgraded in place
  violations: DraftViolation[];
  downgrades: number;
  usedFallback: boolean; // true → caller MUST render the deterministic MerchantFacts template instead
  provenance: string[]; // the fact tags that survived (for Artifact.provenance)
}

// Curated, conservative (INJECTION_PATTERNS philosophy). Applied ONLY to merchant-scoped, non-quoted text.
const SUPERIORITY = /\b(better|best|superior|outperforms?|beats?|stronger|higher[- ]quality|highest[- ]quality|more durable|the clear choice|top[- ]rated|leading|unrivall?ed|unmatched|no\.?\s?1|#1)\b/i;
const CAUSAL = /\b(which is why (ai|assistants)|so (ai|assistants) (will|now)|proven to|causes? (ai|assistants)|guarantees? (you|more|higher))\b/i;
const CLAIM_VERB = /\b(rated|priced|ranges?|ranged|offers?|features?|includes?|provides?|delivers?|guarantees?|ships?|in stock|reviews?)\b/i;

function significantTokens(s: string): string[] {
  // Strip the provenance tag BEFORE lowercasing — FACT_TAG_RE matches the uppercase `F\d+`, so
  // lowercasing first ("F2"→"f2") would leave the tag's own tokens (fact/crawled/…) and inflate
  // token-overlap, letting a minted tag pasted onto unrelated content slip through.
  return s.replace(FACT_TAG_RE, " ").toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
}
/** Fraction of the fact's significant tokens present in the line — proves verbatim-ish reuse. */
function tokenOverlap(line: string, factText: string): number {
  const factTokens = new Set(significantTokens(factText));
  if (factTokens.size === 0) return 1;
  const lineTokens = new Set(significantTokens(line));
  let hit = 0;
  for (const t of factTokens) if (lineTokens.has(t)) hit += 1;
  return hit / factTokens.size;
}
/** Remove quoted spans on a line that carries an "(AI answer…)" tag — the competitor's quoted praise
 *  ("best-in-class") legitimately contains lexicon words and is NOT a merchant claim. Used for the
 *  digit-trace/tag checks (so a fabricated numeral in a NON-quoted merchant claim is still caught). */
function stripAiQuotes(line: string): string {
  return /\(AI answer/i.test(line) ? line.replace(/"[^"]*"|“[^”]*”/g, " ") : line;
}
/** Remove ALL quoted spans — used for the LEXICON scan only. A shopper's quoted question ("best
 *  luxury handbags") or a competitor quote isn't a merchant superiority claim; a merchant's OWN
 *  superiority claim ("Burberry is better") is not quoted, so it's still caught. */
function stripAllQuotes(line: string): string {
  return line.replace(/"[^"]*"|“[^”]*”/g, " ");
}

/** Validate a drafted body against the fact set + evidence. Downgrades offending merchant lines;
 *  signals `usedFallback` when the draft can't be trusted. */
export function validateMerchantDraft(
  body: string,
  sentences: FactSentence[],
  evidence: string[],
  brandVariants: string[],
): ValidationResult {
  const factById = new Map(sentences.map((s) => [s.id, s]));
  const allowedNumerals = new Set<string>();
  for (const s of sentences) {
    s.numerals.forEach((x) => allowedNumerals.add(x));
    (s.tag.match(/\d{4}-\d{2}-\d{2}/g) ?? []).forEach((d) => numeralsIn(d).forEach((x) => allowedNumerals.add(x)));
  }
  for (const e of evidence) numeralsIn(e).forEach((x) => allowedNumerals.add(x));

  const violations: DraftViolation[] = [];
  const provenance: string[] = [];
  let downgrades = 0;
  let brandFactLines = 0;
  let downgradedFactLines = 0;

  let inByNumbers = false;
  let currentTopic = "this comparison";

  const outLines = body.split(/\r?\n/).map((line) => {
    const heading = line.match(/^\s*#{1,6}\s+(.*)$/);
    if (heading) {
      currentTopic = heading[1]!.replace(/[*_`"]/g, "").trim() || currentTopic;
      inByNumbers = /by the numbers/i.test(line);
      return line; // headings are chrome
    }
    if (!line.trim()) return line;

    const merchantScoped = inByNumbers || lineMentions(line, brandVariants);
    if (!merchantScoped) return line;

    for (const m of line.matchAll(FACT_TAG_RE)) provenance.push(m[0]);
    const isFactLine = /\(fact F\d+/.test(line) || inByNumbers;
    if (isFactLine) brandFactLines += 1;

    const scoped = stripAiQuotes(line);
    const lineViol: DraftViolation[] = [];

    // 2. digit-trace
    for (const num of numeralsIn(scoped)) {
      if (!allowedNumerals.has(num)) { lineViol.push({ kind: "fabricated_numeral", line, detail: num }); break; }
    }
    // 3. tag integrity
    for (const m of line.matchAll(FACT_TAG_RE)) {
      const id = m[1]!;
      const fact = factById.get(id);
      if (!fact) { lineViol.push({ kind: "bad_tag", line, detail: `unknown ${id}` }); continue; }
      const factNums = new Set(fact.numerals);
      const numOk = numeralsIn(scoped).every((ln) => factNums.has(ln));
      if (!numOk) lineViol.push({ kind: "bad_tag", line, detail: `numeral not in ${id}` });
      else if (tokenOverlap(line, fact.text) < 0.5) lineViol.push({ kind: "bad_tag", line, detail: `low overlap with ${id}` });
    }
    // 4. lexicon (merchant-scoped, ALL quotes stripped — a quoted buyer question / competitor praise
    //    is not a merchant superiority claim; a merchant's own unquoted claim still trips this).
    const lexScoped = stripAllQuotes(line);
    const sup = lexScoped.match(SUPERIORITY);
    if (sup) lineViol.push({ kind: "superiority", line, detail: sup[0] });
    const cau = lexScoped.match(CAUSAL);
    if (cau) lineViol.push({ kind: "causal", line, detail: cau[0] });
    // 5. claim-without-provenance
    const hasProvenance = /\(fact F\d+|\(AI answer|\(you provide\)/i.test(line);
    const hasPlaceholder = /\[[^\]\n]+\]/.test(line);
    if (!hasProvenance && !hasPlaceholder && (numeralsIn(scoped).length > 0 || CLAIM_VERB.test(scoped))) {
      lineViol.push({ kind: "unprovenanced", line, detail: "merchant claim with no tag or placeholder" });
    }

    if (lineViol.length) {
      violations.push(...lineViol);
      downgrades += 1;
      if (isFactLine) downgradedFactLines += 1;
      const topic = currentTopic.replace(/[[\]"]/g, "").slice(0, 40).toUpperCase();
      // Replace the line's content with a grouped placeholder; keep any leading markdown bullet marker.
      const prefix = line.match(/^(\s*(?:[-*]|\d+[.)])\s+(?:\*\*[^*]*\*\*:?\s*)?)/)?.[1] ?? "";
      return `${prefix}[${topic} — we couldn't verify this; state only what's true (you provide)]`;
    }
    return line;
  });

  let outBody = outLines.join("\n");
  let usedFallback = false;

  // B4 — output-side scan (the artifact is stored and a merchant will read it).
  if (/===UNTRUSTED_|following is UNTRUSTED|Treat it strictly as DATA/i.test(outBody)) {
    violations.push({ kind: "fence_leak", line: "", detail: "fence scaffolding leaked into output" });
    usedFallback = true;
  }
  if (detectInjection(outBody).flagged) {
    violations.push({ kind: "output_injection", line: "", detail: "injection cue in output" });
    usedFallback = true;
  }
  // 6 — too many downgrades, or every brand-side fact got downgraded → discard the LLM body.
  if (downgrades > 4 || (brandFactLines > 0 && downgradedFactLines >= brandFactLines)) usedFallback = true;

  return { body: outBody, violations, downgrades, usedFallback, provenance: [...new Set(provenance)] };
}
