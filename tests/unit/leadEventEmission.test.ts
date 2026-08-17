/**
 * Wave B "Wire the engine" — lead.* workflow events are REAL now.
 *
 * Before this wave `emitLeadEvent` (server/services/workflow-engine.ts) was
 * exported with ZERO call sites: 46 workflow templates existed and only the
 * two parcel events ever fired, so every "New Lead Received" / "Lead Status
 * Changed" automation a customer installed sat idle forever.
 *
 * This suite pins the honest contract of the new emitters:
 *   1. EVERY lead-creation path emits `lead.created` EXACTLY ONCE, with the
 *      real organizationId + the persisted lead id (single create, Pax's
 *      create_lead tool, the client CSV import route, the tax-delinquent
 *      import, and the shared CSV importer used by /api/leads/import).
 *   2. A status move emits `lead.status_changed` carrying previousData; a
 *      non-status material change emits `lead.updated`.
 *   3. A NO-OP update emits NOTHING — neither the single PUT, nor bulk
 *      update, nor Pax re-asserting the status a lead already has.
 *   4. Emits are fire-and-forget: a throwing workflow engine can NEVER fail
 *      a lead create or update (the request still succeeds).
 *
 * idempotent: true — storage, db and the workflow engine are fully mocked;
 * no DATABASE_URL needed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const ORG_ID = 77;

// Every piece of mutable mock state lives inside vi.hoisted() because the
// vi.mock factories below are hoisted above the imports — a plain top-level
// `const` would still be in its TDZ when routes-leads.ts pulls in `storage`.
const H = vi.hoisted(() => {
  const ORG_ID = 77;

  type Emitted = {
    event: string;
    organizationId: number;
    leadId: number;
    data: Record<string, any>;
    previousData?: Record<string, any>;
  };
  type FakeLead = Record<string, any> & { id: number; organizationId: number };

  const state = {
    ORG_ID,
    EMITTED: [] as Emitted[],
    emitShouldThrow: false,
    LEADS: [] as FakeLead[],
    nextLeadId: 1,
  };

  const insertLeadRow = (values: Record<string, any>): FakeLead => {
    const lead = {
      id: state.nextLeadId++,
      status: "new",
      deletedAt: null,
      ...values,
    } as FakeLead;
    state.LEADS.push(lead);
    return lead;
  };

  // The only real seam we assert on: workflow-engine's emitLeadEvent. Mocked
  // at the ENGINE boundary (never at services/leadEvents) so the
  // fire-and-forget wrapper, the no-op diff and the payload shape are all
  // exercised for real.
  const emitLeadEventMock = vi.fn(
    (
      event: string,
      organizationId: number,
      leadId: number,
      data: Record<string, any>,
      previousData?: Record<string, any>,
    ) => {
      if (state.emitShouldThrow) throw new Error("workflow engine exploded");
      state.EMITTED.push({ event, organizationId, leadId, data, previousData });
    },
  );

  const storageMock = {
    createLead: vi.fn(async (data: any) => insertLeadRow(data)),
    createLeadsBatch: vi.fn(async (rows: any[]) => rows.map((r) => insertLeadRow(r))),
    // Returns a COPY, like a real row read — otherwise the in-place
    // `updateLead` mutation below would also mutate the caller's
    // "before" snapshot and the diff would never see a change.
    getLead: vi.fn(async (orgId: number, id: number) => {
      const found = state.LEADS.find((l) => l.id === id && l.organizationId === orgId);
      return found ? { ...found } : undefined;
    }),
    getLeadsByIds: vi.fn(async (orgId: number, ids: number[]) =>
      state.LEADS.filter((l) => l.organizationId === orgId && ids.includes(l.id)).map(
        (l) => ({ ...l }),
      ),
    ),
    updateLead: vi.fn(async (id: number, updates: any) => {
      const lead = state.LEADS.find((l) => l.id === id)!;
      Object.assign(lead, updates);
      return { ...lead };
    }),
    bulkUpdateLeads: vi.fn(async (orgId: number, ids: number[], updates: any) => {
      let n = 0;
      for (const lead of state.LEADS) {
        if (lead.organizationId === orgId && ids.includes(lead.id)) {
          Object.assign(lead, updates);
          n++;
        }
      }
      return n;
    }),
    findDuplicateLeads: vi.fn(async () => []),
    getTeamMemberByEmail: vi.fn(async () => null),
    createAuditLogEntry: vi.fn(async () => ({ id: 1 })),
    updateLeadScore: vi.fn(async () => ({})),
    createLeadActivity: vi.fn(async () => ({ id: 1 })),
    logActivity: vi.fn(async () => ({ id: 1 })),
    getNotes: vi.fn(async () => []),
    createNote: vi.fn(async () => ({ id: 1 })),
    getLeads: vi.fn(async () => state.LEADS),
  };

  // Minimal chainable drizzle stand-in covering exactly the shapes the lead
  // routes use: select→from→where(→limit), insert→values→returning,
  // update→set→where→returning. Drizzle's `where` clause is an opaque SQL
  // object here, so the raw-db tests below deliberately keep the fake table
  // small enough that "all rows" and "the targeted row" coincide.
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
        const p: any = Promise.resolve(undefined);
        p.returning = () => Promise.resolve([insertLeadRow(vals)]);
        return p;
      },
    }),
    update: () => ({
      set: (updates: any) => ({
        where: () => {
          const p: any = Promise.resolve(undefined);
          p.returning = () =>
            Promise.resolve(
              state.LEADS.map((l) => {
                Object.assign(l, updates);
                return { ...l };
              }),
            );
          return p;
        },
      }),
    }),
    transaction: async (fn: any) => fn(dbMock),
  };

  return { state, insertLeadRow, emitLeadEventMock, storageMock, dbMock };
});

const emitLeadEventMock = H.emitLeadEventMock;

vi.mock("../../server/services/workflow-engine", () => ({
  emitLeadEvent: (...args: any[]) =>
    H.emitLeadEventMock(...(args as [any, any, any, any, any])),
  emitPropertyEvent: vi.fn(),
  emitDealEvent: vi.fn(),
  emitPaymentEvent: vi.fn(),
  emitParcelEvent: vi.fn(),
  workflowEngine: { emit: vi.fn() },
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type FakeLead = Record<string, any> & { id: number; organizationId: number };

function seedLead(overrides: Partial<FakeLead> = {}): FakeLead {
  return H.insertLeadRow({
    organizationId: ORG_ID,
    type: "seller",
    firstName: "Dana",
    lastName: "Reyes",
    email: null,
    phone: null,
    address: null,
    city: null,
    state: null,
    zip: null,
    apn: null,
    source: "manual",
    status: "new",
    notes: null,
    tags: null,
    assignedTo: null,
    score: 0,
    deletedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  });
}

vi.mock("../../server/storage", () => ({
  storage: H.storageMock,
  db: H.dbMock,
}));
vi.mock("../../server/db", () => ({ db: H.dbMock }));

// ── Everything else routes-leads.ts pulls in (no DB, no network) ───────────

vi.mock("../../server/auth", () => ({
  isAuthenticated: (_req: any, _res: any, next: any) => next(),
}));
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
vi.mock("../../server/utils/orgScope", () => ({
  assertUserIsOrgMember: vi.fn(async () => true),
}));
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
  leadScoringService: {
    recordConversion: vi.fn(async () => ({})),
    scoreLead: vi.fn(async () => ({})),
  },
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
// Dynamic imports inside the create handler — all fire-and-forget side rails.
vi.mock("../../server/services/leadAssigner", () => ({ assignLead: async () => null }));
vi.mock("../../server/services/consentEvents", () => ({ recordConsentGranted: async () => ({}) }));
vi.mock("../../server/services/activation", () => ({ recordActivationEventAsync: () => {} }));
vi.mock("../../server/services/compliance/ofacScreening", () => ({
  screenCounterpartyAsync: () => {},
}));
vi.mock("../../server/services/mlSnapshots", () => ({ recordSnapshotAsync: () => {} }));
vi.mock("../../server/services/webhookDispatcher", () => ({
  webhookLeadCreated: async () => ({}),
}));
vi.mock("../../server/services/teamWebhookDispatcher", () => ({
  dispatchTeamEvent: async () => ({}),
}));

// ── Pax tool chokepoint gates (server/ai/tools.ts) ────────────────────────
// Both read the DB. getPaxPauseState fails CLOSED, so without this mock
// every Pax tool call would be refused before reaching the handler.
vi.mock("../../server/services/paxPause", () => ({
  getPaxPauseState: async () => ({ paused: false, pausedUntil: null, checkFailed: false }),
  paxPauseRefusalMessage: () => "Pax is paused",
}));
vi.mock("../../server/services/approvalKernel", () => ({
  APPROVAL_REQUIRED_TOOLS: new Set<string>(),
  proposePendingAction: async () => ({ id: 1 }),
  pendingActionArtifact: (p: any) => p,
}));
vi.mock("../../server/services/aiContextAggregator", () => ({
  getSystemContext: async () => ({}),
  formatContextForAI: () => "",
  invalidateContextCache: () => {},
}));

// ── Modules under test ─────────────────────────────────────────────────────

import { registerLeadRoutes } from "../../server/routes-leads";
import { importLeads } from "../../server/services/importExport";
import { executeTool } from "../../server/ai/tools";
import {
  changedLeadFields,
  emitLeadUpdated,
  safeEmitLeadEvent,
} from "../../server/services/leadEvents";

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

beforeEach(() => {
  H.state.LEADS = [];
  H.state.nextLeadId = 1;
  H.state.EMITTED = [];
  H.state.emitShouldThrow = false;
  vi.clearAllMocks();
});

const EMITTED = () => H.state.EMITTED;
const LEADS = () => H.state.LEADS;
const created = () => EMITTED().filter((e) => e.event === "lead.created");
const statusChanged = () => EMITTED().filter((e) => e.event === "lead.status_changed");
const updated = () => EMITTED().filter((e) => e.event === "lead.updated");

// ═══════════════════════════════════════════════════════════════════════════
describe("lead.created fires exactly once on every creation path", () => {
  it("POST /api/leads (single create)", async () => {
    const res = await request(app)
      .post("/api/leads")
      .send({ type: "seller", firstName: "Ada", lastName: "Lovelace" });

    expect(res.status).toBe(201);
    expect(created()).toHaveLength(1);
    expect(created()[0].organizationId).toBe(ORG_ID);
    expect(created()[0].leadId).toBe(res.body.id);
    // Payload is the PERSISTED row, not the request body.
    expect(created()[0].data.firstName).toBe("Ada");
    expect(created()[0].data.organizationId).toBe(ORG_ID);
  });

  it("POST /api/leads/csv-import — once per imported row, never for skipped rows", async () => {
    // Row 3 is invalid (no usable name) and must NOT emit.
    const res = await request(app)
      .post("/api/leads/csv-import")
      .send({
        rows: [
          { firstName: "A", lastName: "One", apn: "111" },
          { ownerName: "B Two", apn: "222" },
          { apn: "333" },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(2);
    expect(res.body.skippedInvalid).toBe(1);
    expect(created()).toHaveLength(2);
    for (const e of created()) {
      expect(e.organizationId).toBe(ORG_ID);
      expect(typeof e.leadId).toBe("number");
      expect(e.data.source).toBe("csv_import");
    }
    // Entity ids are the real distinct persisted rows.
    expect(new Set(created().map((e) => e.leadId)).size).toBe(2);
  });

  it("POST /api/leads/csv-import — the same APN in a different STATE is not a duplicate", async () => {
    // An APN is unique within a county, not globally. Keyed on the number
    // alone, parcel 12345 in Texas and parcel 12345 in Oklahoma were one lead
    // and the second import was silently counted as skippedExisting — the
    // caller was told a real, different parcel already existed.
    seedLead({ apn: "12345", state: "TX" });

    const res = await request(app)
      .post("/api/leads/csv-import")
      .send({
        rows: [
          { firstName: "Same", lastName: "State", apn: "12345", state: "TX" },
          { firstName: "Other", lastName: "State", apn: "12345", state: "OK" },
        ],
      });

    expect(res.status).toBe(200);
    expect(
      res.body.skippedExisting,
      "the TX row should still be recognised as already present",
    ).toBe(1);
    expect(
      res.body.imported,
      "the OK parcel was rejected as a duplicate of the TX one",
    ).toBe(1);
    expect(created()).toHaveLength(1);
    expect(created()[0].data.state).toBe("OK");
  });

  it("POST /api/leads/csv-import — the same parcel twice in one file still dedupes", () => {
    // The other direction, so the fix cannot be "stop deduping".
    return request(app)
      .post("/api/leads/csv-import")
      .send({
        rows: [
          { firstName: "First", lastName: "Row", apn: "777", state: "TX" },
          { firstName: "Second", lastName: "Row", apn: "777", state: "TX" },
          // Case and spacing must not defeat it either.
          { firstName: "Third", lastName: "Row", apn: " 777 ", state: "tx" },
        ],
      })
      .then((res) => {
        expect(res.status).toBe(200);
        expect(res.body.imported).toBe(1);
        expect(res.body.skippedDuplicateInFile).toBe(2);
      });
  });

  it("POST /api/leads/import/tax-delinquent — once per batched lead", async () => {
    const res = await request(app)
      .post("/api/leads/import/tax-delinquent")
      .send({
        mappedData: [
          { owner_name: "Carl Vance", property_address: "1 A St", state: "TX" },
          { owner_name: "Dee Brooks", property_address: "2 B St", state: "TX" },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.successCount).toBe(2);
    expect(created()).toHaveLength(2);
    expect(created().every((e) => e.organizationId === ORG_ID)).toBe(true);
    expect(created().map((e) => e.leadId).sort()).toEqual(LEADS().map((l) => l.id).sort());
  });

  it("importLeads() — the shared CSV importer behind /api/leads/import", async () => {
    const result = await importLeads(
      [
        { "First Name": "Eve", "Last Name": "Nakamura", Email: "eve@example.com" },
        { "First Name": "Finn", "Last Name": "Okafor", Email: "finn@example.com" },
      ],
      ORG_ID,
    );

    expect(result.successCount).toBe(2);
    expect(created()).toHaveLength(2);
    expect(created().every((e) => e.organizationId === ORG_ID)).toBe(true);
    expect(created().every((e) => typeof e.leadId === "number")).toBe(true);
  });

  it("Pax create_lead tool", async () => {
    const out: any = await executeTool(
      "create_lead",
      { first_name: "Gil", last_name: "Praeger", type: "buyer" },
      { id: ORG_ID, name: "Test Org" } as any,
    );

    expect(out.success).toBe(true);
    expect(created()).toHaveLength(1);
    expect(created()[0].organizationId).toBe(ORG_ID);
    expect(created()[0].leadId).toBe(out.data.lead.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("status moves fire lead.status_changed with previousData", () => {
  it("PUT /api/leads/:id status new → contacted", async () => {
    const lead = seedLead({ status: "new" });

    const res = await request(app)
      .put(`/api/leads/${lead.id}`)
      .send({ status: "contacted" });

    expect(res.status).toBe(200);
    expect(statusChanged()).toHaveLength(1);
    expect(updated()).toHaveLength(0);
    const evt = statusChanged()[0];
    expect(evt.organizationId).toBe(ORG_ID);
    expect(evt.leadId).toBe(lead.id);
    expect(evt.data.status).toBe("contacted");
    expect(evt.previousData?.status).toBe("new");
  });

  it("PUT /api/leads/:id non-status material change fires lead.updated", async () => {
    const lead = seedLead({ status: "new", notes: null });

    const res = await request(app)
      .put(`/api/leads/${lead.id}`)
      .send({ notes: "Called, wants a callback Thursday" });

    expect(res.status).toBe(200);
    expect(updated()).toHaveLength(1);
    expect(statusChanged()).toHaveLength(0);
    expect(updated()[0].leadId).toBe(lead.id);
    expect(updated()[0].data.changedFields).toEqual(["notes"]);
  });

  it("bulk-update fires one status_changed per lead that actually moved", async () => {
    const a = seedLead({ status: "new" });
    const b = seedLead({ status: "new" });
    // Already 'contacted' — the bulk write does not change it, so no event.
    const c = seedLead({ status: "contacted" });

    const res = await request(app)
      .post("/api/leads/bulk-update")
      .send({ ids: [a.id, b.id, c.id], updates: { status: "contacted" } });

    expect(res.status).toBe(200);
    expect(statusChanged()).toHaveLength(2);
    expect(statusChanged().map((e) => e.leadId).sort()).toEqual([a.id, b.id].sort());
    expect(statusChanged().every((e) => e.previousData?.status === "new")).toBe(true);
  });

  it("Pax update_lead_status fires status_changed on a real move", async () => {
    const lead = seedLead({ status: "new" });

    await executeTool(
      "update_lead_status",
      { lead_id: lead.id, status: "contacted" },
      { id: ORG_ID, name: "Test Org" } as any,
    );

    expect(statusChanged()).toHaveLength(1);
    expect(statusChanged()[0].leadId).toBe(lead.id);
    expect(statusChanged()[0].previousData?.status).toBe("new");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("a no-op write emits NOTHING", () => {
  it("PUT /api/leads/:id resubmitting identical values emits no event", async () => {
    const lead = seedLead({ status: "new", firstName: "Dana", notes: "same" });

    const res = await request(app)
      .put(`/api/leads/${lead.id}`)
      .send({ status: "new", firstName: "Dana", notes: "same" });

    expect(res.status).toBe(200);
    expect(EMITTED()).toHaveLength(0);
  });

  it("bulk-update that changes nothing emits no event", async () => {
    const a = seedLead({ status: "contacted" });
    const b = seedLead({ status: "contacted" });

    const res = await request(app)
      .post("/api/leads/bulk-update")
      .send({ ids: [a.id, b.id], updates: { status: "contacted" } });

    expect(res.status).toBe(200);
    expect(EMITTED()).toHaveLength(0);
  });

  it("Pax re-asserting the status a lead already has emits no event", async () => {
    const lead = seedLead({ status: "contacted" });

    await executeTool(
      "update_lead_status",
      { lead_id: lead.id, status: "contacted" },
      { id: ORG_ID, name: "Test Org" } as any,
    );

    expect(EMITTED()).toHaveLength(0);
  });

  it("restoring an already-active lead emits nothing", async () => {
    const lead = seedLead({ deletedAt: null });

    const res = await request(app).patch(`/api/leads/${lead.id}/restore`);

    expect(res.status).toBe(200);
    expect(EMITTED()).toHaveLength(0);
  });

  it("changedLeadFields ignores non-material churn (score, lastContactedAt)", () => {
    const before = { status: "new", score: 10, lastContactedAt: new Date(0) };
    const after = { status: "new", score: 92, lastContactedAt: new Date(999) };
    expect(
      changedLeadFields(before, after, ["status", "score", "lastContactedAt"]),
    ).toEqual([]);
    expect(emitLeadUpdated(ORG_ID, before, after, ["score"])).toBeNull();
    expect(EMITTED()).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("emits are fire-and-forget — a workflow failure cannot fail the request", () => {
  it("a throwing engine still lets POST /api/leads succeed", async () => {
    H.state.emitShouldThrow = true;

    const res = await request(app)
      .post("/api/leads")
      .send({ type: "seller", firstName: "Hana", lastName: "Ito" });

    expect(res.status).toBe(201);
    expect(res.body.firstName).toBe("Hana");
    expect(emitLeadEventMock).toHaveBeenCalledTimes(1);
    expect(EMITTED()).toHaveLength(0); // it threw, nothing recorded
  });

  it("a throwing engine still lets PUT /api/leads/:id succeed", async () => {
    const lead = seedLead({ status: "new" });
    H.state.emitShouldThrow = true;

    const res = await request(app)
      .put(`/api/leads/${lead.id}`)
      .send({ status: "contacted" });

    expect(res.status).toBe(200);
    expect(emitLeadEventMock).toHaveBeenCalled();
  });

  it("a throwing engine still lets a CSV import complete every row", async () => {
    H.state.emitShouldThrow = true;

    const result = await importLeads(
      [{ "First Name": "Ivo", "Last Name": "Sandu" }],
      ORG_ID,
    );

    expect(result.successCount).toBe(1);
    expect(result.errorCount).toBe(0);
  });

  it("safeEmitLeadEvent drops (never throws on) a missing org or lead id", () => {
    expect(() =>
      safeEmitLeadEvent("lead.created", undefined, 5, { id: 5 }),
    ).not.toThrow();
    expect(() =>
      safeEmitLeadEvent("lead.created", ORG_ID, undefined, {}),
    ).not.toThrow();
    expect(emitLeadEventMock).not.toHaveBeenCalled();
  });
});
