/**
 * Unit Tests: usageLimitGate middleware
 *
 * Tests the factory middleware that enforces usage limits per resource type.
 * - Allowed scenario: next() is called
 * - Denied scenario: 429 returned with correct body
 * - Founder bypass: always allowed regardless of usage
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock checkUsageLimit ────────────────────────────────────────────────────

const mockCheckUsageLimit = vi.fn();

vi.mock("../../server/services/usageLimits", () => ({
  checkUsageLimit: (...args: any[]) => mockCheckUsageLimit(...args),
}));

// ── Import after mocks ──────────────────────────────────────────────────────

import { usageLimitGate } from "../../server/middleware/usageLimitGate";

// ── Test Helpers ────────────────────────────────────────────────────────────

function makeMockReq(organizationId?: number) {
  return {
    organizationId,
    user: organizationId ? { organizationId } : undefined,
  } as any;
}

function makeMockRes() {
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: any) {
      res.body = data;
      return res;
    },
  };
  return res;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("usageLimitGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls next() when usage is within limits", async () => {
    mockCheckUsageLimit.mockResolvedValue({
      allowed: true,
      current: 5,
      limit: 50,
      resourceType: "leads",
      tier: "starter",
    });

    const middleware = usageLimitGate("leads");
    const req = makeMockReq(1);
    const res = makeMockRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it("returns 429 with correct body when limit is exceeded", async () => {
    mockCheckUsageLimit.mockResolvedValue({
      allowed: false,
      current: 50,
      limit: 50,
      resourceType: "leads",
      tier: "free",
    });

    const middleware = usageLimitGate("leads");
    const req = makeMockReq(1);
    const res = makeMockRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({
      error: "limit_exceeded",
      resourceType: "leads",
      current: 50,
      limit: 50,
      tier: "free",
      upgradeUrl: "/settings#billing",
    });
  });

  it("always allows founder orgs (bypass)", async () => {
    mockCheckUsageLimit.mockResolvedValue({
      allowed: true,
      current: 9999,
      limit: null,
      resourceType: "leads",
      tier: "enterprise",
    });

    const middleware = usageLimitGate("leads");
    const req = makeMockReq(1);
    const res = makeMockRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 when organizationId is missing", async () => {
    const middleware = usageLimitGate("leads");
    const req = { user: {} } as any;
    const res = makeMockRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: "organization_required" });
  });

  it("fails open when checkUsageLimit throws", async () => {
    mockCheckUsageLimit.mockRejectedValue(new Error("DB connection failed"));

    const middleware = usageLimitGate("properties");
    const req = makeMockReq(1);
    const res = makeMockRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("works with different resource types", async () => {
    mockCheckUsageLimit.mockResolvedValue({
      allowed: false,
      current: 100,
      limit: 100,
      resourceType: "ai_requests",
      tier: "starter",
    });

    const middleware = usageLimitGate("ai_requests");
    const req = makeMockReq(1);
    const res = makeMockRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(res.body.resourceType).toBe("ai_requests");
    expect(mockCheckUsageLimit).toHaveBeenCalledWith(1, "ai_requests");
  });
});
