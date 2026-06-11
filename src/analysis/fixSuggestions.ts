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
//       NOT been audited; the week-2 crawler will verify. Always labeled as such.
//
// We never assert product facts. Factual cards carry a `verifyNote`.
// ---------------------------------------------------------------------------

const SITE_NOT_AUDITED = "Site not yet audited — the week-2 crawler will verify whether this already exists.";

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

  // 1. Head-to-head comparison vs the direct threat.
  if (threat) {
    const related = lostPrompts.filter((lp) => lp.winners.includes(threat.competitor));
    if (related.length) {
      cards.push({
        id: "cmp_threat",
        tier: "evidence_backed",
        impact: "high",
        title: `Add a "${brand} vs ${threat.competitor}" comparison page`,
        why:
          `${threat.competitor} out-recommended ${brand} in ${related.length} answer(s) in this scan ` +
          `(${threat.summary}). A direct comparison gives assistants a source to cite ${brand} from.`,
        relatedPrompts: uniq(related.map((r) => r.prompt)).slice(0, 6),
        relatedSnippets: related.map((r) => r.snippet).filter(Boolean).slice(0, 3) as string[],
        suggestedFix:
          `Publish an honest side-by-side: coating type, PFAS/PTFE/PFOA status, oven-safe temp, ` +
          `induction support, warranty, price. Lead with where ${brand} genuinely wins.`,
        verifyNote: "Only claim advantages that are actually true for your products.",
      });
    }
  }

  // 2. Transactional clusters where the brand is absent or weak.
  for (const c of clusters.filter((c) => c.transactional)) {
    const clusterLost = lostPrompts.filter((lp) => c.prompts.includes(lp.prompt));
    if (!c.absent && c.brandMention.rate > 0.34) continue; // already reasonably visible
    if (clusterLost.length === 0 && !c.absent) continue;

    const spec = clusterFix(c.cluster, category, brand, c);
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

  // 3. Expose the quotable specs competitors win on.
  if (proofPoints.length) {
    const top = proofPoints.slice(0, 6);
    cards.push({
      id: "expose_specs",
      tier: "evidence_backed",
      impact: "high",
      title: "Expose AI-quotable product specs on every PDP",
      why:
        `In answers where competitors beat ${brand}, assistants leaned on concrete, quotable proof: ` +
        `${top.map((p) => p.label.toLowerCase()).join(", ")}. ${brand} needs these stated in plain text AIs can lift.`,
      relatedPrompts: [],
      relatedSnippets: top.map((p) => p.exampleSnippet).filter(Boolean).slice(0, 3) as string[],
      suggestedFix:
        "On each product page, state in plain text: coating material, PFAS/PTFE/PFOA status, " +
        "max oven-safe temperature, induction compatibility, dishwasher guidance, and warranty length.",
      verifyNote: "Add each spec only if true for that product; verify and expose it clearly.",
    });
  }

  // 4. Third-party proof (competitors repeatedly cite named tests).
  const testing = proofPoints.find((p) => p.id === "third_party_testing" || p.id === "named_reviews");
  if (testing) {
    cards.push({
      id: "third_party_proof",
      tier: "evidence_backed",
      impact: "medium",
      title: "Feature named third-party test results",
      why:
        `Winning competitors (${testing.competitors.join(", ")}) were cited with named reviews / lab tests ` +
        `in ${testing.hits} answer(s). Assistants trust and repeat these.`,
      relatedPrompts: testing.examplePrompt ? [testing.examplePrompt] : [],
      relatedSnippets: testing.exampleSnippet ? [testing.exampleSnippet] : [],
      suggestedFix:
        "If you have legitimate third-party testing or editorial awards, surface them as quotable, " +
        "linkable text near the product (not only in images).",
      verifyNote: "Add this only if true — never fabricate test results or awards.",
    });
  }

  // ---- (b) GENERAL HYGIENE (site not audited) ------------------------------

  cards.push({
    id: "schema",
    tier: "general_hygiene",
    impact: "medium",
    title: "Add/verify structured product schema (Product, Offer, AggregateRating)",
    why:
      "Structured data helps AI crawlers extract price, availability, ratings, and specs reliably " +
      "instead of guessing from prose.",
    relatedPrompts: [],
    relatedSnippets: [],
    suggestedFix:
      "Ensure each PDP emits valid schema.org Product JSON-LD with name, brand, material, offers, " +
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
      `Draft an /llms.txt (or a clean "About ${brand}" page) listing product lines, materials, ` +
      "safety claims, price ranges, and differentiators in plain text.",
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

function clusterFix(
  cluster: string,
  category: string,
  brand: string,
  c: QueryClusterResult,
): ClusterFixSpec | null {
  switch (cluster) {
    case "induction":
      return {
        title: `Add a use-case page: "Best ${category} for induction"`,
        why: "Induction is a high-intent filter shoppers and assistants use to narrow choices.",
        fix: `Create a page confirming induction compatibility for ${brand} products, with the spec stated explicitly.`,
        verify: "State induction compatibility only for products that actually support it.",
      };
    case "budget":
      return {
        title: `Add a buying guide: "Best ${category} under $300 / $400"`,
        why: "Price-anchored queries route shoppers to brands that publish clear value framing.",
        fix: `Publish a guide mapping ${brand} sets to price tiers with what each includes.`,
      };
    case "wedding_gift":
      return {
        title: `Add a gift guide: "${category} as a wedding / registry gift"`,
        why: "Gift and registry queries are high-intent and rarely surface this brand in the scan.",
        fix: `Create giftable bundle/registry content positioning ${brand} for weddings and new homes.`,
      };
    case "first_apartment":
      return {
        title: `Add a starter guide: "${category} for a first apartment"`,
        why: "First-apartment / starter queries favor brands with clear beginner-friendly starter sets.",
        fix: `Publish a starter-kit page recommending the right entry ${brand} set and why.`,
      };
    case "alternatives": {
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
    case "teflon_replacement":
      return {
        title: `Add content: "Replacing Teflon — switch to ${brand}"`,
        why: "Safety-switch queries are exactly this brand's positioning but it under-indexes here.",
        fix: `Publish a "ditch Teflon" page explaining ${brand}'s coating and what it's free of.`,
        verify: "Verify and clearly state which substances the coating is actually free of.",
      };
    default:
      return null;
  }
}

const IMPACT_ORDER: Record<FixCard["impact"], number> = { high: 0, medium: 1, low: 2 };
function sortByImpact(cards: FixCard[]): FixCard[] {
  return cards.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier === "evidence_backed" ? -1 : 1;
    return IMPACT_ORDER[a.impact] - IMPACT_ORDER[b.impact];
  });
}
