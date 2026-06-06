/**
 * L4 — W3C traceparent middleware tests.
 */

import { describe, it, expect } from "vitest";
import { parseTraceparent, formatTraceparent, correlationIdMiddleware } from "./correlationId";
import type { Request, Response } from "express";

describe("parseTraceparent", () => {
  it("parses a spec-compliant traceparent", () => {
    const parsed = parseTraceparent("00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01");
    expect(parsed).toEqual({
      version: "00",
      traceId: "0af7651916cd43dd8448eb211c80319c",
      parentSpanId: "b7ad6b7169203331",
      flags: "01",
    });
  });

  it("returns null on malformed input", () => {
    expect(parseTraceparent("garbage")).toBeNull();
    expect(parseTraceparent("00-too-short")).toBeNull();
    expect(parseTraceparent(undefined)).toBeNull();
    expect(parseTraceparent("")).toBeNull();
  });

  it("rejects all-zero trace_id", () => {
    expect(
      parseTraceparent("00-00000000000000000000000000000000-b7ad6b7169203331-01"),
    ).toBeNull();
  });

  it("rejects all-zero span_id", () => {
    expect(
      parseTraceparent("00-0af7651916cd43dd8448eb211c80319c-0000000000000000-01"),
    ).toBeNull();
  });

  it("rejects unsupported version ff", () => {
    expect(
      parseTraceparent("ff-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"),
    ).toBeNull();
  });

  it("accepts uppercase hex (W3C spec §3.2.2.1 says lowercase, but real-world traces use both)", () => {
    const parsed = parseTraceparent("00-0AF7651916CD43DD8448EB211C80319C-B7AD6B7169203331-01");
    expect(parsed?.traceId).toBe("0AF7651916CD43DD8448EB211C80319C");
  });
});

describe("formatTraceparent", () => {
  it("emits the canonical version + flags by default", () => {
    expect(formatTraceparent("aaaa", "bbbb")).toBe("00-aaaa-bbbb-01");
  });
});

describe("correlationIdMiddleware", () => {
  function makeReqRes(headers: Record<string, string> = {}): {
    req: Request;
    res: Response;
    headersSent: Record<string, string>;
  } {
    const headersSent: Record<string, string> = {};
    const req = { headers } as unknown as Request;
    const res = {
      setHeader: (name: string, value: string) => {
        headersSent[name] = value;
      },
    } as unknown as Response;
    return { req, res, headersSent };
  }

  it("generates a fresh traceparent when none provided", () => {
    const { req, res, headersSent } = makeReqRes();
    let nextCalled = false;
    correlationIdMiddleware(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    expect(req.correlationId).toBeTruthy();
    expect(req.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(req.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(req.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(headersSent["traceparent"]).toBe(req.traceparent);
    expect(headersSent["X-Request-ID"]).toBe(req.correlationId);
  });

  it("reuses incoming trace_id but mints a fresh span_id", () => {
    const incomingTrace = "0af7651916cd43dd8448eb211c80319c";
    const incomingSpan = "b7ad6b7169203331";
    const { req, res } = makeReqRes({
      traceparent: `00-${incomingTrace}-${incomingSpan}-01`,
    });
    correlationIdMiddleware(req, res, () => {});
    expect(req.traceId).toBe(incomingTrace);
    expect(req.spanId).not.toBe(incomingSpan); // fresh span per hop
    expect(req.spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  it("falls back to a fresh trace_id on malformed incoming traceparent", () => {
    const { req, res } = makeReqRes({ traceparent: "definitely-not-w3c" });
    correlationIdMiddleware(req, res, () => {});
    expect(req.traceId).toMatch(/^[0-9a-f]{32}$/);
  });
});
