/**
 * outboundFetch — trace-context-aware fetch wrapper (L4).
 *
 * Drop-in replacement for `fetch()` that propagates the current request's
 * W3C `traceparent` header to outbound calls so vendor APIs and our own
 * internal hops continue the same trace.
 *
 * Usage:
 *
 *   import { outboundFetch } from "@/server/utils/outboundFetch";
 *   const resp = await outboundFetch(url, { method: "POST", body });
 *
 * When called outside of a request context (worker job, scheduled task,
 * boot), the helper still works — it just generates a fresh W3C trace
 * context for the outbound call instead of propagating one. This is
 * deliberate: every outbound HTTP call should be traceable, not only
 * those originating from an inbound HTTP request.
 *
 * Migration path: existing `await fetch(url, ...)` call sites in
 * server/services/* + server/integrations/* should be migrated to
 * `outboundFetch` opportunistically; the lint check in
 * `scripts/check-route-cost-class.mjs` will eventually be extended to
 * flag raw `fetch(` in server-side code.
 */

import { randomBytes } from "crypto";
import { currentTraceContext } from "./traceContext";
import { formatTraceparent } from "../middleware/correlationId";

function genTraceId(): string {
  return randomBytes(16).toString("hex");
}

function genSpanId(): string {
  return randomBytes(8).toString("hex");
}

/**
 * fetch wrapper that injects a W3C `traceparent` header on every outbound
 * call. Reuses the inbound request's trace_id when available; otherwise
 * generates a fresh one. Always mints a new span_id per call.
 *
 * Caller-provided `traceparent` header is preserved (the caller knows
 * what they want propagated).
 */
export async function outboundFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const ctx = currentTraceContext();
  const traceId = ctx?.traceId ?? genTraceId();
  const spanId = genSpanId();
  const traceparent = formatTraceparent(traceId, spanId);

  const headers = new Headers(init?.headers ?? undefined);
  if (!headers.has("traceparent")) {
    headers.set("traceparent", traceparent);
  }
  if (ctx?.correlationId && !headers.has("x-correlation-id")) {
    headers.set("x-correlation-id", ctx.correlationId);
  }

  return fetch(input, { ...init, headers });
}
