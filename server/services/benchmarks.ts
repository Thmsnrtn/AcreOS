/**
 * External benchmarks — a value, or nothing, and never a value without a source.
 *
 * ── WHAT THIS REPLACES ──────────────────────────────────────────────────────
 * Two unsourced constants were being presented as facts about the world:
 *
 *   `industryBenchmarkMin: 1, industryBenchmarkMax: 3` — served to CUSTOMERS on
 *   the direct-mail attribution card, rendered as "Industry benchmark: 1–3%",
 *   and — worse — driving a green "— above average" badge the moment a
 *   customer's real response rate cleared the invented lower bound. An invented
 *   number was issuing a verdict on a paying customer's campaign.
 *
 *   `industryBenchmark: 2.5, // SaaS average monthly churn %` — served to the
 *   founder, rendered as a comparison bar, and used as the threshold for a
 *   categorical health status.
 *
 * Neither cited anything. CLAUDE.md's standing founder decision is that
 * fabrication is never acceptable — "no invented numbers, no placeholder data
 * presented as real" — and a claim about an entire industry, with nothing
 * behind it, is exactly that. It is a subtler case than an invented
 * MEASUREMENT, because a benchmark is legitimately a constant: you do not
 * compute the industry's average from your own database. The defect is not the
 * constancy. It is the missing source.
 *
 * ── THE CONTRACT ────────────────────────────────────────────────────────────
 * A benchmark is only renderable if it can say where it came from and when. The
 * type makes that structural rather than a convention: there is no way to
 * express a value without a citation, so the next author cannot add one by
 * accident, and the surfaces render nothing when nothing is registered.
 *
 * The registry is EMPTY on purpose. Supplying a real one is a few lines — a
 * figure, its publisher, and the year — and that is a deliberate act by someone
 * who has the citation in front of them, which is the whole point.
 */

export interface Benchmark {
  /** The figure itself, in `unit`. */
  value: number;
  /** A range, where the published benchmark is one. */
  rangeMin?: number;
  rangeMax?: number;
  /** e.g. "percent" — rendered beside the value. */
  unit: string;
  /** WHO published it. A real, checkable attribution, never "industry data". */
  source: string;
  /** WHEN it was published, so a reader can judge whether it is still true. */
  asOf: string;
}

/**
 * Every benchmark any surface may render, by key.
 *
 * EMPTY, and that is the current honest state. The two entries that used to be
 * inlined at their call sites — direct-mail response rate and SaaS monthly
 * churn — are not here because nobody recorded where they came from, and
 * inventing a citation to satisfy the type would be a worse lie than the
 * uncited number was.
 */
const BENCHMARKS: Record<string, Benchmark> = {};

/** Keys the product asks for, listed so a reader can see what is missing. */
export const BENCHMARK_KEYS = {
  /** Direct-mail response rate, shown on the campaign attribution card. */
  directMailResponseRate: "direct_mail_response_rate",
  /** Monthly churn for comparable SaaS, shown on the founder churn panel. */
  saasMonthlyChurn: "saas_monthly_churn",
} as const;

/** The benchmark for a key, or null when none is registered. Never throws. */
export function benchmarkFor(key: string): Benchmark | null {
  return BENCHMARKS[key] ?? null;
}
