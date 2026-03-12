/**
 * Tasks #30–#36 — Security Headers Unit Tests
 *
 * Verifies that securityHeaders middleware sets the correct HTTP security
 * headers for both production and development environments.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";

function mockReqRes(isProduction = false) {
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = isProduction ? "production" : "development";

  const headers: Record<string, string> = {};
  const req = { method: "GET", path: "/", ip: "127.0.0.1" } as unknown as Request;
  const res = {
    setHeader: vi.fn((name: string, value: string) => { headers[name.toLowerCase()] = value; }),
    locals: {},
    on: vi.fn(),
  } as unknown as Response;
  const next = vi.fn() as NextFunction;

  return { req, res, next, headers, originalEnv };
}

describe("securityHeaders middleware", () => {
  it("sets X-Content-Type-Options: nosniff (task #33)", async () => {
    const { securityHeaders } = await import("../../server/middleware/security");
    const { req, res, next, headers } = mockReqRes();
    securityHeaders(req, res, next);
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(next).toHaveBeenCalled();
  });

  it("sets X-Frame-Options: DENY (task #32)", async () => {
    const { securityHeaders } = await import("../../server/middleware/security");
    const { req, res, next, headers } = mockReqRes();
    securityHeaders(req, res, next);
    expect(headers["x-frame-options"]).toBe("DENY");
  });

  it("sets Referrer-Policy: strict-origin-when-cross-origin (task #34)", async () => {
    const { securityHeaders } = await import("../../server/middleware/security");
    const { req, res, next, headers } = mockReqRes();
    securityHeaders(req, res, next);
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  it("sets Permissions-Policy disabling camera/mic/geolocation (task #35)", async () => {
    const { securityHeaders } = await import("../../server/middleware/security");
    const { req, res, next, headers } = mockReqRes();
    securityHeaders(req, res, next);
    const pp = headers["permissions-policy"];
    expect(pp).toContain("camera=()");
    expect(pp).toContain("microphone=()");
    expect(pp).toContain("geolocation=()");
  });

  it("sets Content-Security-Policy header", async () => {
    const { securityHeaders } = await import("../../server/middleware/security");
    const { req, res, next, headers } = mockReqRes();
    securityHeaders(req, res, next);
    expect(headers["content-security-policy"]).toBeTruthy();
    expect(headers["content-security-policy"]).toContain("default-src");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  });

  it("sets HSTS with includeSubDomains and preload in production (task #30)", async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    vi.resetModules();

    const { securityHeaders } = await import("../../server/middleware/security");
    const headers: Record<string, string> = {};
    const req = { method: "GET", path: "/", ip: "127.0.0.1" } as unknown as Request;
    const res = {
      setHeader: vi.fn((name: string, value: string) => { headers[name.toLowerCase()] = value; }),
      locals: {},
    } as unknown as Response;
    const next = vi.fn() as NextFunction;

    securityHeaders(req, res, next);

    const hsts = headers["strict-transport-security"];
    expect(hsts).toContain("max-age=31536000");
    expect(hsts).toContain("includeSubDomains");
    expect(hsts).toContain("preload");

    process.env.NODE_ENV = originalEnv;
    vi.resetModules();
  });

  it("does NOT set HSTS in development", async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    vi.resetModules();

    const { securityHeaders } = await import("../../server/middleware/security");
    const headers: Record<string, string> = {};
    const req = { method: "GET", path: "/", ip: "127.0.0.1" } as unknown as Request;
    const res = {
      setHeader: vi.fn((name: string, value: string) => { headers[name.toLowerCase()] = value; }),
      locals: {},
    } as unknown as Response;
    const next = vi.fn() as NextFunction;

    securityHeaders(req, res, next);

    expect(headers["strict-transport-security"]).toBeUndefined();

    process.env.NODE_ENV = originalEnv;
    vi.resetModules();
  });

  it("generates a per-request CSP nonce in production (task #31)", async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    vi.resetModules();

    const { securityHeaders } = await import("../../server/middleware/security");

    const nonces = new Set<string>();

    for (let i = 0; i < 20; i++) {
      const locals: Record<string, unknown> = {};
      const req = { method: "GET", path: "/", ip: "127.0.0.1" } as unknown as Request;
      const res = {
        setHeader: vi.fn(),
        locals,
      } as unknown as Response;
      securityHeaders(req, res, vi.fn());
      if (locals.cspNonce) nonces.add(locals.cspNonce as string);
    }

    // Each request should produce a unique nonce
    expect(nonces.size).toBe(20);

    process.env.NODE_ENV = originalEnv;
    vi.resetModules();
  });
});

describe("corsMiddleware", () => {
  it("allows configured origins", async () => {
    const { corsMiddleware } = await import("../../server/middleware/security");
    const setHeader = vi.fn();
    const req = {
      method: "GET",
      headers: { origin: "http://localhost:3000" },
    } as unknown as Request;
    const res = { setHeader, status: vi.fn().mockReturnThis(), end: vi.fn() } as unknown as Response;
    const next = vi.fn();

    corsMiddleware(req, res, next);

    expect(setHeader).toHaveBeenCalledWith("Access-Control-Allow-Origin", "http://localhost:3000");
    expect(setHeader).toHaveBeenCalledWith("Access-Control-Allow-Credentials", "true");
  });

  it("does not set Allow-Origin header for disallowed origins", async () => {
    const { corsMiddleware } = await import("../../server/middleware/security");
    const setHeader = vi.fn();
    const req = {
      method: "GET",
      headers: { origin: "https://evil.example.com" },
    } as unknown as Request;
    const res = { setHeader, status: vi.fn().mockReturnThis(), end: vi.fn() } as unknown as Response;
    const next = vi.fn();

    corsMiddleware(req, res, next);

    const originCalls = (setHeader as any).mock.calls.filter(
      (call: any[]) => call[0] === "Access-Control-Allow-Origin"
    );
    expect(originCalls.length).toBe(0);
  });
});
