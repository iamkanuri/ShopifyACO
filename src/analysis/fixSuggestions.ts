import type { Config } from "../types.js";
import type {
  CompetitorThreat,
  FixCard,
  LostPrompt,
  ProofPoint,
  QueryClusterResult,
} from "./types.js";
import type { CitedSourcesReport } from "./citedSources.js";
import { uniq } from "./util.js";

/** "wirecutter.com (5), reddit.com (4), goodhousekeeping.com (2)" for the top cited sources. */
function sourceList(report: CitedSourcesReport | undefined, n = 3): string {
  return (report?.onLostAnswers.sources ?? []).slice(0, n).map((s) => `${s.domain} (${s.count})`).join(", ");
}

// ---------------------------------------------------------------------------
// Fix cards in two clearly-labeled tiers:
//   (a) EVIDENCE-BACKED — every card cites the exact lost prompts/snippets that
//       triggered it. No evidence link => it cannot be tier (a).
//   (b) GENERAL HYGIENE — schema / llms.txt / structured data. The live site has
//       NOT been audited, so these are general best practices, always labeled as such.
//
// EVERYTHING here is CATEGORY-AGNOSTIC and derived from THIS scan's evidence — the
// detected category, the real competitor, the real lost prompts, and the real reasons
// assistants cited. There is NO hardcoded vertical vocabulary (the prior version told
// every brand to disclose its "PFAS status / oven-safe temp / induction support").
// We never assert product facts. Factual cards carry a `verifyNote`.
// ---------------------------------------------------------------------------

const SITE_NOT_AUDITED = "Not checked against your live store — verify whether this already exists before acting.";

/** Join labels into a readable clause: ["a","b","c"] → "a, b, and c". */
function listJoin(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

export function buildFixCards(
  cfg: Config,
  threat: CompetitorThreat | null,
  clusters: QueryClusterResult[],
  proofPoints: ProofPoint[],
  lostPrompts: LostPrompt[],
  citedSources?: CitedSourcesReport,
  ownLeadsCategory = false,
): FixCard[] {
  const cards: FixCard[] = [];
  const brand = cfg.brand.name;
  const category = cfg.category;

  // ---- (a) EVIDENCE-BACKED -------------------------------------------------

  // 1. Head-to-head comparison vs the direct threat — grounded in the real lost prompts
  //    and the specific reasons the competitor was cited for (never a canned spec list).
  if (threat) {
    const related = lostPrompts.filter((lp) => lp.winners.includes(threat.competitor));
    if (related.length) {
      const reasons = proofPoints.filter((p) => p.competitors.includes(threat.competitor)).slice(0, 3);
      const reasonLabels = reasons.map((p) => p.label.toLowerCase());
      const egPrompt = related[0]!.prompt;
      const egSnippet =
        (related.map((r) => r.snippet).find(Boolean) as string | undefined) ??
        (reasons.map((r) => r.exampleSnippet).find(Boolean) as string | undefined);
      cards.push({
        id: "cmp_threat",
        tier: "evidence_backed",
        impact: "high",
        title: `Add a "${brand} vs ${threat.competitor}" comparison page`,
        why:
          `${threat.competitor} out-recommended ${brand} in ${related.length} answer(s) in this scan` +
          (reasonLabels.length ? `, where assistants leaned on ${listJoin(reasonLabels)}` : "") +
          ` — e.g. "${egPrompt}". A direct comparison gives assistants a ${brand} source to cite for these queries.`,
        relatedPrompts: uniq(related.map((r) => r.prompt)).slice(0, 6),
        relatedSnippets: related.map((r) => r.snippet).filter(Boolean).slice(0, 3) as string[],
        suggestedFix:
          `Publish an honest "${brand} vs ${threat.competitor}" page that meets these queries head-on` +
          (reasonLabels.length ? `, directly addressing ${listJoin(reasonLabels)}` : ` for ${category}`) +
          `, and leads with where ${brand} genuinely wins.` +
          (egSnippet ? ` Ground it in what assistants actually said about ${threat.competitor}: "${egSnippet}".` : ""),
        verifyNote: "Only claim advantages that are actually true for your products.",
      });
    }
  }

  // 2. Transactional clusters where the brand is absent or weak.
  for (const c of clusters.filter((c) => c.transactional)) {
    const clusterLost = lostPrompts.filter((lp) => c.prompts.includes(lp.prompt));
    if (!c.absent && c.brandMention.rate > 0.34) continue; // already reasonably visible
    if (clusterLost.length === 0 && !c.absent) continue;

    const spec = clusterFix(c.cluster, category, brand, c, clusterLost);
    if (!spec) continue;
    cards.push({
      id: `cluster_${c.cluster}`,
      tier: "evidence_backed",
      impact: c.absent ? "high" : "medium",
      title: spec.title,
      why:
        `${brand} is ${c.absent ? "absent from" : "weak in"} "${c.label}" buying queries ` +
        `(${c.brandMention.count}/${c.responses} mentioned in this scan). ${spec.why}`,
      relatedPrompts: uniq((clusterLost.length ? clusterLost.map((l) => l.prompt) : c.prompts)).slice(0, 6),
      relatedSnippets: clusterLost.map((l) => l.snippet).filter(Boolean).slice(0, 2) as string[],
      suggestedFix: spec.fix,
      verifyNote: spec.verify,
    });
  }

  // 3. Expose the quotable details competitors win on — derived from the proof points
  //    actually detected in THIS scan (neutral labels), not a fixed spec list.
  if (proofPoints.length) {
    // Cap at the top few by frequency (Fix 4) so this reads as focused advice, not a 7-item dump.
    const top = proofPoints.slice(0, 4);
    const labels = top.map((p) => p.label.toLowerCase());
    // A category LEADER isn't being "beaten" — reframe to defend-the-lead. And a single-hit signal isn't a
    // pattern: this is only a HIGH-impact card when the merchant is losing AND a proof point recurs (≥2).
    const strongPattern = top.some((p) => p.hits >= 2);
    cards.push({
      id: "expose_specs",
      tier: "evidence_backed",
      impact: !ownLeadsCategory && strongPattern ? "high" : "medium",
      title: ownLeadsCategory
        ? "State the details AI assistants quote — so you keep winning these comparisons"
        : "State the details AI assistants quote — the ones competitors win on",
      why: ownLeadsCategory
        ? `${brand} already leads, but in the few answers where a rival was picked instead, assistants leaned on ` +
          `concrete, quotable specifics: ${listJoin(labels)}. State these in plain text to protect the lead and close even those gaps.`
        : `In answers where competitors beat ${brand}, assistants leaned on concrete, quotable specifics: ` +
          `${listJoin(labels)}. ${brand} needs these stated in plain text assistants can lift.`,
      relatedPrompts: [],
      relatedSnippets: top.map((p) => p.exampleSnippet).filter(Boolean).slice(0, 3) as string[],
      suggestedFix:
        `On every product and collection page, state in plain text the details shoppers in ${category} compare` +
        ` — here, assistants rewarded ${listJoin(labels)} — for each product. Assistants quote what's written, so don't leave it in images.`,
      verifyNote: "State each detail only if it's true for that product; verify before publishing.",
    });
  }

  // 4. Third-party proof / press (competitors repeatedly cite reviews, tests, or awards).
  const testing = proofPoints.find(
    (p) => p.id === "third_party_testing" || p.id === "editorial_press" || p.id === "awards_recognition",
  );
  if (testing) {
    // Upgrade from generic to SPECIFIC when we know where assistants actually grounded the lost
    // answers: name the exact sources (observed — "the assistant cited X", never "X caused the win").
    const lostSources = sourceList(citedSources);
    const lostN = citedSources?.onLostAnswers.n ?? 0;
    cards.push({
      id: "third_party_proof",
      tier: "evidence_backed",
      impact: "medium",
      title: "Feature third-party proof and press",
      // Honest framing: a reason that appeared in answers where the brand lost — NOT a claim that a
      // named competitor "won on" it. The cited sources are OBSERVED (assistant cited them), not causal.
      why: lostSources
        ? `In the ${lostN} answer(s) where ${brand} wasn't the pick, assistants cited ${lostSources} — the third-party sources they leaned on most in your category (observed, not proof those citations chose the competitor).`
        : `In answers where ${brand} wasn't the pick, ${testing.label.toLowerCase()} showed up as a reason AI trusted and repeated (${testing.hits} answer(s)).`,
      relatedPrompts: testing.examplePrompt ? [testing.examplePrompt] : [],
      relatedSnippets: testing.exampleSnippet ? [testing.exampleSnippet] : [],
      suggestedFix: lostSources
        ? `Earn and surface legitimate proof on the sources assistants actually cite here (${lostSources}): pursue coverage/reviews/testing from those outlets, and make any genuine results quotable, linkable text near the product (not only in images).`
        : "If you have legitimate third-party testing, editorial coverage, or awards, surface them as quotable, " +
          "linkable text near the product (not only in images).",
      verifyNote: "Add this only if true — never fabricate tests, reviews, or awards; the cited sources are where assistants LOOKED, not proof they chose the competitor.",
    });
  }

  // ---- (b) GENERAL HYGIENE (site not audited) ------------------------------

  cards.push({
    id: "schema",
    tier: "general_hygiene",
    impact: "medium",
    title: "Fill the structured-data gaps most platforms leave (AggregateRating, shipping, returns)",
    why:
      "Structured data helps AI crawlers extract ratings, shipping terms, and return policies reliably " +
      "instead of guessing from prose — and these specific fields are the ones standard storefront " +
      "platforms do NOT emit by default.",
    relatedPrompts: [],
    relatedSnippets: [],
    suggestedFix:
      "Add AggregateRating (your real review counts), OfferShippingDetails, and hasMerchantReturnPolicy " +
      "to your existing product schema. Note: modern platforms (e.g. Shopify OS 2.0 themes) already emit " +
      "a Product + Offer JSON-LD block — extend that block rather than adding a second Product node, " +
      "and if a reviews app is installed it may already emit AggregateRating (check your page source " +
      "first; duplicates conflict).",
    verifyNote: SITE_NOT_AUDITED,
  });

  cards.push({
    id: "llms_txt",
    tier: "general_hygiene",
    impact: "low",
    title: `Publish an AI-readable brand summary (llms.txt candidate) for ${brand}`,
    why:
      "A concise, factual brand/product summary at a stable URL gives assistants a canonical source " +
      "to ground answers about you.",
    relatedPrompts: [],
    relatedSnippets: [],
    suggestedFix:
      `Draft an /llms.txt (or a clean "About ${brand}" page) listing product lines, key attributes, ` +
      "price ranges, and differentiators in plain text.",
    verifyNote: SITE_NOT_AUDITED,
  });

  return sortByImpact(cards);
}

interface ClusterFixSpec {
  title: string;
  why: string;
  fix: string;
  verify?: string;
}

/**
 * The prescription for a transactional cluster the brand is losing. The `alternatives`
 * cluster keeps its evidence-driven competitor extraction; every other cluster uses ONE
 * category-agnostic template grounded in a real lost prompt from that cluster — so there
 * is no per-vertical hardcoded copy to drift out of a category (e.g. cookware "induction"
 * / "Teflon" advice reaching a fashion brand).
 */
function clusterFix(
  cluster: string,
  category: string,
  brand: string,
  c: QueryClusterResult,
  clusterLost: LostPrompt[],
): ClusterFixSpec | null {
  if (cluster === "alternatives") {
    const named = uniq(
      c.prompts
        .map((p) => /alternatives? to ([a-z0-9 .&'-]+)/i.exec(p)?.[1]?.trim())
        .filter(Boolean) as string[],
    );
    const who = named.length ? named.join(", ") : "leading competitors";
    return {
      title: `Win "alternatives to ${who}" searches`,
      why: `Assistants answer "alternatives to ${who}" without surfacing ${brand}.`,
      fix: `Create comparison/alternative content explaining why ${brand} is a strong alternative to ${who}.`,
      verify: "Frame comparisons honestly; only claim real advantages.",
    };
  }

  // Fix 4: derive the title + step from the REAL lost prompt (like the comparison card), so the
  // card reads as advice — "Publish a 'best modular sofa under $2000' guide" — not internal
  // taxonomy ("Add content for 'Budget / under-price' queries").
  const eg = (clusterLost.find((l) => l.prompt)?.prompt ?? c.prompts[0]) as string | undefined;
  const q = eg ? humanizePrompt(eg) : c.label.toLowerCase();
  return {
    title: eg ? `Publish a "${q}" guide` : `Add content for ${c.label.toLowerCase()} queries in ${category}`,
    why: `Shoppers ask "${eg ?? c.label}" and ${brand} isn't the answer.`,
    fix:
      `Create a page that directly answers "${eg ?? c.label}" — mirror how shoppers phrase it, ` +
      `show where ${brand} fits, and state the specifics assistants can quote.`,
  };
}

/** Turn a shopper question into a pasteable page-title phrase: drop the leading question stem
 *  and trailing punctuation ("What are the best luxury bags?" → "best luxury bags"). */
function humanizePrompt(p: string): string {
  return p
    .trim()
    .replace(/[?.!]+$/, "")
    .replace(/^(what are the|what'?s the|what is the|which|what|who makes the|where can i (find|buy) the?)\s+/i, "")
    .trim();
}

const IMPACT_ORDER: Record<FixCard["impact"], number> = { high: 0, medium: 1, low: 2 };
function sortByImpact(cards: FixCard[]): FixCard[] {
  return cards.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier === "evidence_backed" ? -1 : 1;
    return IMPACT_ORDER[a.impact] - IMPACT_ORDER[b.impact];
  });
}
