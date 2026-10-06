/**
 * GET /api/due-diligence/:propertyId reads (or starts) a checklist only on a
 * property the organization holds, with the organization in the read — the
 * same guard as the PUT. A malformed id is a 400, not a 500.
 *
 * Storage is mocked; the database half is dueDiligenceChecklistScope.db.test.ts.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const ORG_A = 42;

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
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

const getProperty = vi.fn();
const getOrCreateDueDiligenceChecklist = vi.fn();
const getDueDiligenceChecklist = vi.fn();
vi.mock("../../server/storage", () => ({
  storage: {
    getProperty: (...a: unknown[]) => getProperty(...a),
    getOrCreateDueDiligenceChecklist: (...a: unknown[]) => getOrCreateDueDiligenceChecklist(...a),
    getDueDiligenceChecklist: (...a: unknown[]) => getDueDiligenceChecklist(...a),
    updateDueDiligenceChecklist: vi.fn(async (_id: number, patch: object) => patch),
  },
}));
vi.mock("../../server/db", () => ({ db: {}, withTransaction: async (fn: any) => fn({}) }));
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

import { registerDealRoutes } from "../../server/routes-deals";

describe("GET /api/due-diligence/:propertyId", () => {
  let app: express.Application;
  beforeAll(() => {
    app = express();
    app.use(express.json());
    registerDealRoutes(app as any);
  });
  beforeEach(() => {
    getProperty.mockReset();
    getOrCreateDueDiligenceChecklist.mockReset();
    getDueDiligenceChecklist.mockReset();
  });

  it("a property the organization does not hold: 404, and nothing is read or started", async () => {
    getProperty.mockResolvedValue(undefined);
    const res = await request(app).get("/api/due-diligence/7");
    expect(res.status).toBe(404);
    expect(getProperty).toHaveBeenCalledWith(ORG_A, 7);
    expect(getOrCreateDueDiligenceChecklist).not.toHaveBeenCalled();
  });

  it("the holder's property: the checklist is read within the organization", async () => {
    getProperty.mockResolvedValue({ id: 7, organizationId: ORG_A });
    getOrCreateDueDiligenceChecklist.mockResolvedValue({ id: 1, organizationId: ORG_A, propertyId: 7 });
    const res = await request(app).get("/api/due-diligence/7");
    expect(res.status).toBe(200);
    expect(getOrCreateDueDiligenceChecklist).toHaveBeenCalledWith(ORG_A, 7);
  });

  it.each(["undefined", "0", "-3", "1.5", "abc"])("a malformed property id (%s) is a 400, not a 500", async (id) => {
    const res = await request(app).get(`/api/due-diligence/${id}`);
    expect(res.status).toBe(400);
    expect(getOrCreateDueDiligenceChecklist).not.toHaveBeenCalled();
  });

  it.each(["undefined", "0", "-3", "1.5", "abc"])("a malformed property id (%s) on the PUT is a 400 and reads nothing", async (id) => {
    const res = await request(app).put(`/api/due-diligence/${id}`).send({ notes: "x" });
    expect(res.status).toBe(400);
    expect(getProperty).not.toHaveBeenCalled();
    expect(getDueDiligenceChecklist).not.toHaveBeenCalled();
  });

  it("the PUT reads the existing checklist within the organization too", async () => {
    getProperty.mockResolvedValue({ id: 7, organizationId: ORG_A });
    getDueDiligenceChecklist.mockResolvedValue({ id: 1, organizationId: ORG_A, propertyId: 7 });
    const res = await request(app).put("/api/due-diligence/7").send({ notes: "x" });
    expect(res.status).toBe(200);
    expect(getDueDiligenceChecklist).toHaveBeenCalledWith(ORG_A, 7);
  });
});
