# Lens 11 -- Observability Engineer Audit

**Auditor persona:** Observability Engineer -- evaluates logging quality, error tracking, metrics, distributed tracing, request correlation, and whether operators can diagnose production issues.

**Date:** 2026-04-15
**Codebase snapshot:** commit ff7b154 (main)

---

## Executive Summary

AcreOS has invested meaningfully in observability scaffolding: a structured JSON logger with request/response middleware, Sentry integration (server + client), OpenTelemetry tracing plumbing, a custom Prometheus-compatible metrics endpoint, correlation ID middleware, PII masking on console output, and documentation for SLOs, monitoring plans, alert rules, and incident response. The bones are good.

However, the infrastructure is **largely unactivated in production**. Sentry DSN and OpenTelemetry exporter are commented out in `.env.example` and `fly-secrets.example`, meaning they almost certainly are not configured in production. The `setSentryUser()` function is defined but never called, so all Sentry errors lack user/org context. Three separate request-ID systems (logger's `requestId`, `correlationId` middleware, and telemetry's `traceId`) coexist but are never unified, making cross-cutting diagnosis impossible. The largest source file (`server/index.ts`, 1900+ lines) uses a legacy `log()` function for 150+ background job messages instead of the structured logger. And there is no log aggregation service configured -- no Fly.io log drain, no Datadog, no Logtail -- meaning structured JSON logs are emitted to stdout and lost when the container restarts.

The net effect: operators today must diagnose production incidents by SSHing into Fly.io and tailing live logs, checking Fly.io's short-lived log buffer, or hoping Sentry caught the error (which it may not, given the DSN may be unset). This is inadequate for a revenue-generating SaaS with 926 API endpoints, 30+ background jobs, and autonomous AI agents making financial decisions.

---

## Findings

### OBS-01: Sentry DSN likely not configured in production (P0)

**Severity:** P0 -- blind to production failures
**Category:** Error tracking

`server/utils/sentry.ts` guards all Sentry calls behind `if (!dsn) return;` and `if (!initialized) return;`. The DSN is read from `process.env.SENTRY_DSN`. In both `.env.example` (line 152) and `fly-secrets.example` (line 61), the SENTRY_DSN is commented out. The client-side equivalent (`VITE_SENTRY_DSN`) is similarly commented out in `.env.example` (line 154).

If SENTRY_DSN is not set in Fly.io secrets, every call to `captureException()`, `setSentryUser()`, and `Sentry.init()` is a silent no-op. The deploy workflow uploads source maps to Sentry with `continue-on-error: true` (`.github/workflows/deploy.yml:92`), meaning source map upload failures are silently swallowed. There is no validation at startup that SENTRY_DSN is actually set and reachable.

**Evidence:**
- `.env.example:152` -- `# SENTRY_DSN=https://...@sentry.io/...`
- `fly-secrets.example:61` -- `# SENTRY_DSN=https://...@sentry.io/...`
- `server/utils/sentry.ts:10-12` -- `if (!dsn) return;`
- `server/utils/validateEnv.ts` -- should be checked for whether SENTRY_DSN is listed as required (it is not referenced in the import at `server/index.ts:27`)
- `.github/workflows/deploy.yml:92` -- `continue-on-error: true` on Sentry source map upload

**Remediation:** Verify SENTRY_DSN is set in Fly.io secrets (`flyctl secrets list`). Add a startup warning (not hard failure) if SENTRY_DSN is missing in production. Remove `continue-on-error` from source map upload or at minimum surface the failure in deploy notifications.

---

### OBS-02: No log aggregation or log drain configured (P0)

**Severity:** P0 -- blind to production failures
**Category:** Log management

The structured logger (`server/utils/logger.ts:61`) correctly emits JSON to stdout in production. However, there is no log drain or log shipping configured. `fly.toml` has no `[log_drain]` section. No Datadog, Logtail, Papertrail, or other log aggregation agent is referenced in the deployment configuration. The monitoring plan (`docs/monitoring-plan.md`) references only `fly logs` (real-time stream) for log inspection.

Fly.io's built-in log buffer retains only a few thousand lines and is not searchable. Structured JSON logs emitted by the logger go to stdout and are effectively lost when containers restart or scale. This means operators cannot search historical logs, correlate errors across time windows, or perform post-mortem analysis beyond what Fly's ephemeral buffer retains.

**Evidence:**
- `fly.toml` -- no log drain configuration
- No Datadog/Logtail/Papertrail agent in `package.json` or deployment config
- `docs/monitoring-plan.md:23` -- monitoring relies on `fly logs` (real-time only)
- `server/utils/logger.ts:57` -- comment references "Datadog, Logtail, etc." as aspirational but not wired

**Remediation:** Configure a Fly.io log drain (`fly logs ship`) to a log aggregation service. Logtail (free tier), Datadog, or Grafana Loki are all compatible with the JSON format already emitted.

---

### OBS-03: `setSentryUser()` is defined but never called (P0)

**Severity:** P0 -- blind to production failures
**Category:** Error tracking context

`server/utils/sentry.ts:51-58` defines `setSentryUser()` which attaches user ID, email, and org ID to Sentry events. However, grep shows **zero call sites** anywhere in the codebase. This means every Sentry error report (if Sentry is configured at all) lacks user and organization context. Operators cannot determine which user or tenant is affected by an error, which is critical for a multi-tenant SaaS.

**Evidence:**
- `server/utils/sentry.ts:51` -- `setSentryUser` is exported
- Grep for `setSentryUser` across the codebase returns only the definition, zero calls
- Neither `hydrateUser` nor `getOrCreateOrg` middleware calls `setSentryUser`

**Remediation:** Call `setSentryUser({ id: req.auth.userId, orgId: req.organizationId })` in the auth middleware chain, ideally in `hydrateUser` or `getOrCreateOrg`.

---

### OBS-04: Three competing request-ID systems, none unified (P1)

**Severity:** P1 -- missing structured logging/tracing
**Category:** Request correlation

There are three independent request identification systems that do not share values:

1. **Logger requestId** (`server/utils/logger.ts:166-170`): Generates `${Date.now()}-${counter}` and sets `X-Request-Id` response header. Stored on `req.requestId` via unsafe cast.
2. **Correlation ID middleware** (`server/middleware/correlationId.ts`): Reads `x-request-id` or `x-correlation-id` from inbound headers or generates `randomUUID()`. Sets `req.correlationId` and `X-Request-ID` response header.
3. **Telemetry traceId** (`server/middleware/telemetry.ts:118`): Uses OpenTelemetry span context `traceId` and sets `X-Trace-Id` response header.

All three set different response headers (two fight over `X-Request-Id`). The logger's `requestId` field is not populated from `correlationId`. The `apiError.ts:23` utility includes `correlationId` in error responses, but the structured logger uses `requestId`. Route handlers use neither.

**Evidence:**
- `server/utils/logger.ts:179` -- `res.setHeader("X-Request-Id", requestId)` using counter-based ID
- `server/middleware/correlationId.ts:15` -- `res.setHeader("X-Request-ID", id)` using UUID
- `server/middleware/telemetry.ts:130` -- `res.setHeader("X-Trace-Id", traceId)` using OTel trace
- `server/utils/apiError.ts:23` -- `requestId: (res.req as any)?.correlationId` (reads correlationId, calls it requestId)
- `req.correlationId` usage count in route files: 0 (only the middleware file uses it)

**Remediation:** Consolidate to a single ID. The correlationId middleware should run first and its value should be used by the logger, telemetry, and Sentry context. Remove the counter-based requestId generator from logger.ts.

---

### OBS-05: OpenTelemetry tracing is disabled by default and not configured in production (P1)

**Severity:** P1 -- missing structured logging/tracing
**Category:** Distributed tracing

`server/tracing.ts:57` defaults to `OTEL_EXPORTER=none` when no env var is set. In `.env.example:259`, all OTEL variables are commented out. The tracing initialization logs "Tracing disabled" and returns early. Without tracing, the telemetry middleware (`server/middleware/telemetry.ts`) creates spans via a no-op tracer that discards all data.

The no-op tracer in `server/tracing.ts:147-161` returns spans whose `isRecording()` returns `false` and whose `end()`, `setAttribute()`, `setStatus()` are all no-ops. The `startSpan()` and `traceAsync()` utility functions are exported but used by **zero** service files (grep for `startSpan|traceAsync` in services returns no matches).

The in-memory ring buffer (`telemetry.ts:31`) collects 500 recent spans but the `getRecentSpans()` filter function at line 43-48 is broken -- it always returns `true` regardless of the `limitMs` parameter, making the time-windowing non-functional.

**Evidence:**
- `.env.example:259` -- `# OTEL_EXPORTER=otlp`
- `server/tracing.ts:57-58` -- `const mode = process.env.OTEL_EXPORTER || "none"`
- `server/tracing.ts:95-98` -- returns early when exporter is null
- `server/middleware/telemetry.ts:43-48` -- `return true` ignores cutoff
- Zero service files import `startSpan` or `traceAsync`

**Remediation:** Enable OTLP exporter in production (set OTEL_EXPORTER and endpoint in Fly secrets). Fix the `getRecentSpans()` filter. Add timestamps to `SpanRecord` so the filter can actually work. Instrument critical service paths (AI calls, DB queries, external APIs) with `traceAsync`.

---

### OBS-06: 150+ background job log messages use legacy `log()` instead of structured logger (P1)

**Severity:** P1 -- missing structured logging/tracing
**Category:** Logging quality

`server/index.ts:81-90` defines a legacy `log(message, source)` function that wraps `logger.info()` but prepends a human-readable timestamp string *inside* the message, producing double-timestamped entries in production JSON output. This function is used 150+ times throughout the 1900-line index.ts file for all background job logging.

Because these calls go through `log()` instead of directly using `logger.info()` with structured metadata, the log entries lack:
- `requestId` / `correlationId`
- `organizationId` (background jobs operate per-org but don't tag it)
- Structured `metadata` fields (job duration, items processed, error counts)
- Proper error objects (errors are stringified: `${err}` loses stack traces)

**Evidence:**
- `server/index.ts:81-90` -- legacy `log()` function
- `server/index.ts:838` -- `log(\`Lead nurturing for org ${org.id}: scored=${result.scored}...\`, 'nurturing')` -- org ID embedded in string, not structured
- `server/index.ts:841` -- `log(\`Lead nurturing error for org ${org.id}: ${err}\`, 'nurturing')` -- error serialized as string, stack trace lost
- 150+ instances across the file

**Remediation:** Replace `log(message, source)` calls with `logger.info(message, { source, organizationId, metadata: { ... } })`. For error cases, use `logger.error(message, err, { source, organizationId })` to preserve stack traces.

---

### OBS-07: Prometheus metrics endpoint and alerting are aspirational, not operational (P1)

**Severity:** P1 -- missing structured logging/tracing
**Category:** Metrics and alerting

Two separate metrics systems exist:

1. `server/middleware/metrics.ts` -- an in-process `MetricsCollector` exposed at `/metrics` via `metricsHandler`
2. `server/routes-metrics.ts` -- a separate in-process metrics store with Prometheus text output exposed at a route-level `/metrics`

Both are in-memory only and reset on restart. The `METRICS_TOKEN` env var required by `routes-metrics.ts:341` is commented out in `.env.example:263`. Without it, the endpoint returns 503.

The `monitoring/prometheus.yml` config references `acreos.fly.dev/metrics` with Bearer auth via a credentials file (`/run/secrets/prometheus_metrics_token`). But there is no evidence of a Prometheus instance running -- no Docker Compose, no Fly.io app for Prometheus, no managed Prometheus service configured. The `monitoring/alert-rules.yml` defines 10 alert rules referencing metrics like `acreos_http_errors_total`, `acreos_requests_total`, and `acreos_cache_hits_total`, but some of these metric names don't match the actual metrics emitted (e.g., the middleware emits `acreos_http_requests_total` but the alert references `acreos_requests_total`).

The Grafana dashboard JSON (`monitoring/grafana-dashboard.json`) exists but references the same mismatched metric names.

**Evidence:**
- `.env.example:263` -- `# METRICS_TOKEN=...`
- `server/routes-metrics.ts:340-343` -- returns 503 when METRICS_TOKEN is unset
- `monitoring/alert-rules.yml:16` -- references `acreos_requests_total`, but `server/middleware/metrics.ts:88` emits `acreos_http_requests_total`
- `monitoring/alert-rules.yml:131` -- references `acreos_cache_hits_total` and `acreos_cache_misses_total` which are not emitted by any code
- No Prometheus deployment configuration found

**Remediation:** Deploy a Prometheus instance (Fly.io app or Grafana Cloud free tier). Set METRICS_TOKEN in Fly secrets. Reconcile metric names between emitter code and alert rules. Consider using the prom-client npm package for standard Prometheus client instrumentation instead of two custom implementations.

---

### OBS-08: Sentry `expressErrorHandler()` registered in wrong position (P1)

**Severity:** P1 -- missing structured logging/tracing
**Category:** Error tracking

`server/index.ts:248-250` registers `Sentry.expressErrorHandler()` *before* routes are mounted. Express error handlers (4-arity middleware) only fire when errors are passed via `next(err)` from downstream handlers. Placing it before routes means it intercepts nothing. A second registration at `server/index.ts:429` is correctly placed after `registerRoutes()` and `errorLoggingMiddleware`.

The first registration is dead code that gives a false sense of coverage. (This was also noted in the staff-backend audit lens 03, finding BE-08.)

**Evidence:**
- `server/index.ts:247-250` -- first registration, before routes
- `server/index.ts:427-430` -- second registration, after routes (correct)

**Remediation:** Remove the first `Sentry.expressErrorHandler()` registration at line 249.

---

### OBS-09: Client-side error boundary generates local-only error IDs (P2)

**Severity:** P2 -- improvement
**Category:** Error correlation

`client/src/components/error-boundary.tsx:20` generates error IDs using `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`. These IDs are shown to the user in the UI but are not sent to any backend endpoint. They are forwarded to Sentry as `extra.errorId`, but since Sentry may not be configured (OBS-01), they exist only in the browser console.

If a user reports "Error ID: err_1713200000000_abc123def", operators have no way to look it up without searching Sentry (if configured) or asking the user for reproduction steps.

**Evidence:**
- `client/src/components/error-boundary.tsx:20-21` -- local-only error ID generation
- `client/src/components/error-boundary.tsx:38-44` -- sent to Sentry only
- No API call to persist the error report server-side

**Remediation:** Either POST the error report to a backend endpoint (e.g., `/api/errors/report`) or ensure Sentry is reliably configured so error IDs are searchable.

---

### OBS-10: Debug-level logs silently dropped in production (P2)

**Severity:** P2 -- improvement
**Category:** Logging quality

`server/utils/logger.ts:90-93` suppresses all `debug` level logs in production (`if (!IS_PRODUCTION) { console.debug(line); }`). While this is a common pattern, there is no way to dynamically enable debug logging in production for troubleshooting without redeploying with `NODE_ENV=development` (which changes many other behaviors).

The logger has no concept of a log level threshold (e.g., `LOG_LEVEL=debug`) that could be set via environment variable to temporarily increase verbosity.

**Evidence:**
- `server/utils/logger.ts:89-93` -- hard-coded `IS_PRODUCTION` check

**Remediation:** Add a `LOG_LEVEL` environment variable (default: `info` in production, `debug` in development) and check it instead of `IS_PRODUCTION`. This allows operators to set `LOG_LEVEL=debug` in Fly secrets for temporary diagnostics.

---

### OBS-11: Two duplicate error response utilities coexist (P2)

**Severity:** P2 -- improvement
**Category:** Logging quality

Two error response utilities exist:

1. `server/utils/errors.ts` -- the standard `Errors.*` helpers referenced in CLAUDE.md
2. `server/utils/apiError.ts` -- an alternative set (`apiError()`, `notFound()`, `internalError()`, etc.)

They produce different response shapes. `errors.ts` produces `{ error, message, details, statusCode }`. `apiError.ts` produces `{ code, message, retryable, details, requestId }`. The `apiError.ts` version includes `requestId` (from `correlationId`) while `errors.ts` does not include any request identifier.

This means some error responses include correlation context and some do not, making it harder for operators to trace errors back to specific requests.

**Evidence:**
- `server/utils/errors.ts` -- `{ error, message, details, statusCode }` shape
- `server/utils/apiError.ts` -- `{ code, message, retryable, details, requestId }` shape
- `apiError.ts:23` -- includes `requestId: (res.req as any)?.correlationId`
- `errors.ts` -- no request ID in response

**Remediation:** Consolidate to a single error response utility. Add `requestId` from the correlation middleware to all error responses so operators can tie client-reported errors to server logs.

---

### OBS-12: Health check endpoint does not gate on critical services (P2)

**Severity:** P2 -- improvement
**Category:** Health monitoring

The health check at `/api/health` calls `healthCheckService.checkAll()` which probes Stripe, OpenAI, Twilio, Redis, and other services. However, the endpoint always returns a 200 status code regardless of health status (see `server/routes.ts:346-348`). The catch block returns `{ overall: "degraded" }` with 200. Fly.io's health checks and the deploy workflow's post-deploy curl (`deploy.yml:113`) use `--fail` which only triggers on HTTP 4xx/5xx.

This means if the database is unreachable or Redis is missing (which orientation notes as a known issue), the health check still returns 200 and the deploy is considered successful.

Additionally, the health check probes external APIs (OpenAI, Stripe) on every invocation, adding latency and potential for rate limiting. The cached variant (`/api/health/cached`) mitigates this but is not used by the deploy pipeline.

**Evidence:**
- `server/routes.ts:342-349` -- always returns 200
- `.github/workflows/deploy.yml:113` -- `curl --fail` only catches non-200
- Orientation doc: "Redis package missing -- health check shows degraded"

**Remediation:** Return 503 when `overall` is `"unavailable"`. Use `/api/health/cached` in the deploy pipeline. Separate liveness checks (database only) from readiness checks (all dependencies).

---

### OBS-13: PII masking regex has false-positive risk on numeric data (P2)

**Severity:** P2 -- improvement
**Category:** Log quality

`server/middleware/piiMasking.ts` patches all console methods to mask phone numbers, SSNs, emails, and credit cards. The SSN pattern (`\b(\d{3})[.\-\s]?(\d{2})[.\-\s]?(\d{4})\b`) and credit card pattern can match legitimate numeric data such as property parcel IDs (e.g., `123-45-6789`), property prices, and internal reference numbers.

For a land investing platform where parcel numbers, tax IDs, and property identifiers are routinely logged, false positives could obscure critical diagnostic data. There is no allowlist mechanism or contextual awareness.

**Evidence:**
- `server/middleware/piiMasking.ts:33` -- SSN regex matches 9-digit sequences with separators
- `server/middleware/piiMasking.ts:38` -- CC regex matches 13-19 digit sequences
- Land investing domain routinely uses parcel IDs like `012-345-6789`

**Remediation:** Add a contextual allowlist for known safe patterns (parcel IDs, internal IDs). Consider applying PII masking only to specific log fields rather than all console output.

---

### OBS-14: No database query logging or slow query alerts in application layer (P2)

**Severity:** P2 -- improvement
**Category:** Database observability

`server/db.ts` configures a `statement_timeout` of 30s and comments mention "Slow query monitoring" (Task T2), but Drizzle ORM is initialized without query logging enabled. There is no application-level instrumentation to log queries, their durations, or the endpoints that triggered them. The `db.ts` comment at line 1 references slow query monitoring but no implementation exists.

PostgreSQL-level `log_min_duration_statement` may be configured at the Fly Postgres level, but those logs are separate from application logs and not correlated with request IDs.

**Evidence:**
- `server/db.ts:1-12` -- comments reference "Slow Query Monitoring" but no logger integration
- `drizzle(pool, { schema })` -- no `logger` option passed to Drizzle
- No `pool.on('query')` or similar event listener for query timing

**Remediation:** Enable Drizzle's built-in logger (`drizzle(pool, { schema, logger: true })`) or add a custom logger that records query duration and tags it with the active request's correlation ID. Alert on queries exceeding a threshold (e.g., 1s).

---

### OBS-15: Background jobs lack structured outcome reporting (P2)

**Severity:** P2 -- improvement
**Category:** Job observability

Background jobs (30+ registered in `server/index.ts`) store health records in the `jobHealthLogs` table (lines 110-114), which includes `jobName`, `runStartedAt`, `runCompletedAt`, `durationMs`, and status. However, there is no dashboard, alert, or Prometheus metric exposing job health. The `jobSupervisor` service is imported and started (line 764) but its monitoring data is not exposed to the metrics endpoint.

Job failures are logged via the legacy `log()` function (OBS-06), losing structured metadata. There are no alerts for job failures -- a background job could silently fail for days without triggering any notification.

**Evidence:**
- `server/index.ts:110-114` -- job health logs stored in DB
- `server/index.ts:764` -- job supervisor started but metrics not exported
- No Prometheus counter for `acreos_job_failures_total` or similar
- No alert rule for job health in `monitoring/alert-rules.yml`

**Remediation:** Export job health metrics (run count, failure count, duration histogram) via the Prometheus endpoint. Add alert rules for job failures. Surface job health in the founder dashboard.

---

### OBS-16: No alerting pipeline connected (P2)

**Severity:** P2 -- improvement
**Category:** Alerting

`monitoring/prometheus.yml:30` references `alertmanager:9093` for routing alerts. `docs/slo-monitoring.md:137-139` references PagerDuty and Slack `#alerts-production` as alert channels. However, there is no Alertmanager deployment configuration, no PagerDuty integration configuration, and no Slack webhook URL configured anywhere in the codebase or secrets examples.

The monitoring plan (`docs/monitoring-plan.md`) describes alert thresholds and escalation policies, but these exist only as documentation. No automated alerting is operational.

**Evidence:**
- `monitoring/prometheus.yml:31` -- `alertmanager:9093` with no corresponding deployment
- `docs/slo-monitoring.md:137-139` -- references PagerDuty and Slack with no configuration
- No `PAGERDUTY_*` or `SLACK_WEBHOOK*` variables in `.env.example` or `fly-secrets.example`
- `docs/INCIDENT_RESPONSE.md:67` -- "Legal Counsel: TBD" suggests operational tooling is not fully stood up

**Remediation:** Deploy Alertmanager (or use Grafana Cloud Alerting). Configure at minimum one notification channel (Slack webhook or PagerDuty) for critical alerts. The monitoring documentation is thorough; it just needs to be implemented.

---

## Summary Table

| ID | Finding | Severity | Category |
|----|---------|----------|----------|
| OBS-01 | Sentry DSN likely not configured in production | P0 | Error tracking |
| OBS-02 | No log aggregation or log drain configured | P0 | Log management |
| OBS-03 | `setSentryUser()` defined but never called | P0 | Error tracking context |
| OBS-04 | Three competing request-ID systems, none unified | P1 | Request correlation |
| OBS-05 | OpenTelemetry tracing disabled, not configured, no service adoption | P1 | Distributed tracing |
| OBS-06 | 150+ background job logs use legacy `log()`, losing structure | P1 | Logging quality |
| OBS-07 | Prometheus metrics + alerting are aspirational, not operational | P1 | Metrics and alerting |
| OBS-08 | Sentry error handler registered in wrong position | P1 | Error tracking |
| OBS-09 | Client error boundary generates local-only error IDs | P2 | Error correlation |
| OBS-10 | Debug logs hard-suppressed in production, no dynamic log level | P2 | Logging quality |
| OBS-11 | Two duplicate error response utilities with different shapes | P2 | Logging quality |
| OBS-12 | Health check always returns 200, deploy gate is ineffective | P2 | Health monitoring |
| OBS-13 | PII masking regex false-positives on numeric domain data | P2 | Log quality |
| OBS-14 | No database query logging or slow query instrumentation | P2 | Database observability |
| OBS-15 | Background jobs lack structured outcome reporting and alerts | P2 | Job observability |
| OBS-16 | No alerting pipeline connected (Alertmanager, PagerDuty, Slack) | P2 | Alerting |

---

## What Works Well

1. **Structured logger design** (`server/utils/logger.ts`) -- JSON output in production, human-readable in dev, with proper level routing and error serialization. The interface supports `requestId`, `userId`, `organizationId`, and arbitrary metadata.

2. **PII masking** (`server/middleware/piiMasking.ts`) -- Console output is intercepted and PII patterns (phone, email, SSN, credit card) are masked before reaching stdout. This is a strong privacy safeguard despite the false-positive risk noted in OBS-13.

3. **Sentry integration design** -- Server and client Sentry initialization strips sensitive headers (`cookie`, `authorization`, `x-csrf-token`). Session replay is configured at 10% baseline / 100% on error. Source map upload is integrated into the deploy pipeline.

4. **Health check service** -- Comprehensive probes for Stripe, OpenAI, Twilio, Redis, and database. Cached variant avoids hammering external services. Per-service health check endpoint exists.

5. **Monitoring documentation** -- `docs/monitoring-plan.md`, `docs/slo-monitoring.md`, `docs/INCIDENT_RESPONSE.md`, runbooks, and alert rules are thorough and well-structured. The SLO targets are reasonable for the scale.

6. **Metrics middleware** -- Both `server/middleware/metrics.ts` and `server/routes-metrics.ts` collect request counts, durations, error rates, and system metrics in Prometheus text format with proper histograms and percentile calculation.

7. **Unhandled error safety nets** -- `server/index.ts:45-61` catches `unhandledRejection` and `uncaughtException`, logs them, and forwards to Sentry with graceful shutdown on fatal errors.
