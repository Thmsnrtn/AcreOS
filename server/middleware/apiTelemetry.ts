/**
 * API telemetry middleware (FW-9 + L14).
 *
 * Counts 2xx / 4xx / 5xx + duration p50/p95 per route across the /api
 * surface. Two layers:
 *
 *   1. In-process Map<route, counters> for real-time observability — the
 *      same shape as the original middleware.
 *   2. Durable persistence (L14) — on a tick (every TICK_MS milliseconds,
 *      OR after FLUSH_THRESHOLD requests, whichever fires first) we flush
 *      the Map to the `api_telemetry_samples` table and reset. This means
 *      per-route counters survive restart / suspend / Fly machine
 *      rotation, and the founder cost dashboard can query a 30-day
 *      window without an external APM.
 *
 * Surfaced via GET /api/admin/telemetry (founder-gated). The reader
 * UNIONs the current-tick Map with the durable rows so the surface
 * always shows up-to-the-second numbers.
 */

import type { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";

interface RouteCounters {
  count2xx: number;
  count4xx: number;
  count5xx: number;
  totalMs: number;
  /** Sliding p95 window: latest 100 durations. */
  durations: number[];
  firstSeenMs: number;
  lastSeenMs: number;
  /** L5b — cost class declared at route registration, if any. */
  costClass?: string;
}

const ROUTE_BUCKETS = new Map<string, RouteCounters>();
const MAX_DURATIONS = 100;

// ─── L14 — durable flush configuration ───────────────────────────────────────
const TICK_MS = 60_000;               // flush every minute
const FLUSH_THRESHOLD = 1_000;        // …or after 1k requests, whichever first
let requestsSinceFlush = 0;
let windowStartMs = Date.now();
let flushTimer: NodeJS.Timeout | null = null;

/**
 * Normalize Express paths so /api/leases/abc-123 collapses to
 * "/api/leases/:id" rather than spawning a per-uuid counter row.
 */
function normalizeRoute(method: string, originalUrl: string, route: string | undefined): string {
  if (route) return `${method} ${route}`;
  const path = originalUrl.split("?")[0];
  const segments = path.split("/").map((seg) => {
    if (/^\d+$/.test(seg)) return ":id";
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return ":id";
    return seg;
  });
  return `${method} ${segments.join("/")}`;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

/**
 * L14 — flush the in-process Map to api_telemetry_samples and reset.
 * Fire-and-forget — failure to persist must not block live observability.
 *
 * Dynamic-import the db module so test environments + boot-before-db are
 * resilient: telemetry recording starts the instant the middleware is
 * installed, but persistence waits until the db is dialled.
 */
async function flushSamples(): Promise<void> {
  if (ROUTE_BUCKETS.size === 0) {
    windowStartMs = Date.now();
    requestsSinceFlush = 0;
    return;
  }

  // Snapshot + reset under the same tick boundary so concurrent
  // record-and-flush don't double-count.
  const snapshot: Array<[string, RouteCounters]> = [...ROUTE_BUCKETS.entries()];
  ROUTE_BUCKETS.clear();
  const windowStart = new Date(windowStartMs);
  const windowEnd = new Date();
  windowStartMs = windowEnd.getTime();
  requestsSinceFlush = 0;

  try {
    const { db } = await import("../db");
    const { apiTelemetrySamples } = await import("@shared/schema");
    const rows = snapshot.map(([route, bucket]) => {
      const sorted = [...bucket.durations].sort((a, b) => a - b);
      return {
        route,
        costClass: bucket.costClass ?? null,
        windowStart,
        windowEnd,
        count2xx: bucket.count2xx,
        count4xx: bucket.count4xx,
        count5xx: bucket.count5xx,
        totalMs: bucket.totalMs,
        p50Ms: percentile(sorted, 50),
        p95Ms: percentile(sorted, 95),
      };
    });
    if (rows.length > 0) {
      await db.insert(apiTelemetrySamples).values(rows);
    }
  } catch (err) {
    // If we couldn't persist, put the samples back into the in-process
    // Map so they at least survive into the next flush attempt. Use add-
    // and-merge semantics to avoid losing counters posted while we were
    // away.
    for (const [route, bucket] of snapshot) {
      const existing = ROUTE_BUCKETS.get(route);
      if (existing) {
        existing.count2xx += bucket.count2xx;
        existing.count4xx += bucket.count4xx;
        existing.count5xx += bucket.count5xx;
        existing.totalMs += bucket.totalMs;
        existing.durations.push(...bucket.durations);
        if (existing.durations.length > MAX_DURATIONS) {
          existing.durations.splice(0, existing.durations.length - MAX_DURATIONS);
        }
        existing.firstSeenMs = Math.min(existing.firstSeenMs, bucket.firstSeenMs);
        existing.lastSeenMs = Math.max(existing.lastSeenMs, bucket.lastSeenMs);
      } else {
        ROUTE_BUCKETS.set(route, bucket);
      }
    }
    logger.warn("[apiTelemetry] flush failed — samples retained in-process for retry", {
      metadata: { detail: err instanceof Error ? err.message : String(err) },
    });
  }
}

function ensureFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    void flushSamples();
  }, TICK_MS);
  // Don't keep the event loop alive on its own.
  flushTimer.unref?.();
}

export function apiTelemetry() {
  ensureFlushTimer();
  return function (req: Request, res: Response, next: NextFunction) {
    if (!req.path?.startsWith("/api/")) return next();

    const startMs = Date.now();
    res.on("finish", () => {
      try {
        const durationMs = Date.now() - startMs;
        const matched = (req.route as { path?: string } | undefined)?.path;
        const fullPath = matched ? `/api${matched}` : req.originalUrl;
        const key = normalizeRoute(req.method, fullPath, matched ? `/api${matched}` : undefined);
        const status = res.statusCode;

        let bucket = ROUTE_BUCKETS.get(key);
        if (!bucket) {
          bucket = {
            count2xx: 0,
            count4xx: 0,
            count5xx: 0,
            totalMs: 0,
            durations: [],
            firstSeenMs: Date.now(),
            lastSeenMs: Date.now(),
            costClass: req.costClass,
          };
          ROUTE_BUCKETS.set(key, bucket);
        }
        // Latch the cost class once observed (handlers stamp it via the
        // costClass() middleware before res.on("finish") fires).
        if (!bucket.costClass && req.costClass) bucket.costClass = req.costClass;

        bucket.totalMs += durationMs;
        bucket.lastSeenMs = Date.now();
        bucket.durations.push(durationMs);
        if (bucket.durations.length > MAX_DURATIONS) bucket.durations.shift();

        if (status >= 500) bucket.count5xx++;
        else if (status >= 400) bucket.count4xx++;
        else bucket.count2xx++;

        // L14 — threshold-based flush. Fires whichever comes first
        // between TICK_MS and FLUSH_THRESHOLD requests.
        requestsSinceFlush++;
        if (requestsSinceFlush >= FLUSH_THRESHOLD) {
          void flushSamples();
        }
      } catch {/* never let telemetry crash the request */}
    });

    next();
  };
}

export interface RouteSummary {
  route: string;
  totalCount: number;
  count2xx: number;
  count4xx: number;
  count5xx: number;
  errorRate: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  firstSeenAt: string;
  lastSeenAt: string;
  costClass?: string;
}

/**
 * Snapshot of the current-tick Map. Does NOT include durable rows from
 * api_telemetry_samples — for the union view use getTelemetrySummaryDurable
 * below (async; queries the db).
 */
export function getTelemetrySummary(): {
  routes: RouteSummary[];
  totals: { totalCount: number; total2xx: number; total4xx: number; total5xx: number; errorRate: number };
} {
  const routes: RouteSummary[] = [];
  let total2xx = 0;
  let total4xx = 0;
  let total5xx = 0;

  for (const [route, bucket] of ROUTE_BUCKETS.entries()) {
    const totalCount = bucket.count2xx + bucket.count4xx + bucket.count5xx;
    const errorRate = totalCount > 0 ? (bucket.count4xx + bucket.count5xx) / totalCount : 0;
    const sorted = [...bucket.durations].sort((a, b) => a - b);
    routes.push({
      route,
      totalCount,
      count2xx: bucket.count2xx,
      count4xx: bucket.count4xx,
      count5xx: bucket.count5xx,
      errorRate: Math.round(errorRate * 10000) / 10000,
      avgMs: totalCount > 0 ? Math.round(bucket.totalMs / totalCount) : 0,
      p50Ms: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
      firstSeenAt: new Date(bucket.firstSeenMs).toISOString(),
      lastSeenAt: new Date(bucket.lastSeenMs).toISOString(),
      costClass: bucket.costClass,
    });
    total2xx += bucket.count2xx;
    total4xx += bucket.count4xx;
    total5xx += bucket.count5xx;
  }

  routes.sort((a, b) => b.totalCount - a.totalCount);

  const totalCount = total2xx + total4xx + total5xx;
  const errorRate = totalCount > 0 ? (total4xx + total5xx) / totalCount : 0;

  return {
    routes,
    totals: {
      totalCount,
      total2xx,
      total4xx,
      total5xx,
      errorRate: Math.round(errorRate * 10000) / 10000,
    },
  };
}

/**
 * L14 — union view. Reads the durable api_telemetry_samples table for
 * the requested window (default last 24h) and UNIONs the current-tick
 * Map for up-to-the-second numbers. Use this from the founder cost
 * dashboard / admin telemetry endpoint.
 */
export async function getTelemetrySummaryDurable(sinceMs = 24 * 60 * 60 * 1000): Promise<{
  routes: RouteSummary[];
  totals: { totalCount: number; total2xx: number; total4xx: number; total5xx: number; errorRate: number };
}> {
  const since = new Date(Date.now() - sinceMs);
  let durableRows: Array<{
    route: string;
    costClass: string | null;
    count2xx: number;
    count4xx: number;
    count5xx: number;
    totalMs: number;
    p50Ms: number;
    p95Ms: number;
    firstSeenAt: Date;
    lastSeenAt: Date;
  }> = [];
  try {
    const { db } = await import("../db");
    const { apiTelemetrySamples } = await import("@shared/schema");
    const { sql, gte } = await import("drizzle-orm");
    durableRows = await db
      .select({
        route: apiTelemetrySamples.route,
        costClass: apiTelemetrySamples.costClass,
        count2xx: sql<number>`COALESCE(SUM(${apiTelemetrySamples.count2xx}), 0)::int`,
        count4xx: sql<number>`COALESCE(SUM(${apiTelemetrySamples.count4xx}), 0)::int`,
        count5xx: sql<number>`COALESCE(SUM(${apiTelemetrySamples.count5xx}), 0)::int`,
        totalMs: sql<number>`COALESCE(SUM(${apiTelemetrySamples.totalMs}), 0)::int`,
        p50Ms: sql<number>`COALESCE(MAX(${apiTelemetrySamples.p50Ms}), 0)::int`,
        p95Ms: sql<number>`COALESCE(MAX(${apiTelemetrySamples.p95Ms}), 0)::int`,
        firstSeenAt: sql<Date>`MIN(${apiTelemetrySamples.windowStart})`,
        lastSeenAt: sql<Date>`MAX(${apiTelemetrySamples.windowEnd})`,
      })
      .from(apiTelemetrySamples)
      .where(gte(apiTelemetrySamples.windowStart, since))
      .groupBy(apiTelemetrySamples.route, apiTelemetrySamples.costClass);
  } catch (err) {
    logger.warn("[apiTelemetry] durable read failed — returning current-tick only", {
      metadata: { detail: err instanceof Error ? err.message : String(err) },
    });
  }

  // Build a merged map: durable + current-tick.
  type Merged = {
    count2xx: number;
    count4xx: number;
    count5xx: number;
    totalMs: number;
    p50Ms: number;
    p95Ms: number;
    firstSeenMs: number;
    lastSeenMs: number;
    costClass?: string;
  };
  const merged = new Map<string, Merged>();

  for (const r of durableRows) {
    merged.set(r.route, {
      count2xx: r.count2xx,
      count4xx: r.count4xx,
      count5xx: r.count5xx,
      totalMs: r.totalMs,
      p50Ms: r.p50Ms,
      p95Ms: r.p95Ms,
      firstSeenMs: new Date(r.firstSeenAt).getTime(),
      lastSeenMs: new Date(r.lastSeenAt).getTime(),
      costClass: r.costClass ?? undefined,
    });
  }

  // Overlay current-tick.
  for (const [route, bucket] of ROUTE_BUCKETS.entries()) {
    const sorted = [...bucket.durations].sort((a, b) => a - b);
    const existing = merged.get(route);
    if (existing) {
      existing.count2xx += bucket.count2xx;
      existing.count4xx += bucket.count4xx;
      existing.count5xx += bucket.count5xx;
      existing.totalMs += bucket.totalMs;
      existing.p50Ms = Math.max(existing.p50Ms, percentile(sorted, 50));
      existing.p95Ms = Math.max(existing.p95Ms, percentile(sorted, 95));
      existing.firstSeenMs = Math.min(existing.firstSeenMs, bucket.firstSeenMs);
      existing.lastSeenMs = Math.max(existing.lastSeenMs, bucket.lastSeenMs);
      if (!existing.costClass && bucket.costClass) existing.costClass = bucket.costClass;
    } else {
      merged.set(route, {
        count2xx: bucket.count2xx,
        count4xx: bucket.count4xx,
        count5xx: bucket.count5xx,
        totalMs: bucket.totalMs,
        p50Ms: percentile(sorted, 50),
        p95Ms: percentile(sorted, 95),
        firstSeenMs: bucket.firstSeenMs,
        lastSeenMs: bucket.lastSeenMs,
        costClass: bucket.costClass,
      });
    }
  }

  const routes: RouteSummary[] = [];
  let total2xx = 0;
  let total4xx = 0;
  let total5xx = 0;
  for (const [route, m] of merged.entries()) {
    const totalCount = m.count2xx + m.count4xx + m.count5xx;
    const errorRate = totalCount > 0 ? (m.count4xx + m.count5xx) / totalCount : 0;
    routes.push({
      route,
      totalCount,
      count2xx: m.count2xx,
      count4xx: m.count4xx,
      count5xx: m.count5xx,
      errorRate: Math.round(errorRate * 10000) / 10000,
      avgMs: totalCount > 0 ? Math.round(m.totalMs / totalCount) : 0,
      p50Ms: m.p50Ms,
      p95Ms: m.p95Ms,
      firstSeenAt: new Date(m.firstSeenMs).toISOString(),
      lastSeenAt: new Date(m.lastSeenMs).toISOString(),
      costClass: m.costClass,
    });
    total2xx += m.count2xx;
    total4xx += m.count4xx;
    total5xx += m.count5xx;
  }
  routes.sort((a, b) => b.totalCount - a.totalCount);
  const totalCount = total2xx + total4xx + total5xx;
  const errorRate = totalCount > 0 ? (total4xx + total5xx) / totalCount : 0;
  return {
    routes,
    totals: {
      totalCount,
      total2xx,
      total4xx,
      total5xx,
      errorRate: Math.round(errorRate * 10000) / 10000,
    },
  };
}

/** Test hook — force a flush + clear in-process Map. */
export async function _flushNowForTest(): Promise<void> {
  await flushSamples();
}

export function resetTelemetry(): void {
  ROUTE_BUCKETS.clear();
  requestsSinceFlush = 0;
  windowStartMs = Date.now();
}
