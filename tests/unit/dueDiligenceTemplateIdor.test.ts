/**
 * T0-2 — Due-diligence template IDOR regression tests.
 *
 * The F-D39 org check landed on PUT/DELETE /api/due-diligence/templates/:id
 * but the GET was missed, so any authenticated org could read any other
 * org's template by guessing the numeric id. Same asymmetry existed on
 * GET /api/checklist-templates/:id. These tests mount the real deal routes
 * on a bare express app with auth + org middleware stubbed (org A = 42)
 * and assert the tenant boundary: org B's template must 404, never 200,
 * and the 404 must be indistinguishable from a nonexistent id.
 *
 * idempotent: true — storage is fully mocked; no DB.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const ORG_A = 42;
const ORG_B = 999;

// ── Mock infra dependencies BEFORE importing the module under test ──────────

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { id: "user-a", claims: { sub: "user-a" } };
    next();
  },
}));

vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: any, next: any) => {
    req.organization = { id: ORG_A, name: "Org A" };
    req.organizationId = ORG_A;
    next();
  },
}));

const getDueDiligenceTemplate = vi.fn();
const getChecklistTemplate = vi.fn();

vi.mock("../../server/storage", () => ({
  storage: {
    getDueDiligenceTemplate: (...args: unknown[]) => getDueDiligenceTemplate(...args),
    getChecklistTemplate: (...args: unknown[]) => getChecklistTemplate(...args),
  },
}));

// Handlers we don't exercise still need their imports to resolve.
vi.mock("../../server/db", () => ({
  db: {},
  withTransaction: async (fn: any) => fn({}),
}));
vi.mock("../../server/services/leadScoring", () => ({ leadScoringService: {} }));
vi.mock("../../server/services/propertyEnrichment", () => ({ propertyEnrichmentService: {} }));
vi.mock("../../server/services/usageLimits", () => ({ checkUsageLimit: vi.fn() }));
vi.mock("../../server/services/usury", () => ({ checkUsury: vi.fn() }));
vi.mock("../../server/services/dealHandoffService", () => ({
  getAllHandoffs: vi.fn(),
  getHandoffsForDeal: vi.fn(),
  initiateHandoff: vi.fn(),
  updateHandoffChecklist: vi.fn(),
  completeHandoff: vi.fn(),
}));

// ── Import the module under test ───────────────────────────────────────────

import { registerDealRoutes } from "../../server/routes-deals";

describe("due-diligence template tenant isolation (T0-2)", () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    registerDealRoutes(app as any);
  });

  beforeEach(() => {
    getDueDiligenceTemplate.mockReset();
    getChecklistTemplate.mockReset();
  });

  describe("GET /api/due-diligence/templates/:id", () => {
    it("404s when the template belongs to another org (cross-tenant read)", async () => {
      getDueDiligenceTemplate.mockResolvedValue({
        id: 7,
        organizationId: ORG_B,
        name: "Org B secret playbook",
        items: [],
      });

      const res = await request(app).get("/api/due-diligence/templates/7");

      expect(getDueDiligenceTemplate).toHaveBeenCalledWith(7);
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain("secret playbook");
    });

    it("404s identically for a nonexistent id (no existence oracle)", async () => {
      getDueDiligenceTemplate.mockResolvedValue(undefined);

      const crossTenant = await (async () => {
        getDueDiligenceTemplate.mockResolvedValueOnce({ id: 8, organizationId: ORG_B, name: "x", items: [] });
        return request(app).get("/api/due-diligence/templates/8");
      })();
      const missing = await request(app).get("/api/due-diligence/templates/123456");

      expect(crossTenant.status).toBe(404);
      expect(missing.status).toBe(404);
      // Same body shape and message — an attacker can't tell which case hit.
      expect(crossTenant.body).toEqual(missing.body);
    });

    it("200s for the caller's own template", async () => {
      getDueDiligenceTemplate.mockResolvedValue({
        id: 9,
        organizationId: ORG_A,
        name: "Org A template",
        items: [],
      });

      const res = await request(app).get("/api/due-diligence/templates/9");

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Org A template");
    });
  });

  describe("GET /api/checklist-templates/:id", () => {
    it("404s when the checklist template belongs to another org", async () => {
      getChecklistTemplate.mockResolvedValue({
        id: 11,
        organizationId: ORG_B,
        name: "Org B checklist",
      });

      const res = await request(app).get("/api/checklist-templates/11");

      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain("Org B checklist");
    });

    it("200s for the caller's own checklist template", async () => {
      getChecklistTemplate.mockResolvedValue({
        id: 12,
        organizationId: ORG_A,
        name: "Org A checklist",
      });

      const res = await request(app).get("/api/checklist-templates/12");

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Org A checklist");
    });
  });
});
