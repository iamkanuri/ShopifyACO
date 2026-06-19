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

interface ListItem {
  rank: number; // 1-based; numbered lists use the printed number
  line: string;
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

/** The sentence (or list line) containing `index`, lowercased. */
function localSentence(text: string, index: number): string {
  let start = index;
  while (start > 0 && !".!?\n".includes(text[start - 1]!)) start--;
  let end = index;
  while (end < text.length && !".!?\n".includes(text[end]!)) end++;
  return text.slice(start, end).toLowerCase();
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

  // Find this brand's rank in any list it appears in (first matching item).
  let listRank: number | null = null;
  for (const item of parseListItems(text)) {
    if (lineMentions(item.line, variants)) {
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
