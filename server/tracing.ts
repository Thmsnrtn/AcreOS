// @ts-nocheck
/**
 * OpenTelemetry Distributed Tracing (T74)
 *
 * Instruments the AcreOS Node.js server with OpenTelemetry for distributed
 * tracing. Supports two export modes via env vars:
 *
 *   OTEL_EXPORTER=otlp         → OTLP HTTP (Honeycomb, Grafana Tempo, Jaeger)
 *   OTEL_EXPORTER=console      → stdout (development/debugging)
 *   OTEL_EXPORTER=none/unset   → no-op (production default if no endpoint set)
 *
 * Required env vars for OTLP:
 *   OTEL_EXPORTER_OTLP_ENDPOINT (e.g. "https://api.honeycomb.io")
 *   OTEL_EXPORTER_OTLP_HEADERS  (e.g. "x-honeycomb-team=<api-key>")
 *
 * Must be called BEFORE any other imports in server/index.ts.
 */

import { NodeTracerProvider } from "@opentelemetry/sdk-trace-base";
import { Resource } from "@opentelemetry/resources";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import {
  SimpleSpanProcessor,
  BatchSpanProcessor,
  ConsoleSpanExporter,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { context, trace, type Tracer } from "@opentelemetry/api";

const SERVICE_NAME = "acreos-server";
const SERVICE_VERSION = process.env.npm_package_version || "0.0.0";

let _tracer: Tracer | null = null;

async function buildExporter(): Promise<SpanExporter | null> {
  const mode = process.env.OTEL_EXPORTER || "none";

  if (mode === "console") {
    return new ConsoleSpanExporter();
  }

  if (
    mode === "otlp" ||
    (mode !== "none" && process.env.OTEL_EXPORTER_OTLP_ENDPOINT)
  ) {
    try {
      // Dynamically import to avoid crashing when package isn't installed
      const { OTLPTraceExporter } = await import(
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        "@opentelemetry/exporter-trace-otlp-http" as any
      );
      const endpoint =
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318";
      const headersRaw = process.env.OTEL_EXPORTER_OTLP_HEADERS || "";
      const headers: Record<string, string> = {};
      for (const part of headersRaw.split(",")) {
        const [k, v] = part.split("=");
        if (k && v) headers[k.trim()] = v.trim();
      }
      console.log(`[Tracing] Using OTLP exporter → ${endpoint}`);
      return new OTLPTraceExporter({ url: `${endpoint}/v1/traces`, headers });
    } catch (err) {
      console.warn(
        "[Tracing] @opentelemetry/exporter-trace-otlp-http not available — falling back to console"
      );
      return new ConsoleSpanExporter();
    }
  }

  return null; // no-op
}

export async function initTracing(): Promise<void> {
  const exporter = await buildExporter();

  if (!exporter) {
    console.log("[Tracing] Tracing disabled (set OTEL_EXPORTER=console|otlp to enable)");
    return;
  }

  const resource = new Resource({
    "service.name": SERVICE_NAME,
    "service.version": SERVICE_VERSION,
    "deployment.environment": process.env.NODE_ENV || "development",
  });

  const provider = new NodeTracerProvider({ resource });

  // Use BatchSpanProcessor for production, Simple for console
  if (exporter instanceof ConsoleSpanExporter) {
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
  } else {
    provider.addSpanProcessor(new BatchSpanProcessor(exporter));
  }

  provider.register();

  registerInstrumentations({
    instrumentations: [
      new HttpInstrumentation({
        // Ignore noisy health check and static asset requests
        ignoreIncomingRequestHook: (req) => {
          const url = req.url ?? "";
          return (
            url === "/health" ||
            url === "/favicon.ico" ||
            url.startsWith("/_")
          );
        },
      }),
      new ExpressInstrumentation(),
    ],
  });

  _tracer = trace.getTracer(SERVICE_NAME, SERVICE_VERSION);

  console.log(`[Tracing] OpenTelemetry tracing initialized (service: ${SERVICE_NAME})`);
}

/**
 * Get the application tracer. Returns a no-op tracer if tracing is not initialized.
 */
export function getTracer(): Tracer {
  return _tracer ?? trace.getTracer(SERVICE_NAME);
}

/**
 * Create a child span within the current active context.
 * Usage:
 *   const span = startSpan("my-operation", { "db.table": "leads" });
 *   try { ... } finally { span.end(); }
 */
export function startSpan(
  name: string,
  attributes?: Record<string, string | number | boolean>
) {
  const tracer = getTracer();
  const span = tracer.startSpan(name, { attributes });
  return span;
}

/**
 * Wrap an async function with a trace span.
 */
export async function traceAsync<T>(
  name: string,
  fn: () => Promise<T>,
  attributes?: Record<string, string | number | boolean>
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(name, { attributes: attributes ?? {} }, async (span) => {
    try {
      const result = await fn();
      span.setStatus({ code: 1 }); // OK
      return result;
    } catch (err: any) {
      span.setStatus({ code: 2, message: err.message }); // ERROR
      span.recordException(err);
      throw err;
    } finally {
      span.end();
    }
  });
}
