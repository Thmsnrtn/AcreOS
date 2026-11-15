/**
 * Minimum cohort for the partner Data-API benchmarks endpoint
 * (`GET /api/data/benchmarks/:state/:propertyType`, server/routes-data-api.ts).
 *
 * The endpoint has always told callers "Min 10 transactions required to
 * display", but until 2026-11-03 nothing enforced it: a cohort of ONE public
 * record transaction was served as an "average" — that one sale's own
 * price-per-acre and acreage (legal-run finding
 * `finding-benchmarks-minimum-unenforced`). The claim is now the behaviour:
 * below the minimum no figure is served, the true sample size is reported,
 * and the note says what actually happened.
 *
 * The note strings live here, beside the rule they describe, so the copy and
 * the code cannot drift apart again (pinned by benchmarksMinimumEnforced.test.ts).
 */

export const BENCHMARK_MIN_SAMPLE = 10;

export const BENCHMARK_NOTE_SERVED =
  `Aggregated from closed public-record transactions. Figures are shown only when the cohort holds at least ${BENCHMARK_MIN_SAMPLE} transactions.`;

export const BENCHMARK_NOTE_INSUFFICIENT =
  `Insufficient data: this cohort holds fewer than ${BENCHMARK_MIN_SAMPLE} closed public-record transactions, so no average is shown. Figures are shown only at ${BENCHMARK_MIN_SAMPLE} or more.`;

export interface BenchmarkAggregateRow {
  avgPricePerAcre?: unknown;
  avgAcreage?: unknown;
  count?: unknown;
}

export interface BenchmarkFigures {
  avgPricePerAcre: number | null;
  avgAcreage: number | null;
  sampleSize: number;
  minimumSampleSize: number;
  insufficientData: boolean;
  dataPrivacyNote: string;
}

function toNumber(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

/** Shape the aggregate row for the response; withholds figures below the minimum. */
export function shapeBenchmarks(row: BenchmarkAggregateRow | undefined): BenchmarkFigures {
  // Postgres returns COUNT(*) as a bigint string; never trust its type.
  const sampleSize = Math.max(0, Math.trunc(toNumber(row?.count)));
  if (sampleSize < BENCHMARK_MIN_SAMPLE) {
    return {
      avgPricePerAcre: null,
      avgAcreage: null,
      sampleSize,
      minimumSampleSize: BENCHMARK_MIN_SAMPLE,
      insufficientData: true,
      dataPrivacyNote: BENCHMARK_NOTE_INSUFFICIENT,
    };
  }
  return {
    avgPricePerAcre: toNumber(row?.avgPricePerAcre),
    avgAcreage: toNumber(row?.avgAcreage),
    sampleSize,
    minimumSampleSize: BENCHMARK_MIN_SAMPLE,
    insufficientData: false,
    dataPrivacyNote: BENCHMARK_NOTE_SERVED,
  };
}
