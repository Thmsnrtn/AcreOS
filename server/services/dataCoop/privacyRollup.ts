/**
 * privacyRollup.ts — the generalized privacy-preserving rollup substrate
 * (Tier 3F, elevation blueprint 2026-06-10).
 *
 * marketNetworkContributor.ts pioneered the privacy model for cross-org deal
 * data: k≥5 cohort floor, value bucketing, org-null aggregation. This module
 * extracts that pattern into a reusable, PURE (no DB, no IO) substrate so any
 * cross-org aggregate — county market rollups today, anything tomorrow —
 * inherits the same guarantees by construction:
 *
 *   1. k≥5 cohort floor, STRUCTURAL: computeCountyRollup() returns null when
 *      the cohort is below MIN_COHORT_SIZE, so a sub-k rollup row can never
 *      be materialized. The gate lives in the aggregation, not the read path.
 *   2. Value bucketing: every price sample is rounded to the nearest
 *      PRICE_PER_ACRE_BUCKET ($500/acre — same constant as the contributor)
 *      BEFORE any percentile is computed, so no exact deal is recoverable.
 *   3. Org-null OUTPUT: nothing this module emits carries an organization
 *      identifier. Samples arrive tagged with their OPERATOR only so the
 *      operator floor below can be counted; the tag never leaves.
 *   4. Per-metric honesty: each sub-metric is independently k-gated — a
 *      county can clear the parcel-density floor while its accepted-price
 *      cohort is still thin; that metric is null, never extrapolated.
 *   5. A 5-DISTINCT-OPERATOR floor (founder ruling 2026-09-29 #11,
 *      DEFECT-0159): a sample or parcel count is not a privacy floor — one
 *      operator's five deals were the whole cohort. Every distribution and
 *      category share needs samples from MIN_DISTINCT_OPERATORS consenting
 *      operators, or it is null. Consent is filtered by the caller
 *      (`consentingOrgIds()`, sophiePrivacyGuard.ts) before samples arrive.
 *
 * Everything here is deterministic and synchronous — the DB-facing gather/
 * materialize lives in countyRollupJob.ts; tests exercise this module
 * directly.
 */

/**
 * Minimum cohort before ANY cross-org aggregate is served. Mirrors
 * marketNetworkContributor.MIN_COHORT_SIZE — keep the two in lockstep.
 */
export const MIN_COHORT_SIZE = 5;

/**
 * Distinct consenting operators behind ANY figure shown across customers
 * (founder ruling 2026-09-29 #11). The one floor every cross-org surface
 * imports — market network, credit benchmarks, community reviews, support
 * learnings and the county rollups below.
 */
export const MIN_DISTINCT_OPERATORS = 5;

/** Does this set of contributing operators clear the floor? Null/absent tags never count. */
export function meetsOperatorFloor(operators: Iterable<unknown>): boolean {
  const distinct = new Set<string>();
  for (const o of operators) if (o !== null && o !== undefined && o !== "") distinct.add(String(o));
  return distinct.size >= MIN_DISTINCT_OPERATORS;
}

/** One raw sample and the operator (organization) it came from. */
export interface OperatorSample {
  value: number;
  operator: number;
}

/** Price-per-acre bucket width ($) — mirrors the contributor's $500 rounding. */
export const PRICE_PER_ACRE_BUCKET = 500;

/** Bucket a value to the nearest `step` to prevent exact-value fingerprinting. */
export function bucketValue(value: number, step: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return 0;
  return Math.round(value / step) * step;
}

/** Linear-interpolated percentile from an ASCENDING-sorted array. */
export function percentileValue(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  const frac = idx - lo;
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * frac;
}

/** A k-gated median/p25/p75 distribution over bucketed values. */
export interface PrivateDistribution {
  median: number;
  p25: number;
  p75: number;
  /** Sample count backing this distribution (always >= MIN_COHORT_SIZE). */
  n: number;
}

/**
 * Compute a {median, p25, p75} distribution from raw samples, bucketing each
 * sample to `bucketStep` first. Returns null — never a thin estimate — when
 * fewer than MIN_COHORT_SIZE valid samples exist, or when those samples come
 * from fewer than MIN_DISTINCT_OPERATORS operators.
 */
export function computePrivateDistribution(
  samples: OperatorSample[],
  bucketStep: number,
): PrivateDistribution | null {
  const valid = samples.filter((s) => Number.isFinite(s.value) && s.value > 0);
  if (!meetsOperatorFloor(valid.map((s) => s.operator))) return null;
  const bucketed = valid.map((s) => bucketValue(s.value, bucketStep)).sort((a, b) => a - b);
  if (bucketed.length < MIN_COHORT_SIZE) return null;
  return {
    median: percentileValue(bucketed, 50),
    p25: percentileValue(bucketed, 25),
    p75: percentileValue(bucketed, 75),
    n: bucketed.length,
  };
}

/**
 * A k-gated categorical distribution (e.g. LCS grades). Shares are
 * percentages (one decimal); raw per-category counts are NOT emitted so a
 * category with one member can't be singled out beyond its share.
 */
export interface PrivateCategoryDistribution {
  total: number; // >= MIN_COHORT_SIZE
  shares: Record<string, number>; // category -> % of total (0..100, 1dp)
}

export function computeCategoryDistribution(
  counts: Record<string, number>,
  /** The distinct operators behind these counts — the floor is theirs, not the members'. */
  operators: Iterable<unknown>,
): PrivateCategoryDistribution | null {
  const entries = Object.entries(counts).filter(
    ([, n]) => Number.isFinite(n) && n > 0,
  );
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (total < MIN_COHORT_SIZE || !meetsOperatorFloor(operators)) return null;
  const shares: Record<string, number> = {};
  for (const [cat, n] of entries) {
    shares[cat] = Math.round((n / total) * 1000) / 10;
  }
  return { total, shares };
}

// ── County rollup composition ────────────────────────────────────────────────

/**
 * Raw (pre-aggregation) samples for one county+period, from CONSENTING
 * operators only. Each carries its operator so the floor can be counted; no
 * operator id reaches the output.
 */
export interface CountyRollupInput {
  state: string; // 2-letter code (will be uppercased)
  county: string;
  period: string; // "YYYY-MM"
  /** Distinct contributing parcels (cross-org APNs observed) — the cohort k. */
  parcelsObserved: number;
  /** Observation rows logged during the period (density signal). */
  observationsInPeriod: number;
  /** Raw asked $/acre samples (offers sent) — bucketed before aggregation. */
  askedPricePerAcre: OperatorSample[];
  /** Raw accepted $/acre samples (deals accepted/closed). */
  acceptedPricePerAcre: OperatorSample[];
  /** Days from offer sent to seller response (where both timestamps exist). */
  daysToResponse: OperatorSample[];
  /** LCS grade -> count of scored parcels (latest score per parcel). */
  lcsGradeCounts: Record<string, number>;
  /** The distinct operators whose parcels make up lcsGradeCounts. */
  lcsOperators: number[];
}

/** The metrics jsonb persisted on county_market_rollups rows. */
export interface CountyRollupMetrics {
  /** $/acre asked (offers sent), bucketed to $500. Null when its cohort < k. */
  askedPricePerAcre: PrivateDistribution | null;
  /** $/acre accepted (deals), bucketed to $500. Null when its cohort < k. */
  acceptedPricePerAcre: PrivateDistribution | null;
  /** Days from offer sent to response, whole days. Null when its cohort < k. */
  daysToResponse: PrivateDistribution | null;
  /** Observation density — counts only, no values, no org linkage. */
  parcelObservationDensity: {
    parcelsObserved: number;
    observationsInPeriod: number;
  };
  /** LCS grade share distribution. Null when fewer than k scored parcels. */
  lcsGradeDistribution: PrivateCategoryDistribution | null;
}

export interface CountyRollupRow {
  state: string;
  county: string;
  period: string;
  cohortSize: number; // == parcelsObserved, always >= MIN_COHORT_SIZE
  metrics: CountyRollupMetrics;
}

/**
 * Compose one county rollup row from raw samples — or null when the county's
 * contributing-parcel cohort is below MIN_COHORT_SIZE. Callers materialize
 * ONLY non-null results; there is no code path that persists a sub-k row.
 */
export function computeCountyRollup(
  input: CountyRollupInput,
): CountyRollupRow | null {
  if (input.parcelsObserved < MIN_COHORT_SIZE) return null;

  const metrics: CountyRollupMetrics = {
    askedPricePerAcre: computePrivateDistribution(
      input.askedPricePerAcre,
      PRICE_PER_ACRE_BUCKET,
    ),
    acceptedPricePerAcre: computePrivateDistribution(
      input.acceptedPricePerAcre,
      PRICE_PER_ACRE_BUCKET,
    ),
    // Whole-day bucketing: response latency is coarse by nature, and 1-day
    // granularity prevents timestamp fingerprinting of a specific offer.
    daysToResponse: computePrivateDistribution(input.daysToResponse, 1),
    parcelObservationDensity: {
      parcelsObserved: input.parcelsObserved,
      observationsInPeriod: input.observationsInPeriod,
    },
    lcsGradeDistribution: computeCategoryDistribution(input.lcsGradeCounts, input.lcsOperators),
  };

  return {
    state: (input.state || "").trim().toUpperCase(),
    county: (input.county || "").trim(),
    period: input.period,
    cohortSize: input.parcelsObserved,
    metrics,
  };
}

/** Calendar-month period string for a date, e.g. "2026-06". */
export function periodOf(date: Date): string {
  const m = date.getUTCMonth() + 1;
  return `${date.getUTCFullYear()}-${m < 10 ? "0" : ""}${m}`;
}

/** UTC [start, end) window for a "YYYY-MM" period. */
export function periodWindow(period: string): { start: Date; end: Date } {
  const [y, m] = period.split("-").map((s) => parseInt(s, 10));
  return {
    start: new Date(Date.UTC(y, m - 1, 1)),
    end: new Date(Date.UTC(y, m, 1)),
  };
}

/** Quarter string for a date, e.g. "2026-Q2" (mirrors the contributor). */
export function quarterOf(date: Date): string {
  const q = Math.ceil((date.getUTCMonth() + 1) / 3);
  return `${date.getUTCFullYear()}-Q${q}`;
}

/** The three "YYYY-MM" periods inside a "YYYY-Q#" quarter. */
export function periodsOfQuarter(quarter: string): string[] {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarter);
  if (!match) return [];
  const year = parseInt(match[1], 10);
  const q = parseInt(match[2], 10);
  const firstMonth = (q - 1) * 3 + 1;
  return [0, 1, 2].map((i) => {
    const m = firstMonth + i;
    return `${year}-${m < 10 ? "0" : ""}${m}`;
  });
}
