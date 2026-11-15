/**
 * Signup trim (W1.4) — every writer of an org's business type refuses a closed
 * type for a new signup, driven through the REAL routes (audit of #499).
 *
 * The earlier check only looked for the guard's name in five of the seven
 * handlers, so a guard handed `undefined` instead of the requested type stayed
 * green. Here each writer is sent a closed type over HTTP and must answer 422
 * with nothing written; the same request with an open type must reach a write
 * (so a harness that never reaches the sink cannot pass).
 *
 * And "new signup" is decided by when the org was created, not by whether it
 * finished onboarding: Skip marks an org onboarded with no type check, so a
 * signup that presses Skip and then asks for a closed type is still refused.
 * An org created before the trim shipped is untouched.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const TRIM_SHIPPED_AT = new Date("2026-11-01T00:00:00Z");
const AFTER_TRIM = new Date("2026-11-10T00:00:00Z");
const BEFORE_TRIM = new Date("2026-01-15T00:00:00Z");

const h = vi.hoisted(() => {
  const state = {
    org: null as any,
    flag: null as null | { state: string; createdAt: Date | null },
    writes: [] as string[],
  };
  const passUser = (req: any, _res: any, next: any) => {
    req.user = { id: "owner-1", email: "o@example.com" };
    next();
  };
  const passOrg = (req: any, _res: any, next: any) => {
    req.organization = state.org;
    req.organizationId = state.org?.id;
    next();
  };
  return { state, passUser, passOrg };
});

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/auth", () => ({
  isAuthenticated: h.passUser,
  requireFounder: (_req: any, res: any) => res.status(404).end(),
  getOrCreateOrg: h.passOrg,
}));
vi.mock("../../server/auth/clerkAuth", () => ({
  isAuthenticated: h.passUser,
  requireFounder: (_req: any, res: any) => res.status(404).end(),
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: h.passOrg,
  ACTIVE_ORG_COOKIE: "acreos_active_org",
  ACTIVE_ORG_COOKIE_OPTS: {},
}));
vi.mock("../../server/middleware/roleScope", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  requireScope: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../server/utils/auditLog", () => ({
  auditFromRequest: vi.fn(async () => undefined),
  AuditActions: new Proxy({}, { get: (_t, k) => String(k) }),
}));
vi.mock("../../server/middleware/botSignals", () => ({
  recordSignupSignals: vi.fn(async () => undefined),
  computeReqIpBucket: () => "bucket",
}));
vi.mock("../../server/services/activation", () => ({
  recordActivationEventAsync: vi.fn(),
  onboardingStepCompletedEvent: vi.fn(() => ({})),
}));
vi.mock("../../server/services/lifecycleEvents", () => ({ recordLifecycleEvent: vi.fn(async () => undefined) }));
vi.mock("../../server/services/onboarding/sampleSeeder", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  seedSampleDataForOrg: vi.fn(async () => ({ seeded: true, counts: {} })),
  clearSampleDataForOrg: vi.fn(),
}));
vi.mock("../../server/utils/openaiClient", () => ({ getOpenAIClient: () => null }));
vi.mock("../../server/services/featureFlags", () => ({
  featureFlagService: {
    getByKey: async () => (h.state.flag ? { key: "onboarding.signup_trim", ...h.state.flag } : null),
  },
}));
// Every onboarding-service method is a write sink here; the org-level ones
// also persist into the fixture so the next request sees them (Skip, then switch).
vi.mock("../../server/services/onboarding", () => ({
  onboardingService: new Proxy(
    {},
    {
      get: (_t, name) => async (..._args: unknown[]) => {
        h.state.writes.push(`onboardingService.${String(name)}`);
        if (name === "completeOnboarding") h.state.org = { ...h.state.org, onboardingCompleted: true };
        if (name === "provisionTemplates") return { success: true, provisioned: { campaigns: 0, tags: [] } };
        return { currentStep: 0, completed: false };
      },
    },
  ),
}));
vi.mock("../../server/storage", () => ({
  storage: {
    updateOrganization: vi.fn(async (_id: number, u: Record<string, unknown>) => {
      h.state.writes.push("storage.updateOrganization");
      h.state.org = { ...h.state.org, ...u };
      return h.state.org;
    }),
    getTeamMember: vi.fn(async () => undefined),
    getTeamMembers: vi.fn(async () => []),
    createAuditLogEntry: vi.fn(async () => undefined),
  },
  db: {},
}));
vi.mock("../../server/db", () => {
  const select = () => {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      limit: async () => [h.state.org],
      then: (ok: (v: unknown) => unknown) => ok([h.state.org]),
    };
    return chain;
  };
  return {
    db: {
      select,
      update: (t: unknown) => ({
        set: () => ({
          where: async () => {
            h.state.writes.push(`db.update(${(t as any)?.[Symbol.for("drizzle:Name")] ?? "table"})`);
          },
        }),
      }),
      insert: () => ({
        values: () => {
          h.state.writes.push("db.insert");
          const done: any = Promise.resolve([]);
          done.returning = async () => [{ id: 1 }];
          done.onConflictDoNothing = () => done;
          return done;
        },
      }),
    },
  };
});

import onboardingRouter from "../../server/routes-onboarding";
import personaRouter from "../../server/routes-persona";
import { registerOrganizationRoutes } from "../../server/routes-organization";

/** The seven writers, each with a request that would write `type`. */
const WRITERS: Array<{ name: string; send: (app: express.Express, type: string) => request.Test }> = [
  { name: "POST /api/onboarding/complete", send: (a, t) => request(a).post("/api/onboarding/complete").send({ businessType: t }) },
  { name: "PATCH /api/onboarding/progress", send: (a, t) => request(a).patch("/api/onboarding/progress").send({ step: 1, businessType: t }) },
  { name: "PUT /api/onboarding/step", send: (a, t) => request(a).put("/api/onboarding/step").send({ step: 1, data: { businessType: t } }) },
  { name: "POST /api/onboarding/complete-step", send: (a, t) => request(a).post("/api/onboarding/complete-step").send({ stepId: 1, data: { businessType: t } }) },
  { name: "POST /api/onboarding/provision", send: (a, t) => request(a).post("/api/onboarding/provision").send({ businessType: t }) },
  { name: "PUT /api/me/persona", send: (a, t) => request(a).put("/api/me/persona").send({ persona: "land_investor", businessType: t }) },
  { name: "PATCH /api/organization", send: (a, t) => request(a).patch("/api/organization").send({ onboardingData: { businessType: t } }) },
];

const CLOSED = "fix_and_flip";
const OPEN = "land_flipper";
const org = (o: Record<string, unknown> = {}) => ({
  id: 42,
  ownerId: "owner-1",
  onboardingCompleted: false,
  onboardingData: null,
  settings: {},
  createdAt: AFTER_TRIM,
  ...o,
});

let app: express.Express;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use(h.passUser);
  // Mounted in production order: the onboarding router before the org routes.
  app.use("/api/onboarding", h.passOrg, onboardingRouter);
  app.use("/api/me/persona", personaRouter);
  registerOrganizationRoutes(app);
});
beforeEach(() => {
  h.state.org = org();
  h.state.flag = { state: "on", createdAt: TRIM_SHIPPED_AT };
  h.state.writes = [];
});

describe("every business-type writer, driven for real", () => {
  it("the list is the seven writers (vacuity)", () => {
    expect(WRITERS).toHaveLength(7);
  });

  it.each(WRITERS)("$name: a new signup asking for a closed type gets 422 and nothing is written", async (w) => {
    const res = await w.send(app, CLOSED);
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.details).toMatchObject({ reason: "business_type_not_open", requested: CLOSED });
    expect(h.state.writes).toEqual([]);
  });

  it.each(WRITERS)("$name: the same request with an open type reaches a write", async (w) => {
    const res = await w.send(app, OPEN);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(h.state.writes.length).toBeGreaterThan(0);
  });

  it.each(WRITERS)("$name: Skip, then switch to a closed type, is still refused", async (w) => {
    const skipped = await request(app).post("/api/onboarding/skip").send({});
    expect(skipped.status).toBe(200);
    // The real Skip route did mark the org onboarded: this is the shape the audit found.
    expect(h.state.org.onboardingCompleted).toBe(true);
    expect(h.state.org.onboardingData).toMatchObject({ skipped: true });
    h.state.writes = [];

    const res = await w.send(app, CLOSED);
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(h.state.writes).toEqual([]);
  });

  it.each(WRITERS)("$name: an org created after the trim and fully onboarded is still refused", async (w) => {
    h.state.org = org({ onboardingCompleted: true, onboardingData: { businessType: OPEN } });
    const res = await w.send(app, CLOSED);
    expect(res.status).toBe(422);
    expect(h.state.writes).toEqual([]);
  });

  it.each(WRITERS)("$name: an org created before the trim is untouched", async (w) => {
    h.state.org = org({ createdAt: BEFORE_TRIM, onboardingCompleted: true, onboardingData: { businessType: OPEN } });
    const res = await w.send(app, CLOSED);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it("with the trim off, a new signup's closed type is accepted", async () => {
    h.state.flag = { state: "off", createdAt: TRIM_SHIPPED_AT };
    for (const w of WRITERS) {
      h.state.org = org();
      expect((await w.send(app, CLOSED)).status, w.name).toBe(200);
    }
  });

  it("with no flag row (trim ON by default, no ship date) no org is shown to predate it", async () => {
    h.state.flag = null;
    h.state.org = org({ createdAt: BEFORE_TRIM, onboardingCompleted: true });
    expect((await WRITERS[6].send(app, CLOSED)).status).toBe(422);
  });
});
