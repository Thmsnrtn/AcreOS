/**
 * Unit Tests: usageLimitGate middleware
 *
 * Tests the factory middleware that enforces usage limits per resource type.
 * - Allowed scenario: next() is called
 * - Denied scenario: 429 returned with the LIMIT_EXCEEDED envelope and the
 *   tier-diff `details` payload (Lens 3 — Pricing Coherence)
 * - Founder bypass: always allowed regardless of usage
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock checkUsageLimit ────────────────────────────────────────────────────

const mockCheckUsageLimit = vi.fn();

vi.mock("../../server/services/usageLimits", async () => {
  const actual = await vi.importActual<any>("../../server/services/usageLimits");
  return {
    ...actual,
    checkUsageLimit: (...args: any[]) => mockCheckUsageLimit(...args),
  };
});

// ── Import after mocks ──────────────────────────────────────────────────────

import { usageLimitGate } from "../../server/middleware/usageLimitGate";
import { TIER_LIMITS } from "@shared/billing/tier-limits";
import { TIER_PRICES_CENTS } from "@shared/billing/tier-pricing";

// ── Test Helpers ────────────────────────────────────────────────────────────

function makeMockReq(organizationId?: number, isFounder = false) {
  return {
    organizationId,
    user: organizationId ? { organizationId } : undefined,
    isFounder,
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

  it("returns 429 with the Lens-3 tier-diff payload when limit is exceeded", async () => {
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
    expect(res.body.error).toBe("LIMIT_EXCEEDED");
    expect(res.body.message).toBe("Usage limit exceeded");
    expect(res.body.details).toEqual({
      resourceType: "leads",
      currentTier: "free",
      currentCount: 50,
      currentLimit: 50,
      nextTier: "starter",
      nextTierLimit: TIER_LIMITS.starter.leads,
      nextTierMonthlyPriceCents: TIER_PRICES_CENTS.starter.priceMonthlyCents,
      upgradeUrl: "/settings#billing?tier=starter",
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
    const req = makeMockReq(1, true);
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
    expect(res.body.error).toBe("UNAUTHORIZED");
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
      current: 25,
      limit: 25,
      resourceType: "ai_requests",
      tier: "free",
    });

    const middleware = usageLimitGate("ai_requests");
    const req = makeMockReq(1);
    const res = makeMockRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(res.body.details.resourceType).toBe("ai_requests");
    expect(res.body.details.nextTier).toBe("starter");
    expect(res.body.details.nextTierLimit).toBe(TIER_LIMITS.starter.ai_requests);
    expect(mockCheckUsageLimit).toHaveBeenCalledWith(1, "ai_requests", { isFounder: false });
  });

  it("returns nextTier=null when already on top self-serve tier (scale)", async () => {
    mockCheckUsageLimit.mockResolvedValue({
      allowed: false,
      current: 9999,
      limit: 9999,
      resourceType: "leads",
      tier: "scale",
    });

    const middleware = usageLimitGate("leads");
    const req = makeMockReq(1);
    const res = makeMockRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.statusCode).toBe(429);
    expect(res.body.details.nextTier).toBeNull();
    expect(res.body.details.nextTierMonthlyPriceCents).toBeNull();
    expect(res.body.details.upgradeUrl).toBe("/settings#billing");
  });
});
