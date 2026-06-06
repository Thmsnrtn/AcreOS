/**
 * L4 — queue traceparent propagation tests.
 *
 * Verifies the enqueue→consumer round-trip: a payload stamped inside an
 * active trace context carries the upstream trace_id, and the consumer-side
 * restore re-uses that trace_id (continuing the same distributed trace)
 * while minting a fresh span_id for the consumer hop.
 */

import { describe, it, expect } from "vitest";
import { withTraceContext, currentTraceContext } from "./traceContext";
import { parseTraceparent } from "../middleware/correlationId";
import {
  stampTraceContext,
  readTraceEnvelope,
  stripTraceEnvelope,
  buildConsumerTraceContext,
  runWithRestoredTraceContext,
  TRACE_ENVELOPE_KEY,
} from "./queueTraceContext";

const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const SPAN_ID = "b7ad6b7169203331";
const TRACEPARENT = `00-${TRACE_ID}-${SPAN_ID}-01`;

describe("stampTraceContext", () => {
  it("embeds the active trace context as a _trace envelope", () => {
    const out = withTraceContext(
      { correlationId: "corr-1", traceId: TRACE_ID, spanId: SPAN_ID, traceparent: TRACEPARENT },
      () => stampTraceContext({ foo: "bar" }),
    );
    expect(out.foo).toBe("bar");
    const env = (out as Record<string, unknown>)[TRACE_ENVELOPE_KEY] as Record<string, unknown>;
    expect(env.traceparent).toBe(TRACEPARENT);
    expect(env.correlationId).toBe("corr-1");
  });

  it("is a no-op outside an active trace context", () => {
    const payload = { foo: "bar" };
    const out = stampTraceContext(payload);
    expect(out).toEqual({ foo: "bar" });
    expect(TRACE_ENVELOPE_KEY in out).toBe(false);
  });
});

describe("readTraceEnvelope", () => {
  it("returns the envelope when the traceparent is valid", () => {
    const payload = { x: 1, [TRACE_ENVELOPE_KEY]: { traceparent: TRACEPARENT, correlationId: "c" } };
    expect(readTraceEnvelope(payload)).toEqual({ traceparent: TRACEPARENT, correlationId: "c" });
  });

  it("returns null on missing / malformed envelope", () => {
    expect(readTraceEnvelope({ x: 1 })).toBeNull();
    expect(readTraceEnvelope({ [TRACE_ENVELOPE_KEY]: { traceparent: "garbage" } })).toBeNull();
    expect(readTraceEnvelope(null)).toBeNull();
  });
});

describe("stripTraceEnvelope", () => {
  it("removes the envelope key", () => {
    const out = stripTraceEnvelope({ a: 1, [TRACE_ENVELOPE_KEY]: { traceparent: TRACEPARENT } });
    expect(out).toEqual({ a: 1 });
  });

  it("returns input unchanged when no envelope present", () => {
    const p = { a: 1 };
    expect(stripTraceEnvelope(p)).toBe(p);
  });
});

describe("buildConsumerTraceContext", () => {
  it("re-uses upstream trace_id and mints a fresh span_id", () => {
    const ctx = buildConsumerTraceContext({ [TRACE_ENVELOPE_KEY]: { traceparent: TRACEPARENT } });
    expect(ctx.traceId).toBe(TRACE_ID);
    expect(ctx.spanId).not.toBe(SPAN_ID);
    const parsed = parseTraceparent(ctx.traceparent);
    expect(parsed?.traceId).toBe(TRACE_ID);
  });

  it("mints a brand-new trace context when no envelope present", () => {
    const ctx = buildConsumerTraceContext({ foo: "bar" });
    expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(ctx.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(parseTraceparent(ctx.traceparent)).not.toBeNull();
  });
});

describe("end-to-end enqueue→restore round-trip", () => {
  it("consumer continues the same trace_id as the producer", () => {
    // Producer side — stamp inside an active context.
    const enqueued = withTraceContext(
      { correlationId: "corr-9", traceId: TRACE_ID, spanId: SPAN_ID, traceparent: TRACEPARENT },
      () => stampTraceContext({ job: "render" }),
    );

    // Consumer side — restore and read the active context inside fn.
    const seen = runWithRestoredTraceContext(enqueued, () => currentTraceContext());
    expect(seen?.traceId).toBe(TRACE_ID);
    expect(seen?.correlationId).toBe("corr-9");
    // Fresh span for this hop.
    expect(seen?.spanId).not.toBe(SPAN_ID);
  });
});
