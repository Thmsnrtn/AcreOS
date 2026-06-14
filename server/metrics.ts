/**
 * AcreOS Prometheus Exporter (Lens 24).
 *
 * Single registry that backs every operational metric we expose to Grafana
 * Cloud / Prometheus via `GET /metrics`. Built on `prom-client@15` — the
 * canonical Node Prometheus library.
 *
 * Design rules (do NOT violate):
 *   1. NO high-cardinality labels. `route` is normalised to the matched
 *      Express path template (e.g. `/api/leads/:id`), never the raw URL.
 *      No user_id, org_id, lead_id, or anything resembling PII may ever
 *      end up as a label — that's how you destroy a Prometheus instance.
 *   2. NO PII in metric values either. Counters and histograms are pure
 *      numerics. Free-text fields stay in structured logs, not metrics.
 *   3. The `/metrics` endpoint is bearer-gated. Even shape-of-traffic data
 *      is a reconnaissance gift. See `metricsHandler` below.
 *
 * Wire-up:
 *   - `metricsMiddleware` mounts in server/index.ts and records the four
 *     HTTP metrics on every request (count, duration, plus failure /
 *     errors via status).
 *   - `metricsHandler` is the bearer-gated route handler for `/metrics`.
 *   - `recordAiCall`, `recordJobRun`, `recordAiCost`, `recordStripeWebhookFailure`
 *     are called from the relevant services to advance the business
 *     counters. These are fire-and-forget; throwing is a programmer
 *     error, not a runtime expectation.
 *   - DB-pool gauges are sampled lazily on every scrape inside
 *     `metricsHandler`, so we never need a polling job that survives
 *     pool draining at shutdown.
 */

import type { Request, Response, NextFunction } from "express";
import client, {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "prom-client";
import { pool } from "./db";
import { logger } from "./utils/logger";
import { sendError } from "./utils/errors";

// ── Registry ────────────────────────────────────────────────────────────────
// One private registry — we deliberately do NOT use the global default
// because importing tests or sibling modules tend to register conflicting
// metric names, which prom-client throws on. Default-process metrics
// (CPU, GC, event-loop lag, etc.) are attached to this registry so they
// scrape alongside the AcreOS-prefixed ones.

export const registry = new Registry();

collectDefaultMetrics({
  register: registry,
  prefix: "acreos_nodejs_",
});

// ── HTTP metrics ────────────────────────────────────────────────────────────
// Histogram buckets are tuned for an API where the P95 SLO is 500 ms — the
// densest resolution lives between 25 ms and 1 s. Anything above 5 s is
// noise; the +Inf bucket catches the slow tail.

const HTTP_DURATION_BUCKETS_SECONDS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

export const httpRequestsTotal = new Counter({
  name: "acreos_http_requests_total",
  help: "Total HTTP requests handled by Express, labelled by method, normalised route, and status code class.",
  labelNames: ["method", "route", "status"] as const,
  registers: [registry],
});

export const httpRequestDurationSeconds = new Histogram({
  name: "acreos_http_request_duration_seconds",
  help: "HTTP request latency in seconds, labelled by method, normalised route, and status code class.",
  labelNames: ["method", "route", "status"] as const,
  buckets: HTTP_DURATION_BUCKETS_SECONDS,
  registers: [registry],
});

// ── Database pool gauges ────────────────────────────────────────────────────
// These are sampled per-scrape rather than ticked continuously — see
// `metricsHandler` below. Gauges live here so the metric name & shape are
// declared next to the other families.

export const dbPoolIdle = new Gauge({
  name: "acreos_db_pool_idle",
  help: "Number of idle (available) Postgres connections in the primary pool.",
  registers: [registry],
});

export const dbPoolTotal = new Gauge({
  name: "acreos_db_pool_total",
  help: "Total Postgres connections currently held by the primary pool (idle + active).",
  registers: [registry],
});

// ── AI metrics ──────────────────────────────────────────────────────────────
// `tier` here means the routed model tier — typically "haiku" | "sonnet" |
// "opus" — fed in by aiRouter. `agent` is a short tag like "pax_chat",
// "lead_scoring", "cmo_script_gen". Both are bounded by code (compile-time
// strings), so cardinality stays sane.
//
// `category` on the cost counter is the BudgetCategory enum from
// `services/intelligence/budget.ts` — also bounded.

export const aiCallsTotal = new Counter({
  name: "acreos_ai_calls_total",
  help: "Total AI model invocations, labelled by routed model tier and the feature tag of the caller.",
  labelNames: ["tier", "agent"] as const,
  registers: [registry],
});

export const aiCostCentsTotal = new Counter({
  name: "acreos_ai_cost_cents_total",
  help: "Total AI spend in fractional cents, labelled by budget category. Driven by recordSpend() in services/intelligence/budget.ts.",
  labelNames: ["category"] as const,
  registers: [registry],
});

// ── Job metrics ─────────────────────────────────────────────────────────────
// `job_name` is the static name of a scheduled job (e.g. "leadNurturing",
// "outboxDrain"). `status` is "success" | "failed" | "skipped_lock" —
// matches the values written into job_health_logs.

const JOB_DURATION_BUCKETS_SECONDS = [
  0.1, 0.5, 1, 5, 10, 30, 60, 120, 300, 600, 1800,
];

export const jobRunsTotal = new Counter({
  name: "acreos_job_runs_total",
  help: "Total scheduled job runs, labelled by job name and final status.",
  labelNames: ["job_name", "status"] as const,
  registers: [registry],
});

export const jobDurationSeconds = new Histogram({
  name: "acreos_job_duration_seconds",
  help: "Scheduled job run duration in seconds, labelled by job name.",
  labelNames: ["job_name"] as const,
  buckets: JOB_DURATION_BUCKETS_SECONDS,
  registers: [registry],
});

// ── Stripe ──────────────────────────────────────────────────────────────────
// Counted independently of `httpRequestsTotal{status="5xx",route="/api/stripe/webhook"}`
// because some webhook failures are processed-but-failed (the route returns
// 400 due to a bad signature, but Stripe will retry — we want a separate
// alarm channel).

export const stripeWebhookFailedTotal = new Counter({
  name: "acreos_stripe_webhook_failed_total",
  help: "Stripe webhook deliveries that failed signature verification or threw inside the processor. Drives the StripeWebhookFailing alert in docs/slo-monitoring.md.",
  registers: [registry],
});

// ── Public parcel reports (Tier 3A) ─────────────────────────────────────────
// /p/:state/:county/:apn permalinks. `generated` is the cost-bearing event
// (upstream county-GIS + free-geo lookups happen); everything else is a DB
// read. The daily-spike alert in services/publicParcelReport.ts complements
// this counter — the counter is the trend line, the alert is the tripwire.

export const publicParcelReportEventsTotal = new Counter({
  name: "acreos_public_parcel_report_events_total",
  help: "Public /p parcel-report lifecycle events, labelled by event: generated | cache_hit | view | og_image | unavailable | capped. Tier 3A cost-guard telemetry.",
  labelNames: ["event"] as const,
  registers: [registry],
});

// ── Public helpers ──────────────────────────────────────────────────────────
// These are the call-site interface other services should use. Direct
// access to the metric objects above is fine inside this file but the
// helpers carry the documentation on what counts as a valid label.

/** Record one AI model call. Called from ai-telemetry.recordAiCall(). */
export function recordAiCall(tier: string, agent: string): void {
  aiCallsTotal.inc({ tier: safeLabel(tier), agent: safeLabel(agent) });
}

/** Record AI spend. Called from services/intelligence/budget.recordSpend(). */
export function recordAiCost(category: string, cents: number): void {
  if (!Number.isFinite(cents) || cents <= 0) return;
  aiCostCentsTotal.inc({ category: safeLabel(category) }, cents);
}

/**
 * Record one scheduled job run. `durationSeconds` is observed into the
 * duration histogram only on success — failed jobs still increment the
 * counter so on-call can see failure rates, but a 30s timeout on a 5s job
 * would skew the latency distribution.
 */
export function recordJobRun(
  jobName: string,
  status: "success" | "failed" | "skipped_lock",
  durationSeconds: number,
): void {
  const name = safeLabel(jobName);
  jobRunsTotal.inc({ job_name: name, status });
  if (status === "success" && Number.isFinite(durationSeconds) && durationSeconds >= 0) {
    jobDurationSeconds.observe({ job_name: name }, durationSeconds);
  }
}

/** Record a Stripe webhook failure. Called from the webhook route's catch block. */
export function recordStripeWebhookFailure(): void {
  stripeWebhookFailedTotal.inc();
}

// ── Internal helpers ────────────────────────────────────────────────────────

/**
 * Normalise a label value so a typo or external string can't blow up
 * cardinality. Allows letters, numbers, underscore, dash, slash, colon,
 * and period; everything else collapses to "_". Cap at 64 chars.
 */
function safeLabel(value: string | undefined | null): string {
  if (!value) return "unknown";
  return value.replace(/[^a-zA-Z0-9_\-\/:.]/g, "_").slice(0, 64);
}

/**
 * Resolve the lowest-cardinality route key we can. Express populates
 * `req.route?.path` only after the matching layer runs, so we evaluate it
 * inside the `finish` listener. When unavailable (404s, static, middleware
 * early returns), fall back to "unmatched" — never the raw req.path,
 * which would let any URL invent a new label value.
 */
function routeKey(req: Request): string {
  const matched = req.route?.path;
  if (typeof matched === "string" && matched.length > 0) {
    return safeLabel(matched);
  }
  // baseUrl + path catches Express routers (e.g. mounted "/api/metrics")
  // where req.route is on the child router. Still bounded by the route
  // table on disk, not user input.
  const composed = (req.baseUrl || "") + (req.path || "");
  if (composed && composed.length < 80 && !composed.includes(" ")) {
    // Strip numeric IDs and UUIDs so /api/leads/123 → /api/leads/:id
    const normalised = composed
      .replace(/\/\d+(?=\/|$)/g, "/:id")
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, "/:uuid");
    return safeLabel(normalised);
  }
  return "unmatched";
}

/**
 * Compress an HTTP status code into a single label value so we don't
 * register 500-ish distinct labels (200, 201, 204, 301, 302, 400, ...).
 * "2xx" / "3xx" / "4xx" / "5xx" keeps the alert PromQL terse:
 *
 *   rate(acreos_http_requests_total{status="5xx"}[5m])
 *     / rate(acreos_http_requests_total[5m])
 */
function statusClass(status: number): string {
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx";
  if (status >= 300) return "3xx";
  if (status >= 200) return "2xx";
  return "1xx";
}

// ── Middleware ──────────────────────────────────────────────────────────────

/**
 * Express middleware that records HTTP metrics. Drop it in early in the
 * chain so even short-circuited responses (rate limit 429s, etc.) are
 * counted. The `finish` listener runs after the response has been
 * flushed, which is when req.route is reliably populated.
 */
export function metricsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    try {
      const durationNanos = process.hrtime.bigint() - start;
      const seconds = Number(durationNanos) / 1_000_000_000;
      const labels = {
        method: safeLabel(req.method),
        route: routeKey(req),
        status: statusClass(res.statusCode),
      };
      httpRequestsTotal.inc(labels);
      httpRequestDurationSeconds.observe(labels, seconds);
    } catch (err) {
      // Metrics must NEVER break the request path. Swallow + log.
      logger.warn("[metrics] middleware observe failed", {
        metadata: { detail: err instanceof Error ? err.message : String(err) },
      });
    }
  });
  next();
}

// ── /metrics handler ────────────────────────────────────────────────────────

/**
 * Bearer-gated Prometheus scrape handler.
 *
 * Why gate this at all?
 *   - The exposition format leaks every Express route the app has ever
 *     answered, plus the request rate per status code per route. That's
 *     a complete reconnaissance map for any attacker — they learn the
 *     full API surface AND which endpoints are hot enough to be worth
 *     credential-stuffing.
 *   - Business counters (`acreos_ai_cost_cents_total`,
 *     `acreos_ai_calls_total`) expose AI-spend velocity and feature
 *     traffic mix. That's competitive intelligence; never serve it
 *     anonymously.
 *
 * Rationale for the env-var design:
 *   - `METRICS_TOKEN` set → require `Authorization: Bearer <token>`. This
 *     is what production runs.
 *   - `METRICS_TOKEN` unset AND NODE_ENV !== "production" → return
 *     unauthenticated metrics. Lets `curl localhost:5000/metrics` work
 *     during local dev without ceremony.
 *   - `METRICS_TOKEN` unset AND NODE_ENV === "production" → 503. A
 *     misconfigured prod deploy fails closed rather than leaking. See
 *     also `routes-metrics.ts` for the historical version of this
 *     gating logic — the new exporter consolidates both.
 */
export async function metricsHandler(req: Request, res: Response): Promise<void> {
  const expected = process.env.METRICS_TOKEN;

  if (expected) {
    const auth = req.headers.authorization ?? "";
    const presented = typeof auth === "string" && auth.startsWith("Bearer ")
      ? auth.slice(7)
      : "";
    if (presented !== expected) {
      res.set("WWW-Authenticate", 'Bearer realm="acreos-metrics"');
      res.status(401).end();
      return;
    }
  } else if (process.env.NODE_ENV === "production") {
    sendError(res, 503, "METRICS_TOKEN_NOT_SET", "Prometheus exporter is closed in production without METRICS_TOKEN.");
    return;
  }

  // Lazy gauge sampling. Pool counts are cheap getters on the pg.Pool
  // instance; reading them per scrape is preferable to a polling
  // interval that we'd have to clear on shutdown.
  try {
    dbPoolTotal.set(pool.totalCount ?? 0);
    dbPoolIdle.set(pool.idleCount ?? 0);
  } catch {
    // Pool may be draining during graceful shutdown — set to 0 and move
    // on; the scrape is still useful for the other metrics.
    dbPoolTotal.set(0);
    dbPoolIdle.set(0);
  }

  try {
    const body = await registry.metrics();
    res.set("Content-Type", registry.contentType);
    res.send(body);
  } catch (err) {
    logger.error(
      "[metrics] failed to render Prometheus exposition",
      err instanceof Error ? err : undefined,
    );
    res.status(500).end();
  }
}

// ── Test/dev helper ─────────────────────────────────────────────────────────

/**
 * Reset every metric to zero. Tests only — never call from runtime
 * code, you'll lose the running counters. Kept here rather than in a
 * test util so the registry stays encapsulated.
 */
export function __resetMetricsForTesting(): void {
  registry.resetMetrics();
}

// Re-export the prom-client types so callers don't need to import them
// directly when extending the registry.
export type { Counter, Gauge, Histogram, Registry } from "prom-client";
export { client };
