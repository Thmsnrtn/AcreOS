/**
 * Unit tests for the featureGate middleware.
 *
 * Verifies that:
 *   1. Enabled flags allow the request through (calls next())
 *   2. Disabled flags return 404
 *   3. Missing flags return 404
 *   4. Database errors fall through gracefully (calls next())
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

// ── Mock the DB layer ──────────────────────────────────────────────────────────

const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();

vi.mock("../../server/db", () => ({
  db: {
    select: (...args: any[]) => {
      mockSelect(...args);
      return { from: mockFrom };
    },
  },
}));

// Chain: db.select().from().where().limit() → rows
mockFrom.mockReturnValue({ where: mockWhere });
mockWhere.mockReturnValue({ limit: mockLimit });

vi.mock("@shared/schema", () => ({
  platformFeatureFlags: {
    key: "key",
    enabled: "enabled",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: string) => ({ col, val }),
}));

vi.mock("../../server/services/founder", () => ({
  isFounderEmail: (e?: string) => e === "founder@test.local",
}));

// ── Import after mocks ─────────────────────────────────────────────────────────

import { featureGate, requireLadderFlag } from "../../server/middleware/featureGate";

// ── Helpers ────────────────────────────────────────────────────────────────────

function mockReqRes() {
  const req = {} as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const next = vi.fn() as NextFunction;
  return { req, res, next };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("featureGate middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ limit: mockLimit });
  });

  it("calls next() when the flag exists and is enabled", async () => {
    mockLimit.mockResolvedValueOnce([{ key: "feature_marketplace", enabled: true }]);

    const { req, res, next } = mockReqRes();
    await featureGate("feature_marketplace")(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 404 when the flag exists but is disabled", async () => {
    mockLimit.mockResolvedValueOnce([{ key: "feature_marketplace", enabled: false }]);

    const { req, res, next } = mockReqRes();
    await featureGate("feature_marketplace")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
    // The body moved to the standard error envelope. This gate used to answer
    // with an ad-hoc `{ message }` — the only shape in the API that did not
    // conform to `{ error, message, statusCode }`. The INVARIANT this test
    // protects is unchanged (404, and next() is not called); only the shape of
    // the refusal is, so the assertion is rewritten rather than dropped.
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "FEATURE_NOT_AVAILABLE", statusCode: 404 }),
    );
  });

  it("returns 404 when the flag does not exist", async () => {
    mockLimit.mockResolvedValueOnce([]);

    const { req, res, next } = mockReqRes();
    await featureGate("feature_nonexistent")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 404 when the database throws (fail closed for non-founders)", async () => {
    // Post-port behavior (featureFlagService): getByKey swallows DB errors
    // and returns null. isEnabled then returns ctx.isFounder. For a request
    // with no founder context the gate fails closed.
    mockLimit.mockRejectedValueOnce(new Error("relation does not exist"));

    const { req, res, next } = mockReqRes();
    await featureGate("feature_marketplace")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("enterprise tier bypasses an ORDINARY flag (the documented back-compat hatch)", async () => {
    const { req, res, next } = mockReqRes();
    (req as any).organization = { subscriptionTier: "enterprise" };
    await featureGate("feature_marketplace")(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(mockSelect).not.toHaveBeenCalled(); // bypass happens before any lookup
  });

  it("an UNEXPECTED error fails OPEN — requireFlag's documented posture", async () => {
    const { req, res, next } = mockReqRes();
    // Poison a property only buildFlagContext reads (INSIDE the try) so the
    // middleware's own catch — not the service's swallow — decides the
    // outcome. req.user/req.organization are read before the try begins.
    Object.defineProperty(req, "isFounder", {
      get() { throw new Error("poisoned request"); },
    });
    await featureGate("feature_marketplace")(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

/**
 * requireLadderFlag — the GOVERNANCE variant enforcing founder decisions
 * (expansion ladder: "no marketplace before ~25 customers").
 *
 * WHY THESE CASES EXIST (2026-08-31): the CI coverage ratchet had been red
 * for three weeks because this entire function — the fail-closed
 * founder-decision gate — had ZERO behavioral coverage. Its own doc-comment
 * cited expansionLadder.test.ts as enforcement, but that test pins
 * source-shape (export exists, not mounted), never behavior: a gate whose
 * fail-closed branch was rewritten to fail OPEN would have stayed green.
 * These cases pin the two properties that make it a governance gate rather
 * than a feature flag.
 */
describe("requireLadderFlag — the governance variant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ limit: mockLimit });
  });

  it("the founder passes — they must be able to see the surface they rule on", async () => {
    const { req, res, next } = mockReqRes();
    (req as any).user = { email: "founder@test.local" };
    await requireLadderFlag("expansion.marketplace")(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("enterprise tier does NOT bypass — a paid plan cannot buy past a founder decision", async () => {
    mockLimit.mockResolvedValueOnce([]); // flag absent → off
    const { req, res, next } = mockReqRes();
    (req as any).organization = { subscriptionTier: "enterprise" };
    await requireLadderFlag("expansion.marketplace")(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("an enabled flag passes a non-founder through", async () => {
    mockLimit.mockResolvedValueOnce([
      { key: "expansion.marketplace", state: "on", enabled: true },
    ]);
    const { req, res, next } = mockReqRes();
    await requireLadderFlag("expansion.marketplace")(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("a disabled flag refuses", async () => {
    mockLimit.mockResolvedValueOnce([]);
    const { req, res, next } = mockReqRes();
    await requireLadderFlag("expansion.marketplace")(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("an UNEXPECTED error fails CLOSED — an expansion gate that opens on an error is not a gate", async () => {
    const { req, res, next } = mockReqRes();
    Object.defineProperty(req, "isFounder", {
      get() { throw new Error("poisoned request"); },
    });
    await requireLadderFlag("expansion.marketplace")(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
