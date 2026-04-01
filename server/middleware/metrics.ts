import { Request, Response, NextFunction } from "express";

// Simple in-process metrics collector (no external dependency needed)
interface MetricBucket {
  count: number;
  sum: number;        // sum of durations for histograms
  values: number[];   // last N values for percentile calculation
}

class MetricsCollector {
  private counters: Map<string, number> = new Map();
  private histograms: Map<string, MetricBucket> = new Map();
  private gauges: Map<string, number> = new Map();

  incCounter(name: string, labels: Record<string, string> = {}) {
    const key = this.labelKey(name, labels);
    this.counters.set(key, (this.counters.get(key) || 0) + 1);
  }

  observeHistogram(name: string, value: number, labels: Record<string, string> = {}) {
    const key = this.labelKey(name, labels);
    const bucket = this.histograms.get(key) || { count: 0, sum: 0, values: [] };
    bucket.count++;
    bucket.sum += value;
    bucket.values.push(value);
    if (bucket.values.length > 1000) bucket.values = bucket.values.slice(-500);
    this.histograms.set(key, bucket);
  }

  setGauge(name: string, value: number, labels: Record<string, string> = {}) {
    const key = this.labelKey(name, labels);
    this.gauges.set(key, value);
  }

  // Format as Prometheus text exposition
  toPrometheus(): string {
    const lines: string[] = [];

    // Counters
    for (const [key, value] of this.counters) {
      lines.push(`${key} ${value}`);
    }

    // Histograms (expose count, sum, and percentiles as gauges)
    for (const [key, bucket] of this.histograms) {
      lines.push(`${key}_count ${bucket.count}`);
      lines.push(`${key}_sum ${bucket.sum}`);
      if (bucket.values.length > 0) {
        const sorted = [...bucket.values].sort((a, b) => a - b);
        const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
        const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
        const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;
        lines.push(`${key}_p50 ${p50}`);
        lines.push(`${key}_p95 ${p95}`);
        lines.push(`${key}_p99 ${p99}`);
      }
    }

    // Gauges
    for (const [key, value] of this.gauges) {
      lines.push(`${key} ${value}`);
    }

    return lines.join("\n") + "\n";
  }

  private labelKey(name: string, labels: Record<string, string>): string {
    const labelStr = Object.entries(labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(",");
    return labelStr ? `${name}{${labelStr}}` : name;
  }
}

export const metrics = new MetricsCollector();

// Express middleware to track request metrics
export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const route = req.route?.path || req.path;
    const method = req.method;
    const status = String(res.statusCode);
    const statusClass = `${status[0]}xx`;

    metrics.incCounter("acreos_http_requests_total", { method, status: statusClass, route });
    metrics.observeHistogram("acreos_http_request_duration_ms", duration, { method, route });

    if (res.statusCode >= 500) {
      metrics.incCounter("acreos_errors_total", { method, route, status });
    }
  });

  next();
}

// Metrics endpoint handler
export function metricsHandler(_req: Request, res: Response) {
  // Add system metrics
  const mem = process.memoryUsage();
  metrics.setGauge("acreos_memory_heap_used_bytes", mem.heapUsed);
  metrics.setGauge("acreos_memory_heap_total_bytes", mem.heapTotal);
  metrics.setGauge("acreos_memory_rss_bytes", mem.rss);
  metrics.setGauge("acreos_uptime_seconds", process.uptime());

  res.set("Content-Type", "text/plain; charset=utf-8");
  res.send(metrics.toPrometheus());
}
