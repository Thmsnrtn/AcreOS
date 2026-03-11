import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

// Helper to create mock req/res/next
function mockReqRes(ip = "127.0.0.1", userId?: string) {
  const req = {
    ip,
    socket: { remoteAddress: ip },
    user: userId ? { claims: { sub: userId } } : undefined,
  } as unknown as Request;

  const headers: Record<string, string> = {};
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn((key: string, value: string) => {
      headers[key] = value;
    }),
    _headers: headers,
  } as unknown as Response & { _headers: Record<string, string> };

  const next = vi.fn() as NextFunction;
  return { req, res, next, headers };
}

describe("createRateLimiter", () => {
  let createRateLimiter: any;
  let clearRateLimitStore: any;
  let RATE_LIMIT_CONFIGS: any;
  let createAuthenticatedRateLimiter: any;
  let authenticatedKeyFunction: any;

  beforeEach(async () => {
    // Reset module so the in-memory store is cleared between test suites
    vi.resetModules();
    const mod = await import("../../server/middleware/rateLimit");
    createRateLimiter = mod.createRateLimiter;
    clearRateLimitStore = mod.clearRateLimitStore;
    RATE_LIMIT_CONFIGS = mod.RATE_LIMIT_CONFIGS;
    createAuthenticatedRateLimiter = mod.createAuthenticatedRateLimiter;
    authenticatedKeyFunction = mod.authenticatedKeyFunction;
  });

  afterEach(() => {
    clearRateLimitStore();
  });

  describe("allows requests below threshold", () => {
    it("calls next() for requests within the limit", () => {
      const limiter = createRateLimiter({ maxRequests: 3, windowMs: 60_000 });
      const { req, res, next } = mockReqRes("10.0.0.1");

      limiter(req, res, next);
      limiter(req, res, next);
      limiter(req, res, next);

      expect(next).toHaveBeenCalledTimes(3);
      expect(res.status).not.toHaveBeenCalled();
    });

    it("sets X-RateLimit-Limit header on allowed requests", () => {
      const limiter = createRateLimiter({ maxRequests: 5, windowMs: 60_000 });
      const { req, res, next, headers } = mockReqRes("10.0.0.2");

      limiter(req, res, next);

      expect(headers["X-RateLimit-Limit"]).toBe("5");
      expect(next).toHaveBeenCalled();
    });

    it("decrements X-RateLimit-Remaining with each request", () => {
      const limiter = createRateLimiter({ maxRequests: 3, windowMs: 60_000 });
      const { req, res, next, headers } = mockReqRes("10.0.0.3");

      limiter(req, res, next); // remaining = 2
      expect(headers["X-RateLimit-Remaining"]).toBe("2");

      limiter(req, res, next); // remaining = 1
      expect(headers["X-RateLimit-Remaining"]).toBe("1");

      limiter(req, res, next); // remaining = 0
      expect(headers["X-RateLimit-Remaining"]).toBe("0");

      expect(next).toHaveBeenCalledTimes(3);
    });

    it("allows a single request without blocking", () => {
      const limiter = createRateLimiter({ maxRequests: 1, windowMs: 60_000 });
      const { req, res, next } = mockReqRes("10.0.0.4");

      limiter(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe("returns 429 after exceeding threshold", () => {
    it("blocks the request that exceeds the limit", () => {
      const limiter = createRateLimiter({ maxRequests: 2, windowMs: 60_000 });
      const { req, res, next } = mockReqRes("10.0.1.1");

      limiter(req, res, next); // 1 — allowed
      limiter(req, res, next); // 2 — allowed
      limiter(req, res, next); // 3 — blocked

      expect(next).toHaveBeenCalledTimes(2);
      expect(res.status).toHaveBeenCalledWith(429);
    });

    it("returns JSON body with message and retryAfter fields on 429", () => {
      const limiter = createRateLimiter({ maxRequests: 1, windowMs: 60_000 });
      const { req, res, next } = mockReqRes("10.0.1.2");

      limiter(req, res, next); // allowed
      limiter(req, res, next); // blocked

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Rate limit exceeded"),
          retryAfter: expect.any(Number),
        })
      );
    });

    it("sets X-RateLimit-Remaining to 0 on a 429 response", () => {
      const limiter = createRateLimiter({ maxRequests: 1, windowMs: 60_000 });
      const { req, res, next, headers } = mockReqRes("10.0.1.3");

      limiter(req, res, next); // allowed
      limiter(req, res, next); // blocked

      expect(headers["X-RateLimit-Remaining"]).toBe("0");
    });

    it("continues blocking after the first 429", () => {
      const limiter = createRateLimiter({ maxRequests: 1, windowMs: 60_000 });
      const { req, res, next } = mockReqRes("10.0.1.4");

      limiter(req, res, next); // allowed
      limiter(req, res, next); // blocked #1
      limiter(req, res, next); // blocked #2

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledTimes(2);
    });

    it("isolates limits per IP — different IPs are independent", () => {
      const limiter = createRateLimiter({ maxRequests: 1, windowMs: 60_000 });
      const a = mockReqRes("10.0.2.1");
      const b = mockReqRes("10.0.2.2");

      limiter(a.req, a.res, a.next); // IP A — allowed
      limiter(a.req, a.res, a.next); // IP A — blocked

      limiter(b.req, b.res, b.next); // IP B — allowed (fresh limit)

      expect(a.next).toHaveBeenCalledTimes(1);
      expect(a.res.status).toHaveBeenCalledWith(429);

      expect(b.next).toHaveBeenCalledTimes(1);
      expect(b.res.status).not.toHaveBeenCalled();
    });
  });

  describe("returns Retry-After header on 429", () => {
    it("includes Retry-After header when rate limited", () => {
      const limiter = createRateLimiter({ maxRequests: 1, windowMs: 60_000 });
      const { req, res, next, headers } = mockReqRes("10.0.3.1");

      limiter(req, res, next); // allowed
      limiter(req, res, next); // blocked

      expect(headers["Retry-After"]).toBeDefined();
    });

    it("Retry-After is a positive integer (seconds)", () => {
      const limiter = createRateLimiter({ maxRequests: 1, windowMs: 60_000 });
      const { req, res, next, headers } = mockReqRes("10.0.3.2");

      limiter(req, res, next);
      limiter(req, res, next);

      const retryAfter = parseInt(headers["Retry-After"], 10);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(60);
    });

    it("Retry-After matches retryAfter in the JSON body", () => {
      const limiter = createRateLimiter({ maxRequests: 1, windowMs: 60_000 });
      const { req, res, next, headers } = mockReqRes("10.0.3.3");

      limiter(req, res, next);
      limiter(req, res, next);

      const headerSeconds = parseInt(headers["Retry-After"], 10);
      const jsonCall = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(jsonCall.retryAfter).toBe(headerSeconds);
    });

    it("includes X-RateLimit-Reset header alongside Retry-After", () => {
      const limiter = createRateLimiter({ maxRequests: 1, windowMs: 30_000 });
      const { req, res, next, headers } = mockReqRes("10.0.3.4");

      limiter(req, res, next);
      limiter(req, res, next);

      expect(headers["X-RateLimit-Reset"]).toBeDefined();
      const resetEpoch = parseInt(headers["X-RateLimit-Reset"], 10);
      expect(resetEpoch).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });
  });

  describe("custom key function", () => {
    it("uses the provided key function instead of IP", () => {
      const customKey = vi.fn().mockReturnValue("custom:key");
      const limiter = createRateLimiter({ maxRequests: 1, windowMs: 60_000 }, customKey);
      const { req, res, next } = mockReqRes("10.0.4.1");

      limiter(req, res, next);
      limiter(req, res, next);

      expect(customKey).toHaveBeenCalledTimes(2);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(429);
    });
  });

  describe("authenticatedKeyFunction", () => {
    it("uses user ID for authenticated requests", () => {
      const req = {
        ip: "10.0.5.1",
        socket: { remoteAddress: "10.0.5.1" },
        user: { claims: { sub: "user-abc" } },
      } as unknown as Request;

      expect(authenticatedKeyFunction(req)).toBe("user:user-abc");
    });

    it("falls back to IP when user is not present", () => {
      const req = {
        ip: "10.0.5.2",
        socket: { remoteAddress: "10.0.5.2" },
        user: undefined,
      } as unknown as Request;

      expect(authenticatedKeyFunction(req)).toBe("ip:10.0.5.2");
    });

    it("falls back to IP when user has no sub claim", () => {
      const req = {
        ip: "10.0.5.3",
        socket: { remoteAddress: "10.0.5.3" },
        user: { claims: {} },
      } as unknown as Request;

      expect(authenticatedKeyFunction(req)).toBe("ip:10.0.5.3");
    });
  });

  describe("RATE_LIMIT_CONFIGS exports", () => {
    it("exports a default config with expected shape", () => {
      expect(RATE_LIMIT_CONFIGS.default).toMatchObject({
        maxRequests: expect.any(Number),
        windowMs: expect.any(Number),
      });
    });

    it("auth config is more restrictive than default", () => {
      expect(RATE_LIMIT_CONFIGS.auth.maxRequests).toBeLessThan(
        RATE_LIMIT_CONFIGS.default.maxRequests
      );
    });
  });

  describe("clearRateLimitStore", () => {
    it("resets the store so previously blocked IPs can proceed", () => {
      const limiter = createRateLimiter({ maxRequests: 1, windowMs: 60_000 });
      const { req, res, next } = mockReqRes("10.0.6.1");

      limiter(req, res, next); // allowed
      limiter(req, res, next); // blocked

      clearRateLimitStore();

      const { req: req2, res: res2, next: next2 } = mockReqRes("10.0.6.1");
      limiter(req2, res2, next2); // should be allowed again

      expect(next2).toHaveBeenCalledOnce();
      expect(res2.status).not.toHaveBeenCalled();
    });
  });
});
