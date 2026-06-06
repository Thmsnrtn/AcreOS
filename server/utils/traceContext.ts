/**
 * Trace Context propagation (L4).
 *
 * The W3C-spec `traceparent` is established by `correlationIdMiddleware`
 * on every inbound request. This module exposes it to downstream code via
 * `AsyncLocalStorage` so:
 *
 *   1. The structured logger can stamp `traceId` + `spanId` onto every
 *      log line without each call site threading the request through.
 *   2. The outbound fetch helper (`outboundFetch`) can stamp `traceparent`
 *      onto outgoing HTTP calls so vendor APIs and our own internal
 *      hops continue the same trace.
 *
 * If no trace context is active (worker jobs, scheduled tasks, boot), the
 * context returns null and callers fall back to generating new IDs (or
 * skipping propagation).
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface TraceCtx {
  correlationId: string;
  traceId: string;
  spanId: string;
  traceparent: string;
}

const traceContext = new AsyncLocalStorage<TraceCtx>();

/** Run `fn` inside the given trace context. Used by middleware. */
export function withTraceContext<T>(ctx: TraceCtx, fn: () => T): T {
  return traceContext.run(ctx, fn);
}

/** Current trace context, or null when outside a request. */
export function currentTraceContext(): TraceCtx | null {
  return traceContext.getStore() ?? null;
}
