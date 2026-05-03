/**
 * Unit tests for the idempotencyMiddleware.
 *
 * Verifies that:
 *   1. Requests without an Idempotency-Key header pass through to next()
 *   2. First request with a key is processed; the response is cached
 *   3. Second request with the same key replays the cached response
 *      (handler is NOT invoked again)
 *   4. Keys are scoped per organization (same key, different orgs → no replay)
 *   5. Error responses (status >= 400) are not cached
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

import { idempotencyMiddleware } from "../../server/middleware/idempotency";

// ── Helpers ────────────────────────────────────────────────────────────────────

function mockReqRes(opts: {
  key?: string;
  orgId?: string;
} = {}) {
  const req = {
    headers: opts.key ? { "idempotency-key": opts.key } : {},
    organization: opts.orgId ? { id: opts.orgId } : undefined,
  } as unknown as Request;

  let statusCode = 200;
  let lastBody: unknown = null;
  const res = {
    statusCode,
    status: vi.fn(function (this: any, code: number) {
      this.statusCode = code;
      statusCode = code;
      return this;
    }),
    json: vi.fn(function (this: any, body: unknown) {
      lastBody = body;
      return this;
    }),
    get body() {
      return lastBody;
    },
  } as unknown as Response & { body: unknown };

  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next };
}

// Drives middleware → simulated handler → eventual final response.
// Returns a promise that resolves after the handler chain completes
// (or after the middleware short-circuits via cache replay).
function runMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  return new Promise<void>((resolve) => {
    (next as any).mockImplementationOnce(() => {
      // simulate handler running synchronously
      resolve();
    });
    idempotencyMiddleware(req, res, next);
    // If the middleware short-circuits (cache hit), next() is never called.
    // Resolve on the next microtask if so.
    setTimeout(resolve, 20);
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("idempotencyMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls next() when no Idempotency-Key header is present", () => {
    const { req, res, next } = mockReqRes();
    idempotencyMiddleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("processes the request and caches the response on first hit", async () => {
    const key = `test-key-first-${Date.now()}`;
    const { req, res, next } = mockReqRes({ key, orgId: "org-1" });

    await runMiddleware(req, res, next);
    // Simulate handler producing a 200 response
    (res as any).statusCode = 200;
    (res as any).json({ ok: true, value: 42 });

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("replays the cached response on duplicate Idempotency-Key", async () => {
    const key = `test-key-replay-${Date.now()}`;

    // First call — handler runs, response cached
    const first = mockReqRes({ key, orgId: "org-replay" });
    await runMiddleware(first.req, first.res, first.next);
    (first.res as any).statusCode = 201;
    (first.res as any).json({ created: "deal-1" });

    // Second call with same key — handler should NOT run; cached body replayed.
    const second = mockReqRes({ key, orgId: "org-replay" });
    idempotencyMiddleware(second.req, second.res, second.next);

    // Wait for the async cache lookup
    await new Promise((r) => setTimeout(r, 30));

    expect(second.next).not.toHaveBeenCalled();
    expect(second.res.status).toHaveBeenCalledWith(201);
    expect(second.res.json).toHaveBeenCalledWith({ created: "deal-1" });
  });

  it("scopes cache keys by organization", async () => {
    const key = `test-key-scope-${Date.now()}`;

    const orgA = mockReqRes({ key, orgId: "org-A" });
    await runMiddleware(orgA.req, orgA.res, orgA.next);
    (orgA.res as any).statusCode = 200;
    (orgA.res as any).json({ org: "A" });

    // Same key, different org — should NOT see cached A response
    const orgB = mockReqRes({ key, orgId: "org-B" });
    await runMiddleware(orgB.req, orgB.res, orgB.next);

    // orgB's handler must run (next called). It must not receive A's payload.
    expect(orgB.next).toHaveBeenCalled();
  });

  it("does not cache error responses (status >= 400)", async () => {
    const key = `test-key-error-${Date.now()}`;

    // First call — handler returns a 400.
    const first = mockReqRes({ key, orgId: "org-err" });
    await runMiddleware(first.req, first.res, first.next);
    (first.res as any).statusCode = 400;
    (first.res as any).json({ error: "bad request" });

    // Second call with same key — handler should still run because errors aren't cached.
    const second = mockReqRes({ key, orgId: "org-err" });
    await runMiddleware(second.req, second.res, second.next);

    expect(second.next).toHaveBeenCalled();
  });
});
