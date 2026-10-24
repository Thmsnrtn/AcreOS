/**
 * Data-sourcing ops metrics — D2g (v2 §3), served read-only at
 * GET /api/ops/data (routes-ops.ts, the ops service token).
 *
 *   coverage       — counties by ownership state + parcels kept (the county
 *                    pipeline's coverage rows), and each statewide build job's
 *                    latest run outcome (dry_run_only / ingested / failed).
 *   fallThrough    — provider lookups over the window by answering layer
 *                    (D1 A3 demand events) and the PAID fall-through rate per
 *                    1,000 lookups: answers a vendor billed AcreOS for.
 *                    BYOK answers are the customer's own spend, counted apart.
 *   warehouseCost  — warehouse-served lookups (open data + cache) against the
 *                    < $0.001 target. Fully-loaded cost is NOT measured: no
 *                    metered infrastructure cost is recorded anywhere (the
 *                    cost optimizer's Fly figure is a fixed estimate, not a
 *                    bill), so the cost is null with that reason — never an
 *                    estimate divided by a count.
 *   adapterRemaps  — per statewide job: runs, D2d remap attempts by outcome,
 *                    and the promotion rate (a source that remaps often is a
 *                    source to replace).
 *
 * The pure folds below are what the tests drive; loadDataOpsMetrics() is the
 * one production read.
 */

export const WAREHOUSE_LOOKUP_TARGET_USD = 0.001;
export const WAREHOUSE_LAYERS = ["open_data", "cache"] as const;

export interface LayerCount {
  answeringLayer: string | null;
  n: number;
}

export interface FallThrough {
  windowDays: number;
  total: number;
  byLayer: Record<string, number>;
  /** Vendor-billed answers per 1,000 lookups; null with no lookups. */
  paidPer1k: number | null;
  /** Rows written before 0287 carry no layer; counted, never guessed. */
  unattributed: number;
}

export function foldFallThrough(rows: readonly LayerCount[], windowDays: number): FallThrough {
  const byLayer: Record<string, number> = {};
  let total = 0;
  let unattributed = 0;
  for (const r of rows) {
    total += r.n;
    if (!r.answeringLayer) {
      unattributed += r.n;
      continue;
    }
    byLayer[r.answeringLayer] = (byLayer[r.answeringLayer] ?? 0) + r.n;
  }
  const attributed = total - unattributed;
  return {
    windowDays,
    total,
    byLayer,
    paidPer1k: attributed > 0 ? Math.round(((byLayer.vendor ?? 0) / attributed) * 1000 * 10) / 10 : null,
    unattributed,
  };
}

export interface WarehouseCost {
  warehouseServedLookups: number;
  targetUsd: number;
  costPerLookupUsd: null;
  why: string;
}

export function foldWarehouseCost(f: FallThrough): WarehouseCost {
  const served = WAREHOUSE_LAYERS.reduce((n, l) => n + (f.byLayer[l] ?? 0), 0);
  return {
    warehouseServedLookups: served,
    targetUsd: WAREHOUSE_LOOKUP_TARGET_USD,
    costPerLookupUsd: null,
    why: "not measured — no metered infrastructure or bucket cost is recorded (the cost optimizer's Fly figure is a fixed estimate, not a bill)",
  };
}

export interface RunObservationRow {
  jobName: string;
  status: string;
  observation: Record<string, unknown> | null;
}

export interface JobRemapRate {
  jobName: string;
  runs: number;
  attempts: number;
  promoted: number;
  rejected: number;
  noProposal: number;
  /** promoted / runs; null with no runs. */
  promotionRate: number | null;
  latestOutcome: string | null;
}

export function foldRemapRates(rows: readonly RunObservationRow[]): JobRemapRate[] {
  const by = new Map<string, JobRemapRate>();
  for (const r of rows) {
    const j = by.get(r.jobName) ?? { jobName: r.jobName, runs: 0, attempts: 0, promoted: 0, rejected: 0, noProposal: 0, promotionRate: null, latestOutcome: null };
    j.runs += 1;
    const remap = (r.observation?.remap ?? null) as { outcome?: string } | null;
    if (remap?.outcome) {
      j.attempts += 1;
      if (remap.outcome === "promoted") j.promoted += 1;
      else if (remap.outcome === "rejected") j.rejected += 1;
      else if (remap.outcome === "no_proposal") j.noProposal += 1;
    }
    by.set(r.jobName, j);
  }
  return Array.from(by.values()).map((j) => ({ ...j, promotionRate: j.runs > 0 ? Math.round((j.promoted / j.runs) * 1000) / 1000 : null }));
}

export interface StatewideBuildStatus {
  jobName: string;
  lastRunStatus: string | null;
  outcome: string | null;
  county: string | null;
  normalized: number | null;
  peakRssMb: number | null;
}

/** rows newest-first per job; the first row per job is its latest. */
export function foldStatewideBuilds(rows: readonly RunObservationRow[]): StatewideBuildStatus[] {
  const seen = new Map<string, StatewideBuildStatus>();
  for (const r of rows) {
    if (seen.has(r.jobName)) continue;
    const o = r.observation as { outcome?: { status?: string }; summary?: { county?: string; normalized?: number; peakRssMb?: number } } | null;
    seen.set(r.jobName, {
      jobName: r.jobName,
      lastRunStatus: r.status,
      outcome: r.status === "failure" ? "failed" : (o?.outcome?.status ?? null),
      county: o?.summary?.county ?? null,
      normalized: o?.summary?.normalized ?? null,
      peakRssMb: o?.summary?.peakRssMb ?? null,
    });
  }
  return Array.from(seen.values());
}

export interface DataOpsMetrics {
  asOf: string;
  coverage: {
    counties: { state: string; status: string; counties: number; parcelsStored: number }[];
    statewideBuilds: StatewideBuildStatus[];
  };
  fallThrough: FallThrough;
  warehouseCost: WarehouseCost;
  adapterRemaps: JobRemapRate[];
}

/** The production read (platform-wide aggregates; no tenant rows leave this function). */
export async function loadDataOpsMetrics(now: Date, windowDays = 30): Promise<DataOpsMetrics> {
  const { sql, desc, eq, gte, like } = await import("drizzle-orm");
  const { unscopedForPlatformOps } = await import("../../utils/orgScopedDb");
  const { countyDiscoveryQueue, etlJobs, etlRuns, providerLookupLog } = await import("@shared/schema");
  const reason = "D2g data ops metrics: platform-wide aggregates for the ops API (read-only)";
  const since = new Date(now.getTime() - windowDays * 86_400_000);
  const [countyRows, layerRows, runRows] = await Promise.all([
    unscopedForPlatformOps(reason)
      .select({
        state: countyDiscoveryQueue.state,
        status: sql<string>`COALESCE(${countyDiscoveryQueue.ownedStatus}, 'never_requested')`,
        counties: sql<number>`COUNT(*)::int`,
        parcelsStored: sql<number>`COALESCE(SUM(${countyDiscoveryQueue.ownedParcelsStored}), 0)::int`,
      })
      .from(countyDiscoveryQueue)
      .groupBy(countyDiscoveryQueue.state, sql`COALESCE(${countyDiscoveryQueue.ownedStatus}, 'never_requested')`),
    unscopedForPlatformOps(reason)
      .select({ answeringLayer: providerLookupLog.answeringLayer, n: sql<number>`COUNT(*)::int` })
      .from(providerLookupLog)
      .where(gte(providerLookupLog.createdAt, since))
      .groupBy(providerLookupLog.answeringLayer),
    unscopedForPlatformOps(reason)
      .select({ jobName: etlJobs.jobName, status: etlRuns.status, observation: etlRuns.observation })
      .from(etlRuns)
      .innerJoin(etlJobs, eq(etlRuns.jobId, etlJobs.id))
      .where(like(etlJobs.jobName, "%_statewide_cadastral_v1"))
      .orderBy(desc(etlRuns.startedAt))
      .limit(2000),
  ]);
  const fallThrough = foldFallThrough(layerRows as LayerCount[], windowDays);
  const runs = runRows as RunObservationRow[];
  return {
    asOf: now.toISOString(),
    coverage: { counties: countyRows as DataOpsMetrics["coverage"]["counties"], statewideBuilds: foldStatewideBuilds(runs) },
    fallThrough,
    warehouseCost: foldWarehouseCost(fallThrough),
    adapterRemaps: foldRemapRates(runs),
  };
}
