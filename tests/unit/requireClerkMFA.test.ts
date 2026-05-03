/**
 * R4 — Unit tests for requireClerkMFA middleware.
 *
 * Covers the decision matrix:
 *   1. No Clerk session             → 401
 *   2. 2FA enabled + verified       → next()
 *   3. 2FA enabled + NOT verified   → 403 mfa_required
 *   4. 2FA disabled + low-trust     → next()
 *   5. 2FA disabled + high-trust    → 403 mfa_setup_required
 *   6. 2FA disabled + flag on       → 403 mfa_setup_required
 *   7. Clerk lookup fails           → 403 (fail closed, not silent pass)
 *
 * The Clerk SDK and the audit-event DB writer are both mocked. We assert
 * the middleware's response shape and `next()` behaviour, not the audit
 * write path (which is best-effort and never blocks).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

// ── Mocks ────────────────────────────────────────────────────────────────────

const getUserMock = vi.fn();

vi.mock("@clerk/express", () => ({
  createClerkClient: () => ({
    users: {
      getUser: (...args: unknown[]) => getUserMock(...args),
    },
  }),
}));

// db.insert(...).values(...) — return a chain that resolves successfully
// so the audit-log call inside the middleware is a no-op.
vi.mock("../../server/db", () => ({
  db: {
    insert: () => ({
      values: () => Promise.resolve(),
    }),
  },
}));

vi.mock("@shared/schema", () => ({
  auditEvents: {},
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(opts: {
  userId?: string | null;
  fva?: [number, number] | null;
  url?: string;
  method?: string;
}): Request {
  return {
    auth: opts.userId
      ? { userId: opts.userId, factorVerificationAge: opts.fva ?? null }
      : undefined,
    user: undefined,
    originalUrl: opts.url ?? "/api/admin/users",
    url: opts.url ?? "/api/admin/users",
    method: opts.method ?? "GET",
    headers: {},
    ip: "127.0.0.1",
  } as unknown as Request;
}

function makeRes() {
  const status = vi.fn();
  const json = vi.fn();
  const res: any = {
    status: (code: number) => {
      status(code);
      return res;
    },
    json: (body: unknown) => {
      json(body);
      return res;
    },
  };
  return { res: res as Response, status, json };
}

async function loadMiddleware() {
  // Re-import after mocks so the middleware picks up the mocked SDK.
  const mod = await import("../../server/middleware/requireClerkMFA");
  return mod.requireClerkMFA;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("requireClerkMFA", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MFA_REQUIRED_FOR_ALL_USERS;
  });

  it("returns 401 when there is no Clerk session", async () => {
    const requireClerkMFA = await loadMiddleware();
    const req = makeReq({ userId: null });
    const { res, status, json } = makeRes();
    const next: NextFunction = vi.fn();

    await requireClerkMFA(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Unauthorized", statusCode: 401 })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("passes through when 2FA is enabled and second factor was verified this session", async () => {
    const requireClerkMFA = await loadMiddleware();
    getUserMock.mockResolvedValueOnce({ twoFactorEnabled: true });

    // fva[1] = 30s ago → second factor verified
    const req = makeReq({ userId: "user_abc", fva: [60, 30] });
    const { res, status } = makeRes();
    const next: NextFunction = vi.fn();

    await requireClerkMFA(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it("blocks with 403 mfa_required when 2FA is enabled but second factor not verified this session", async () => {
    const requireClerkMFA = await loadMiddleware();
    getUserMock.mockResolvedValueOnce({ twoFactorEnabled: true });

    // fva[1] = -1 → never verified
    const req = makeReq({ userId: "user_abc", fva: [60, -1] });
    const { res, status, json } = makeRes();
    const next: NextFunction = vi.fn();

    await requireClerkMFA(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "mfa_required" })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("blocks with 403 mfa_required when FVA claim is missing entirely (fail-closed) and 2FA is enabled", async () => {
    const requireClerkMFA = await loadMiddleware();
    getUserMock.mockResolvedValueOnce({ twoFactorEnabled: true });

    // fva null = instance hasn't opted in → fail closed
    const req = makeReq({ userId: "user_abc", fva: null });
    const { res, status, json } = makeRes();
    const next: NextFunction = vi.fn();

    await requireClerkMFA(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "mfa_required" })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("passes through when 2FA is NOT enabled and route is low-trust", async () => {
    const requireClerkMFA = await loadMiddleware();
    getUserMock.mockResolvedValueOnce({ twoFactorEnabled: false });

    // /api/admin/feature-flags is admin but NOT high-trust
    const req = makeReq({ userId: "user_abc", fva: [60, -1], url: "/api/admin/feature-flags" });
    const { res, status } = makeRes();
    const next: NextFunction = vi.fn();

    await requireClerkMFA(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it("blocks with 403 mfa_setup_required on a high-trust route when 2FA is NOT enabled", async () => {
    const requireClerkMFA = await loadMiddleware();
    getUserMock.mockResolvedValueOnce({ twoFactorEnabled: false });

    const req = makeReq({
      userId: "user_abc",
      fva: [60, -1],
      url: "/api/admin/users/u_123/2fa/reset",
    });
    const { res, status, json } = makeRes();
    const next: NextFunction = vi.fn();

    await requireClerkMFA(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "mfa_setup_required" })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("blocks with 403 mfa_setup_required when MFA_REQUIRED_FOR_ALL_USERS=true even on low-trust routes", async () => {
    process.env.MFA_REQUIRED_FOR_ALL_USERS = "true";
    const requireClerkMFA = await loadMiddleware();
    getUserMock.mockResolvedValueOnce({ twoFactorEnabled: false });

    const req = makeReq({ userId: "user_abc", fva: [60, -1], url: "/api/admin/feature-flags" });
    const { res, status, json } = makeRes();
    const next: NextFunction = vi.fn();

    await requireClerkMFA(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "mfa_setup_required" })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("fails closed (403) when the Clerk SDK lookup throws", async () => {
    const requireClerkMFA = await loadMiddleware();
    getUserMock.mockRejectedValueOnce(new Error("clerk down"));

    const req = makeReq({ userId: "user_abc", fva: [60, -1] });
    const { res, status, json } = makeRes();
    const next: NextFunction = vi.fn();

    await requireClerkMFA(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "mfa_required" })
    );
    expect(next).not.toHaveBeenCalled();
  });
});
