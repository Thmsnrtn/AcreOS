import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

// ─── isAuthenticated Middleware ──────────────────────────
describe("isAuthenticated middleware", () => {
  let isAuthenticated: any;

  beforeEach(async () => {
    const mod = await import("../../server/auth/localAuth");
    isAuthenticated = mod.isAuthenticated;
  });

  function mockReqRes(authenticated: boolean, user: any = null) {
    const req = {
      isAuthenticated: () => authenticated,
      user,
    } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;
    const next = vi.fn() as NextFunction;
    return { req, res, next };
  }

  it("calls next() for authenticated users", () => {
    const { req, res, next } = mockReqRes(true, { id: "u1", email: "a@b.com" });
    isAuthenticated(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("returns 401 for unauthenticated users", () => {
    const { req, res, next } = mockReqRes(false);
    isAuthenticated(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when authenticated but no user object", () => {
    const { req, res, next } = mockReqRes(true, null);
    isAuthenticated(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

// ─── Founder Email Service ──────────────────────────────
describe("isFounderEmail", () => {
  let isFounderEmail: any;

  beforeEach(async () => {
    const mod = await import("../../server/services/founder");
    isFounderEmail = mod.isFounderEmail;
  });

  it("identifies the primary founder email", () => {
    expect(isFounderEmail("thmsnrtn@gmail.com")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isFounderEmail("THMSNRTN@GMAIL.COM")).toBe(true);
  });

  it("identifies founder emails from env var", () => {
    // FOUNDER_EMAILS is set to "founder@test.com" in tests/setup.ts
    expect(isFounderEmail("founder@test.com")).toBe(true);
  });

  it("returns false for non-founder emails", () => {
    expect(isFounderEmail("random@example.com")).toBe(false);
  });

  it("handles null/undefined gracefully", () => {
    expect(isFounderEmail(null)).toBe(false);
    expect(isFounderEmail(undefined)).toBe(false);
    expect(isFounderEmail("")).toBe(false);
  });
});

// ─── requireFounder Middleware ──────────────────────────
describe("requireFounder middleware", () => {
  let requireFounder: any;

  beforeEach(async () => {
    const mod = await import("../../server/auth/routes");
    requireFounder = mod.requireFounder;
  });

  function mockReqRes(authenticated: boolean, email: string | null = null) {
    const req = {
      isAuthenticated: () => authenticated,
      user: email ? { id: "u1", email } : null,
    } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;
    const next = vi.fn() as NextFunction;
    return { req, res, next };
  }

  it("calls next() for founder users", async () => {
    const { req, res, next } = mockReqRes(true, "thmsnrtn@gmail.com");
    await requireFounder(req, res, next);
    expect(next).toHaveBeenCalled();
    expect((req as any).isFounder).toBe(true);
  });

  it("returns 404 for non-founder users", async () => {
    const { req, res, next } = mockReqRes(true, "random@example.com");
    await requireFounder(req, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 404 for unauthenticated users", async () => {
    const { req, res, next } = mockReqRes(false);
    await requireFounder(req, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
