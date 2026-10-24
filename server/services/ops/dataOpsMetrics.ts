/**
 * Data-sourcing ops metrics — D2g (v2 §3), served read-only at
 * GET /api/ops/data (routes-ops.ts, the ops service token).
 * What every number means, and what it is divided by: docs/ops/data-ops-metrics.md.
 *
 *   coverage       — counties by ownership state + parcels kept (the county
 *                    pipeline's coverage rows), rolled up per state against a
 *                    STATED denominator (counties the discovery queue knows
 *                    of — never "all counties in the state"), and each
 *                    statewide build job's latest run outcome.
 *   fallThrough    — provider lookups over the window by answering layer
 *                    (D1 A3 demand events) and the PAID fall-through rate per
 *                    1,000 answers served: answers a vendor billed AcreOS for.
 *                    BYOK answers are the customer's own spend, counted apart.
 *                    Every layer value lands in a defined bucket, in
 *                    `unattributed` (no layer written) or in `unknownLayers`
 *                    (a value this fold has no bucket for) — never dropped.
 *   warehouseCost  — warehouse-served answers (open data + cache) against the
 *                    < $0.001 target. Fully-loaded cost is NOT measured: no
 *                    metered infrastructure cost is recorded anywhere (the
 *                    cost optimizer's Fly figure is a fixed estimate, not a
 *                    bill), so the cost is null with that reason — never an
 *                    estimate divided by a count.
 *   adapterRemaps  — per statewide job: runs, D2d remap attempts by outcome,
 *                    and the promotion rate (a source that remaps often is a
 *                    source to replace).
 *   releaseInventory — D2b warehouse releases. No release store exists yet,
 *                    so this reads `not_built` — never an empty list, which
 *                    would read as "zero releases".
 *   purposeLedger  — D2e person-adjacent lookups over the window by surface
 *                    and permissible-purpose code (counts only — no actor,
 *                    org or parcel leaves this read).
 *
 * The pure folds below are what the tests drive; loadDataOpsMetrics() is the
 * one production read.
 */

import type { AnsweringLayer } from "@shared/openData/demandEvent";

const WAREHOUSE_LOOKUP_TARGET_USD = 0.001;

// ─── Fall-through ───────────────────────────────────────────────────────────

/**
 * Which bucket each answering layer counts in. A Record over the shared
 * AnsweringLayer union, so adding a layer to the union without bucketing it
 * here fails the type check; dataOpsMetrics.layerVocabulary.test.ts derives
 * the values the registry actually WRITES from source and holds them to this
 * map, so a literal written outside the union cannot slip past either.
 */
type LayerBucket = "warehouse" | "paid_platform" | "paid_byok";
const LAYER_BUCKETS: Record<AnsweringLayer, LayerBucket> = {
  open_data: "warehouse",
  cache: "warehouse",
  vendor: "paid_platform",
  vendor_byok: "paid_byok",
};

function isKnownLayer(v: string): v is AnsweringLayer {
  return Object.prototype.hasOwnProperty.call(LAYER_BUCKETS, v);
}

/** One provider_lookup_log group: (layer, success, cached flag, probe?) → count. */
export interface LayerCount {
  answeringLayer: string | null;
  success: boolean;
  cached: boolean;
  /** A dataSourceProbe canary row (provider_name 'probe:*') — telemetry, not demand. */
  probe: boolean;
  n: number;
}

interface AnsweredFailed {
  answered: number;
  failed: number;
}

export interface FallThrough {
  windowDays: number;
  /** Every provider_lookup_log row in the window, probes included. */
  totalRows: number;
  /** Canary rows (provider_name 'probe:*'); excluded from every rate below. */
  probes: number;
  byLayer: Record<AnsweringLayer, AnsweredFailed>;
  byBucket: Record<LayerBucket, number>;
  /** The rate's denominator: successful answers with a known layer, probes excluded. */
  answersServed: number;
  /** Vendor (platform-key) answers per 1,000 answersServed; null when answersServed is 0. */
  paidPer1k: number | null;
  /** Attempts with a known layer that served nothing (success=false). Not in the rate. */
  failedAttempts: number;
  /**
   * Rows with no answering layer. Written by pre-0287 rows AND, today, by the
   * parcel_snapshots and cached_lookups cache lanes, which do not set one —
   * split by the cached flag the writer recorded. Counted, never guessed into
   * a bucket, and kept out of the rate.
   */
  unattributed: { rows: number; cachedFlag: number; notCachedFlag: number };
  /** Layer values this fold has no bucket for. Non-empty means the vocabulary drifted. */
  unknownLayers: Record<string, number>;
  /** The bucket map itself, so a reader sees what counts as paid. */
  layerBuckets: Record<AnsweringLayer, LayerBucket>;
}

export function foldFallThrough(rows: readonly LayerCount[], windowDays: number): FallThrough {
  const byLayer = Object.fromEntries(
    (Object.keys(LAYER_BUCKETS) as AnsweringLayer[]).map((l) => [l, { answered: 0, failed: 0 }]),
  ) as Record<AnsweringLayer, AnsweredFailed>;
  const byBucket: Record<LayerBucket, number> = { warehouse: 0, paid_platform: 0, paid_byok: 0 };
  const unattributed = { rows: 0, cachedFlag: 0, notCachedFlag: 0 };
  const unknownLayers: Record<string, number> = {};
  let totalRows = 0;
  let probes = 0;
  let failedAttempts = 0;
  for (const r of rows) {
    totalRows += r.n;
    if (r.probe) {
      probes += r.n;
      continue;
    }
    if (r.answeringLayer === null || r.answeringLayer === "") {
      unattributed.rows += r.n;
      if (r.cached) unattributed.cachedFlag += r.n;
      else unattributed.notCachedFlag += r.n;
      continue;
    }
    if (!isKnownLayer(r.answeringLayer)) {
      unknownLayers[r.answeringLayer] = (unknownLayers[r.answeringLayer] ?? 0) + r.n;
      continue;
    }
    if (r.success) {
      byLayer[r.answeringLayer].answered += r.n;
      byBucket[LAYER_BUCKETS[r.answeringLayer]] += r.n;
    } else {
      byLayer[r.answeringLayer].failed += r.n;
      failedAttempts += r.n;
    }
  }
  const answersServed = byBucket.warehouse + byBucket.paid_platform + byBucket.paid_byok;
  return {
    windowDays,
    totalRows,
    probes,
    byLayer,
    byBucket,
    answersServed,
    paidPer1k: answersServed > 0 ? Math.round((byBucket.paid_platform / answersServed) * 1000 * 10) / 10 : null,
    failedAttempts,
    unattributed,
    unknownLayers,
    layerBuckets: { ...LAYER_BUCKETS },
  };
}

export interface WarehouseCost {
  /** Successful open_data + cache answers (the warehouse bucket). */
  warehouseServedLookups: number;
  /** Null-layer rows the writer flagged cached — cache-served, but not layer-attributed; NOT added above. */
  cacheFlaggedWithoutLayer: number;
  targetUsd: number;
  costPerLookupUsd: null;
  why: string;
}

export function foldWarehouseCost(f: FallThrough): WarehouseCost {
  return {
    warehouseServedLookups: f.byBucket.warehouse,
    cacheFlaggedWithoutLayer: f.unattributed.cachedFlag,
    targetUsd: WAREHOUSE_LOOKUP_TARGET_USD,
    costPerLookupUsd: null,
    why: "not measured — no metered infrastructure or bucket cost is recorded (the cost optimizer's Fly figure is a fixed estimate, not a bill)",
  };
}

// ─── Coverage ───────────────────────────────────────────────────────────────

export interface CountyCoverageRow {
  state: string;
  /** county_discovery_queue.owned_status; null = ownership never requested. */
  status: string | null;
  counties: number;
  parcelsStored: number;
}

/** Owned-status lifecycle the county pipeline writes (countyPipeline.ts, ownedParcelStore.ts). */
const OWNED_STATUSES = ["pending", "processing", "complete", "refused", "failed"] as const;
type OwnedStatus = (typeof OWNED_STATUSES)[number];

export interface StateCoverage {
  state: string;
  /** Owned outright: owned_status = 'complete'. */
  countiesOwned: number;
  /**
   * The denominator: counties with a county_discovery_queue row for this
   * state (someone searched there, or it was seeded). NOT every county in the
   * state — AcreOS records no authoritative county count per state.
   */
  countiesKnown: number;
  inProgress: number;
  refused: number;
  failed: number;
  neverRequested: number;
  /** Rows whose owned_status is outside the lifecycle above — counted, not dropped. */
  otherStatus: number;
  /** SUM(owned_parcels_stored) over every known county in the state. */
  parcelsStored: number;
}

export function foldCoverageByState(rows: readonly CountyCoverageRow[]): StateCoverage[] {
  const by = new Map<string, StateCoverage>();
  for (const r of rows) {
    const s = by.get(r.state) ?? {
      state: r.state,
      countiesOwned: 0,
      countiesKnown: 0,
      inProgress: 0,
      refused: 0,
      failed: 0,
      neverRequested: 0,
      otherStatus: 0,
      parcelsStored: 0,
    };
    s.countiesKnown += r.counties;
    s.parcelsStored += r.parcelsStored;
    const status = r.status;
    if (status === null) s.neverRequested += r.counties;
    else if (!(OWNED_STATUSES as readonly string[]).includes(status)) s.otherStatus += r.counties;
    else {
      const known = status as OwnedStatus;
      if (known === "complete") s.countiesOwned += r.counties;
      else if (known === "pending" || known === "processing") s.inProgress += r.counties;
      else if (known === "refused") s.refused += r.counties;
      else s.failed += r.counties;
    }
    by.set(r.state, s);
  }
  return Array.from(by.values()).sort((a, b) => a.state.localeCompare(b.state));
}

// ─── Release inventory (D2b) ────────────────────────────────────────────────

/** One warehouse release as D2b's store will describe it. Defined here until that store exists. */
export interface ReleaseInventoryRow {
  releaseId: string;
  /** vYYYY.MM.N */
  name: string;
  createdAt: string;
  /** The promoted / current release. */
  current: boolean;
  countyCount: number;
  parcelCount: number;
}

const RELEASE_NAME = /^v\d{4}\.(0[1-9]|1[0-2])\.\d+$/;

export type ReleaseInventory =
  | { status: "not_built"; why: string }
  | {
      status: "reported";
      releaseCount: number;
      /** null when no release is flagged current, or when more than one is (see currentConflict). */
      current: ReleaseInventoryRow | null;
      /** More than one release flagged current — reported, never resolved by picking one. */
      currentConflict: boolean;
      /** Names that are not vYYYY.MM.N. */
      malformedNames: string[];
      /** Newest first. */
      releases: ReleaseInventoryRow[];
    };

export const RELEASE_INVENTORY_NOT_BUILT: ReleaseInventory = {
  status: "not_built",
  why: "no release store exists yet (D2b)",
};

export function foldReleaseInventory(rows: readonly ReleaseInventoryRow[]): ReleaseInventory {
  const releases = [...rows].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  const current = releases.filter((r) => r.current);
  return {
    status: "reported",
    releaseCount: releases.length,
    current: current.length === 1 ? current[0] : null,
    currentConflict: current.length > 1,
    malformedNames: releases.filter((r) => !RELEASE_NAME.test(r.name)).map((r) => r.name),
    releases,
  };
}

/**
 * The release reader D2b will provide. Until the integrator wires one, the
 * inventory is `not_built` — an absent store is not an empty one.
 */
export type ReleaseReader = () => Promise<ReleaseInventoryRow[]>;

async function readReleaseInventory(reader: ReleaseReader | undefined): Promise<ReleaseInventory> {
  if (!reader) return RELEASE_INVENTORY_NOT_BUILT;
  return foldReleaseInventory(await reader());
}

// ─── Remaps and statewide builds ────────────────────────────────────────────

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

// ─── The production read ────────────────────────────────────────────────────

export interface DataOpsMetrics {
  asOf: string;
  coverage: {
    counties: { state: string; status: string; counties: number; parcelsStored: number }[];
    byState: StateCoverage[];
    statewideBuilds: StatewideBuildStatus[];
  };
  fallThrough: FallThrough;
  warehouseCost: WarehouseCost;
  adapterRemaps: JobRemapRate[];
  releaseInventory: ReleaseInventory;
  purposeLedger: { windowDays: number; bySurface: { surface: string; purposeCode: string; n: number }[] };
}

/** The production read (platform-wide aggregates; no tenant rows leave this function). */
export async function loadDataOpsMetrics(now: Date, windowDays = 30, releases?: ReleaseReader): Promise<DataOpsMetrics> {
  const { sql, desc, eq, gte, like } = await import("drizzle-orm");
  const { unscopedForPlatformOps } = await import("../../utils/orgScopedDb");
  const { countyDiscoveryQueue, etlJobs, etlRuns, providerLookupLog, purposeLedger } = await import("@shared/schema");
  const reason = "D2g data ops metrics: platform-wide aggregates for the ops API (read-only)";
  const since = new Date(now.getTime() - windowDays * 86_400_000);
  const isProbe = sql<boolean>`(${providerLookupLog.providerName} LIKE 'probe:%')`;
  const [countyRows, layerRows, runRows, purposeRows, releaseInventory] = await Promise.all([
    unscopedForPlatformOps(reason)
      .select({
        state: countyDiscoveryQueue.state,
        status: countyDiscoveryQueue.ownedStatus,
        counties: sql<number>`COUNT(*)::int`,
        parcelsStored: sql<number>`COALESCE(SUM(${countyDiscoveryQueue.ownedParcelsStored}), 0)::int`,
      })
      .from(countyDiscoveryQueue)
      .groupBy(countyDiscoveryQueue.state, countyDiscoveryQueue.ownedStatus),
    unscopedForPlatformOps(reason)
      .select({
        answeringLayer: providerLookupLog.answeringLayer,
        success: providerLookupLog.success,
        cached: providerLookupLog.cached,
        probe: isProbe,
        n: sql<number>`COUNT(*)::int`,
      })
      .from(providerLookupLog)
      .where(gte(providerLookupLog.createdAt, since))
      .groupBy(providerLookupLog.answeringLayer, providerLookupLog.success, providerLookupLog.cached, isProbe),
    unscopedForPlatformOps(reason)
      .select({ jobName: etlJobs.jobName, status: etlRuns.status, observation: etlRuns.observation })
      .from(etlRuns)
      .innerJoin(etlJobs, eq(etlRuns.jobId, etlJobs.id))
      .where(like(etlJobs.jobName, "%_statewide_cadastral_v1"))
      .orderBy(desc(etlRuns.startedAt))
      .limit(2000),
    unscopedForPlatformOps(reason)
      .select({ surface: purposeLedger.surface, purposeCode: purposeLedger.purposeCode, n: sql<number>`COUNT(*)::int` })
      .from(purposeLedger)
      .where(gte(purposeLedger.createdAt, since))
      .groupBy(purposeLedger.surface, purposeLedger.purposeCode),
    readReleaseInventory(releases),
  ]);
  const fallThrough = foldFallThrough(
    layerRows.map((r) => ({ answeringLayer: r.answeringLayer, success: r.success, cached: r.cached === true, probe: r.probe === true, n: r.n })),
    windowDays,
  );
  const runs = runRows as RunObservationRow[];
  return {
    asOf: now.toISOString(),
    coverage: {
      // A county never requested has no owned status yet; say so rather than leave it null.
      counties: countyRows.map((r) => ({ ...r, status: r.status ?? "never_requested" })),
      byState: foldCoverageByState(countyRows),
      statewideBuilds: foldStatewideBuilds(runs),
    },
    fallThrough,
    warehouseCost: foldWarehouseCost(fallThrough),
    adapterRemaps: foldRemapRates(runs),
    releaseInventory,
    purposeLedger: { windowDays, bySurface: purposeRows as DataOpsMetrics["purposeLedger"]["bySurface"] },
  };
}
