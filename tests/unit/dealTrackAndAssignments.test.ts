/**
 * W6.1 + W6.2 — deal-centric track endpoint + contract assignments.
 *
 * 1. GET /api/deals/:id/track — unions activity events across the deal,
 *    its property, and the seller lead (bridged via property.sellerId)
 *    into one chronological, deduped track. The per-slice timeline
 *    endpoints only ever showed one fragment.
 * 2. POST/GET /api/deals/:id/assignments — the wholesaler's assignment
 *    record: end buyer + fee (INTEGER CENTS) + state-rule advisory.
 *
 * Mounted on a bare express app with auth/org/db/storage mocked, per the
 * dealAggregates.test.ts pattern.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
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

const state = {
  deal: { id: 7, propertyId: 3, status: "in_escrow" } as any,
  property: { id: 3, sellerId: 11, state: "TX" } as any,
  eventsByEntity: {} as Record<string, any[]>,
  insertedAssignments: [] as any[],
  assignmentRows: [] as any[],
};

vi.mock("../../server/storage", () => ({
  storage: {
    getDeal: async (_orgId: number, id: number) => (id === state.deal.id ? state.deal : undefined),
    getProperty: async (_orgId: number, id: number) => (id === state.property.id ? state.property : undefined),
    getActivityEvents: async (_orgId: number, entityType: string, entityId: number) =>
      state.eventsByEntity[`${entityType}:${entityId}`] ?? [],
  },
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

vi.mock("../../server/db", () => {
  const selectChain: any = {
    from: () => selectChain,
    where: () => selectChain,
    orderBy: () => selectChain,
    limit: async () => state.assignmentRows,
    then: (res: any, rej: any) => Promise.resolve(state.assignmentRows).then(res, rej),
  };
  return {
    db: {
      select: () => selectChain,
      insert: () => ({
        values: (vals: any) => ({
          returning: async () => {
            const row = { id: 99, ...vals };
            state.insertedAssignments.push(row);
            return [row];
          },
        }),
      }),
      update: () => ({
        set: (vals: any) => ({
          where: () => ({ returning: async () => [{ id: 99, ...vals }] }),
        }),
      }),
    },
    withTransaction: async (fn: any) => fn(),
  };
});

import { registerDealRoutes } from "../../server/routes-deals";

let app: express.Application;

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerDealRoutes(app as any);
});

beforeEach(() => {
  state.deal = { id: 7, propertyId: 3, status: "in_escrow" };
  state.property = { id: 3, sellerId: 11, state: "TX" };
  state.eventsByEntity = {};
  state.insertedAssignments = [];
  state.assignmentRows = [];
});

describe("GET /api/deals/:id/track (W6.2)", () => {
  it("unions deal + property + seller-lead events, deduped and date-sorted", async () => {
    state.eventsByEntity = {
      "deal:7": [
        { id: 1, eventType: "stage_changed", eventDate: "2026-07-01T00:00:00Z" },
      ],
      "property:3": [
        { id: 2, eventType: "document_uploaded", eventDate: "2026-06-20T00:00:00Z" },
        { id: 1, eventType: "stage_changed", eventDate: "2026-07-01T00:00:00Z" }, // dup
      ],
      "lead:11": [
        { id: 3, eventType: "mail_sent", eventDate: "2026-06-01T00:00:00Z" },
        { id: 4, eventType: "sms_received", eventDate: "2026-06-10T00:00:00Z" },
      ],
    };
    const res = await request(app).get("/api/deals/7/track");
    expect(res.status).toBe(200);
    expect(res.body.map((e: any) => e.id)).toEqual([1, 2, 4, 3]); // desc by date, id 1 deduped
  });

  it("404s on an unknown deal", async () => {
    const res = await request(app).get("/api/deals/999/track");
    expect(res.status).toBe(404);
  });

  it("still returns the deal's own events when the property lookup fails", async () => {
    state.deal = { id: 7, propertyId: 555, status: "negotiating" }; // property 555 unknown
    state.eventsByEntity = { "deal:7": [{ id: 9, eventType: "note_added", eventDate: "2026-07-02T00:00:00Z" }] };
    const res = await request(app).get("/api/deals/7/track");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe("contract assignments (W6.1)", () => {
  it("creates an assignment with fee in integer cents", async () => {
    const res = await request(app).post("/api/deals/7/assignments").send({
      endBuyerName: "Cash Buyer LLC",
      assignmentFeeCents: 750_000, // $7,500
      originalContractDate: "2026-06-15",
    });
    expect(res.status).toBe(201);
    expect(res.body.assignment.assignmentFeeCents).toBe(750_000);
    expect(res.body.assignment.status).toBe("draft");
    expect(state.insertedAssignments).toHaveLength(1);
  });

  it("refuses an assignment with no end buyer", async () => {
    const res = await request(app).post("/api/deals/7/assignments").send({
      assignmentFeeCents: 100_000,
    });
    expect(res.status).toBe(400);
  });

  it("refuses a negative fee (validation)", async () => {
    const res = await request(app).post("/api/deals/7/assignments").send({
      endBuyerName: "X",
      assignmentFeeCents: -5,
    });
    expect(res.status).toBe(422);
  });

  it("404s when the deal doesn't exist", async () => {
    const res = await request(app).post("/api/deals/999/assignments").send({
      endBuyerName: "X",
      assignmentFeeCents: 1,
    });
    expect(res.status).toBe(404);
  });
});
