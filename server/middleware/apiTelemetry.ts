/**
 * API telemetry middleware (FW-9).
 *
 * Counts 2xx / 4xx / 5xx + duration p50/p95 per route across the /api
 * surface. Stays in-process (Map<route, counters>) so there's no
 * external dependency. The counters reset when the process restarts —
 * intentionally; persistent telemetry belongs in a real APM (Datadog,
 * Honeycomb) and this is a backstop for early-warning observability.
 *
 * Surfaced via GET /api/admin/telemetry (founder-gated).
 */

import type { Request, Response, NextFunction } from "express";

interface RouteCounters {
  count2xx: number;
  count4xx: number;
  count5xx: number;
  totalMs: number;
  /** Sliding p95 window: latest 100 durations. */
  durations: number[];
  firstSeenMs: number;
  lastSeenMs: number;
}

const ROUTE_BUCKETS = new Map<string, RouteCounters>();
const MAX_DURATIONS = 100;

/**
 * Normalize Express paths so /api/leases/abc-123 collapses to
 * "/api/leases/:id" rather than spawning a per-uuid counter row.
 *
 * Heuristic: replace any path segment that's a number, uuid, or single
 * non-alpha word > 12 chars with the `:id` placeholder. Good enough for
 * a backstop; APMs handle this with templating.
 */
function normalizeRoute(method: string, originalUrl: string, route: string | undefined): string {
  // route comes from req.route?.path when matched (already templated like "/api/leases/:id")
  if (route) return `${method} ${route}`;
  // Fallback: hand-roll from originalUrl
  const path = originalUrl.split("?")[0];
  const segments = path.split("/").map((seg) => {
    if (/^\d+$/.test(seg)) return ":id";
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return ":id";
    return seg;
  });
  return `${method} ${segments.join("/")}`;
}

export function apiTelemetry() {
  return function (req: Request, res: Response, next: NextFunction) {
    if (!req.path?.startsWith("/api/")) return next();

    const startMs = Date.now();
    res.on("finish", () => {
      try {
        const durationMs = Date.now() - startMs;
        // route may not be set if the request 404'd before matching
        const matched = (req as any).route?.path as string | undefined;
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
          };
          ROUTE_BUCKETS.set(key, bucket);
        }

        bucket.totalMs += durationMs;
        bucket.lastSeenMs = Date.now();
        bucket.durations.push(durationMs);
        if (bucket.durations.length > MAX_DURATIONS) bucket.durations.shift();

        if (status >= 500) bucket.count5xx++;
        else if (status >= 400) bucket.count4xx++;
        else bucket.count2xx++;
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
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

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
    });
    total2xx += bucket.count2xx;
    total4xx += bucket.count4xx;
    total5xx += bucket.count5xx;
  }

  // Sort by totalCount descending — most-trafficked routes first.
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

export function resetTelemetry(): void {
  ROUTE_BUCKETS.clear();
}
