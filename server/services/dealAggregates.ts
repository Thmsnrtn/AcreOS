/**
 * T0-10 — Deals header aggregates.
 *
 * The Deals door header (KPI cards + stage-distribution bar in
 * client/src/pages/deals.tsx) previously computed pipeline value / closed
 * value / stalled counts from ONE page of the paginated /api/deals response
 * (25 rows), so any org with more than 25 deals saw numbers that were
 * silently wrong. GET /api/deals/aggregates (server/routes-deals.ts) now
 * computes them with org-scoped SQL aggregation; this module holds the
 * dependency-free pieces (benchmarks + row folding) so they can be
 * unit-tested without mocking the whole route file's import graph.
 */

/**
 * Benchmark days a deal may sit in a stage before it is considered slow /
 * stalled. MUST mirror STAGE_BENCHMARK_DAYS in client/src/pages/deals.tsx
 * (the client still uses its copy for per-card health dots; the server uses
 * this one for the aggregate stalled/warning counts).
 */
export const STAGE_BENCHMARK_DAYS: Record<string, number> = {
  negotiating: 14,
  offer_sent: 5,
  countered: 5,
  accepted: 7,
  in_escrow: 30,
  closed: 999,
  cancelled: 999,
};

/** Fallback benchmark for unknown stages — mirrors the client's `?? 14`. */
export const DEFAULT_STAGE_BENCHMARK_DAYS = 14;

/** One grouped row from the SQL aggregation (GROUP BY status, type). */
export interface DealAggregateRow {
  status: string;
  type: string;
  /** Deals in this (status, type) group. */
  count: number;
  /** SUM(COALESCE(offer_amount, accepted_amount, 0)) for the group. */
  pipelineValue: number;
  /** SUM(COALESCE(accepted_amount, 0)) for the group. */
  acceptedValue: number;
  /** Deals whose days-in-stage >= benchmark * 2. */
  stalledCount: number;
  /** Deals whose days-in-stage >= ceil(benchmark * 1.25) — includes stalled. */
  warnAtLeastCount: number;
}

export interface DealAggregatesResponse {
  totals: {
    /** All deals in scope, every status (incl. cancelled). */
    totalDeals: number;
    /** type=acquisition, status != cancelled. */
    acquisitions: number;
    /** type=disposition, status != cancelled. */
    dispositions: number;
    /** Sum of offer-or-accepted amount over active (not closed/cancelled) deals. */
    totalPipelineValue: number;
    /** Sum of accepted amount over closed deals. */
    closedValue: number;
    /** Active deals at >= 2x their stage benchmark. */
    stalledCount: number;
    /** Active deals at >= 1.25x benchmark but below the stalled threshold. */
    warningCount: number;
  };
  /** Per-status counts/values for the stage-distribution bar. */
  stages: { status: string; count: number; value: number }[];
}

const ACTIVE = (status: string) => status !== "closed" && status !== "cancelled";

/**
 * Fold the grouped SQL rows into the response shape. Pure function —
 * mirrors the (previously page-local) reductions in deals.tsx exactly:
 *  - acquisitions/dispositions exclude cancelled
 *  - pipeline value excludes closed + cancelled
 *  - closed value sums acceptedAmount of closed deals
 *  - warning = (>= 1.25x benchmark) minus stalled, active deals only
 */
export function foldDealAggregates(rows: DealAggregateRow[]): DealAggregatesResponse {
  const totals: DealAggregatesResponse["totals"] = {
    totalDeals: 0,
    acquisitions: 0,
    dispositions: 0,
    totalPipelineValue: 0,
    closedValue: 0,
    stalledCount: 0,
    warningCount: 0,
  };
  const stageMap = new Map<string, { count: number; value: number }>();

  for (const row of rows) {
    const count = Number(row.count) || 0;
    const pipelineValue = Number(row.pipelineValue) || 0;
    const acceptedValue = Number(row.acceptedValue) || 0;
    const stalled = Number(row.stalledCount) || 0;
    const warnAtLeast = Number(row.warnAtLeastCount) || 0;

    totals.totalDeals += count;
    if (row.status !== "cancelled") {
      if (row.type === "acquisition") totals.acquisitions += count;
      if (row.type === "disposition") totals.dispositions += count;
    }
    if (ACTIVE(row.status)) {
      totals.totalPipelineValue += pipelineValue;
      totals.stalledCount += stalled;
      // warnAtLeast counts stalled deals too (2x >= ceil(1.25x) for all
      // positive benchmarks), so the strictly-warning band is the difference.
      totals.warningCount += Math.max(0, warnAtLeast - stalled);
    }
    if (row.status === "closed") totals.closedValue += acceptedValue;

    const stage = stageMap.get(row.status) ?? { count: 0, value: 0 };
    stage.count += count;
    stage.value += pipelineValue;
    stageMap.set(row.status, stage);
  }

  return {
    totals,
    stages: Array.from(stageMap, ([status, s]) => ({ status, count: s.count, value: s.value })),
  };
}
