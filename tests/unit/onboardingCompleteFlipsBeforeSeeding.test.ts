/**
 * POST /api/onboarding/complete flips the durable completion flag BEFORE it
 * seeds sample data (onboarding bounce, package 2026-11-05, RC-3).
 *
 * The flag used to be the route's last write, behind the seed — the slowest,
 * most failure-prone step. A seed that hung, or a process that died while
 * seeding, left an org that had finished the wizard with no completion
 * record, so the gate sent the user back into the wizard.
 *
 * Ordering changes, semantics don't: a seed failure is still reported as
 * `incomplete: ["sample data"]`, `success: false`, `completed: true`.
 *
 * Storage/db/seeder are mocked the same way routes-onboarding.test.ts mocks
 * them; the assertion is what the stored org says AT THE MOMENT the seeder is
 * entered, which is the property the reorder exists for.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const h = vi.hoisted(() => {
  const state: { org: any; completedWhenSeedingStarted: boolean | null } = {
    org: null,
    completedWhenSeedingStarted: null,
  };
  const storage = {
    getOrganization: vi.fn(async (_id: number) => state.org),
    updateOrganization: vi.fn(async (_id: number, updates: any) => {
      state.org = { ...state.org, ...updates };
      return state.org;
    }),
  };
  const seedSampleDataForOrg = vi.fn();
  return { state, storage, seedSampleDataForOrg };
});

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/storage", () => ({ storage: h.storage, db: {} }));
vi.mock("../../server/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
}));
vi.mock("../../server/services/onboarding/sampleSeeder", () => ({
  seedSampleDataForOrg: h.seedSampleDataForOrg,
  clearSampleDataForOrg: vi.fn(),
}));
vi.mock("../../server/utils/openaiClient", () => ({ getOpenAIClient: () => null }));

import onboardingRouter from "../../server/routes-onboarding";

const TEST_USER = { id: "user-1", email: "u@example.com", firstName: "Test" };
const body = { formData: { businessType: "land_flipper", orgName: "Acme Land" }, seedSampleData: true, path: "fast" };

describe("POST /api/onboarding/complete — completion is durable before seeding", () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use(
      "/api/onboarding",
      (req, _res, next) => {
        (req as any).user = TEST_USER;
        (req as any).organization = h.state.org;
        (req as any).organizationId = h.state.org?.id;
        next();
      },
      onboardingRouter,
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    h.state.org = {
      id: 42,
      name: "Acme Land",
      onboardingCompleted: false,
      onboardingStep: 0,
      onboardingData: null,
      settings: {},
      ownerId: "user-1",
    };
    h.state.completedWhenSeedingStarted = null;
  });

  it("a failing seed: the org is already complete when seeding starts, and the failure is still reported as incomplete", async () => {
    h.seedSampleDataForOrg.mockImplementationOnce(async () => {
      h.state.completedWhenSeedingStarted = h.state.org.onboardingCompleted === true;
      throw new Error("seed failed");
    });

    const res = await request(app).post("/api/onboarding/complete").send(body);

    expect(h.seedSampleDataForOrg).toHaveBeenCalledTimes(1);
    expect(h.state.completedWhenSeedingStarted).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: false, completed: true, incomplete: ["sample data"] });
    expect(h.state.org.onboardingCompleted).toBe(true);
  });

  it("a hanging seed: the completion record exists while the seed is still running", async () => {
    let releaseSeed!: () => void;
    let seedEntered!: () => void;
    const entered = new Promise<void>((r) => (seedEntered = r));
    h.seedSampleDataForOrg.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          seedEntered();
          releaseSeed = () => resolve({ seeded: true, counts: { leads: 5 } });
        }),
    );

    const inFlight = request(app).post("/api/onboarding/complete").send(body).then((r) => r);
    await entered;

    // The seed has not returned — and the org is already durably complete.
    expect(h.state.org.onboardingCompleted).toBe(true);
    expect(h.state.org.settings?.onboardingCompleted).toBe(true);

    releaseSeed();
    const res = await inFlight;
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, completed: true, sampleData: { seeded: true } });
  });

  it("a successful seed still answers success with the seed counts (contract unchanged)", async () => {
    h.seedSampleDataForOrg.mockResolvedValueOnce({ seeded: true, counts: { leads: 5, properties: 3 } });
    const res = await request(app).post("/api/onboarding/complete").send(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      completed: true,
      organizationUpdated: true,
      sampleData: { seeded: true, counts: { leads: 5, properties: 3 } },
    });
  });
});
