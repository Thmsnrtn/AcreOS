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

// ── Import after mocks ─────────────────────────────────────────────────────────

import { featureGate } from "../../server/middleware/featureGate";

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
});
