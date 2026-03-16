/**
 * T180 — API Metrics Routes (Founder-only)
 *
 * Provides operational metrics for monitoring:
 * GET /api/metrics/requests  — recent HTTP request counts by endpoint
 * GET /api/metrics/errors    — recent error counts
 * GET /api/metrics/cache     — cache hit/miss stats
 * GET /api/metrics/summary   — combined summary
 * GET /metrics               — Prometheus text format scrape endpoint
 *
 * Business counters (incremented via exported helpers):
 *   incrementDealsCreated()
 *   incrementCallsMade()
 *   incrementValuationsRequested()
 *   incrementMarketplaceTransactions()
 *   incrementErrors(path, statusCode)
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

// ─── Prometheus-compatible counters & gauges ──────────────────────────────────

// Business event counters
let dealsCreatedTotal = 0;
let callsMadeTotal = 0;
let valuationsRequestedTotal = 0;
let marketplaceTransactionsTotal = 0;

// Error counter: map of "path:statusCode" → count
const errorCounters = new Map<string, number>();

// Active connections gauge (incremented/decremented externally or derived)
let activeConnectionsGauge = 0;

// HTTP request duration histogram buckets (ms)
const DURATION_BUCKETS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

// Histogram state: bucket → cumulative count
const durationBuckets = new Map<number, number>(
  DURATION_BUCKETS.map((b) => [b, 0])
);
let durationSum = 0;
let durationCount = 0;

/** Record a request duration into the histogram. */
function observeDuration(ms: number): void {
  durationSum += ms;
  durationCount++;
  for (const bucket of DURATION_BUCKETS) {
    if (ms <= bucket) {
      durationBuckets.set(bucket, (durationBuckets.get(bucket) ?? 0) + 1);
    }
  }
}

// ─── Public increment helpers ─────────────────────────────────────────────────

export function incrementDealsCreated(count = 1): void {
  dealsCreatedTotal += count;
}

export function incrementCallsMade(count = 1): void {
  callsMadeTotal += count;
}

export function incrementValuationsRequested(count = 1): void {
  valuationsRequestedTotal += count;
}

export function incrementMarketplaceTransactions(count = 1): void {
  marketplaceTransactionsTotal += count;
}

export function incrementErrors(path: string, statusCode: number): void {
  const key = `${path}:${statusCode}`;
  errorCounters.set(key, (errorCounters.get(key) ?? 0) + 1);
}

export function setActiveConnections(count: number): void {
  activeConnectionsGauge = count;
}

// ─── Enhanced recordRequest that also feeds Prometheus buckets ────────────────

const _originalRecordRequest = recordRequest;

// Monkey-patch to also update histogram on every request recorded
export function recordRequestWithMetrics(metric: RequestMetric): void {
  recentRequests.push(metric);
  if (recentRequests.length > MAX_METRICS) {
    recentRequests.shift();
  }
  observeDuration(metric.durationMs);
  if (metric.statusCode >= 400) {
    incrementErrors(metric.path, metric.statusCode);
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

// ─── Prometheus text format helpers ──────────────────────────────────────────

function promComment(help: string, type: string, name: string): string {
  return `# HELP ${name} ${help}\n# TYPE ${name} ${type}`;
}

function promCounter(name: string, value: number, labels: Record<string, string> = {}): string {
  const labelStr = Object.entries(labels)
    .map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`)
    .join(",");
  const metric = labelStr ? `${name}{${labelStr}}` : name;
  return `${metric} ${value}`;
}

function promGauge(name: string, value: number, labels: Record<string, string> = {}): string {
  return promCounter(name, value, labels);
}

function buildPrometheusOutput(): string {
  const lines: string[] = [];
  const ts = Date.now();

  // ── HTTP request duration histogram ──────────────────────────────────────
  lines.push(promComment("HTTP request duration in milliseconds", "histogram", "http_request_duration_ms"));
  let cumulativeCount = 0;
  for (const bucket of DURATION_BUCKETS) {
    const count = durationBuckets.get(bucket) ?? 0;
    cumulativeCount += count;
    lines.push(`http_request_duration_ms_bucket{le="${bucket}"} ${cumulativeCount}`);
  }
  lines.push(`http_request_duration_ms_bucket{le="+Inf"} ${durationCount}`);
  lines.push(`http_request_duration_ms_sum ${durationSum}`);
  lines.push(`http_request_duration_ms_count ${durationCount}`);
  lines.push("");

  // ── Business counters ─────────────────────────────────────────────────────
  lines.push(promComment("Total number of deals created", "counter", "deals_created_total"));
  lines.push(promCounter("deals_created_total", dealsCreatedTotal));
  lines.push("");

  lines.push(promComment("Total number of voice calls made", "counter", "calls_made_total"));
  lines.push(promCounter("calls_made_total", callsMadeTotal));
  lines.push("");

  lines.push(promComment("Total number of AVM valuations requested", "counter", "valuations_requested_total"));
  lines.push(promCounter("valuations_requested_total", valuationsRequestedTotal));
  lines.push("");

  lines.push(promComment("Total number of marketplace transactions", "counter", "marketplace_transactions_total"));
  lines.push(promCounter("marketplace_transactions_total", marketplaceTransactionsTotal));
  lines.push("");

  // ── Active connections gauge ──────────────────────────────────────────────
  lines.push(promComment("Number of currently active HTTP connections", "gauge", "active_connections"));
  lines.push(promGauge("active_connections", activeConnectionsGauge));
  lines.push("");

  // ── Error rate counters ───────────────────────────────────────────────────
  lines.push(promComment("Total HTTP errors by path and status code", "counter", "http_errors_total"));
  for (const [key, count] of errorCounters.entries()) {
    const colonIdx = key.lastIndexOf(":");
    const path = key.substring(0, colonIdx);
    const status = key.substring(colonIdx + 1);
    lines.push(promCounter("http_errors_total", count, { path, status_code: status }));
  }
  lines.push("");

  // ── Process metrics ───────────────────────────────────────────────────────
  const mem = process.memoryUsage();
  lines.push(promComment("Process heap used in bytes", "gauge", "process_heap_used_bytes"));
  lines.push(promGauge("process_heap_used_bytes", mem.heapUsed));
  lines.push("");

  lines.push(promComment("Process heap total in bytes", "gauge", "process_heap_total_bytes"));
  lines.push(promGauge("process_heap_total_bytes", mem.heapTotal));
  lines.push("");

  lines.push(promComment("Process RSS memory in bytes", "gauge", "process_rss_bytes"));
  lines.push(promGauge("process_rss_bytes", mem.rss));
  lines.push("");

  lines.push(promComment("Process uptime in seconds", "counter", "process_uptime_seconds"));
  lines.push(promCounter("process_uptime_seconds", Math.floor(process.uptime())));
  lines.push("");

  // ── Cache metrics ─────────────────────────────────────────────────────────
  const cacheStats = getCacheStats();
  lines.push(promComment("Response cache current size", "gauge", "response_cache_size"));
  lines.push(promGauge("response_cache_size", cacheStats.size));
  lines.push("");

  lines.push(promComment("Response cache max capacity", "gauge", "response_cache_max_size"));
  lines.push(promGauge("response_cache_max_size", cacheStats.maxSize));
  lines.push("");

  // ── Recent request window metrics ─────────────────────────────────────────
  const last5min = getWindowedMetrics(5 * 60 * 1000);
  lines.push(promComment("HTTP requests in last 5 minutes", "gauge", "http_requests_last5m"));
  lines.push(promGauge("http_requests_last5m", last5min.length));
  lines.push("");

  const errorCount5m = last5min.filter(r => r.statusCode >= 400).length;
  lines.push(promComment("HTTP errors in last 5 minutes", "gauge", "http_errors_last5m"));
  lines.push(promGauge("http_errors_last5m", errorCount5m));
  lines.push("");

  return lines.join("\n");
}

// ─── GET /metrics — Prometheus scrape endpoint ────────────────────────────────
// Mount this at the app level (not under /api prefix) so Prometheus can reach it.
// Usage in app: app.use(metricsRouter) — exposes GET /metrics
//
// F-A05-2: Require Bearer token matching METRICS_TOKEN env var.
// Without METRICS_TOKEN set the endpoint is disabled (503) to prevent
// accidental exposure in misconfigured deployments.
router.get("/", (req: Request, res: Response) => {
  const metricsToken = process.env.METRICS_TOKEN;
  if (!metricsToken) {
    return res.status(503).json({ error: "Metrics endpoint not configured" });
  }

  const authHeader = req.headers["authorization"] || "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (provided !== metricsToken) {
    res.set("WWW-Authenticate", 'Bearer realm="AcreOS Metrics"');
    return res.status(401).json({ error: "Unauthorized" });
  }

  res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.send(buildPrometheusOutput());
});

export default router;
