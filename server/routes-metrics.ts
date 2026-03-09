/**
 * T180 — API Metrics Routes (Founder-only)
 *
 * Provides operational metrics for monitoring:
 * GET /api/metrics/requests  — recent HTTP request counts by endpoint
 * GET /api/metrics/errors    — recent error counts
 * GET /api/metrics/cache     — cache hit/miss stats
 * GET /api/metrics/summary   — combined summary
 */

import { Router, type Request, type Response } from "express";
import { getCacheStats } from "./middleware/responseCache";

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

export function recordRequest(metric: RequestMetric): void {
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

export default router;
