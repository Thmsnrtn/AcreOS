import type { Request, Response, NextFunction } from "express";
import { randomBytes, randomUUID } from "crypto";
import { withTraceContext } from "../utils/traceContext";

// ─── L4: W3C Trace Context propagation ───────────────────────────────────────
//
// In addition to the existing `correlationId` (an opaque per-request UUID we
// emit as `X-Request-ID`), the request now also carries a W3C-spec
// `traceparent`. Both ride together: the correlationId stays the human-
// readable identifier we paste into log filters, the traceparent is the
// cross-service / cross-vendor trace identifier (compatible with OTel,
// Datadog, Honeycomb, etc).
//
// W3C spec: https://www.w3.org/TR/trace-context/
//   traceparent = version-traceId-parentId-flags
//                  "00"  16-byte  8-byte    1-byte
//                        (hex)    (hex)     (hex)
//   e.g. 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
//
// If the incoming request already has a `traceparent` header (typical for
// in-mesh requests or requests coming through a tracing-aware reverse
// proxy), we adopt its trace_id and generate a fresh span_id for *this*
// hop. Otherwise we mint a brand-new one.

declare global {
  namespace Express {
    interface Request {
      correlationId: string;
      /** W3C-spec traceparent header for this request. Always set. */
      traceparent: string;
      /** 16-byte hex trace_id parsed from traceparent. */
      traceId: string;
      /** 8-byte hex span_id parsed from traceparent (this hop's span). */
      spanId: string;
    }
  }
}

const TRACEPARENT_RE = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;

function genTraceId(): string {
  return randomBytes(16).toString("hex");
}

function genSpanId(): string {
  return randomBytes(8).toString("hex");
}

/**
 * Parse a candidate traceparent header. Returns a normalised W3C-spec
 * traceparent that re-uses the inbound trace_id but always mints a fresh
 * span_id for this hop (we are the current span; the inbound span_id
 * becomes our `parent_id` if downstream tooling cares — for now we don't
 * propagate parent because we don't yet emit OTel spans).
 *
 * Returns null when the header is missing or malformed.
 */
export function parseTraceparent(input: string | undefined | null): {
  version: string;
  traceId: string;
  parentSpanId: string;
  flags: string;
} | null {
  if (!input) return null;
  const m = TRACEPARENT_RE.exec(input.trim());
  if (!m) return null;
  const [, version, traceId, parentSpanId, flags] = m;
  // Reject the all-zero trace_id / span_id per spec §3.2.2.3.
  if (/^0+$/.test(traceId) || /^0+$/.test(parentSpanId)) return null;
  // Reject unsupported versions (spec §3.2.2.1: only "00" is defined).
  if (version === "ff") return null;
  return { version, traceId, parentSpanId, flags };
}

/**
 * Build a W3C-spec traceparent string. Always uses version "00" and
 * sampled-flag "01" (we don't yet support unsampled trace propagation
 * because every request is logged regardless).
 */
export function formatTraceparent(traceId: string, spanId: string, flags = "01"): string {
  return `00-${traceId}-${spanId}-${flags}`;
}

export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const id = (req.headers["x-request-id"] as string) || (req.headers["x-correlation-id"] as string) || randomUUID();
  req.correlationId = id;
  res.setHeader("X-Request-ID", id);

  // L4 — W3C traceparent propagation.
  const incoming = parseTraceparent(req.headers["traceparent"] as string | undefined);
  const traceId = incoming?.traceId ?? genTraceId();
  const spanId = genSpanId();
  const flags = incoming?.flags ?? "01";
  const traceparent = formatTraceparent(traceId, spanId, flags);

  req.traceparent = traceparent;
  req.traceId = traceId;
  req.spanId = spanId;
  res.setHeader("traceparent", traceparent);

  // Open an AsyncLocalStorage context so logger + outboundFetch can read
  // the trace ids without each call site threading the request through.
  withTraceContext({ correlationId: id, traceId, spanId, traceparent }, () => {
    next();
  });
}
