/**
 * Unit tests for the admin recovery-console founder gate.
 *
 * Coriander §1: every recovery endpoint (2FA reset, session revoke, autopay
 * freeze, ownership transfer, password-reset link) must reject non-founder
 * callers with a 403 before doing any work. This test pins that contract on
 * the shared `requireFounderForRecovery` helper.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Response } from "express";
import type { AuthenticatedRequest } from "../../server/types/request";

// ── Mock the entire DB / Clerk / Stripe surface so importing the route
// module doesn't try to open real connections in unit-test mode. We only
// exercise `requireFounderForRecovery` here, which doesn't touch any of
// these — but the module-level imports do, so we stub them out.
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("@clerk/express", () => ({
  createClerkClient: () => ({
    users: { getUser: vi.fn() },
    sessions: { getSessionList: vi.fn(), revokeSession: vi.fn() },
    signInTokens: { createSignInToken: vi.fn() },
  }),
}));
vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(() => ({
    subscriptions: { update: vi.fn() },
  })),
}));
vi.mock("../../server/auth", () => ({ isAuthenticated: vi.fn() }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@shared/schema", () => ({
  auditEvents: {},
  organizations: {},
}));
vi.mock("@shared/models/auth", () => ({ users: {} }));

// Founder-identity check is the contract under test — control its return value.
const isFounderIdentityMock = vi.fn();
vi.mock("../../server/services/founder", () => ({
  isFounderIdentity: (args: any) => isFounderIdentityMock(args),
}));

import { requireFounderForRecovery } from "../../server/routes-admin-recovery";

function mockRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

function mockReq(overrides: Partial<any> = {}): AuthenticatedRequest {
  return {
    user: { email: "test@example.com", clerkUserId: "user_123" },
    auth: { userId: "user_123" },
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
    ...overrides,
  } as unknown as AuthenticatedRequest;
}

describe("requireFounderForRecovery", () => {
  beforeEach(() => {
    isFounderIdentityMock.mockReset();
  });

  it("returns true and writes nothing when caller is a founder", () => {
    isFounderIdentityMock.mockReturnValue(true);
    const res = mockRes();
    const req = mockReq();

    const ok = requireFounderForRecovery(req, res);

    expect(ok).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(isFounderIdentityMock).toHaveBeenCalledWith({
      email: "test@example.com",
      userId: "user_123",
    });
  });

  it("returns false and sends 403 FORBIDDEN when caller is NOT a founder", () => {
    isFounderIdentityMock.mockReturnValue(false);
    const res = mockRes();
    const req = mockReq();

    const ok = requireFounderForRecovery(req, res);

    expect(ok).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "FORBIDDEN",
        message: "Founder access required",
        statusCode: 403,
      })
    );
  });

  it("returns false with 403 when req has no user at all", () => {
    isFounderIdentityMock.mockReturnValue(false);
    const res = mockRes();
    const req = mockReq({ user: undefined, auth: undefined });

    const ok = requireFounderForRecovery(req, res);

    expect(ok).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(isFounderIdentityMock).toHaveBeenCalledWith({
      email: null,
      userId: null,
    });
  });

  it("falls back to clerkUserId when req.auth.userId is missing", () => {
    isFounderIdentityMock.mockReturnValue(true);
    const res = mockRes();
    const req = mockReq({
      auth: undefined,
      user: { email: "founder@acreos.io", clerkUserId: "user_founder" },
    });

    requireFounderForRecovery(req, res);

    expect(isFounderIdentityMock).toHaveBeenCalledWith({
      email: "founder@acreos.io",
      userId: "user_founder",
    });
  });
});
