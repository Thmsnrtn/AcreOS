import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

// ─── Rate Limiter Tests ──────────────────────────────────
describe("rateLimit middleware", () => {
  let createRateLimiter: any;
  let clearRateLimitStore: any;

  beforeEach(async () => {
    const mod = await import("../../server/middleware/rateLimit");
    createRateLimiter = mod.createRateLimiter;
    clearRateLimitStore = mod.clearRateLimitStore;
    clearRateLimitStore();
  });

  function mockReqRes(ip = "127.0.0.1") {
    const req = { ip, socket: { remoteAddress: ip } } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn(),
    } as unknown as Response;
    const next = vi.fn() as NextFunction;
    return { req, res, next };
  }

  it("allows requests under the limit", () => {
    const limiter = createRateLimiter({ maxRequests: 5, windowMs: 60000 });
    const { req, res, next } = mockReqRes();

    limiter(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("blocks requests over the limit", () => {
    const limiter = createRateLimiter({ maxRequests: 2, windowMs: 60000 });
    const { req, res, next } = mockReqRes();

    limiter(req, res, next); // 1
    limiter(req, res, next); // 2
    limiter(req, res, next); // 3 — should block

    expect(res.status).toHaveBeenCalledWith(429);
  });

  it("sets rate limit headers", () => {
    const limiter = createRateLimiter({ maxRequests: 10, windowMs: 60000 });
    const { req, res, next } = mockReqRes();

    limiter(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith("X-RateLimit-Limit", "10");
    expect(res.setHeader).toHaveBeenCalledWith("X-RateLimit-Remaining", "9");
  });

  it("isolates rate limits by IP", () => {
    const limiter = createRateLimiter({ maxRequests: 1, windowMs: 60000 });

    const a = mockReqRes("10.0.0.1");
    const b = mockReqRes("10.0.0.2");

    limiter(a.req, a.res, a.next); // IP A — 1st
    limiter(b.req, b.res, b.next); // IP B — 1st

    expect(a.next).toHaveBeenCalled();
    expect(b.next).toHaveBeenCalled();
  });
});

// ─── CSRF Middleware Tests ──────────────────────────────
describe("csrfProtection middleware", () => {
  let csrfProtection: any;

  beforeEach(async () => {
    const mod = await import("../../server/middleware/csrf");
    csrfProtection = mod.csrfProtection;
  });

  function mockReqRes(method: string, path: string, cookies: Record<string, string> = {}, headers: Record<string, string> = {}) {
    const req = {
      method,
      path,
      cookies,
      headers,
    } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;
    const next = vi.fn() as NextFunction;
    return { req, res, next };
  }

  it("allows GET requests without a token", () => {
    const { req, res, next } = mockReqRes("GET", "/api/leads");
    csrfProtection(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("allows exempt paths without a token", () => {
    const { req, res, next } = mockReqRes("POST", "/api/auth/login");
    csrfProtection(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("blocks POST without a CSRF token", () => {
    const { req, res, next } = mockReqRes("POST", "/api/leads");
    csrfProtection(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows POST with matching CSRF token", () => {
    const token = "abc123";
    const { req, res, next } = mockReqRes(
      "POST",
      "/api/leads",
      { csrf_token: token },
      { "x-csrf-token": token }
    );
    csrfProtection(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("blocks POST with mismatched CSRF token", () => {
    const { req, res, next } = mockReqRes(
      "POST",
      "/api/leads",
      { csrf_token: "tokenA" },
      { "x-csrf-token": "tokenB" }
    );
    csrfProtection(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

// ─── Batch Processing Tests ──────────────────────────────
describe("batchProcess", () => {
  let batchProcess: any;
  let isRateLimitError: any;

  beforeEach(async () => {
    const mod = await import("../../server/utils/batch");
    batchProcess = mod.batchProcess;
    isRateLimitError = mod.isRateLimitError;
  });

  it("processes items in order", async () => {
    const items = [1, 2, 3];
    const results = await batchProcess(items, async (item: number) => item * 2);
    expect(results).toEqual([2, 4, 6]);
  });

  it("respects concurrency limit", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    await batchProcess(
      [1, 2, 3, 4, 5],
      async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 50));
        concurrent--;
        return true;
      },
      { concurrency: 2 }
    );

    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it("calls onProgress callback", async () => {
    const progress: number[] = [];
    await batchProcess(
      [1, 2, 3],
      async (item: number) => item,
      { onProgress: (completed: number) => progress.push(completed) }
    );
    expect(progress).toEqual([1, 2, 3]);
  });

  it("isRateLimitError detects 429 errors", () => {
    expect(isRateLimitError(new Error("HTTP 429 Too Many Requests"))).toBe(true);
    expect(isRateLimitError(new Error("rate limit exceeded"))).toBe(true);
    expect(isRateLimitError(new Error("Something else"))).toBe(false);
  });
});
