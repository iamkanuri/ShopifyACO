// ===========================================================================
// MEASUREMENT COMPLETION STATE (v2.8 CP0) — make "did not run" impossible to
// read as "clean".
//
// THE FAILURE THIS EXISTS TO PREVENT, observed three times in four sessions,
// each time in the flattering direction:
//
//   1. v2.7 — an adversarial workflow returned `confirmed: 0, falsePassCount: 0`
//      and was read as "no defects". All three verifier agents had died on a
//      session limit; the two surviving attackers were holding 24 candidate
//      defects. The aggregate counted CONFIRMATIONS, and a confirmation that
//      never ran counts as zero.
//   2. v2.4 — a `git ls-files | xargs grep` hygiene sweep reported CLEAN over a
//      real leak, because xargs had silently dropped the batch.
//   3. v2.4 — `python -c` / `npx tsx -e` emit no output and exit 0 in this
//      environment, so a silent one-liner is indistinguishable from a clean run.
//
// The shape is identical every time: an instrument that reports absence of
// evidence, and absence of the instrument, with the same value. Zero is the
// most dangerous number a broken harness can return, because it is also the
// number a healthy harness returns when everything is fine.
//
// THE RULE. A measurement that did not complete is not a passing measurement.
// Every aggregate must resolve to exactly one of three states, and the third
// one is a BLOCKER, not a score:
//
//   VERIFIED_CLEAN  every expected unit completed, every candidate was
//                   adjudicated, zero confirmations.
//   DEFECTS_FOUND   every expected unit completed, n > 0 confirmations.
//   INCOMPLETE      any expected unit failed to return, or any candidate went
//                   unadjudicated, or nothing was scheduled at all.
//
// `confirmedCount` is deliberately `number | null`: on INCOMPLETE it is null,
// never 0, so an incomplete run cannot be summed into a defect total or
// rendered as a pass by a caller that only looks at the number.
//
// Pure + deterministic — no network, no clock, no I/O.
// ===========================================================================

export type CompletionState = "verified_clean" | "defects_found" | "incomplete";

/** One attacker, verifier, sweep shard or probe batch. */
export interface UnitReport {
  /** Stable identifier, so `missing` names what to re-run. */
  id: string;
  /** The unit's role. Only used for the expected-vs-completed breakdown. */
  role: "attacker" | "verifier" | "sweep";
  /**
   * Did this unit RUN TO COMPLETION and return a result?
   *
   * Not "did it find nothing" — a unit that completed and found nothing is
   * `completed: true`. This flag answers only whether the instrument ran.
   */
  completed: boolean;
  /** Why it did not complete. Required when `completed` is false. */
  failure?: string;
}

export interface AggregateInput {
  units: readonly UnitReport[];
  /**
   * Candidate defects the attackers surfaced. Every one must be adjudicated by
   * a verifier before the aggregate can be decisive — this is exactly what v2.7
   * skipped when its verifiers died holding 24 candidates.
   */
  candidates: number;
  /** Candidates a verifier actually reached a verdict on (confirm OR refute). */
  adjudicated: number;
  /** Candidates a completed verifier CONFIRMED as real defects. */
  confirmed: number;
}

export interface Aggregate {
  state: CompletionState;
  /**
   * The confirmed-defect count, or `null` when the run was INCOMPLETE.
   * Never 0 on an incomplete run — see the module header.
   */
  confirmedCount: number | null;
  expected: { attackers: number; verifiers: number; sweeps: number };
  completed: { attackers: number; verifiers: number; sweeps: number };
  /** `id: failure` for every unit that did not complete. */
  missing: string[];
  /** Candidates no verifier reached. > 0 forces INCOMPLETE. */
  unadjudicated: number;
  /** True only when this aggregate may be used to justify a ship decision. */
  decisive: boolean;
  /** Why the state is what it is — rendered verbatim into session reports. */
  summary: string;
}

const countBy = (units: readonly UnitReport[], role: UnitReport["role"], done: boolean | null): number =>
  units.filter((u) => u.role === role && (done === null || u.completed === done)).length;

/**
 * Resolve a set of unit reports into exactly one of the three states.
 *
 * INCOMPLETE wins over everything, including over confirmed defects: if the
 * verification step was partial, "n confirmed" is a floor of unknown depth and
 * must not be reported as the answer.
 */
export function aggregate(input: AggregateInput): Aggregate {
  const { units, candidates, adjudicated, confirmed } = input;

  const expected = {
    attackers: countBy(units, "attacker", null),
    verifiers: countBy(units, "verifier", null),
    sweeps: countBy(units, "sweep", null),
  };
  const completed = {
    attackers: countBy(units, "attacker", true),
    verifiers: countBy(units, "verifier", true),
    sweeps: countBy(units, "sweep", true),
  };
  const missing = units
    .filter((u) => !u.completed)
    .map((u) => `${u.id}: ${u.failure ?? "no failure reason recorded"}`);

  const unadjudicated = Math.max(0, candidates - adjudicated);
  const scheduled = units.length;

  const reasons: string[] = [];
  // Nothing scheduled is the purest form of the bug: an empty aggregate is
  // arithmetically indistinguishable from a clean one.
  if (scheduled === 0) reasons.push("no units were scheduled — an empty run is not a clean run");
  if (missing.length) reasons.push(`${missing.length} of ${scheduled} units did not complete`);
  // Attackers with no verifier behind them is the v2.7 shape exactly.
  if (expected.attackers > 0 && expected.verifiers === 0) {
    reasons.push("attackers ran with no verifier scheduled — candidates cannot be confirmed or refuted");
  }
  if (unadjudicated > 0) reasons.push(`${unadjudicated} of ${candidates} candidates were never adjudicated`);
  // A verifier cannot confirm more than it adjudicated; if it reports otherwise
  // the bookkeeping is broken and the number is not trustworthy either way.
  if (confirmed > adjudicated) reasons.push(`confirmed (${confirmed}) exceeds adjudicated (${adjudicated}) — inconsistent bookkeeping`);

  if (reasons.length) {
    return {
      state: "incomplete", confirmedCount: null, expected, completed, missing, unadjudicated,
      decisive: false,
      summary:
        `INCOMPLETE — ${reasons.join("; ")}. ` +
        `Ran ${completed.attackers}/${expected.attackers} attackers, ` +
        `${completed.verifiers}/${expected.verifiers} verifiers, ` +
        `${completed.sweeps}/${expected.sweeps} sweeps. ` +
        `This is NOT a pass and must not be counted as zero defects.`,
    };
  }

  const state: CompletionState = confirmed > 0 ? "defects_found" : "verified_clean";
  return {
    state, confirmedCount: confirmed, expected, completed, missing, unadjudicated,
    decisive: true,
    summary:
      state === "defects_found"
        ? `DEFECTS FOUND — ${confirmed} confirmed of ${candidates} candidates, all adjudicated by ` +
          `${completed.verifiers}/${expected.verifiers} verifiers.`
        : `VERIFIED CLEAN — ${completed.attackers}/${expected.attackers} attackers and ` +
          `${completed.verifiers}/${expected.verifiers} verifiers completed; ` +
          `all ${candidates} candidates adjudicated, 0 confirmed.`,
  };
}

// ---- sweeps -----------------------------------------------------------------

export interface SweepInput {
  /** What the sweep set out to inspect. Unknown-ahead-of-time ⇒ pass null. */
  expectedFiles: number | null;
  /** What it actually inspected. */
  sweptFiles: number;
  /** Per-file read/parse errors — a file that could not be read was not swept. */
  errors: readonly string[];
  /** Hits. */
  findings: number;
}

/**
 * The same discipline for a file sweep: "swept N files, found nothing" and
 * "the sweep did not complete" must never render the same way.
 *
 * `expectedFiles: null` is honest for a walker that discovers as it goes — but a
 * sweep that visited ZERO files is always INCOMPLETE, because that is precisely
 * what the xargs failure looked like.
 */
export function sweepAggregate(input: SweepInput): Aggregate {
  const { expectedFiles, sweptFiles, errors, findings } = input;
  const shortfall = expectedFiles !== null && sweptFiles < expectedFiles;
  const scope = `${sweptFiles}${expectedFiles === null ? "" : `/${expectedFiles}`} files`;
  const failure =
    sweptFiles === 0
      ? "swept 0 files — the walker matched nothing, which is what a broken sweep looks like"
      : shortfall
        ? `swept ${sweptFiles} of ${expectedFiles} expected files`
        : errors.length
          ? `${errors.length} file(s) could not be read: ${errors.slice(0, 3).join("; ")}`
          : undefined;
  const units: UnitReport[] = [
    { id: `sweep(${scope})`, role: "sweep", completed: failure === undefined, failure },
  ];
  // A sweep is its own verifier: reading the file IS the adjudication.
  const base = aggregate({ units, candidates: findings, adjudicated: findings, confirmed: findings });
  // The generic summary is phrased for attacker/verifier fleets and reads as
  // "0/0 attackers" for a sweep, which is exactly the kind of vacuous-looking
  // clean report this module exists to prevent. Re-phrase it in sweep terms.
  const summary =
    base.state === "incomplete"
      ? `INCOMPLETE — ${failure}. This is NOT a clean sweep; it is a sweep that did not run to completion.`
      : base.state === "defects_found"
        ? `DEFECTS FOUND — ${findings} hit(s) across ${scope}.`
        : `VERIFIED CLEAN — swept ${scope}, 0 hits, 0 unreadable.`;
  return { ...base, summary };
}

/** Throw unless the aggregate is decisive. Use at the top of any ship decision. */
export function requireDecisive(a: Aggregate, context: string): void {
  if (!a.decisive) throw new Error(`${context}: measurement is not decisive.\n${a.summary}`);
}

/** One-line render for logs and session reports. Never prints a bare 0. */
export function renderAggregate(a: Aggregate): string {
  return a.summary;
}
