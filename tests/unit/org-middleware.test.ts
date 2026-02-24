import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

// Mock storage before importing the middleware
vi.mock("../../server/storage", () => ({
  storage: {
    getOrganizationByOwner: vi.fn(),
    createOrganization: vi.fn(),
    createTeamMember: vi.fn(),
  },
  db: {
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
}));

// ─── getOrCreateOrg Middleware ────────────────────────────
describe("getOrCreateOrg middleware", () => {
  let getOrCreateOrg: any;
  let storage: any;

  beforeEach(async () => {
    vi.resetModules();
    // Re-import to get fresh mocks
    const storageMod = await import("../../server/storage");
    storage = storageMod.storage;
    const mod = await import("../../server/middleware/getOrCreateOrg");
    getOrCreateOrg = mod.getOrCreateOrg;
  });

  function mockReqRes(user: any = null) {
    const req = { user } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;
    const next = vi.fn() as NextFunction;
    return { req, res, next };
  }

  it("returns 401 when no user is present", async () => {
    const { req, res, next } = mockReqRes(null);
    await getOrCreateOrg(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when user has no id", async () => {
    const { req, res, next } = mockReqRes({ email: "test@example.com" });
    await getOrCreateOrg(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("attaches existing org and calls next", async () => {
    const existingOrg = { id: 1, name: "Test Org", ownerId: "u1", isFounder: false };
    storage.getOrganizationByOwner.mockResolvedValue(existingOrg);

    const { req, res, next } = mockReqRes({ id: "u1", email: "user@example.com" });
    await getOrCreateOrg(req, res, next);

    expect(storage.getOrganizationByOwner).toHaveBeenCalledWith("u1");
    expect((req as any).organization).toBe(existingOrg);
    expect(next).toHaveBeenCalled();
  });

  it("creates a new org for first-time user", async () => {
    storage.getOrganizationByOwner.mockResolvedValue(null);
    const newOrg = { id: 2, name: "New Org", ownerId: "u2" };
    storage.createOrganization.mockResolvedValue(newOrg);
    storage.createTeamMember.mockResolvedValue({});

    const { req, res, next } = mockReqRes({ id: "u2", email: "new@example.com", firstName: "Jane" });
    await getOrCreateOrg(req, res, next);

    expect(storage.createOrganization).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "u2",
        subscriptionTier: "free",
        subscriptionStatus: "active",
        isFounder: false,
      })
    );
    expect(storage.createTeamMember).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 2,
        userId: "u2",
        role: "owner",
      })
    );
    expect((req as any).organization).toBe(newOrg);
    expect(next).toHaveBeenCalled();
  });

  it("gives founder users enterprise tier on new org", async () => {
    storage.getOrganizationByOwner.mockResolvedValue(null);
    const founderOrg = { id: 3, name: "Founder Org", ownerId: "u3" };
    storage.createOrganization.mockResolvedValue(founderOrg);
    storage.createTeamMember.mockResolvedValue({});

    const { req, res, next } = mockReqRes({ id: "u3", email: "founder@test.com" });
    await getOrCreateOrg(req, res, next);

    expect(storage.createOrganization).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionTier: "enterprise",
        isFounder: true,
        trialStartedAt: null,
        trialEndsAt: null,
      })
    );
    expect(next).toHaveBeenCalled();
  });

  it("sets 7-day trial for non-founder new users", async () => {
    storage.getOrganizationByOwner.mockResolvedValue(null);
    storage.createOrganization.mockResolvedValue({ id: 4 });
    storage.createTeamMember.mockResolvedValue({});

    const { req, res, next } = mockReqRes({ id: "u4", email: "user@example.com" });
    await getOrCreateOrg(req, res, next);

    const createCall = storage.createOrganization.mock.calls[0][0];
    expect(createCall.trialStartedAt).toBeInstanceOf(Date);
    expect(createCall.trialEndsAt).toBeInstanceOf(Date);

    // Trial should be approximately 7 days
    const trialDays = (createCall.trialEndsAt.getTime() - createCall.trialStartedAt.getTime()) / (1000 * 60 * 60 * 24);
    expect(trialDays).toBeCloseTo(7, 0);
  });
});
