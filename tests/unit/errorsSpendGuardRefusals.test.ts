import { describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import { AIConcurrencyExceeded } from "../../server/services/aiConcurrency";
import { AIQuotaUnavailable } from "../../server/services/aiQuotaService";
import { Errors } from "../../server/utils/errors";

function createRes() {
  const headers: Record<string, string> = {};
  const res = {
    locals: {},
    getHeader: (name: string) => headers[name],
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as unknown as Response;
  return { headers, res };
}

function body(res: Response) {
  const mock = res.json as unknown as { mock: { calls: Array<[unknown]> } };
  return mock.mock.calls[0][0] as { error: string; message: string };
}

function status(res: Response) {
  const mock = res.status as unknown as { mock: { calls: Array<[number]> } };
  return mock.mock.calls[0][0];
}

describe("Errors.internal spend-guard refusals", () => {
  it("maps an AI concurrency refusal to 429 AI_CONCURRENCY_EXCEEDED with Retry-After 2", () => {
    const { headers, res } = createRes();
    Errors.internal(res, new AIConcurrencyExceeded(5));
    expect(status(res)).toBe(429);
    expect(body(res).error).toBe("AI_CONCURRENCY_EXCEEDED");
    expect(headers["Retry-After"]).toBe("2");
  });

  it("maps an AI quota refusal to 503 AI_QUOTA_UNAVAILABLE with Retry-After 30", () => {
    const { headers, res } = createRes();
    Errors.internal(res, new AIQuotaUnavailable());
    expect(status(res)).toBe(503);
    expect(body(res).error).toBe("AI_QUOTA_UNAVAILABLE");
    expect(headers["Retry-After"]).toBe("30");
  });

  it("maps a shape-only concurrency refusal to 429 with the default Retry-After 2", () => {
    const { headers, res } = createRes();
    const error = new Error("Too many AI tasks are running at once.") as Error & { code: string };
    error.code = "AI_CONCURRENCY_EXCEEDED";
    Errors.internal(res, error);
    expect(status(res)).toBe(429);
    expect(body(res).error).toBe("AI_CONCURRENCY_EXCEEDED");
    expect(headers["Retry-After"]).toBe("2");
  });

  it("maps a shape-only quota refusal to 503 with the default Retry-After 30", () => {
    const { headers, res } = createRes();
    const error = new Error("AI usage metering is temporarily unavailable.") as Error & { code: string };
    error.code = "AI_QUOTA_UNAVAILABLE";
    Errors.internal(res, error);
    expect(status(res)).toBe(503);
    expect(body(res).error).toBe("AI_QUOTA_UNAVAILABLE");
    expect(headers["Retry-After"]).toBe("30");
  });

  it("keeps NO_AI_PROVIDER mapped to 503 SERVICE_UNAVAILABLE", () => {
    const { res } = createRes();
    const error = new Error("No AI provider is configured.") as Error & { code: string };
    error.code = "NO_AI_PROVIDER";
    Errors.internal(res, error);
    expect(status(res)).toBe(503);
    expect(body(res).error).toBe("SERVICE_UNAVAILABLE");
  });

  it("keeps a genuine internal error mapped to 500 INTERNAL_ERROR without Retry-After", () => {
    const { headers, res } = createRes();
    Errors.internal(res, new Error("boom"));
    expect(status(res)).toBe(500);
    expect(body(res).error).toBe("INTERNAL_ERROR");
    expect(headers["Retry-After"]).toBeUndefined();
  });
});
