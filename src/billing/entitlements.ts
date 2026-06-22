// ===========================================================================
// Entitlements — the central, CONFIG-DRIVEN map of plan → features + limits.
//
// This is the single source of truth for "what is a customer on plan X allowed to
// do". It is PURE (no DB, no Stripe, no env) and deterministic so it unit-tests
// cleanly and can be reasoned about at a glance.
//
// Design rules (mirrors the rest of the codebase):
//   • NO prices here. Prices are display copy (src/pricing.ts) + whatever Stripe
//     actually charges. This module governs CAPABILITY, never money.
//   • Plan ids match src/pricing.ts (free | full_report | monitoring | founder_beta)
//     so a Stripe purchase of a plan maps straight to its entitlement.
//   • The free tier is generous enough that the measure→diagnose loop still works for
//     a prospect (mock runs, evidence) — only genuinely paid/costly capabilities
//     (live engine spend, recurring monitoring, store write-back) are gated.
//   • -1 means "unlimited" for any numeric limit.
// ===========================================================================

/** A gated capability. A feature being false hides/blocks that capability for the plan. */
export type Feature =
  | "evidence" // crawl + diagnose (mock is $0, so free-tier ok)
  | "live_benchmarks" // run benchmarks against REAL engines (costs money) — paid
  | "fixes" // Fix Studio apply (write-back to the store) — paid
  | "experiments" // baseline/verify matched runs — paid
  | "monitoring" // recurring schedules — paid
  | "feeds" // product-feed generation (gated additionally by a count limit)
  | "attribution"; // AI-referral pixel attribution read

export const FEATURES: Feature[] = [
  "evidence", "live_benchmarks", "fixes", "experiments", "monitoring", "feeds", "attribution",
];

export interface PlanLimits {
  /** Benchmark RUNS allowed per rolling 30 days (mock + live combined). */
  benchmarksPerMonth: number;
  /** Active recurring monitoring schedules. */
  monitoringSchedules: number;
  /** Distinct product feeds. */
  feeds: number;
}

export interface PlanEntitlement {
  plan: string;
  label: string;
  /** Ordering for upgrade/downgrade comparisons (higher = more access). */
  tier: number;
  /** Subscription (recurring) vs one-time/perpetual grant. */
  recurring: boolean;
  features: Record<Feature, boolean>;
  limits: PlanLimits;
}

function feats(on: Feature[]): Record<Feature, boolean> {
  const out = {} as Record<Feature, boolean>;
  for (const f of FEATURES) out[f] = on.includes(f);
  return out;
}

// The plan catalogue. Adding/retuning a plan is a data edit here — nothing else changes.
const PLAN_ENTITLEMENTS: Record<string, PlanEntitlement> = {
  free: {
    plan: "free", label: "Free", tier: 0, recurring: false,
    features: feats(["evidence", "attribution"]),
    limits: { benchmarksPerMonth: 3, monitoringSchedules: 0, feeds: 1 },
  },
  full_report: {
    plan: "full_report", label: "Full report", tier: 1, recurring: false,
    features: feats(["evidence", "live_benchmarks", "fixes", "experiments", "feeds", "attribution"]),
    limits: { benchmarksPerMonth: 25, monitoringSchedules: 0, feeds: 3 },
  },
  monitoring: {
    plan: "monitoring", label: "Weekly monitoring", tier: 2, recurring: true,
    features: feats(["evidence", "live_benchmarks", "fixes", "experiments", "monitoring", "feeds", "attribution"]),
    limits: { benchmarksPerMonth: 60, monitoringSchedules: 5, feeds: 10 },
  },
  founder_beta: {
    plan: "founder_beta", label: "Founder beta", tier: 3, recurring: false,
    features: feats(["evidence", "live_benchmarks", "fixes", "experiments", "monitoring", "feeds", "attribution"]),
    limits: { benchmarksPerMonth: 100, monitoringSchedules: 10, feeds: 25 },
  },
};

/** The default (no active grant) entitlement. */
export const FREE_ENTITLEMENT = PLAN_ENTITLEMENTS.free!;

/** The public pricing free plan id (src/pricing.ts) is `free_mini`; it maps to `free`. */
const PLAN_ALIASES: Record<string, string> = { free_mini: "free" };

/** Resolve a plan id to its entitlement; unknown plans fall back to free (fail-safe). */
export function planEntitlement(plan: string | null | undefined): PlanEntitlement {
  if (!plan) return FREE_ENTITLEMENT;
  const id = PLAN_ALIASES[plan] ?? plan;
  return PLAN_ENTITLEMENTS[id] || FREE_ENTITLEMENT;
}

/** True when two plan ids refer to the same plan (accounting for the free/free_mini alias). */
export function samePlan(a: string, b: string): boolean {
  return (PLAN_ALIASES[a] ?? a) === (PLAN_ALIASES[b] ?? b);
}

/** All known plan entitlements (for surfacing the comparison in the UI). */
export function allPlanEntitlements(): PlanEntitlement[] {
  return Object.values(PLAN_ENTITLEMENTS).sort((a, b) => a.tier - b.tier);
}

/** Statuses that still grant access. `canceled` keeps access until current_period_end. */
export type EntitlementStatus = "active" | "past_due" | "canceled" | "expired" | "refunded" | "pending";

/** An active entitlement grant as resolved from the DB (or the synthetic free grant). */
export interface ActiveEntitlement {
  plan: string;
  status: EntitlementStatus;
  source: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** The resolved capability set for the plan. */
  entitlement: PlanEntitlement;
  /** Whether this grant currently confers paid access (vs lapsed → free). */
  active: boolean;
}

/**
 * Decide whether a stored grant is currently active. `active`/`past_due` always grant;
 * `canceled` grants until current_period_end (Stripe keeps access through the paid
 * period); `expired`/`refunded` never grant. A null/absent grant → free tier.
 *
 * `now` is injectable for deterministic tests.
 */
export function isGrantActive(
  status: EntitlementStatus,
  currentPeriodEnd: string | null,
  now: Date = new Date(),
): boolean {
  if (status === "active" || status === "past_due") return true;
  if (status === "canceled") {
    // Access continues until the paid period ends (if known); no period end = lapsed.
    return currentPeriodEnd != null && new Date(currentPeriodEnd).getTime() > now.getTime();
  }
  return false; // expired | refunded | pending
}

/** Build the effective entitlement from a stored grant (or null → free tier). */
export function effectiveEntitlement(
  grant:
    | { plan: string; status: string; source?: string; current_period_end?: string | null; cancel_at_period_end?: boolean }
    | null
    | undefined,
  now: Date = new Date(),
): ActiveEntitlement {
  if (!grant) {
    return {
      plan: "free", status: "active", source: "default", currentPeriodEnd: null,
      cancelAtPeriodEnd: false, entitlement: FREE_ENTITLEMENT, active: true,
    };
  }
  const status = grant.status as EntitlementStatus;
  const active = isGrantActive(status, grant.current_period_end ?? null, now);
  return {
    plan: active ? grant.plan : "free",
    status,
    source: grant.source ?? "stripe",
    currentPeriodEnd: grant.current_period_end ?? null,
    cancelAtPeriodEnd: Boolean(grant.cancel_at_period_end),
    entitlement: active ? planEntitlement(grant.plan) : FREE_ENTITLEMENT,
    active,
  };
}

/**
 * Resolve the EFFECTIVE entitlement from a customer's grant rows. A customer can hold
 * several grants (e.g. a one-time full_report plus a monitoring subscription) — the
 * effective access is the highest-tier grant that is currently active. No active grant
 * → free tier.
 */
export function bestEntitlement(
  grants: Array<{ plan: string; status: string; source?: string; current_period_end?: string | null; cancel_at_period_end?: boolean }>,
  now: Date = new Date(),
): ActiveEntitlement {
  let best = effectiveEntitlement(null, now); // free
  for (const g of grants) {
    const eff = effectiveEntitlement(g, now);
    if (eff.active && eff.entitlement.tier > best.entitlement.tier) best = eff;
  }
  return best;
}

/** Does this effective entitlement unlock a feature? */
export function hasFeature(eff: ActiveEntitlement, feature: Feature): boolean {
  return eff.entitlement.features[feature] === true;
}

/**
 * Map a Stripe subscription status to our entitlement status (pure). Keeps the lifecycle
 * mapping in one auditable place. Unknown statuses are treated conservatively as expired.
 */
export function stripeSubStatusToEntitlement(stripeStatus: string | undefined): EntitlementStatus {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
      return "canceled";
    case "incomplete":
      return "pending";
    case "incomplete_expired":
      return "expired";
    default:
      return "expired";
  }
}

/** Limit check: `used` against the plan's limit. unlimited (-1) always allows. */
export function withinLimit(limit: number, used: number): boolean {
  return limit < 0 || used < limit;
}
