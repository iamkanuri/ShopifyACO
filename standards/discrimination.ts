// ===========================================================================
// THE DISCRIMINATION LIFECYCLE — the arithmetic behind grammar 1.1's
// `measured_discrimination` block, and the cross-field rules JSON Schema
// cannot express.
//
// WHY THIS FILE EXISTS. Until now a requirement became `not_discriminating`
// because its author PREDICTED a fail rate outside the 15-85% band. On the
// first valid measurement — 43 coffee brands, applicability enforced, brands
// deduplicated — those predictions held 2 of 10 and every one of the eight
// misses was HIGH. One entry, WEIGHT-001, was predicted 15-40%, measured 11.1%
// on nine products, flagged `not_discriminating`, and then measured 48.8% on
// forty-three. It was one reclassification away from being deleted from the
// standard on the strength of nine products.
//
// So the verdict becomes a measurement, and a measurement is only allowed to
// speak when the arithmetic says it can.
//
// Pure: no network, no filesystem, no clock, no dependencies.
// ===========================================================================

/** The two-sided normal quantile for 95%. Stated rather than imported so the
 *  derivation below can be reconstructed by hand. */
export const Z_95 = 1.959963985;

/** The grammar's target band. A requirement that fails for everyone and one
 *  that fails for no one carry the same information, which is none. */
export const TARGET_BAND = { lowerPct: 15, upperPct: 85 } as const;

export interface Band { lowerPct: number; upperPct: number }
export interface Interval { lowerPct: number; upperPct: number }

/**
 * Wilson score interval for a binomial proportion, in percent.
 *
 * WILSON RATHER THAN WALD, and the choice is not stylistic. Wald
 * (p̂ ± z·√(p̂(1−p̂)/n)) collapses to a ZERO-WIDTH interval at p̂=0 and p̂=1,
 * which is exactly where discrimination verdicts get recorded — an entry that
 * fails for all 43 stores would be certified as certainly-100% by Wald, and
 * every near-unanimous entry would retire itself. Wilson is also better
 * behaved than Clopper-Pearson here: Clopper-Pearson is guaranteed-conservative
 * and would push the floor derived below even higher, which is defensible but
 * buys conservatism this decision does not need, since the decision is already
 * asymmetric by construction (see `verdictFor`).
 *
 * Defined by (p̂ − p)² = z²·p(1−p)/n; the two roots are the bounds. The test
 * suite checks the returned bounds against THAT equation rather than against
 * this closed form, so an algebra error here cannot certify itself.
 */
export function wilson95(failCount: number, n: number, z: number = Z_95): Interval {
  if (!Number.isInteger(failCount) || !Number.isInteger(n)) throw new Error("wilson95 takes integer counts");
  if (n <= 0) throw new Error("wilson95 requires n > 0");
  if (failCount < 0 || failCount > n) throw new Error(`failCount ${failCount} outside 0..${n}`);
  const p = failCount / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return {
    lowerPct: Math.max(0, centre - half) * 100,
    upperPct: Math.min(1, centre + half) * 100,
  };
}

/**
 * THE MINIMUM ADJUDICATED n, DERIVED RATHER THAN CHOSEN.
 *
 * A verdict is a statement that the true fail rate is inside, or outside, the
 * target band. Under the decision rule in `verdictFor` that statement requires
 * the whole 95% interval to sit on one side of a band edge. Ask the cheapest
 * possible question: what is the smallest n at which ANY result at all — even
 * 0 of n or n of n, the two most extreme observations obtainable — could do
 * that?
 *
 * For failCount = 0 the Wilson upper bound reduces to z²/(n + z²). Requiring
 * it below the lower band edge b gives
 *
 *     z²/(n + z²) < b   ⟺   n > z²·(1 − b)/b
 *
 * and with z = 1.96, b = 0.15 that is 21.77, so **22**. By symmetry n of n
 * against the upper edge gives the same number. Below 22 adjudicated rows a
 * discrimination verdict is not merely weak, it is arithmetically incapable of
 * supporting the conclusion it states, whatever was observed. Run 1 recorded
 * its verdicts on n=9.
 *
 * The floor MOVES WITH THE BAND, which is why it is computed and not typed in:
 * 35 at a 10% edge, 22 at 15%, 16 at 20%, 12 at 25%. A session that widens the
 * band and leaves the floor alone has quietly weakened the rule.
 */
export function minimumAdjudicatedN(band: Band = TARGET_BAND, z: number = Z_95): number {
  const b = Math.min(band.lowerPct, 100 - band.upperPct) / 100;
  if (b <= 0 || b >= 0.5) throw new Error(`band edge ${b} is not a usable discrimination band`);
  // ⌊x⌋+1, NOT ⌈x⌉. The derived condition `n > z²(1−b)/b` is STRICT, and when the
  // expression lands exactly on an integer `ceil` returns an n at which the bound
  // sits ON the edge rather than outside it — a floor at which no verdict is
  // reachable. Unreachable at z=1.96 and reachable through `familyWiseFloor`'s
  // computed z, which is how an independent pass found it.
  return Math.floor((z * z * (1 - b)) / b) + 1;
}

/** The floor for the grammar's own 15-85% band. 22. */
export const MIN_ADJUDICATED_N = minimumAdjudicatedN();

export type Verdict = "discriminating" | "not_discriminating" | "indeterminate";

export interface VerdictResult {
  /** `null` means NO VERDICT MAY BE RECORDED — the sample is below the floor. */
  verdict: Verdict | null;
  interval: Interval | null;
  failRatePct: number | null;
  reason: string;
}

/**
 * THE DECISION RULE. Three outcomes, not two, for the same reason
 * `src/measure/completion.ts` has three: a measurement that could not decide
 * must never read as one that decided.
 *
 *   not_discriminating  THE WHOLE 95% INTERVAL lies outside the band. Hard.
 *   discriminating      THE POINT ESTIMATE lies inside the band. Easy.
 *   indeterminate       neither; the entry keeps running and nothing is decided.
 *
 * THE TWO DIRECTIONS DELIBERATELY COST DIFFERENT AMOUNTS, because the two
 * errors are not symmetric and one of them is self-sealing:
 *
 *   wrongly KEEP    one low-information row in a report. SELF-CORRECTING — the
 *                   row keeps accruing n and a later run retires it properly.
 *   wrongly RETIRE  the row stops being run, which destroys the only mechanism
 *                   that could produce the evidence to reverse the decision.
 *                   You cannot re-measure a row you are not running. It is also
 *                   a governance event: it removes an assertion a merchant may
 *                   have failed.
 *
 * Hence: hard to leave, easy to return. Retirement must clear a two-sided 95%
 * interval; keeping, and re-instating, needs only the point estimate.
 *
 * (An earlier draft described the retirement side as "effectively a one-sided
 * α=0.025 test". That is a convenient story and it is not what the rule
 * delivers — the exact size of a Wilson-bound test at a boundary p is not the
 * nominal half-α, and the claim was struck rather than repaired. The asymmetry
 * here is structural, not a chosen confidence level: the two directions test
 * different quantities.)
 *
 * The measured consequence on run 2's own numbers: four entries are
 * `discriminating` (FORMAT-001, GRIND-001, WEIGHT-001, DELIV-001 — exactly the
 * four the human record kept), five are `indeterminate`, and exactly one,
 * CERT-002 at 42 of 43, is retirement-eligible on the arithmetic alone. A
 * point-estimate rule would have retired SEVEN. GRIND-002, which
 * STANDARD_RUN_2 calls "a marginal call that a third run could move back", is
 * refused with 10.5pp to spare: at n=41 the rate would have to be 40 of 41 to
 * permit, so "marginal" understates it.
 */
export function verdictFor(failCount: number, nAdjudicated: number, band: Band = TARGET_BAND, z: number = Z_95): VerdictResult {
  const floor = minimumAdjudicatedN(band, z);
  if (nAdjudicated < floor) {
    return {
      verdict: null,
      interval: null,
      failRatePct: null,
      reason:
        `n=${nAdjudicated} is below the derived floor of ${floor} for a ${band.lowerPct}-${band.upperPct}% band. ` +
        `At this n no observation — not even 0 of n or n of n — can place a 95% interval outside the band, ` +
        `so no verdict may be recorded at all.`,
    };
  }
  const interval = wilson95(failCount, nAdjudicated, z);
  const failRatePct = (failCount / nAdjudicated) * 100;
  if (interval.upperPct < band.lowerPct || interval.lowerPct > band.upperPct) {
    return { verdict: "not_discriminating", interval, failRatePct, reason: "the whole 95% interval lies outside the target band" };
  }
  if (failRatePct >= band.lowerPct && failRatePct <= band.upperPct) {
    return { verdict: "discriminating", interval, failRatePct, reason: "the measured rate lies inside the target band, which is all that keeping an entry requires" };
  }
  return {
    verdict: "indeterminate",
    interval,
    failRatePct,
    reason:
      `the rate is outside the band but the 95% interval [${interval.lowerPct.toFixed(1)}, ${interval.upperPct.toFixed(1)}] ` +
      `is not — this measurement ran and decides nothing; the entry stays executable`,
  };
}

/**
 * How far the interval clears the band edge it cleared, in percentage points.
 * `null` when it clears neither. This is the margin R3 below is measured against.
 */
export function marginToBandPp(failCount: number, nAdjudicated: number, band: Band = TARGET_BAND, z: number = Z_95): number | null {
  const iv = wilson95(failCount, nAdjudicated, z);
  if (iv.upperPct < band.lowerPct) return band.lowerPct - iv.upperPct;
  if (iv.lowerPct > band.upperPct) return iv.lowerPct - band.upperPct;
  return null;
}

/**
 * MULTIPLICITY, RECORDED RATHER THAN SILENTLY IGNORED. The floor above controls
 * error PER ENTRY at 5%. A standard that publishes a COUNT — "six of ten entries
 * do not discriminate" — is making a family-wise claim, and ten independent 95%
 * decisions are jointly right only about 60% of the time. The Bonferroni floor
 * is the n that claim would need: 45 for a 10-entry standard, 62 for 50.
 *
 * This grammar adopts per-entry control, because the decision it governs is
 * per-entry retirement. The joint number is exposed so a document that wants to
 * state a count can say what it would have cost.
 */
export function familyWiseFloor(entryCount: number, band: Band = TARGET_BAND): number {
  if (!Number.isInteger(entryCount) || entryCount < 1) throw new Error("entryCount must be a positive integer");
  const alpha = 0.05 / entryCount;
  return minimumAdjudicatedN(band, inverseNormalCdf(1 - alpha / 2));
}

/** Acklam's rational approximation to the standard-normal quantile. Accurate to
 *  ~1e-9 over the range used here; sufficient, since the result is ceilinged to
 *  an integer sample size. */
function inverseNormalCdf(p: number): number {
  if (p <= 0 || p >= 1) throw new Error("p must be in (0,1)");
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425, pHigh = 1 - pLow;
  let q: number, r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > pHigh) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  q = p - 0.5; r = q * q;
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q /
         (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

// ---------------------------------------------------------------------------
// CROSS-FIELD RULES. JSON Schema can require a field and bound a number; it
// cannot check that a recorded interval is the interval the recorded counts
// produce, or that a sample belongs to the standard it is backing. Those live
// here and are executed by standards/__tests__/discrimination.test.ts, each
// with a negative fixture that must fail — a governance check nobody has
// watched fail is a check nobody has tested.
// ---------------------------------------------------------------------------

export interface RuleError { rule: string; path: string; message: string }

/**
 * Every rule the functions below can emit. The test suite asserts that each one
 * has a negative fixture that actually produces it — a governance check nobody
 * has watched fail is a governance check nobody has tested, and a cross-field
 * rule with no fixture is indistinguishable from a rule that was never wired up.
 */
export const ALL_RULES = [
  // measured_discrimination
  "counts_present",
  "counts_coherent",
  "asked_ge_adjudicated",
  "one_row_per_store",
  "minimum_n",
  "rate_matches_counts",
  "interval_present",
  "interval_recomputes",
  "verdict_follows_interval",
  "supersedes_is_older",
  "larger_sample_is_larger",
  "disjoint_intervals_need_a_named_defect",
  "retirement_needs_bias_declaration",
  "bias_exceeds_margin",
  // category_fitness
  "fitness_sample_is_this_category",
  "defects_within_rows",
  "bounds_ordered",
  "cluster_bound_is_wider",
  "point_estimate_matches_counts",
  "defects_enumerated",
  // never-weaken interaction
  "retirement_is_a_demotion",
] as const;

type Json = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Which band edge an interval cleared, expressed as the bias direction that
 *  would have helped it clear. A rate pushed too HIGH by the instrument is what
 *  would falsely clear the upper edge. */
function interpretEdge(x: number, n: number, band: Band): string | null {
  const iv = wilson95(x, n);
  if (iv.lowerPct > band.upperPct) return "inflates_fail_rate";
  if (iv.upperPct < band.lowerPct) return "deflates_fail_rate";
  return null;
}

/**
 * Tolerance on a published interval bound, in percentage points.
 *
 * ⚠️ MUST STAY BELOW THE SMALLEST DECISION MARGIN THE RULE CAN PRODUCE. At the
 * floor, 0 of 22 gives a Wilson upper bound of 14.8655% — a margin of 0.1345pp
 * to the 15% edge. A tolerance of 0.15 was therefore WIDER than the narrowest
 * margin the rule decides on, which is the shape of a checker that cannot see the
 * case it exists for. 0.05 admits a bound rounded to two decimals and nothing
 * looser, and it is a fifth of the smallest real margin.
 *
 * The verdict itself is never read from the published interval — it is recomputed
 * from `fail_count`/`n_adjudicated`, so no tolerance can flip one. A test asserts
 * exactly that.
 */
export const INTERVAL_TOLERANCE_PP = 0.05;

/** Rules over one entry's `measured_discrimination` block. */
export function checkMeasuredDiscrimination(entry: Json, path: string): RuleError[] {
  const m = entry.measured_discrimination as Json | undefined;
  if (!m) return [];
  const errs: RuleError[] = [];
  const at = `${path}/measured_discrimination`;
  const n = num(m.n_adjudicated), x = num(m.fail_count), rate = num(m.fail_rate_pct);
  const band = (m.target_band as Json | undefined)
    ? { lowerPct: num((m.target_band as Json).lower_pct) ?? NaN, upperPct: num((m.target_band as Json).upper_pct) ?? NaN }
    : TARGET_BAND;

  if (n === null || x === null) return [{ rule: "counts_present", path: at, message: "n_adjudicated and fail_count must both be numbers" }];
  if (x > n) errs.push({ rule: "counts_coherent", path: at, message: `fail_count ${x} exceeds n_adjudicated ${n}` });
  const asked = num(m.n_asked);
  if (asked !== null && asked < n) {
    errs.push({ rule: "asked_ge_adjudicated", path: at, message: `n_asked ${asked} is below n_adjudicated ${n} — a row cannot be adjudicated without being asked` });
  }

  // THE CLUSTERING UNIT. The floor counts ROWS and the interval assumes they are
  // independent. That holds only at one row per store: 22 rows taken as two
  // products from each of eleven stores has an effective n of 18.3 at ICC 0.2,
  // and no field in the record would show it. The same design effect the
  // false-positive bound is required to apply is silently absent here unless the
  // unit is pinned, so it is pinned.
  const stores = num((m.sample as Json | undefined)?.stores);
  if (stores !== null && n > stores) {
    errs.push({
      rule: "one_row_per_store",
      path: at,
      message: `${n} adjudicated rows over ${stores} stores means more than one row per store. The interval assumes independent rows and the floor counts rows, so a clustered sample overstates its own n — the design effect the false-positive bound must apply is invisible here.`,
    });
  }

  if (x <= n) {
    const computed = verdictFor(x, n, band);
    if (computed.verdict === null) {
      errs.push({ rule: "minimum_n", path: at, message: computed.reason });
    } else {
      if (rate !== null && Math.abs(rate - computed.failRatePct!) > 0.05) {
        errs.push({ rule: "rate_matches_counts", path: at, message: `fail_rate_pct ${rate} is not ${computed.failRatePct!.toFixed(4)} = ${x}/${n}. The rate must be over ADJUDICATED rows: counting rows the engine could not decide as failures silently changes the answer.` });
      }
      const iv = m.interval_95 as Json | undefined;
      const lo = num(iv?.lower_pct), hi = num(iv?.upper_pct);
      if (lo === null || hi === null) {
        errs.push({ rule: "interval_present", path: at, message: "interval_95 must carry numeric lower_pct and upper_pct" });
      } else {
        if (Math.abs(lo - computed.interval!.lowerPct) > INTERVAL_TOLERANCE_PP || Math.abs(hi - computed.interval!.upperPct) > INTERVAL_TOLERANCE_PP) {
          errs.push({ rule: "interval_recomputes", path: at, message: `published interval [${lo}, ${hi}] is not the Wilson interval for ${x}/${n}, which is [${computed.interval!.lowerPct.toFixed(4)}, ${computed.interval!.upperPct.toFixed(4)}]` });
        }
      }
      if (m.verdict !== computed.verdict) {
        errs.push({ rule: "verdict_follows_interval", path: at, message: `recorded verdict \`${String(m.verdict)}\` but ${x}/${n} gives \`${computed.verdict}\` — ${computed.reason}` });
      }
    }
  }

  // ---- R3, THE INSTRUMENT GATE ------------------------------------------
  // A confidence interval bounds SAMPLING error and nothing else. It does not
  // cover a known one-directional bias in the instrument, and run 2 has two of
  // them: the semantic tier was off (which can only overstate a claim row's
  // fail rate) and the audit measured a 4.35% false-pass rate (which understates
  // it). The single entry the arithmetic permits retiring — CERT-002 — is a
  // CLAIM row whose interval clears the band edge by 2.94pp, and ONE row
  // reclassified from fail to pass takes it to 41/43 and refuses. A retirement
  // decided by a margin smaller than a disclosed bias is decided by the bias.
  if (m.verdict === "not_discriminating" && x <= n && n >= minimumAdjudicatedN(band)) {
    const biases = Array.isArray(m.instrument_bias) ? (m.instrument_bias as Json[]) : null;
    if (biases === null) {
      errs.push({
        rule: "retirement_needs_bias_declaration",
        path: at,
        message: "a retirement must declare the instrument's known one-directional biases, even if the declaration is an empty list — an undeclared bias is not an absent one",
      });
    } else {
      const margin = marginToBandPp(x, n, band);
      const towardEdge = interpretEdge(x, n, band);
      for (const [i, b] of biases.entries()) {
        if (b.direction !== towardEdge) continue; // pushes away from the edge that was cleared
        const mag = num(b.magnitude_pp);
        if (mag === null) {
          errs.push({ rule: "bias_exceeds_margin", path: `${at}/instrument_bias/${i}`, message: `an UNQUANTIFIED bias in the direction of the cleared edge blocks retirement outright — an unmeasured bias cannot be shown to be smaller than the ${margin?.toFixed(2)}pp margin` });
        } else if (margin !== null && mag >= margin) {
          errs.push({ rule: "bias_exceeds_margin", path: `${at}/instrument_bias/${i}`, message: `declared bias of ${mag}pp toward the cleared edge is at least the interval's ${margin.toFixed(2)}pp margin, so this retirement is decided by the instrument rather than by the stores` });
        }
      }
    }
  }

  // Re-measurement. A superseded record is kept, and the reason it was
  // superseded has to survive contact with the arithmetic.
  const prior = Array.isArray(m.supersedes) ? (m.supersedes as Json[]) : [];
  for (const [i, p] of prior.entries()) {
    const pAt = `${at}/supersedes/${i}`;
    const pDate = String(p.measured_on ?? ""), cDate = String(m.measured_on ?? "");
    if (pDate && cDate && pDate > cDate) {
      errs.push({ rule: "supersedes_is_older", path: pAt, message: `superseded measurement is dated ${pDate}, after the record that replaces it (${cDate})` });
    }
    const pn = num(p.n_adjudicated);
    if (p.superseded_because === "larger_sample") {
      if (pn !== null && pn >= n) {
        errs.push({ rule: "larger_sample_is_larger", path: pAt, message: `\`larger_sample\` but the new sample (${n}) is not larger than the old (${pn})` });
      }
      const piv = p.interval_95 as Json | undefined;
      const plo = num(piv?.lower_pct), phi = num(piv?.upper_pct);
      const cur = wilson95(x, n);
      if (plo !== null && phi !== null && (phi < cur.lowerPct || plo > cur.upperPct)) {
        errs.push({
          rule: "disjoint_intervals_need_a_named_defect",
          path: pAt,
          message:
            `the two 95% intervals do not overlap ([${plo}, ${phi}] then [${cur.lowerPct.toFixed(1)}, ${cur.upperPct.toFixed(1)}]), ` +
            `and \`larger_sample\` does not explain that. Two disjoint 95% intervals cannot both cover the true rate, so at ` +
            `most one of these samples measured the quantity the entry claims. Size changes an interval's WIDTH; it does not ` +
            `move it off the old one. Name the systematic difference — a selection defect, an applicability gate, a ` +
            `deduplication, an engine change — or record the verdict as \`indeterminate\`.`,
        });
      }
    }
  }
  return errs;
}

/** Rules over the standard-level `category_fitness` block. */
export function checkCategoryFitness(std: Json): RuleError[] {
  const f = std.category_fitness as Json | undefined;
  if (!f) return [];
  const errs: RuleError[] = [];
  const at = "category_fitness";
  const sample = f.sample as Json | undefined;

  // THE CP3 RULE. A bound measured on anything but this category's own copy is
  // not this category's bound. Same engine, same audit discipline, and the two
  // numbers still disagree: 7.80% on the general DTC sample (509 audited pass
  // rows, 18 confirmed) against 12.78% on coffee (162 rows, 10 confirmed),
  // both cluster-adjusted at ICC 0.2 — `standards/coffee/v1.0/fitness.json`.
  //
  // ⚠️ This comment used to read `0.83% on 172 general stores, 13.68% on 42
  // coffee stores`, and BOTH halves have since been corrected — the general
  // figure by an order of magnitude, because the audit behind it could not see
  // a defect class that renders no quote. The general number is a FLOOR, not a
  // bound: only one class has been re-checked mechanically, so the two samples
  // are not audited to the same depth and their ratio is not itself a
  // measurement. The direction is the finding; the magnitude is not.
  if (sample?.category_scope === "this_category") {
    const owner = sample.category_standard_id;
    if (owner !== std.standard_id) {
      errs.push({
        rule: "fitness_sample_is_this_category",
        path: `${at}/sample/category_standard_id`,
        message: `the fitness sample is labelled \`${String(owner)}\` but this standard is \`${String(std.standard_id)}\`. A standard may not publish an error bound measured on another category's sample.`,
      });
    }
  }

  const rows = num(f.pass_rows_audited), fp = num(f.confirmed_false_positives);
  if (rows !== null && fp !== null && fp > rows) {
    errs.push({ rule: "defects_within_rows", path: at, message: `${fp} false positives over ${rows} audited pass rows` });
  }
  const b = f.bounds as Json | undefined;
  if (b) {
    const pt = num(b.point_estimate_pct), naive = num(b.naive_95_upper_pct), clus = num(b.cluster_adjusted_95_upper_pct);
    if (pt !== null && naive !== null && naive < pt) {
      errs.push({ rule: "bounds_ordered", path: `${at}/bounds`, message: `naive 95% upper ${naive}% is below the point estimate ${pt}%` });
    }
    if (naive !== null && clus !== null && clus < naive) {
      errs.push({
        rule: "cluster_bound_is_wider",
        path: `${at}/bounds`,
        message: `cluster-adjusted upper ${clus}% is below the naive upper ${naive}%. Clustering within stores can only widen an interval; a narrower adjusted bound means the adjustment was applied backwards, and it flatters the number.`,
      });
    }
    if (rows !== null && fp !== null && pt !== null) {
      const expected = (fp / rows) * 100;
      if (Math.abs(pt - expected) > 0.05) {
        errs.push({ rule: "point_estimate_matches_counts", path: `${at}/bounds`, message: `point estimate ${pt}% is not ${expected.toFixed(4)}% = ${fp}/${rows}` });
      }
    }
  }
  // The defects behind the bound must add up to the count claimed.
  const defects = Array.isArray(f.defects) ? (f.defects as Json[]) : null;
  if (defects && fp !== null && defects.length !== fp) {
    errs.push({ rule: "defects_enumerated", path: `${at}/defects`, message: `${fp} confirmed false positives claimed but ${defects.length} enumerated — a bound whose defects are not all named cannot be checked or fixed` });
  }
  return errs;
}

/**
 * THE NEVER-WEAKEN INTERACTION, CP1's open question, decided.
 *
 * Retiring an entry on a measured verdict REMOVES AN ASSERTION A MERCHANT MAY
 * HAVE FAILED. Mechanically that is identical to the changelog's existing
 * `demoted`: the row stops being tested at all. So it requires the same
 * attestation, and the reason is not bureaucratic — a merchant who failed
 * WEIGHT-001 and then watches it disappear cannot distinguish "removed because
 * a measurement showed it carried no information" from "removed because someone
 * complained". The measurement does not exempt the removal; it JUSTIFIES it,
 * and the justification goes in the change's `rationale`.
 *
 * The useful side effect: the attestation is cheapest before publication, when
 * `prior_failures_exist` is false and remediation is `not_applicable_no_failures`.
 * That prices measuring early, which is what CP3 asks for anyway.
 *
 * The reverse direction — a re-measurement that moves an entry from
 * `not_discriminating` back to `discriminating`, so it starts being tested
 * again — is `strengthened` and needs nothing.
 */
export function checkRetirementAttested(std: Json): RuleError[] {
  const errs: RuleError[] = [];
  const entries = Array.isArray(std.entries) ? (std.entries as Json[]) : [];
  const releases = Array.isArray(std.changelog) ? (std.changelog as Json[]) : [];
  const attestedDemotions = new Set<string>();
  for (const rel of releases) {
    for (const c of (Array.isArray(rel.changes) ? (rel.changes as Json[]) : [])) {
      if ((c.change_type === "demoted" || c.change_type === "weakened") && c.weakening_attestation) {
        attestedDemotions.add(String(c.entry_id));
      }
    }
  }
  for (const [i, e] of entries.entries()) {
    if (e.tier !== "not_discriminating") continue;
    const m = e.measured_discrimination as Json | undefined;
    // No measurement means a grammar-1.0 legacy assignment on a prediction. The
    // schema forbids that at 1.1; there is nothing for this rule to check.
    if (!m) continue;
    // ⚠️ THIS USED TO REQUIRE A SUPERSEDED `discriminating` VERDICT, AND THAT WAS
    // AN ESCAPE HATCH. A first-and-only measurement returning `not_discriminating`
    // has no `supersedes`, so it needed no attestation — making the cheapest way
    // to delete a row from a standard "measure it exactly once". An independent
    // pass found this by looking for the incentive rather than the bug.
    //
    // The correct trigger is the existence of a MEASUREMENT at all. A measurement
    // means the entry RAN, which means it was executable, which means a merchant
    // could have failed it. An entry that never ran has no record here and is
    // never reached. And the honest case costs nothing: an entry retired before
    // anyone ever failed it attests `prior_failures_exist: false` with
    // `not_applicable_no_failures`, which is exactly the cheap path the rule
    // wants authors to take.
    if (!attestedDemotions.has(String(e.id))) {
      errs.push({
        rule: "retirement_is_a_demotion",
        path: `entries/${i}`,
        message:
          `${String(e.id)} carries a measurement, so it was run, and it is now \`not_discriminating\`, so it stops being ` +
          `run. That is a \`demoted\` change and requires a weakening_attestation in the changelog: it removes an ` +
          `assertion a merchant may have failed, and a measurement justifies the removal without exempting it. ` +
          `If nobody ever failed it, attest \`prior_failures_exist: false\` — that is the cheap and correct path.`,
      });
    }
  }
  return errs;
}
