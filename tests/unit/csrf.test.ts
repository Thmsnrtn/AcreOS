import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

describe("CSRF middleware", () => {
  let csrfProtection: any;
  let setCsrfCookie: any;

  beforeEach(async () => {
    const mod = await import("../../server/middleware/csrf");
    csrfProtection = mod.csrfProtection;
    setCsrfCookie = mod.setCsrfCookie;
  });

  function mockReqRes(
    method: string,
    path: string,
    cookies: Record<string, string> = {},
    headers: Record<string, string> = {}
  ) {
    const req = {
      method,
      path,
      cookies,
      headers: { ...headers },
    } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      cookie: vi.fn(),
    } as unknown as Response;
    const next = vi.fn() as NextFunction;
    return { req, res, next };
  }

  it("skips GET requests", () => {
    const { req, res, next } = mockReqRes("GET", "/api/leads");
    csrfProtection(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("skips HEAD requests", () => {
    const { req, res, next } = mockReqRes("HEAD", "/api/leads");
    csrfProtection(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("skips OPTIONS requests", () => {
    const { req, res, next } = mockReqRes("OPTIONS", "/api/leads");
    csrfProtection(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("skips exempt paths (webhook)", () => {
    const { req, res, next } = mockReqRes("POST", "/stripe/webhook");
    csrfProtection(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("skips exempt paths (login)", () => {
    const { req, res, next } = mockReqRes("POST", "/auth/login");
    csrfProtection(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("returns 403 when CSRF cookie is missing", () => {
    const { req, res, next } = mockReqRes("POST", "/api/leads", {}, {});
    csrfProtection(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when CSRF header is missing", () => {
    const { req, res, next } = mockReqRes("POST", "/api/leads", { csrf_token: "abc123" }, {});
    csrfProtection(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when tokens don't match", () => {
    const { req, res, next } = mockReqRes(
      "POST",
      "/api/leads",
      { csrf_token: "abc123" },
      { "x-csrf-token": "xyz789" }
    );
    csrfProtection(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows request when tokens match", () => {
    const token = "a".repeat(64);
    const { req, res, next } = mockReqRes(
      "POST",
      "/api/leads",
      { csrf_token: token },
      { "x-csrf-token": token }
    );
    csrfProtection(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  describe("setCsrfCookie", () => {
    it("sets cookie when none exists", () => {
      const { req, res } = mockReqRes("GET", "/api/auth/user", {});
      setCsrfCookie(req, res);
      expect(res.cookie).toHaveBeenCalledWith(
        "csrf_token",
        expect.any(String),
        expect.objectContaining({
          httpOnly: false,
          sameSite: "strict",
          path: "/",
        })
      );
    });

    it("does not overwrite existing cookie", () => {
      const { req, res } = mockReqRes("GET", "/api/auth/user", { csrf_token: "existing" });
      setCsrfCookie(req, res);
      expect(res.cookie).not.toHaveBeenCalled();
    });
  });
});
