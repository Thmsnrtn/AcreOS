/**
 * W10.4 contract item 4 — a deal's birth status is checked where every
 * creation passes: dealRepo.createDeal.
 *
 *  - "opening" (the default — a person or the agent starting a deal now):
 *    only OPENING_DEAL_STATUSES. Escrow needs contract evidence and close
 *    needs close evidence; a deal reaches them by a transition, which checks
 *    them. Pax created deals already closed (audit of 1694a0b), and the POST
 *    route took any status the schema's `text` column would hold.
 *  - "import" / "sample": history, so any DEAL_STATUSES member — but never a
 *    word the vocabulary does not contain.
 *  - No creation of any kind runs the close's consequences: an imported or
 *    sample closed deal is history, not a sale AcreOS observed.
 *  - POST /api/deals answers 400 naming the allowed statuses.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { DEAL_STATUSES, OPENING_DEAL_STATUSES } from "@shared/lifecycle/pipeline-status";

const F = vi.hoisted(() => ({
  h: null as null | ReturnType<typeof import("../helpers/fakeDealsDb").createFakeDb>,
  recordDealClose: vi.fn(async (..._args: unknown[]) => undefined),
  emitEvidenced: vi.fn(async () => undefined),
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/db", async () => {
  const { createFakeDb } = await import("../helpers/fakeDealsDb");
  F.h = createFakeDb();
  return { db: F.h.db, withTransaction: F.h.withTransaction };
});
vi.mock("../../server/services/eventMeshPublisher", () => ({
  eventMeshPublisher: { dealDiscovered: async () => undefined, dealClosed: async () => undefined, dealUpdated: async () => undefined },
}));
vi.mock("../../server/services/activation", () => ({ recordActivationEventAsync: vi.fn() }));
vi.mock("../../server/services/dealClose", () => ({
  recordDealClose: F.recordDealClose,
  emitContractSignedIfEvidenced: F.emitEvidenced,
  retractClosedSaleTraining: vi.fn(async () => true),
  recordDealReopen: vi.fn(async () => undefined),
}));
vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { id: "user-1", claims: { sub: "user-1" } };
    next();
  },
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: any, next: any) => {
    req.organization = { id: 42, name: "Test Org" };
    req.organizationId = 42;
    next();
  },
}));
vi.mock("../../server/storage", async () => {
  const { dealRepo } = await import("../../server/storage/dealRepo");
  const s: Record<string, unknown> = {
    getDeal: async () => undefined,
    getProperty: async () => undefined,
    createAuditLogEntry: async () => ({}),
    _autoGenerateClosingChecklist: async () => undefined,
  };
  for (const k of ["updateDeal", "bulkUpdateDeals", "createDeal", "getDealsByIds"] as const) {
    s[k] = (dealRepo[k] as (...a: unknown[]) => unknown).bind(s);
  }
  return { storage: s };
});
vi.mock("../../server/services/leadScoring", () => ({ leadScoringService: {} }));
vi.mock("../../server/services/propertyEnrichment", () => ({
  propertyEnrichmentService: { enrichProperty: async () => { throw new Error("not in this test"); } },
}));
vi.mock("../../server/services/usageLimits", () => ({ checkUsageLimit: vi.fn() }));
vi.mock("../../server/services/usury", () => ({ checkUsury: vi.fn() }));
vi.mock("../../server/services/dealEvents", () => ({ emitDealCreated: vi.fn(), emitDealStageChanged: vi.fn() }));
vi.mock("../../server/services/dealHandoffService", () => ({
  getAllHandoffs: vi.fn(),
  getHandoffsForDeal: vi.fn(),
  initiateHandoff: vi.fn(),
  updateHandoffChecklist: vi.fn(),
  completeHandoff: vi.fn(),
}));

type Repo = typeof import("../../server/storage/dealRepo");
let repo: Repo;
let createDeal: (deal: Record<string, unknown>, tx?: unknown, opts?: { creation?: "opening" | "import" | "sample" }) => Promise<any>;
let app: express.Application;
const settle = () => new Promise((r) => setTimeout(r, 30));
const base = { organizationId: 42, propertyId: 3, type: "disposition" };
const deals = () => F.h!.fake.rows("deals");

beforeAll(async () => {
  repo = await import("../../server/storage/dealRepo");
  await import("../../server/services/dealClose");
  const { storage } = (await import("../../server/storage")) as any;
  createDeal = (d, tx, opts) => storage.createDeal(d, tx ?? F.h!.db, opts);
  const { registerDealRoutes } = await import("../../server/routes-deals");
  app = express();
  app.use(express.json());
  registerDealRoutes(app as any);
});

beforeEach(() => {
  F.h!.fake.reset();
  F.recordDealClose.mockClear();
  F.emitEvidenced.mockClear();
});

describe("opening (the default)", () => {
  it("accepts every opening stage, and an absent status (the schema default)", async () => {
    for (const status of OPENING_DEAL_STATUSES) await createDeal({ ...base, status });
    await createDeal({ ...base });
    expect(deals()).toHaveLength(OPENING_DEAL_STATUSES.length + 1);
    // Vacuity: the opening list is the pipeline minus escrow.
    expect(OPENING_DEAL_STATUSES).toContain("negotiating");
    expect(OPENING_DEAL_STATUSES).not.toContain("in_escrow");
  });

  it.each(["closed", "in_escrow", "cancelled", "closing", "deleted", "won"])("refuses %s — and writes nothing", async (status) => {
    const err = await createDeal({ ...base, status }).catch((e) => e);
    expect(err).toBeInstanceOf(repo.DealCreationRefusedError);
    expect(err).toMatchObject({ status, creation: "opening", allowed: [...OPENING_DEAL_STATUSES] });
    expect(deals()).toHaveLength(0);
  });

  it("an explicit { creation: 'opening' } is the same rule", async () => {
    await expect(createDeal({ ...base, status: "closed" }, undefined, { creation: "opening" })).rejects.toBeInstanceOf(
      repo.DealCreationRefusedError,
    );
  });
});

describe.each(["import", "sample"] as const)("%s", (creation) => {
  it("accepts every DEAL_STATUSES member, closed and in_escrow included", async () => {
    for (const status of DEAL_STATUSES) await createDeal({ ...base, status }, undefined, { creation });
    expect(deals().map((d) => d.status)).toEqual([...DEAL_STATUSES]);
  });

  it.each(["closing", "deleted", "Closed", ""])("refuses the unknown string %j", async (status) => {
    const err = await createDeal({ ...base, status }, undefined, { creation }).catch((e) => e);
    expect(err).toBeInstanceOf(repo.DealCreationRefusedError);
    expect(err).toMatchObject({ creation, allowed: [...DEAL_STATUSES] });
    expect(deals()).toHaveLength(0);
  });

  it("a created closed / in_escrow deal runs no close effect and no contract-signed emit", async () => {
    await createDeal({ ...base, status: "closed" }, undefined, { creation });
    await createDeal({ ...base, status: "in_escrow" }, undefined, { creation });
    await createDeal({ ...base, status: "cancelled" }, undefined, { creation });
    await settle();
    expect(F.recordDealClose).not.toHaveBeenCalled();
    expect(F.emitEvidenced).not.toHaveBeenCalled();
  });
});

describe("POST /api/deals", () => {
  it("answers 400 naming the allowed statuses for a deal born closed — and creates nothing", async () => {
    const res = await request(app).post("/api/deals").send({ propertyId: 3, type: "disposition", status: "closed" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: "BAD_REQUEST",
      statusCode: 400,
      details: { status: "closed", allowedStatuses: [...OPENING_DEAL_STATUSES] },
    });
    for (const s of OPENING_DEAL_STATUSES) expect(res.body.message).toContain(s);
    expect(deals()).toHaveLength(0);
    await settle();
    expect(F.recordDealClose).not.toHaveBeenCalled();
  });

  it("refuses a word that is not a status at all", async () => {
    const res = await request(app).post("/api/deals").send({ propertyId: 3, type: "disposition", status: "pending" });
    expect(res.status).toBe(400);
    expect(res.body.details).toMatchObject({ status: "pending" });
  });

  it("creates an opening deal (201)", async () => {
    const res = await request(app).post("/api/deals").send({ propertyId: 3, type: "disposition", status: "offer_sent" });
    expect(res.status).toBe(201);
    expect(deals()).toHaveLength(1);
  });
});
