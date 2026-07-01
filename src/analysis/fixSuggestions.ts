import type { Config } from "../types.js";
import type {
  CompetitorThreat,
  FixCard,
  LostPrompt,
  ProofPoint,
  QueryClusterResult,
} from "./types.js";
import { uniq } from "./util.js";

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
    const top = proofPoints.slice(0, 6);
    const labels = top.map((p) => p.label.toLowerCase());
    cards.push({
      id: "expose_specs",
      tier: "evidence_backed",
      impact: "high",
      title: "State the details AI assistants quote — the ones competitors win on",
      why:
        `In answers where competitors beat ${brand}, assistants leaned on concrete, quotable specifics: ` +
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
    cards.push({
      id: "third_party_proof",
      tier: "evidence_backed",
      impact: "medium",
      title: "Feature third-party proof and press",
      why:
        `Winning competitors (${testing.competitors.join(", ")}) were backed by ${testing.label.toLowerCase()} ` +
        `in ${testing.hits} answer(s). Assistants trust and repeat these.`,
      relatedPrompts: testing.examplePrompt ? [testing.examplePrompt] : [],
      relatedSnippets: testing.exampleSnippet ? [testing.exampleSnippet] : [],
      suggestedFix:
        "If you have legitimate third-party testing, editorial coverage, or awards, surface them as quotable, " +
        "linkable text near the product (not only in images).",
      verifyNote: "Add this only if true — never fabricate tests, reviews, or awards.",
    });
  }

  // ---- (b) GENERAL HYGIENE (site not audited) ------------------------------

  cards.push({
    id: "schema",
    tier: "general_hygiene",
    impact: "medium",
    title: "Add/verify structured product schema (Product, Offer, AggregateRating)",
    why:
      "Structured data helps AI crawlers extract price, availability, ratings, and attributes reliably " +
      "instead of guessing from prose.",
    relatedPrompts: [],
    relatedSnippets: [],
    suggestedFix:
      "Ensure each PDP emits valid schema.org Product JSON-LD with name, brand, key attributes, offers, " +
      "and aggregateRating where available.",
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

  const eg = (clusterLost.find((l) => l.prompt)?.prompt ?? c.prompts[0]) as string | undefined;
  return {
    title: `Add content for "${c.label}" queries in ${category}`,
    why: `Shoppers ask "${c.label}"-style questions${eg ? ` (e.g. "${eg}")` : ""} and ${brand} isn't the answer.`,
    fix:
      `Publish a page that directly answers this intent for ${brand} — mirror how shoppers phrase it ` +
      `and state the specifics assistants can quote.`,
  };
}

const IMPACT_ORDER: Record<FixCard["impact"], number> = { high: 0, medium: 1, low: 2 };
function sortByImpact(cards: FixCard[]): FixCard[] {
  return cards.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier === "evidence_backed" ? -1 : 1;
    return IMPACT_ORDER[a.impact] - IMPACT_ORDER[b.impact];
  });
}
