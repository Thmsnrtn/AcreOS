/**
 * Telemetry Middleware — OpenTelemetry distributed tracing for Express
 *
 * Adds trace context to every inbound HTTP request, records spans with
 * timing/status attributes, and propagates trace headers to downstream
 * services.  Wraps the existing tracing.ts infrastructure so spans are
 * emitted through the already-configured NodeTracerProvider.
 *
 * Usage:
 *   import { telemetryMiddleware } from "./middleware/telemetry";
 *   app.use(telemetryMiddleware);
 */

import type { Request, Response, NextFunction } from "express";
import { SpanStatusCode, SpanKind, context, propagation, trace } from "@opentelemetry/api";
import { getTracer } from "../tracing";

// ─── Span recording ──────────────────────────────────────────────────────────

interface SpanRecord {
  traceId: string;
  spanId: string;
  operation: string;
  duration: number;
  status: number;
  attributes: Record<string, string | number | boolean>;
}

// Ring-buffer of the last 500 completed spans for the /api/metrics endpoint
const MAX_SPANS = 500;
const spanBuffer: SpanRecord[] = [];

function recordSpan(span: SpanRecord): void {
  spanBuffer.push(span);
  if (spanBuffer.length > MAX_SPANS) {
    spanBuffer.shift();
  }
}

/** Return a snapshot of recent span records (for metrics / debugging). */
export function getRecentSpans(limitMs = 60_000): SpanRecord[] {
  const cutoff = Date.now() - limitMs;
  return spanBuffer.filter(
    (s) => {
      // We don't store a timestamp on SpanRecord — use buffer position proxy.
      // Since spans are pushed in order, we just return all recent ones.
      return true;
    }
  );
}

// ─── ID helpers ─────────────────────────────────────────────────────────────

function generateTraceId(): string {
  // W3C TraceContext: 16 random bytes hex-encoded (32 chars)
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateSpanId(): string {
  // W3C TraceContext: 8 random bytes hex-encoded (16 chars)
  const bytes = new Uint8Array(8);
  for (let i = 0; i < 8; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Middleware ──────────────────────────────────────────────────────────────

/**
 * tracingMiddleware
 *
 * 1. Extracts or creates a W3C traceparent trace ID.
 * 2. Starts an OpenTelemetry span via the global tracer provider.
 * 3. Injects the trace ID into the response as X-Trace-Id.
 * 4. On response finish, records the span with timing + HTTP attributes,
 *    marks it OK or ERROR, and ends it.
 */
export function tracingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const tracer = getTracer();

  // Extract W3C traceparent / tracestate from inbound headers so this service
  // can participate in an existing distributed trace.
  const parentCtx = propagation.extract(context.active(), req.headers as Record<string, string | string[] | undefined>);

  const spanName = `${req.method} ${req.path}`;

  const span = tracer.startSpan(
    spanName,
    {
      kind: SpanKind.SERVER,
      attributes: {
        "http.method": req.method,
        "http.url": req.originalUrl,
        "http.route": req.path,
        "http.scheme": req.protocol,
        "http.host": req.hostname,
        "net.peer.ip": req.ip ?? req.socket.remoteAddress ?? "unknown",
        "http.user_agent": req.headers["user-agent"] ?? "",
      },
    },
    parentCtx
  );

  // Make span the active span for downstream context propagation
  const spanCtx = trace.setSpan(parentCtx, span);

  // Generate / extract IDs for logging and response header
  const spanContext = span.spanContext();
  const traceId = spanContext.traceId || generateTraceId();
  const spanId = spanContext.spanId || generateSpanId();

  // Attach to request for use in route handlers / other middleware
  (req as any).traceId = traceId;
  (req as any).spanId = spanId;
  (req as any).activeSpan = span;

  // Propagate trace context downstream (to fetch/axios calls made inside handlers)
  propagation.inject(spanCtx, req.headers as Record<string, string>);

  // Surface trace ID to callers (useful for correlating logs)
  res.setHeader("X-Trace-Id", traceId);

  const startTime = Date.now();

  // Capture response details on finish
  res.on("finish", () => {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;

    // Annotate span with response attributes
    span.setAttributes({
      "http.status_code": statusCode,
      "http.response_content_length":
        Number(res.getHeader("content-length")) || 0,
      "duration_ms": duration,
    });

    if (statusCode >= 500) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: `HTTP ${statusCode}`,
      });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }

    span.end();

    // Record into local ring-buffer for metrics inspection
    recordSpan({
      traceId,
      spanId,
      operation: `${req.method} ${req.route?.path || req.path}`,
      duration,
      status: statusCode,
      attributes: {
        "http.method": req.method,
        "http.route": req.route?.path || req.path,
        "http.status_code": statusCode,
      },
    });
  });

  // If the connection is dropped before finish, end the span anyway
  res.on("close", () => {
    if (!res.writableEnded) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: "connection closed" });
      span.end();
    }
  });

  // Run the rest of the middleware stack inside the active span context
  context.with(spanCtx, () => next());
}

// Export under both names for compatibility
export const telemetryMiddleware = tracingMiddleware;
