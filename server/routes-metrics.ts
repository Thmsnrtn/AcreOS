/**
 * T180 — API Metrics Routes
 *
 * Operational JSON metrics for monitoring. Mounted SESSION-GATED at
 * /api/metrics (server/routes.ts: `app.use('/api/metrics', isAuthenticated,
 * metricsRouter)`) — Prometheus does NOT scrape this router. The scrape
 * endpoint is GET /metrics at the app level, mounted in server/index.ts on
 * the prom-client handler from server/metrics.ts.
 *
 * GET /api/metrics/requests — recent HTTP request counts by endpoint
 * GET /api/metrics/errors   — recent error counts
 * GET /api/metrics/cache    — cache hit/miss stats
 * GET /api/metrics/summary  — combined summary
 * GET /api/metrics          — Prometheus exposition, delegated to the same
 *                             prom-client handler (session gate here PLUS its
 *                             own METRICS_TOKEN bearer gate)
 *
 * Consolidation 2026-08-16 (founder-approved): an earlier version of this
 * file claimed it was mounted at the app level where Prometheus could scrape
 * it (false — it has been session-gated under /api/metrics all along) and
 * rendered its own hand-rolled Prometheus text from in-file counters, four of
 * which (deals/calls/valuations/marketplace) had zero incrementer call sites
 * and could only ever read 0. All exposition now comes from the single
 * prom-client registry in server/metrics.ts; this file keeps only the
 * JSON window endpoints and the rolling request buffer that feeds them.
 */

import { Router, type Request, type Response } from "express";
import { getCacheStats } from "./middleware/responseCache";
import { metricsHandler } from "./metrics";

const router = Router();

// ─── Simple in-process metrics store ─────────────────────────────────────────
interface RequestMetric {
  path: string;
  method: string;
  statusCode: number;
  durationMs: number;
  timestamp: number;
}

const recentRequests: RequestMetric[] = [];
const MAX_METRICS = 1000;

/**
 * Record one finished request into the rolling window that backs the JSON
 * endpoints below. Called from the request logger in server/routes.ts.
 * Prometheus counters/histograms are NOT advanced here — metricsMiddleware
 * (server/metrics.ts) already records every request into the registry.
 */
export function recordRequestWithMetrics(metric: RequestMetric): void {
  recentRequests.push(metric);
  if (recentRequests.length > MAX_METRICS) {
    recentRequests.shift();
  }
}

function getWindowedMetrics(windowMs: number) {
  const cutoff = Date.now() - windowMs;
  return recentRequests.filter(r => r.timestamp > cutoff);
}

// GET /api/metrics/requests — request counts by path (last 5 minutes)
router.get("/requests", (req: Request, res: Response) => {
  const metrics = getWindowedMetrics(5 * 60 * 1000);
  const byPath: Record<string, { count: number; avgMs: number; errors: number }> = {};

  for (const m of metrics) {
    const key = `${m.method} ${m.path}`;
    if (!byPath[key]) byPath[key] = { count: 0, avgMs: 0, errors: 0 };
    byPath[key].count++;
    byPath[key].avgMs = (byPath[key].avgMs * (byPath[key].count - 1) + m.durationMs) / byPath[key].count;
    if (m.statusCode >= 400) byPath[key].errors++;
  }

  const sorted = Object.entries(byPath)
    .map(([path, stats]) => ({ path, ...stats, avgMs: Math.round(stats.avgMs) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);

  res.json({
    windowMinutes: 5,
    totalRequests: metrics.length,
    endpoints: sorted,
  });
});

// GET /api/metrics/errors — error rates by path (last 15 minutes)
router.get("/errors", (req: Request, res: Response) => {
  const metrics = getWindowedMetrics(15 * 60 * 1000);
  const errors = metrics.filter(m => m.statusCode >= 400);

  const byStatus: Record<number, number> = {};
  const byPath: Record<string, number> = {};

  for (const e of errors) {
    byStatus[e.statusCode] = (byStatus[e.statusCode] || 0) + 1;
    const key = `${e.method} ${e.path}`;
    byPath[key] = (byPath[key] || 0) + 1;
  }

  const topErrorPaths = Object.entries(byPath)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20)
    .map(([path, count]) => ({ path, count }));

  res.json({
    windowMinutes: 15,
    totalRequests: metrics.length,
    totalErrors: errors.length,
    errorRate: metrics.length > 0 ? ((errors.length / metrics.length) * 100).toFixed(2) + "%" : "0%",
    byStatus,
    topErrorPaths,
  });
});

// GET /api/metrics/cache — cache statistics
router.get("/cache", (req: Request, res: Response) => {
  const stats = getCacheStats();
  res.json({
    cache: {
      ...stats,
      fillPercent: `${stats.fillPercent}%`,
    },
  });
});

// GET /api/metrics/summary — combined operational summary
router.get("/summary", (req: Request, res: Response) => {
  const last5min = getWindowedMetrics(5 * 60 * 1000);
  const last15min = getWindowedMetrics(15 * 60 * 1000);
  const errors15min = last15min.filter(m => m.statusCode >= 400);
  const avgDuration = last5min.length > 0
    ? Math.round(last5min.reduce((sum, m) => sum + m.durationMs, 0) / last5min.length)
    : 0;

  const cacheStats = getCacheStats();

  res.json({
    timestamp: new Date().toISOString(),
    requests: {
      last5min: last5min.length,
      last15min: last15min.length,
      avgDurationMs: avgDuration,
    },
    errors: {
      last15min: errors15min.length,
      errorRate: last15min.length > 0 ? ((errors15min.length / last15min.length) * 100).toFixed(2) + "%" : "0%",
    },
    cache: {
      size: cacheStats.size,
      maxSize: cacheStats.maxSize,
      fillPercent: `${cacheStats.fillPercent}%`,
    },
    uptime: process.uptime(),
    memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  });
});

// ─── GET /api/metrics — Prometheus exposition (delegated) ────────────────────
// Same prom-client handler as the canonical GET /metrics scrape endpoint —
// single owner of the registry, the exposition format, and the METRICS_TOKEN
// bearer gate (F-A05-2: without METRICS_TOKEN it fails closed in production).
// Reaching it here additionally requires a session because the whole router
// is mounted behind isAuthenticated.
router.get("/", metricsHandler);

export default router;
