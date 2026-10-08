import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

// Captures the values passed to tx.insert(organizations).values({...}) and
// tx.insert(teamMembers).values({...}) so assertions can inspect them.
// Each insert is recorded WITH its table. getOrCreateOrg also starts the
// onboarding journey for a new customer org (fire-and-forget, Stage 2 S2),
// and that write lands on this same fake db. Reading "the first insert"
// positionally made the founder test read whichever insert happened first —
// including a journey row left over from the PREVIOUS test's fire-and-forget,
// which resolves after beforeEach cleared the list. Assertions now name the
// table they mean, and afterEach drains the fire-and-forget.
const inserts: Array<{ table: string; vals: any }> = [];
const insertsInto = (table: string) => inserts.filter((i) => i.table === table).map((i) => i.vals);
let nextOrgRow: any = { id: 2, name: "New Org", ownerId: "u" };

// The S2 onboarding journey is started fire-and-forget for a new CUSTOMER org.
// A spy, so its write can never land in another test's capture (the root
// cause of the founder-test failure: the previous test's journey insert
// resolved after beforeEach had cleared the list and read as "the first
// insert"), and so the call itself is asserted.
const journeySpy = vi.hoisted(() => vi.fn(async (_orgId: number) => ({ started: true })));
vi.mock("../../server/services/onboardingAutonomy", () => ({ startJourney: journeySpy }));

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
    insert: (table: any) => ({
      values: (vals: any) => {
        inserts.push({ table: String(table?.[Symbol.for("drizzle:Name")] ?? "?"), vals });
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
    inserts.length = 0;
    journeySpy.mockClear();
    nextOrgRow = { id: 2, name: "New Org", ownerId: "u" };
    // Re-import to get fresh mocks
    const storageMod = await import("../../server/storage");
    storage = storageMod.storage;
    storage.getOrganizationByOwner.mockReset();
    const mod = await import("../../server/middleware/getOrCreateOrg");
    getOrCreateOrg = mod.getOrCreateOrg;
  }, 30000);

  /** Let fire-and-forget work (the journey start) finish inside its own test. */
  const drain = async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  };
  afterEach(drain);

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

    expect(insertsInto("organizations")[0]).toEqual(
      expect.objectContaining({
        ownerId: "u2",
        subscriptionTier: "free",
        subscriptionStatus: "active",
        isFounder: false,
      })
    );
    expect(insertsInto("team_members")[0]).toEqual(
      expect.objectContaining({
        organizationId: 2,
        userId: "u2",
        role: "owner",
      })
    );
    // S2: a new CUSTOMER org starts its onboarding journey.
    await vi.waitFor(() => expect(journeySpy).toHaveBeenCalledWith(2));
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

      expect(insertsInto("organizations")[0]).toEqual(
        expect.objectContaining({
          subscriptionTier: "enterprise",
          isFounder: true,
          trialStartedAt: null,
          trialEndsAt: null,
        })
      );
      expect(next).toHaveBeenCalled();
      // The founder's own org is not a customer: no onboarding journey.
      await drain();
      expect(journeySpy).not.toHaveBeenCalled();
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

    const orgInsert = insertsInto("organizations")[0];
    expect(orgInsert.trialStartedAt).toBeInstanceOf(Date);
    expect(orgInsert.trialEndsAt).toBeInstanceOf(Date);

    const trialDays =
      (orgInsert.trialEndsAt.getTime() - orgInsert.trialStartedAt.getTime()) /
      (1000 * 60 * 60 * 24);
    expect(trialDays).toBeCloseTo(14, 0);
  });
});
