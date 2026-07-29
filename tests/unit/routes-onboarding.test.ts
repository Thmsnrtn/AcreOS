/**
 * Onboarding routes + service unit tests (no live DB — storage/db mocked).
 *
 * Pins the rebuilt onboarding contract:
 *   1. POST /api/onboarding/complete is the SINGLE code path (the duplicate
 *      in routes-organization.ts is gone) and accepts ALL 15 registry
 *      businessType ids — including the previously orphaned "subdivider".
 *   2. noteRole is threaded through: persisted in onboardingData and used in
 *      persona derivation.
 *   3. Sample data goes through the idempotent seeder contract
 *      (seedSampleDataForOrg), opt-out via seedSampleData:false; the old
 *      inline non-idempotent seeding in completeOnboarding is gone.
 *   4. POST /api/onboarding/skip is honest: marks complete with a
 *      skipped:true marker, seeds NOTHING, fabricates no progress.
 *   5. resetOnboarding preserves businessType/noteRole (persona-relevant
 *      fields), clearing only completion state — a reset + re-run without an
 *      explicit new pick never changes persona.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import fs from "fs";
import path from "path";

const h = vi.hoisted(() => {
  const state: { org: any } = { org: null };
  const storage = {
    getOrganization: vi.fn(async (_id: number) => state.org),
    updateOrganization: vi.fn(async (_id: number, updates: any) => {
      state.org = { ...state.org, ...updates };
      return state.org;
    }),
    createLead: vi.fn(async (d: any) => ({ id: 1, ...d })),
    createProperty: vi.fn(async (d: any) => ({ id: 1, ...d })),
    createDeal: vi.fn(async (d: any) => ({ id: 1, ...d })),
    createNote: vi.fn(async (d: any) => ({ id: 1, ...d })),
    createCampaign: vi.fn(async (d: any) => ({ id: 1, ...d })),
    getLeads: vi.fn(async () => []),
    getProperties: vi.fn(async () => []),
    deleteLead: vi.fn(async () => undefined),
    deleteProperty: vi.fn(async () => undefined),
  };
  const dbUpdates: Array<{ table: unknown; values: any }> = [];
  const seedSampleDataForOrg = vi.fn(
    async (_orgId: string, _businessType: string, _opts?: { userId?: string }) => ({
      seeded: true,
      counts: { leads: 2, properties: 1 },
    }),
  );
  const clearSampleDataForOrg = vi.fn(async (_orgId: string) => ({ cleared: {} }));
  return { state, storage, dbUpdates, seedSampleDataForOrg, clearSampleDataForOrg };
});

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/storage", () => ({ storage: h.storage, db: {} }));

vi.mock("../../server/db", () => ({
  db: {
    update: (table: unknown) => ({
      set: (values: any) => ({
        where: async () => {
          h.dbUpdates.push({ table, values });
        },
      }),
    }),
  },
}));

vi.mock("../../server/services/onboarding/sampleSeeder", () => ({
  seedSampleDataForOrg: h.seedSampleDataForOrg,
  clearSampleDataForOrg: h.clearSampleDataForOrg,
}));

vi.mock("../../server/utils/openaiClient", () => ({
  getOpenAIClient: () => null,
}));

import onboardingRouter from "../../server/routes-onboarding";
import { onboardingService } from "../../server/services/onboarding";
import { users, organizations } from "@shared/schema";
import { BUSINESS_TYPE_IDS } from "@shared/business-types";
import { BUSINESS_TYPES } from "@shared/models/persona-mapping";

const TEST_USER = { id: "user-1", email: "u@example.com", firstName: "Test" };

function freshOrg(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    name: "Test Org",
    onboardingCompleted: false,
    onboardingStep: 0,
    onboardingData: null,
    settings: {},
    ...overrides,
  };
}

describe("onboarding routes", () => {
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
    h.state.org = freshOrg();
    h.dbUpdates.length = 0;
    vi.clearAllMocks();
  });

  describe("registry alignment (subdivider orphan fix)", () => {
    it("shared persona-mapping BUSINESS_TYPES matches all 15 registry ids", () => {
      expect([...BUSINESS_TYPES].sort()).toEqual([...BUSINESS_TYPE_IDS].sort());
      expect(BUSINESS_TYPES).toContain("subdivider");
      expect(BUSINESS_TYPES).toHaveLength(15);
    });

    it("POST /complete accepts every one of the 15 registry businessType ids", async () => {
      for (const id of BUSINESS_TYPE_IDS) {
        h.state.org = freshOrg();
        const res = await request(app)
          .post("/api/onboarding/complete")
          .send({ businessType: id });
        expect(res.status, `businessType=${id}`).toBe(200);
        expect(res.body.success).toBe(true);
        expect(h.state.org.onboardingData?.businessType, `businessType=${id}`).toBe(id);
      }
    });

    it("POST /complete rejects an unknown businessType with 400 (no silent fallback)", async () => {
      const res = await request(app)
        .post("/api/onboarding/complete")
        .send({ businessType: "vacation_rental" });
      expect(res.status).toBe(400);
      expect(h.seedSampleDataForOrg).not.toHaveBeenCalled();
      expect(h.state.org.onboardingCompleted).toBe(false);
    });

    it("provisionTemplates provisions templates for subdivider (previously orphaned)", async () => {
      h.state.org = freshOrg();
      const result = await onboardingService.provisionTemplates(42, "subdivider");
      expect(result.success).toBe(true);
      expect(result.provisioned.campaigns).toBeGreaterThan(0);
      expect(h.storage.createCampaign).toHaveBeenCalled();
    });
  });

  describe("POST /api/onboarding/complete (single code path)", () => {
    it("the duplicate handler in routes-organization.ts is gone", () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, "../../server/routes-organization.ts"),
        "utf8",
      );
      expect(src).not.toMatch(/api\.post\(\s*["']\/api\/onboarding\/complete["']/);
    });

    it("marks onboarding complete and seeds via the seeder contract by default", async () => {
      const res = await request(app)
        .post("/api/onboarding/complete")
        .send({ formData: { businessType: "subdivider", orgName: "Acme Lots" }, path: "fast" });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        sampleData: { seeded: true, counts: { leads: 2, properties: 1 } },
      });
      expect(h.seedSampleDataForOrg).toHaveBeenCalledTimes(1);
      expect(h.seedSampleDataForOrg).toHaveBeenCalledWith("42", "subdivider", {
        userId: "user-1",
      });
      expect(h.state.org.onboardingCompleted).toBe(true);
      // The removed inline seeding must never come back: no direct row writes.
      expect(h.storage.createLead).not.toHaveBeenCalled();
      expect(h.storage.createProperty).not.toHaveBeenCalled();
      expect(h.storage.createDeal).not.toHaveBeenCalled();
    });

    it("does not seed when seedSampleData:false", async () => {
      const res = await request(app)
        .post("/api/onboarding/complete")
        .send({ businessType: "land_flipper", seedSampleData: false });
      expect(res.status).toBe(200);
      expect(h.seedSampleDataForOrg).not.toHaveBeenCalled();
      expect(res.body.sampleData).toBeUndefined();
      expect(h.state.org.onboardingCompleted).toBe(true);
    });

    it("persists noteRole and derives the note-role persona", async () => {
      const res = await request(app)
        .post("/api/onboarding/complete")
        .send({ businessType: "note_investor", noteRole: "service" });
      expect(res.status).toBe(200);
      expect(h.state.org.onboardingData?.noteRole).toBe("service");
      const userUpdate = h.dbUpdates.find((u) => u.table === users);
      expect(userUpdate?.values.persona).toBe("note_servicer");
      const orgUpdate = h.dbUpdates.find((u) => u.table === organizations);
      expect(orgUpdate?.values.investorType).toBe("notes");
    });

    it("re-run without an explicit businessType preserves the stored type and never touches persona", async () => {
      h.state.org = freshOrg({
        onboardingData: { businessType: "subdivider", noteRole: "originate", orgName: "Kept" },
      });
      const res = await request(app).post("/api/onboarding/complete").send({});
      expect(res.status).toBe(200);
      // Stored persona-relevant fields survive the merge.
      expect(h.state.org.onboardingData?.businessType).toBe("subdivider");
      expect(h.state.org.onboardingData?.noteRole).toBe("originate");
      expect(h.state.org.onboardingData?.orgName).toBe("Kept");
      // Persona untouched — no users/organizations updates.
      expect(h.dbUpdates).toHaveLength(0);
      // Default seeding uses the STORED type, not the land_flipper default.
      expect(h.seedSampleDataForOrg).toHaveBeenCalledWith("42", "subdivider", {
        userId: "user-1",
      });
    });
  });

  describe("POST /api/onboarding/skip", () => {
    it("marks complete with skipped:true, seeds nothing, fabricates no progress", async () => {
      h.state.org = freshOrg({ onboardingData: { businessType: "tax_lien_deed" } });
      const res = await request(app).post("/api/onboarding/skip").send({});
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ skipped: true });
      expect(h.state.org.onboardingCompleted).toBe(true);
      expect(h.state.org.onboardingData?.skipped).toBe(true);
      expect(typeof h.state.org.onboardingData?.skippedAt).toBe("string");
      // Preserves what the user already picked.
      expect(h.state.org.onboardingData?.businessType).toBe("tax_lien_deed");
      // Seeds NOTHING and writes no rows.
      expect(h.seedSampleDataForOrg).not.toHaveBeenCalled();
      expect(h.storage.createLead).not.toHaveBeenCalled();
      expect(h.storage.createProperty).not.toHaveBeenCalled();
      expect(h.storage.createDeal).not.toHaveBeenCalled();
      // No fabricated progress: no completedSteps invented.
      expect(h.state.org.onboardingData?.completedSteps).toBeUndefined();
      // Persona untouched.
      expect(h.dbUpdates).toHaveLength(0);
    });
  });

  describe("completeOnboarding service (inline seeding removed)", () => {
    it("only marks the org complete — creates no leads/properties/deals", async () => {
      h.state.org = freshOrg({ onboardingData: { businessType: "land_flipper" } });
      await onboardingService.completeOnboarding(42);
      expect(h.state.org.onboardingCompleted).toBe(true);
      expect(h.state.org.settings?.onboardingCompleted).toBe(true);
      expect(h.storage.createLead).not.toHaveBeenCalled();
      expect(h.storage.createProperty).not.toHaveBeenCalled();
      expect(h.storage.createDeal).not.toHaveBeenCalled();
      expect(h.storage.createCampaign).not.toHaveBeenCalled();
    });
  });

  describe("resetOnboarding service (persona-preserving reset)", () => {
    it("clears completion state but preserves businessType/noteRole and other selections", async () => {
      h.state.org = freshOrg({
        onboardingCompleted: true,
        onboardingStep: 5,
        onboardingData: {
          businessType: "note_investor",
          noteRole: "originate",
          orgName: "Paper Co",
          goals: ["service the book"],
          completedSteps: [0, 1, 2],
          skippedSteps: [3],
          skipped: true,
          skippedAt: "2026-07-01T00:00:00.000Z",
        },
        settings: { onboardingCompleted: true, checklistDismissed: true },
      });

      await onboardingService.resetOnboarding(42);

      expect(h.state.org.onboardingCompleted).toBe(false);
      expect(h.state.org.onboardingStep).toBe(0);
      // Completion state gone…
      expect(h.state.org.onboardingData.completedSteps).toBeUndefined();
      expect(h.state.org.onboardingData.skippedSteps).toBeUndefined();
      expect(h.state.org.onboardingData.skipped).toBeUndefined();
      expect(h.state.org.onboardingData.skippedAt).toBeUndefined();
      // …persona-relevant fields preserved.
      expect(h.state.org.onboardingData.businessType).toBe("note_investor");
      expect(h.state.org.onboardingData.noteRole).toBe("originate");
      expect(h.state.org.onboardingData.orgName).toBe("Paper Co");
      expect(h.state.org.onboardingData.goals).toEqual(["service the book"]);
      expect(h.state.org.settings.onboardingCompleted).toBe(false);
      expect(h.state.org.settings.checklistDismissed).toBe(false);
    });

    it("reset + re-complete without a new pick keeps the persona and businessType", async () => {
      h.state.org = freshOrg({
        onboardingCompleted: true,
        onboardingData: {
          businessType: "subdivider",
          completedSteps: [0, 1],
        },
      });
      await onboardingService.resetOnboarding(42);
      expect(h.state.org.onboardingData.businessType).toBe("subdivider");

      // Wizard re-runs and the user finishes without changing anything.
      const res = await request(app)
        .post("/api/onboarding/complete")
        .send({ seedSampleData: false });
      expect(res.status).toBe(200);
      expect(h.state.org.onboardingData.businessType).toBe("subdivider");
      expect(h.state.org.onboardingCompleted).toBe(true);
      expect(h.dbUpdates).toHaveLength(0); // persona never rewritten
    });
  });
});
