/**
 * HTTP metrics middleware — an alias for the canonical implementation in
 * server/metrics.ts, which is the single owner of every Prometheus metric
 * family, the registry, and the bearer-gated GET /metrics handler.
 *
 * History (consolidation 2026-08-16, founder-approved): this file used to
 * hold a hand-rolled metrics collector plus its own /metrics handler. That
 * handler was gated on an env var name no operator doc mentioned — every doc
 * (.env.example, docs/deployment-checklist.md) says METRICS_TOKEN — so a
 * documented production deploy 404'd the scrape. Its exposition was also
 * malformed Prometheus text (`name{labels}_count` — suffixes AFTER the label
 * braces — aborts the whole scrape on parse; no # HELP/# TYPE) and it
 * measured durations in milliseconds where the canonical histogram is
 * seconds. All of that is gone: the middleware below records into the
 * prom-client registry (acreos_http_requests_total +
 * acreos_http_request_duration_seconds, bounded route labels), and
 * server/index.ts mounts `metricsHandler` from server/metrics.ts — which
 * reads the documented METRICS_TOKEN — at GET /metrics.
 */

export { metricsMiddleware } from "../metrics";
