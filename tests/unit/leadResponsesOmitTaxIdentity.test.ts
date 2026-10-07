/**
 * Lead responses omit tax identity (`leads.taxId` — ciphertext of the
 * recipient TIN — and `leads.taxIdType`). No client surface reads either; the
 * 1099/1098 paths read them server-side.
 *
 * Driven through the REAL lead handlers with a storage stand-in that returns
 * a FULL lead row (every column of the Drizzle table, tax identity set), in
 * two lanes:
 *
 *   1. GUARDED — the app is built the way production builds it: the
 *      app-wide response guard (server/middleware/secretColumnGuard.ts)
 *      installed before the routes. Every lead-serving route here is clean,
 *      including routes with no handler-level projection (/paginated,
 *      /focus), which the guard alone covers — and the guard says so in its
 *      log line. Disable the guard and those go red.
 *   2. HANDLERS ONLY — no guard. GET /:id, list, create and update project
 *      the row themselves (omitSecretColumns), so they stay clean even if
 *      the guard were not installed. Remove a projection and that lane goes
 *      red.
 *
 * The ciphertext uses the legacy 4-segment envelope, not the `enc:v1:` prefix,
 * so the guard's key lane — not its envelope lane — is what is under test.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { getTableColumns } from "drizzle-orm";

const ORG_ID = 77;
const TAX_ID_CIPHERTEXT = "a1b2c3d4:e5f60718:293a4b5c:6d7e8f90";

const H = vi.hoisted(() => {
  type Row = Record<string, any>;
  const state = { LEADS: [] as Row[], template: {} as Row, nextId: 1 };
  const full = (overrides: Row): Row => ({ ...state.template, ...overrides });
  const storageMock = {
    getLead: vi.fn(async (orgId: number, id: number) => {
      const found = state.LEADS.find((l) => l.id === id && l.organizationId === orgId);
      return found ? { ...found } : undefined;
    }),
    getLeads: vi.fn(async () => state.LEADS.map((l) => ({ ...l }))),
    getLeadsPaginated: vi.fn(async (_orgId: number, opts: any) => ({
      data: state.LEADS.map((l) => ({ ...l })),
      total: state.LEADS.length,
      page: opts?.page ?? 1,
      pageSize: opts?.pageSize ?? 25,
      totalPages: 1,
    })),
    getLeadsByComputedStage: vi.fn(async () => ({
      data: state.LEADS.map((l) => ({ ...l })),
      total: state.LEADS.length,
      totalPages: 1,
    })),
    getLeadsCursor: vi.fn(async () => ({
      data: state.LEADS.map((l) => ({ ...l })),
      total: state.LEADS.length,
      hasMore: false,
    })),
    // The database returns every column on insert/update — tax identity included.
    createLead: vi.fn(async (data: Row) => {
      const lead = full({ ...data, id: state.nextId++ });
      state.LEADS.push(lead);
      return { ...lead };
    }),
    updateLead: vi.fn(async (id: number, updates: Row) => {
      const lead = state.LEADS.find((l) => l.id === id)!;
      Object.assign(lead, updates);
      return { ...lead };
    }),
    findDuplicateLeads: vi.fn(async (): Promise<any[]> => []),
    getTeamMemberByEmail: vi.fn(async () => null),
    createAuditLogEntry: vi.fn(async () => ({ id: 1 })),
    updateLeadScore: vi.fn(async () => ({})),
    createLeadActivity: vi.fn(async () => ({ id: 1 })),
    logActivity: vi.fn(async () => ({ id: 1 })),
  };
  const dbMock: any = {
    select: () => ({ from: () => ({ where: () => Object.assign([], { limit: () => [] }) }) }),
    insert: () => ({ values: () => Object.assign(Promise.resolve(undefined), { returning: () => Promise.resolve([]) }) }),
    update: () => ({ set: () => ({ where: () => Object.assign(Promise.resolve(undefined), { returning: () => Promise.resolve([]) }) }) }),
    transaction: async (fn: any) => fn(dbMock),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { state, storageMock, dbMock, logger };
});

vi.mock("../../server/storage", () => ({ storage: H.storageMock, db: H.dbMock }));
vi.mock("../../server/db", () => ({ db: H.dbMock }));
vi.mock("../../server/utils/logger", () => ({ logger: H.logger }));
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

import { leads } from "@shared/schema";
import { registerLeadRoutes } from "../../server/routes-leads";
import { secretColumnGuard } from "../../server/middleware/secretColumnGuard";

/** A lead row carrying EVERY column of the table, as the database returns it. */
function fullLeadTemplate(): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const key of Object.keys(getTableColumns(leads))) row[key] = null;
  return {
    ...row,
    organizationId: ORG_ID,
    type: "seller",
    firstName: "Dana",
    lastName: "Reyes",
    status: "new",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    taxId: TAX_ID_CIPHERTEXT,
    taxIdType: "SSN",
  };
}

function makeApp(withGuard: boolean) {
  const app = express();
  if (withGuard) app.use(secretColumnGuard); // as server/index.ts installs it
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
const guarded = makeApp(true);
const bare = makeApp(false);

/** Every key path in a JSON body that names tax identity. */
function taxIdentityPaths(body: unknown, at = "$"): string[] {
  if (Array.isArray(body)) return body.flatMap((v, i) => taxIdentityPaths(v, `${at}[${i}]`));
  if (body && typeof body === "object") {
    return Object.entries(body as Record<string, unknown>).flatMap(([k, v]) => [
      ...(k === "taxId" || k === "taxIdType" ? [`${at}.${k}`] : []),
      ...taxIdentityPaths(v, `${at}.${k}`),
    ]);
  }
  if (typeof body === "string" && body.includes(TAX_ID_CIPHERTEXT)) return [at];
  return [];
}

function seed(): number {
  const id = H.state.nextId++;
  H.state.LEADS.push({ ...H.state.template, id });
  return id;
}

beforeEach(() => {
  H.state.LEADS = [];
  H.state.nextId = 1;
  H.state.template = fullLeadTemplate();
  vi.clearAllMocks();
});

type Call = { name: string; run: (app: express.Express, id: number) => request.Test };
const PRIMARY: Call[] = [
  { name: "GET /api/leads/:id", run: (app, id) => request(app).get(`/api/leads/${id}`) },
  { name: "GET /api/leads", run: (app) => request(app).get("/api/leads") },
  { name: "GET /api/leads?stage=cold", run: (app) => request(app).get("/api/leads?stage=cold") },
  { name: "POST /api/leads", run: (app) => request(app).post("/api/leads").send({ firstName: "Ada", lastName: "Lovelace" }) },
  { name: "PUT /api/leads/:id", run: (app, id) => request(app).put(`/api/leads/${id}`).send({ notes: "called back" }) },
];
/** Lead-serving routes with no handler-level projection: the guard is their only defence. */
const GUARD_ONLY: Call[] = [
  { name: "GET /api/leads/paginated", run: (app) => request(app).get("/api/leads/paginated") },
  { name: "GET /api/leads/focus", run: (app) => request(app).get("/api/leads/focus") },
];

describe("fixture vacuity", () => {
  it("the storage stand-in serves a full lead row with tax identity set", async () => {
    const id = seed();
    const row = await H.storageMock.getLead(ORG_ID, id);
    expect(Object.keys(row!).length).toBe(Object.keys(getTableColumns(leads)).length);
    expect(row!.taxId).toBe(TAX_ID_CIPHERTEXT);
    expect(row!.taxIdType).toBe("SSN");
  });
});

describe("guarded app (production wiring): no lead response carries tax identity", () => {
  for (const call of [...PRIMARY, ...GUARD_ONLY]) {
    it(call.name, async () => {
      const id = seed();
      const res = await call.run(guarded, id);
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBeLessThan(300);
      // Not vacuous: the lead itself was served.
      expect(JSON.stringify(res.body)).toContain(call.name.startsWith("POST") ? "Ada" : "Dana");
      expect(taxIdentityPaths(res.body)).toEqual([]);
    });
  }

  it("the guard — not a handler — is what cleans the routes with no projection, and it logs the route", async () => {
    seed();
    const res = await request(guarded).get("/api/leads/paginated");
    expect(res.status).toBe(200);
    const guardLogs = H.logger.warn.mock.calls.filter((c) => String(c[0]).includes("[secretColumnGuard]"));
    expect(guardLogs.length).toBe(1);
    expect(guardLogs[0]![1]).toMatchObject({
      route: "GET /api/leads/paginated",
      keys: expect.arrayContaining(["leads.taxId", "leads.taxIdType"]),
    });
  });

  it("the projected routes reach the guard already clean (no guard log)", async () => {
    const id = seed();
    await request(guarded).get(`/api/leads/${id}`);
    await request(guarded).get("/api/leads");
    const guardLogs = H.logger.warn.mock.calls.filter((c) => String(c[0]).includes("[secretColumnGuard]"));
    expect(guardLogs).toEqual([]);
  });
});

describe("handlers only (no guard): the primary lead routes project tax identity out themselves", () => {
  for (const call of PRIMARY) {
    it(call.name, async () => {
      const id = seed();
      const res = await call.run(bare, id);
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBeLessThan(300);
      expect(taxIdentityPaths(res.body)).toEqual([]);
    });
  }
});
