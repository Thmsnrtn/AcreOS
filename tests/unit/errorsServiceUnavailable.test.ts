import { describe, it, expect } from "vitest";
import type { Response } from "express";
import { Errors } from "../../server/utils/errors";
import { NoAIProviderError } from "../../server/services/aiRouter";

// Minimal Express Response stub — captures the status + JSON body.
function fakeRes() {
  const captured: { status?: number; body?: any } = {};
  const res = {
    status(code: number) {
      captured.status = code;
      return res;
    },
    json(body: any) {
      captured.body = body;
      return res;
    },
    // resolveRequestId touches these — keep them benign.
    getHeader: () => undefined,
    locals: {},
  } as unknown as Response;
  return { res, captured };
}

describe("Errors.internal — AI-provider outage downgrades 500 → 503", () => {
  it("maps NoAIProviderError to a 503 SERVICE_UNAVAILABLE, not a 500", () => {
    const { res, captured } = fakeRes();
    Errors.internal(res, new NoAIProviderError());
    expect(captured.status).toBe(503);
    expect(captured.body.error).toBe("SERVICE_UNAVAILABLE");
  });

  it("also matches on the code shape alone (no instanceof coupling)", () => {
    const { res, captured } = fakeRes();
    const shaped = Object.assign(new Error("nope"), { code: "NO_AI_PROVIDER" });
    Errors.internal(res, shaped);
    expect(captured.status).toBe(503);
  });

  it("a genuine internal error still surfaces a 500", () => {
    const { res, captured } = fakeRes();
    Errors.internal(res, new Error("real bug"));
    expect(captured.status).toBe(500);
    expect(captured.body.error).toBe("INTERNAL_ERROR");
  });

  it("serviceUnavailable emits a 503 with a calm default message", () => {
    const { res, captured } = fakeRes();
    Errors.serviceUnavailable(res);
    expect(captured.status).toBe(503);
    expect(captured.body.message).toMatch(/temporarily unavailable/i);
  });
});
