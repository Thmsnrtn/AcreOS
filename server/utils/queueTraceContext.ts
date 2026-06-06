/**
 * queueTraceContext — W3C traceparent propagation across async queues (L4).
 *
 * The inbound-request middleware (`correlationIdMiddleware`) establishes a
 * W3C `traceparent` and exposes it via AsyncLocalStorage
 * (`currentTraceContext`). The structured logger + `outboundFetch` already
 * read that context so log lines and outbound HTTP calls continue the same
 * trace.
 *
 * BUT when a request enqueues async work — an `outbox` row consumed by the
 * worker process, a job consumed on the next tick — the trace context is
 * lost: the consumer runs in a different turn of the event loop (or a
 * different Fly machine entirely) where the AsyncLocalStorage store is
 * empty. The async work appears as an orphan trace, disconnected from the
 * request that scheduled it.
 *
 * This module closes that gap:
 *
 *   stampTraceContext(payload)
 *     Called at ENQUEUE time. Reads the current trace context (if any) and
 *     embeds the `traceparent` under a reserved `_trace` envelope key in the
 *     payload. No-op when there is no active trace context (boot, scheduled
 *     ticks with no upstream request) — the payload is returned unchanged.
 *
 *   runWithRestoredTraceContext(payload, fn)
 *     Called on the CONSUMER side. Parses the embedded `traceparent`, opens a
 *     fresh AsyncLocalStorage trace context that re-uses the upstream
 *     trace_id (and mints a new span_id for this consumer hop), and runs `fn`
 *     inside it. When the payload carries no trace envelope, `fn` runs with a
 *     freshly-minted trace context so consumer work is always traceable.
 *
 * The envelope key is `_trace` and is intentionally underscore-prefixed +
 * non-colliding with business fields. `stripTraceEnvelope` is provided for
 * the rare consumer that wants the original payload shape back.
 */

import { randomBytes } from "crypto";
import { currentTraceContext, withTraceContext, type TraceCtx } from "./traceContext";
import { parseTraceparent, formatTraceparent } from "../middleware/correlationId";

/** Reserved envelope key embedded into queue payloads. */
export const TRACE_ENVELOPE_KEY = "_trace" as const;

export interface QueueTraceEnvelope {
  /** W3C traceparent string of the enqueuing hop. */
  traceparent: string;
  /** Opaque per-request correlation id (X-Request-ID), when present. */
  correlationId?: string;
}

function genTraceId(): string {
  return randomBytes(16).toString("hex");
}

function genSpanId(): string {
  return randomBytes(8).toString("hex");
}

/**
 * Embed the current trace context into a queue payload at enqueue time.
 *
 * Returns a shallow copy of `payload` with a `_trace` envelope added when a
 * trace context is active; otherwise returns `payload` unchanged. Never
 * throws — propagation is best-effort observability, never a hard dependency
 * of the enqueue path.
 */
export function stampTraceContext<T extends Record<string, unknown>>(payload: T): T {
  try {
    const ctx = currentTraceContext();
    if (!ctx) return payload;
    const envelope: QueueTraceEnvelope = {
      traceparent: ctx.traceparent,
      ...(ctx.correlationId ? { correlationId: ctx.correlationId } : {}),
    };
    return { ...payload, [TRACE_ENVELOPE_KEY]: envelope } as T;
  } catch {
    return payload;
  }
}

/** Read the embedded trace envelope from a queue payload, if present + valid. */
export function readTraceEnvelope(
  payload: Record<string, unknown> | null | undefined,
): QueueTraceEnvelope | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = (payload as Record<string, unknown>)[TRACE_ENVELOPE_KEY];
  if (!raw || typeof raw !== "object") return null;
  const tp = (raw as Record<string, unknown>).traceparent;
  if (typeof tp !== "string" || parseTraceparent(tp) === null) return null;
  const correlationId = (raw as Record<string, unknown>).correlationId;
  return {
    traceparent: tp,
    ...(typeof correlationId === "string" ? { correlationId } : {}),
  };
}

/**
 * Return a copy of `payload` with the `_trace` envelope removed. Useful for
 * consumers that pass the payload to a strict schema validator. Returns the
 * input unchanged when no envelope is present.
 */
export function stripTraceEnvelope<T extends Record<string, unknown>>(payload: T): T {
  if (!payload || typeof payload !== "object" || !(TRACE_ENVELOPE_KEY in payload)) {
    return payload;
  }
  const copy = { ...payload };
  delete (copy as Record<string, unknown>)[TRACE_ENVELOPE_KEY];
  return copy as T;
}

/**
 * Build the consumer-side trace context from an enqueued payload.
 *
 * If the payload carries a valid `_trace` envelope, the returned context
 * re-uses the upstream trace_id (continuing the same distributed trace) and
 * mints a fresh span_id for this consumer hop. Otherwise a brand-new trace
 * context is generated so consumer work is always traceable.
 */
export function buildConsumerTraceContext(
  payload: Record<string, unknown> | null | undefined,
): TraceCtx {
  const envelope = readTraceEnvelope(payload);
  const parsed = envelope ? parseTraceparent(envelope.traceparent) : null;
  const traceId = parsed?.traceId ?? genTraceId();
  const spanId = genSpanId();
  const flags = parsed?.flags ?? "01";
  const traceparent = formatTraceparent(traceId, spanId, flags);
  const correlationId = envelope?.correlationId ?? traceId;
  return { correlationId, traceId, spanId, traceparent };
}

/**
 * Run `fn` inside a trace context restored from the enqueued payload. The
 * structured logger + outboundFetch will then stamp the SAME trace_id onto
 * consumer log lines + downstream HTTP calls, so the async work shows up as a
 * continuation of the request that scheduled it.
 */
export function runWithRestoredTraceContext<T>(
  payload: Record<string, unknown> | null | undefined,
  fn: () => T,
): T {
  const ctx = buildConsumerTraceContext(payload);
  return withTraceContext(ctx, fn);
}
