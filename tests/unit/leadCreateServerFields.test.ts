/**
 * A lead's server-owned fields are set by the server, never the request.
 *
 * The lead create contract keeps transport-only extras (`.passthrough()`), so
 * it must also strip what a lead row's server owns: the primary key, the
 * tenant key, the lifecycle timestamps and the soft-delete fields. The
 * repository create paths strip them again as defence in depth, and the edit
 * paths (PUT /api/leads/:id, POST /api/leads/bulk-update) drop a client-sent
 * `deletedAt` / `deletedBy`, since a lead is deleted and restored only through
 * its dedicated paths — which must keep working.
 *
 * Exercised through the REAL handlers and the REAL repository; only storage,
 * the database and side rails are stood in for.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const ORG_ID = 77;

const H = vi.hoisted(() => {
  type Row = Record<string, any>;
  const state = {
    LEADS: [] as Row[],
    nextLeadId: 1,
    inserted: [] as unknown[],
    updates: [] as Row[],
  };
  const insertLeadRow = (values: Row): Row => {
    const lead = { status: "new", deletedAt: null, ...values, id: state.nextLeadId++ };
    state.LEADS.push(lead);
    return lead;
  };
  const storageMock = {
    createLead: vi.fn(async (data: any) => insertLeadRow(data)),
    createLeadsBatch: vi.fn(async (rows: any[]) => rows.map((r) => insertLeadRow(r))),
    getLead: vi.fn(async (orgId: number, id: number) => {
      const found = state.LEADS.find((l) => l.id === id && l.organizationId === orgId);
      return found ? { ...found } : undefined;
    }),
    getLeadsByIds: vi.fn(async (orgId: number, ids: number[]) =>
      state.LEADS.filter((l) => l.organizationId === orgId && ids.includes(l.id)).map((l) => ({ ...l })),
    ),
    updateLead: vi.fn(async (id: number, updates: any) => {
      const lead = state.LEADS.find((l) => l.id === id)!;
      Object.assign(lead, updates);
      return { ...lead };
    }),
    bulkUpdateLeads: vi.fn(async (_orgId: number, ids: number[], updates: any) => {
      for (const lead of state.LEADS) if (ids.includes(lead.id)) Object.assign(lead, updates);
      return ids.length;
    }),
    findDuplicateLeads: vi.fn(async (): Promise<any[]> => []),
    getTeamMemberByEmail: vi.fn(async () => null),
    createAuditLogEntry: vi.fn(async () => ({ id: 1 })),
    updateLeadScore: vi.fn(async () => ({})),
    createLeadActivity: vi.fn(async () => ({ id: 1 })),
    logActivity: vi.fn(async () => ({ id: 1 })),
    getLeads: vi.fn(async () => state.LEADS),
  };
  // Drizzle stand-in: records what reaches `.values()` / `.set()`.
  const dbMock: any = {
    select: () => ({
      from: () => ({
        where: () => {
          const rows = state.LEADS.map((l) => ({ ...l }));
          (rows as any).limit = () => rows;
          return rows;
        },
      }),
    }),
    insert: () => ({
      values: (vals: any) => {
        state.inserted.push(vals);
        const p: any = Promise.resolve(undefined);
        p.returning = () =>
          Promise.resolve((Array.isArray(vals) ? vals : [vals]).map((v: Row) => ({ ...v, id: state.nextLeadId++ })));
        return p;
      },
    }),
    update: () => ({
      set: (updates: Row) => {
        state.updates.push(updates);
        return {
          where: () => {
            const p: any = Promise.resolve(undefined);
            p.returning = () => Promise.resolve(state.LEADS.map((l) => ({ ...Object.assign(l, updates) })));
            return p;
          },
        };
      },
    }),
    transaction: async (fn: any) => fn(dbMock),
  };
  return { state, storageMock, dbMock };
});

vi.mock("../../server/storage", () => ({ storage: H.storageMock, db: H.dbMock }));
vi.mock("../../server/db", () => ({ db: H.dbMock }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/services/workflow-engine", () => ({
  emitLeadEvent: vi.fn(),
  emitPropertyEvent: vi.fn(),
  emitDealEvent: vi.fn(),
  emitPaymentEvent: vi.fn(),
  emitParcelEvent: vi.fn(),
  workflowEngine: { emit: vi.fn() },
}));
vi.mock("../../server/services/legalHold", () => ({
  filterOutHeldIds: async (_o: number, _k: string, ids: number[]) => ids,
  assertNotUnderLegalHold: async () => undefined,
}));
vi.mock("../../server/auth", () => ({ isAuthenticated: (_req: any, _res: any, next: any) => next() }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../server/middleware/usageLimitGate", () => ({
  usageLimitGate: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../server/middleware/roleScope", () => ({
  requireScope: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../server/utils/permissions", () => ({
  attachPermissionContext: () => (_req: any, _res: any, next: any) => next(),
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../server/utils/orgScope", () => ({ assertUserIsOrgMember: vi.fn(async () => true) }));
vi.mock("../../server/services/usageLimits", () => ({
  checkUsageLimit: vi.fn(async () => ({ allowed: true, current: 0, limit: null })),
}));
vi.mock("../../server/services/leadNurturer", () => ({
  leadNurturerService: {
    calculateLeadScore: () => ({ score: 10, factors: {} }),
    segmentLead: () => "cold",
    generateFollowUp: async () => null,
  },
}));
vi.mock("../../server/services/leadScoring", () => ({
  leadScoringService: { recordConversion: vi.fn(async () => ({})), scoreLead: vi.fn(async () => ({})) },
}));
vi.mock("../../server/services/skipTracingService", () => ({
  skipTracingService: { trace: vi.fn(), isConfigured: () => false },
}));
vi.mock("../../server/services/alerting", () => ({ alertingService: { send: vi.fn() } }));
vi.mock("../../server/services/propertyEnrichment", () => ({
  propertyEnrichmentService: { enrichLead: vi.fn(async () => null) },
}));
vi.mock("../../server/services/credits", () => ({
  usageMeteringService: { recordUsage: vi.fn(async () => ({ insufficientCredits: false })) },
  creditService: { deduct: vi.fn() },
}));
vi.mock("../../server/middleware/fileUploadSecurity", () => ({
  createUploadMiddleware: () => ({ single: () => (_req: any, _res: any, next: any) => next() }),
  validateFileMiddleware: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../server/utils/contractResponse", () => ({
  validateResponse: (_schema: any, payload: any) => payload,
}));
vi.mock("../../server/services/leadAssigner", () => ({ assignLead: async () => null }));
vi.mock("../../server/services/consentEvents", () => ({ recordConsentGranted: async () => ({}) }));
vi.mock("../../server/services/activation", () => ({ recordActivationEventAsync: () => {} }));
vi.mock("../../server/services/compliance/ofacScreening", () => ({ screenCounterpartyAsync: () => {} }));
vi.mock("../../server/services/mlSnapshots", () => ({ recordSnapshotAsync: () => {} }));
vi.mock("../../server/services/webhookDispatcher", () => ({ webhookLeadCreated: async () => ({}) }));
vi.mock("../../server/services/teamWebhookDispatcher", () => ({ dispatchTeamEvent: async () => ({}) }));

import { registerLeadRoutes } from "../../server/routes-leads";
import { leadRepo } from "../../server/storage/leadRepo";

const SERVER_OWNED = ["id", "createdAt", "updatedAt", "deletedAt", "deletedBy", "lastScoreAt", "phoneNormalized"];

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.organization = { id: ORG_ID, name: "Test Org" };
    req.organizationId = ORG_ID;
    req.user = { id: "user-1" };
    next();
  });
  registerLeadRoutes(app);
  return app;
}
const app = makeApp();

function seedLead(overrides: Record<string, unknown> = {}) {
  const lead = {
    id: H.state.nextLeadId++,
    organizationId: ORG_ID,
    type: "seller",
    firstName: "Dana",
    lastName: "Reyes",
    status: "new",
    deletedAt: null,
    deletedBy: null,
    assignedTo: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
  H.state.LEADS.push(lead);
  return lead;
}

beforeEach(() => {
  H.state.LEADS = [];
  H.state.nextLeadId = 1;
  H.state.inserted = [];
  H.state.updates = [];
  vi.clearAllMocks();
});

describe("POST /api/leads — the create body never sets server-owned fields", () => {
  it("drops the request's id, tenant key, timestamps and soft-delete fields; keeps transport extras", async () => {
    const res = await request(app)
      .post("/api/leads")
      .send({
        firstName: "Ada",
        lastName: "Lovelace",
        id: 987654,
        organizationId: 999,
        createdAt: "2001-02-03T04:05:06.000Z",
        updatedAt: "2001-02-03T04:05:06.000Z",
        deletedAt: null,
        deletedBy: "someone",
        lastScoreAt: "2001-02-03T04:05:06.000Z",
        phoneNormalized: "5550100",
        latitude: "34.05",
      });

    expect(res.status).toBe(201);
    expect(H.storageMock.createLead).toHaveBeenCalledTimes(1);
    const written = H.storageMock.createLead.mock.calls[0][0] as Record<string, unknown>;
    for (const key of SERVER_OWNED) expect(written, key).not.toHaveProperty(key);
    expect(written.organizationId).toBe(ORG_ID);
    expect(written.firstName).toBe("Ada");
    expect(written.latitude).toBe("34.05");
  });
});

describe("lead edits never set the soft-delete fields", () => {
  it("PUT /api/leads/:id drops deletedAt / deletedBy and keeps the real edit", async () => {
    const lead = seedLead();
    const res = await request(app)
      .put(`/api/leads/${lead.id}`)
      .send({ notes: "called back", deletedAt: null, deletedBy: "someone" });

    expect(res.status).toBe(200);
    const updates = H.storageMock.updateLead.mock.calls[0][1] as Record<string, unknown>;
    expect(updates).not.toHaveProperty("deletedAt");
    expect(updates).not.toHaveProperty("deletedBy");
    expect(updates.notes).toBe("called back");
  });

  it("POST /api/leads/bulk-update drops deletedAt / deletedBy", async () => {
    const lead = seedLead();
    const res = await request(app)
      .post("/api/leads/bulk-update")
      .send({ ids: [lead.id], updates: { notes: "batch", deletedAt: null, deletedBy: "someone" } });

    expect(res.status).toBe(200);
    const updates = H.storageMock.bulkUpdateLeads.mock.calls[0][2] as Record<string, unknown>;
    expect(updates).not.toHaveProperty("deletedAt");
    expect(updates).not.toHaveProperty("deletedBy");
    expect(updates.notes).toBe("batch");
  });

  it("the dedicated delete and restore paths still set and clear them", async () => {
    const lead = seedLead();
    const del = await request(app).delete(`/api/leads/${lead.id}`);
    expect(del.status).toBe(204);
    expect(H.state.updates[0].deletedAt).toBeInstanceOf(Date);
    expect(H.state.updates[0].deletedBy).toBe("user-1");

    const restore = await request(app).patch(`/api/leads/${lead.id}/restore`);
    expect(restore.status).toBe(200);
    expect(H.state.updates[1].deletedAt).toBeNull();
    expect(H.state.updates[1].deletedBy).toBeNull();
  });
});

describe("the repository create paths strip server-owned fields (defence in depth)", () => {
  const self = { logActivity: vi.fn(async () => ({ id: 1 })) } as never;
  const given = {
    organizationId: ORG_ID,
    firstName: "Ada",
    lastName: "Lovelace",
    id: 987654,
    createdAt: "2001-02-03T04:05:06.000Z",
    updatedAt: "2001-02-03T04:05:06.000Z",
    deletedAt: new Date("2001-02-03T04:05:06.000Z"),
    deletedBy: "someone",
    phoneNormalized: "5550100",
  } as never;

  it("createLead ignores a given id, a non-Date createdAt, and the rest", async () => {
    await leadRepo.createLead.call(self, given);
    const row = H.state.inserted[0] as Record<string, unknown>;
    for (const key of SERVER_OWNED) expect(row, key).not.toHaveProperty(key);
    expect(row.organizationId).toBe(ORG_ID);
    expect(row.firstName).toBe("Ada");
  });

  it("createLeadsBatch does the same for every row", async () => {
    await leadRepo.createLeadsBatch.call(self, [given, given]);
    const rows = H.state.inserted[0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      for (const key of SERVER_OWNED) expect(row, key).not.toHaveProperty(key);
      expect(row.organizationId).toBe(ORG_ID);
    }
  });

  it("keeps a server-constructed createdAt Date (the CSV import preserves history)", async () => {
    const original = new Date("2019-05-06T00:00:00Z");
    await leadRepo.createLeadsBatch.call(self, [
      { organizationId: ORG_ID, firstName: "A", lastName: "B", createdAt: original } as never,
    ]);
    const rows = H.state.inserted[0] as Array<Record<string, unknown>>;
    expect(rows[0].createdAt).toBe(original);
  });
});
