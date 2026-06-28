import type { BrandConfig, BrandDetection, Config, RecommendationStatus } from "../types.js";
import { buildVariants, findEarliest, lineMentions, type Match } from "./match.js";

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
const COMPARATIVE_SEPARATORS = [" vs ", " versus ", " over ", " rather than ", " instead of ", " compared to "];

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
function localSentence(text: string, index: number): string {
  let start = index;
  while (start > 0 && !".!?\n;".includes(text[start - 1]!)) start--;
  let end = index;
  while (end < text.length && !".!?\n;".includes(text[end]!)) end++;
  let clause = text.slice(start, end);
  let rel = index - start; // brand position within the clause

  // Narrow further at contrastive conjunctions AND comparative separators, keeping the
  // brand's side — so the recommendation attaches to the winner, not the comparison target.
  for (const sep of [" but ", " whereas ", " however ", " while ", ...COMPARATIVE_SEPARATORS]) {
    let from = 0;
    let cut = clause.toLowerCase().indexOf(sep, from);
    while (cut !== -1) {
      if (rel <= cut) {
        clause = clause.slice(0, cut);
      } else {
        const after = cut + sep.length;
        clause = clause.slice(after);
        rel -= after;
      }
      from = 0;
      cut = clause.toLowerCase().indexOf(sep, from);
    }
  }
  return clause.toLowerCase();
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
  "steer clear",
  "stay away",
  "avoid ",
];
function hasNegatedRecommend(sentence: string): boolean {
  return NEGATED_RECOMMEND.some((p) => sentence.includes(p));
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
  const negated = hasNegatedRecommend(sentence);
  let status: RecommendationStatus = "mentioned_neutral";
  let reason: string | undefined;

  if (negated) {
    reason = "mentioned with a negative / avoid cue";
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
