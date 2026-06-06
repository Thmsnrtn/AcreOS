import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

// Captures the values passed to tx.insert(organizations).values({...}) and
// tx.insert(teamMembers).values({...}) so assertions can inspect them.
const insertValues: any[] = [];
let nextOrgRow: any = { id: 2, name: "New Org", ownerId: "u" };

// Mock storage and db.* used by the middleware.
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
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
  },
}));

// Mock withTransaction so the middleware runs against in-memory fakes
// instead of touching the real Postgres connection.
vi.mock("../../server/db", () => {
  const fakeTx = {
    insert: (_table: any) => ({
      values: (vals: any) => {
        insertValues.push(vals);
        // Return a thenable that is also chainable with .returning() —
        // tx.insert(teamMembers).values({...}) is awaited directly, but
        // tx.insert(organizations).values({...}).returning() is also used.
        const result: any = Promise.resolve(undefined);
        result.returning = () => Promise.resolve([nextOrgRow]);
        return result;
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    }),
  };
  return {
    db: fakeTx,
    withTransaction: async (fn: (tx: any) => Promise<any>) => fn(fakeTx),
  };
});

// ─── getOrCreateOrg Middleware ────────────────────────────
describe("getOrCreateOrg middleware", () => {
  let getOrCreateOrg: any;
  let storage: any;

  // vi.resetModules() + re-importing the middleware (which lazily imports
  // a handful of services) can take >10s on the first run, exceeding the
  // default 10s hook timeout. Give it room.
  beforeEach(async () => {
    vi.resetModules();
    insertValues.length = 0;
    nextOrgRow = { id: 2, name: "New Org", ownerId: "u" };
    // Re-import to get fresh mocks
    const storageMod = await import("../../server/storage");
    storage = storageMod.storage;
    storage.getOrganizationByOwner.mockReset();
    const mod = await import("../../server/middleware/getOrCreateOrg");
    getOrCreateOrg = mod.getOrCreateOrg;
  }, 30000);

  function mockReqRes(user: any = null) {
    const req = { user, session: {} } as unknown as Request;
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
    nextOrgRow = { id: 2, name: "Jane's Organization", ownerId: "u2" };

    const { req, res, next } = mockReqRes({ id: "u2", email: "new@example.com", firstName: "Jane" });
    await getOrCreateOrg(req, res, next);

    // First insert = organizations row; second = teamMembers row.
    expect(insertValues[0]).toEqual(
      expect.objectContaining({
        ownerId: "u2",
        subscriptionTier: "free",
        subscriptionStatus: "active",
        isFounder: false,
      })
    );
    expect(insertValues[1]).toEqual(
      expect.objectContaining({
        organizationId: 2,
        userId: "u2",
        role: "owner",
      })
    );
    expect((req as any).organization).toBe(nextOrgRow);
    expect(next).toHaveBeenCalled();
  });

  it("gives founder users enterprise tier on new org", async () => {
    storage.getOrganizationByOwner.mockResolvedValue(null);
    nextOrgRow = { id: 3, name: "Founder Org", ownerId: "u3" };

    // Founder lookup uses env var; set it for this test.
    const prev = process.env.FOUNDER_EMAIL;
    process.env.FOUNDER_EMAIL = "founder@test.com";
    try {
      vi.resetModules();
      const mod = await import("../../server/middleware/getOrCreateOrg");
      getOrCreateOrg = mod.getOrCreateOrg;

      const { req, res, next } = mockReqRes({ id: "u3", email: "founder@test.com" });
      await getOrCreateOrg(req, res, next);

      expect(insertValues[0]).toEqual(
        expect.objectContaining({
          subscriptionTier: "enterprise",
          isFounder: true,
          trialStartedAt: null,
          trialEndsAt: null,
        })
      );
      expect(next).toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.FOUNDER_EMAIL;
      else process.env.FOUNDER_EMAIL = prev;
    }
  });

  it("sets 14-day trial for non-founder new users", async () => {
    // 2026-06-06 Soren P0 fix: trial duration must match the landing
    // promise ("free for 14 days" in landing/copy.ts hero.cta1 and the
    // Stripe trial_period_days in routes-billing.ts). Was 7 prior.
    storage.getOrganizationByOwner.mockResolvedValue(null);
    nextOrgRow = { id: 4 };

    const { req, res, next } = mockReqRes({ id: "u4", email: "user@example.com" });
    await getOrCreateOrg(req, res, next);

    const orgInsert = insertValues[0];
    expect(orgInsert.trialStartedAt).toBeInstanceOf(Date);
    expect(orgInsert.trialEndsAt).toBeInstanceOf(Date);

    const trialDays =
      (orgInsert.trialEndsAt.getTime() - orgInsert.trialStartedAt.getTime()) /
      (1000 * 60 * 60 * 24);
    expect(trialDays).toBeCloseTo(14, 0);
  });
});
