import type { BrandConfig, BrandDetection, Config, RecommendationStatus } from "../types.js";
import { buildVariants, findAll, findEarliest, lineMentions, type Match } from "./match.js";

// ===========================================================================
// CORE IP — turns one engine answer into structured brand visibility.
//
// Implemented tonight: recommended | mentioned_neutral | not_mentioned.
// TODO (day 2-3): sentiment pass -> mentioned_positive / mentioned_negative,
// and an optional LLM classification pass for ambiguous cases. The enum already
// carries those values so adding them later is non-breaking.
// ===========================================================================

/** Phrases that signal an explicit recommendation in a brand's local sentence. */
const RECOMMEND_PHRASES = [
  "i recommend",
  "i'd recommend",
  "i would recommend",
  "we recommend",
  "highly recommend",
  "would suggest",
  "i'd suggest",
  "my top pick",
  "top pick",
  "best choice",
  "best option",
  "best overall",
  "the best",
  "go with",
  "my pick",
  "first choice",
];

const SNIPPET_RADIUS = 80; // ~160 chars total around the first mention

// Comparative / preference separators. The brand AFTER one of these is the comparison
// TARGET (the loser), not the subject a recommendation or list rank attaches to — so
// "Caraway is my top pick over GreenPan" must not mark GreenPan recommended, and
// "1. Caraway vs GreenPan" must not give GreenPan rank 1. (" vs." with a period is already
// handled by sentence-boundary splitting; only the period-less forms need listing here.)
const COMPARATIVE_SEPARATORS = [" vs ", " versus ", " over ", " rather than ", " instead of ", " compared to ", " better than ", " ahead of "];

interface ListItem {
  rank: number; // 1-based; numbered lists use the printed number
  line: string;
}

/** The PRIMARY subject of a list line — truncated at the first comparative separator so a
 *  "Brand A vs Brand B" item ranks only Brand A, not the comparison target on the same line. */
function primaryPartOfLine(line: string): string {
  const lower = line.toLowerCase();
  let cut = line.length;
  for (const sep of COMPARATIVE_SEPARATORS) {
    const i = lower.indexOf(sep);
    if (i !== -1 && i < cut) cut = i;
  }
  return line.slice(0, cut);
}

/** Parse numbered (`1.` / `1)`) and bulleted (`-`/`*`/`•`) list items, in order. */
function parseListItems(text: string): ListItem[] {
  const items: ListItem[] = [];
  let bulletCounter = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const numbered = rawLine.match(/^\s*(\d{1,2})[.)]\s+(.*)$/);
    if (numbered) {
      items.push({ rank: Number(numbered[1]), line: numbered[2]! });
      continue;
    }
    const bullet = rawLine.match(/^\s*[-*•]\s+(.*)$/);
    if (bullet) {
      bulletCounter += 1;
      items.push({ rank: bulletCounter, line: bullet[1]! });
    }
  }
  return items;
}

/**
 * The CLAUSE containing `index`, lowercased — scoped tighter than a full sentence
 * so per-brand attribution survives mixed answers like
 * "I don't recommend GreenPan; I recommend Caraway." We split on sentence
 * punctuation, semicolons, AND contrastive conjunctions (" but ", " whereas ",
 * " however ", " while "), then keep only the segment around the brand mention.
 */
function clauseAround(text: string, index: number): string {
  let start = index;
  while (start > 0 && !".!?\n;".includes(text[start - 1]!)) start--;
  let end = index;
  while (end < text.length && !".!?\n;".includes(text[end]!)) end++;
  let clause = text.slice(start, end);
  let rel = index - start; // brand position within the clause

  // Narrow further at contrastive conjunctions AND comparative separators, keeping the
  // brand's side — so the recommendation attaches to the winner, not the comparison target.
  for (const sep of [" but ", " whereas ", " however ", " while ", ...COMPARATIVE_SEPARATORS]) {
    let cut = clause.toLowerCase().indexOf(sep);
    while (cut !== -1) {
      if (rel <= cut) {
        clause = clause.slice(0, cut);
      } else {
        const after = cut + sep.length;
        clause = clause.slice(after);
        rel -= after;
      }
      cut = clause.toLowerCase().indexOf(sep);
    }
  }
  return clause; // ORIGINAL case (keeps snippets readable); callers lowercase if they need to match.
}

/** The clause containing `index`, LOWERCASED — for the recommendation-language / negation checks. */
function localSentence(text: string, index: number): string {
  return clauseAround(text, index).toLowerCase();
}

/**
 * The segments of `text` that are ABOUT the brand with these `variants`: the clause around each
 * mention (clauseAround — narrowed at contrastive/comparative separators, so mixed answers attribute
 * per-brand) PLUS any list bullet whose PRIMARY subject is the brand. Original case (readable snippets).
 *
 * This is the brand-scoped extractor proof-point attribution uses so a reason is only credited to the
 * brand whose OWN clause contains it — never the whole answer. (Also the extractor the future
 * "merchant-mirror" reuses to pull what assistants say about the MERCHANT specifically.)
 */
export function brandContexts(text: string, variants: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (seg: string) => {
    const s = seg.trim();
    const key = s.toLowerCase();
    if (s && !seen.has(key)) { seen.add(key); out.push(s); }
  };
  // List bullets whose primary subject is this brand → the whole (primary part of the) bullet.
  for (const item of parseListItems(text)) {
    const primary = primaryPartOfLine(item.line);
    if (lineMentions(primary, variants)) add(primary);
  }
  // The clause around each prose mention of the brand (deduped against the bullets above, since a
  // bulleted mention's clause is often the same line).
  for (const m of findAll(text, variants)) {
    add(clauseAround(text, m.index));
  }
  return out;
}

function snippetAround(text: string, match: Match): string {
  const start = Math.max(0, match.index - SNIPPET_RADIUS);
  const end = Math.min(text.length, match.index + match.text.length + SNIPPET_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return prefix + text.slice(start, end).replace(/\s+/g, " ").trim() + suffix;
}

function hasRecommendLanguage(sentence: string): boolean {
  return RECOMMEND_PHRASES.some((p) => sentence.includes(p));
}

/** Negation / avoidance cues that should suppress a false "recommended". */
const NEGATED_RECOMMEND = [
  "not recommend",
  "wouldn't recommend",
  "would not recommend",
  "don't recommend",
  "do not recommend",
  "can't recommend",
  "cannot recommend",
  "not the best",
  "not a great",
  "not my top pick",
  "not my pick",
  "not my first choice",
  "not my favorite",
  "n't my top pick",
  "n't my pick",
  "steer clear",
  "stay away",
  "avoid ",
];
function hasNegatedRecommend(sentence: string): boolean {
  return NEGATED_RECOMMEND.some((p) => sentence.includes(p));
}

/** True when the brand mention is directly preceded by a negation/exclusion cue, e.g. the
 *  "GreenPan" in "I recommend Caraway, not GreenPan." The recommendation language sits in the
 *  same clause but applies to the OTHER brand — so the negated one must not inherit it. */
function negatedBeforeMention(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 16), index).toLowerCase();
  return /(?:^|[\s,;:])(?:not|except|but not|excluding|skip|avoid)\s+$/.test(before);
}

/** True when the brand mention is the OBJECT of a reference/comparison construction —
 *  "alternatives to X", "instead of X", "better than X", "similar to X", "switch from X",
 *  "unlike X", "dupe for X". The brand is what's being COMPARED-AGAINST or REPLACED, not
 *  recommended; the recommendation language in the same clause belongs to the OTHER brand(s).
 *  This is the mis-attribution that named a merely-referenced rival as "AI recommended X"
 *  ("Good alternatives to Sovereign Laboratories include ARMRA (best overall)" wrongly marked
 *  Sovereign recommended because ARMRA's "best overall" sat in the same clause). */
const REFERENCE_CUE =
  /(?:^|[\s,;:(])(?:alternatives?\s+to|instead\s+of|in\s+place\s+of|replacements?\s+for|replace|switch(?:ing)?\s+from|moving?\s+away\s+from|dupes?\s+(?:for|of)|similar\s+to|comparable\s+to|compared\s+to|better\s+than|worse\s+than|unlike)\s+(?:the\s+|a\s+|an\s+)?$/;
function referencedBeforeMention(text: string, index: number): boolean {
  return REFERENCE_CUE.test(text.slice(Math.max(0, index - 36), index).toLowerCase());
}

/** Detect one brand's visibility within a single answer. */
function detectBrand(text: string, brand: BrandConfig, isOwn: boolean): BrandDetection {
  const variants = buildVariants(brand);
  const match = findEarliest(text, variants);

  if (!match) {
    return {
      name: brand.name,
      isOwn,
      mentioned: false,
      status: "not_mentioned",
      firstIndex: -1,
      listRank: null,
    };
  }

  // Find this brand's rank in any list it appears in (first matching item). Only the line's
  // PRIMARY subject earns the rank — a brand after "vs/over/…" on the same line does not.
  let listRank: number | null = null;
  for (const item of parseListItems(text)) {
    if (lineMentions(primaryPartOfLine(item.line), variants)) {
      listRank = item.rank;
      break;
    }
  }

  const sentence = localSentence(text, match.index);
  const negated = hasNegatedRecommend(sentence) || negatedBeforeMention(text, match.index);
  // The brand is named only as a comparison/alternative REFERENCE ("alternatives to X") → the clause's
  // recommendation language is about the OTHER brand, so this one must not be counted "recommended".
  const referenced = referencedBeforeMention(text, match.index);
  let status: RecommendationStatus = "mentioned_neutral";
  let reason: string | undefined;

  if (negated) {
    reason = "mentioned with a negative / avoid cue";
  } else if (referenced) {
    reason = "named as an alternative/comparison reference, not a recommendation";
  } else if (listRank === 1) {
    status = "recommended";
    reason = "top of list (rank 1)";
  } else if (hasRecommendLanguage(sentence)) {
    status = "recommended";
    reason = "explicit recommendation language";
  } else {
    reason = listRank !== null ? `listed at rank ${listRank}` : "mentioned without recommendation";
  }

  return {
    name: brand.name,
    isOwn,
    mentioned: true,
    status,
    firstIndex: match.index,
    listRank,
    reason,
    snippet: snippetAround(text, match),
  };
}

/**
 * Run detection for the brand + every competitor against one answer.
 * Returns detections in a stable order: own brand first, then competitors as
 * configured.
 */
export function detectMentions(text: string, cfg: Config): BrandDetection[] {
  const detections: BrandDetection[] = [detectBrand(text, cfg.brand, true)];
  for (const competitor of cfg.competitors) {
    detections.push(detectBrand(text, competitor, false));
  }
  return detections;
}

/** Classify one arbitrary brand (name-only is fine) in one answer with the SAME recommendation-vs-
 *  mention logic used for configured competitors. Lets the nameable-rivals check apply the identical
 *  recommendation bar to LLM-discovered brands, so nothing is NAMED as "AI recommends it" unless the
 *  detector agrees it was genuinely recommended (not merely mentioned/referenced). */
export function detectBrandInAnswer(text: string, brand: BrandConfig): BrandDetection {
  return detectBrand(text, brand, false);
}
