/**
 * A purchased list cannot be bulk-marked TCPA-consented.
 *
 * `POST /api/leads/bulk-update` validated `updates` with the lead schema and
 * wrote it to every id, so `{ tcpaConsent: true, consentSource: "list_vendor" }`
 * turned a whole vendor list into "consented" leads with no per-lead evidence —
 * and the SMS/phone gates read `tcpaConsent` as permission to send. A vendor
 * list is not prior express written consent. Consent is granted one lead at a
 * time (PATCH /api/leads/:id/consent, or lead creation with its disclosure),
 * which records the evidence. Clearing consent in bulk stays allowed.
 *
 * Drives the real route with the same storage double leadEventEmission uses.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const ORG_ID = 77;

const H = vi.hoisted(() => {
  const state = { LEADS: [] as Array<Record<string, any>>, bulkCalls: 0 };
  const storageMock = {
    getLeadsByIds: vi.fn(async (orgId: number, ids: number[]) =>
      state.LEADS.filter((l) => l.organizationId === orgId && ids.includes(l.id)).map((l) => ({ ...l })),
    ),
    bulkUpdateLeads: vi.fn(async (orgId: number, ids: number[], updates: any) => {
      state.bulkCalls++;
      let n = 0;
      for (const lead of state.LEADS) {
        if (lead.organizationId === orgId && ids.includes(lead.id)) {
          Object.assign(lead, updates);
          n++;
        }
      }
      return n;
    }),
    createAuditLogEntry: vi.fn(async () => ({ id: 1 })),
  };
  const dbMock: any = {};
  return { state, storageMock, dbMock };
});

vi.mock("../../server/services/workflow-engine", () => ({
  emitLeadEvent: vi.fn(),
  emitPropertyEvent: vi.fn(),
  emitDealEvent: vi.fn(),
  emitPaymentEvent: vi.fn(),
  emitParcelEvent: vi.fn(),
  workflowEngine: { emit: vi.fn() },
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/storage", () => ({ storage: H.storageMock, db: H.dbMock }));
vi.mock("../../server/db", () => ({ db: H.dbMock }));

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
vi.mock("../../server/services/consentEvents", () => ({ recordConsentGranted: async () => ({}), recordConsentRevoked: async () => ({}) }));
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
// Since 2026-09-02 executeTool reads the org's stance + pause through the
// ONE reader (getPaxControls), which fails CLOSED on any DB read — so the
// mocked db above would refuse every record write. Unpaused, default stance.
vi.mock("../../server/services/paxControls", () => ({
  getPaxControls: async () => ({
    stance: "ask_before_sending",
    leadScoring: true,
    borrowerReminders: true,
    inboxDrafts: true,
    paused: false,
    pausedUntil: null,
    pausedBy: null,
    checkFailed: false,
    timezone: "America/Chicago",
  }),
  paxControlsRefusalMessage: () => "Pax is paused",
}));
vi.mock("../../server/services/paxReceipts", () => ({ recordPaxEffect: async () => ({ written: true }) }));
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


import { registerLeadRoutes } from "../../server/routes-leads";

const app = express();
app.use(express.json());
app.use((req: any, _res, next) => {
  req.organization = { id: ORG_ID, name: "Test Org" };
  req.organizationId = ORG_ID;
  req.user = { id: "user-1" };
  next();
});
registerLeadRoutes(app);

beforeEach(() => {
  H.state.bulkCalls = 0;
  H.state.LEADS = [
    { id: 1, organizationId: ORG_ID, status: "new", tcpaConsent: false, consentSource: null, doNotContact: false },
    { id: 2, organizationId: ORG_ID, status: "new", tcpaConsent: false, consentSource: null, doNotContact: false },
    { id: 3, organizationId: ORG_ID, status: "new", tcpaConsent: true, consentSource: "website", doNotContact: true, optOutDate: new Date() },
  ];
});

const snapshot = () => JSON.stringify(H.state.LEADS);
const bulk = (updates: Record<string, unknown>, ids = [1, 2, 3]) =>
  request(app).post("/api/leads/bulk-update").send({ ids, updates });

describe("bulk-update may never grant TCPA consent", () => {
  it("tcpaConsent: true with consentSource 'list_vendor' is a 400 and changes nothing", async () => {
    const before = snapshot();
    const res = await bulk({ tcpaConsent: true, consentSource: "list_vendor" });
    expect(res.status).toBe(400);
    expect(H.state.bulkCalls).toBe(0);
    expect(snapshot()).toBe(before);
  });

  it("tcpaConsent: true alone is a 400", async () => {
    const res = await bulk({ tcpaConsent: true });
    expect(res.status).toBe(400);
    expect(H.state.bulkCalls).toBe(0);
  });

  it("a consent source or date cannot be stamped onto a list", async () => {
    expect((await bulk({ consentSource: "list_vendor" })).status).toBe(400);
    expect((await bulk({ consentSource: "website" })).status).toBe(400);
    expect((await bulk({ consentDate: "2026-10-01T00:00:00.000Z" })).status).toBe(400);
    expect(H.state.bulkCalls).toBe(0);
  });

  it("an opt-out cannot be lifted in bulk", async () => {
    const res = await bulk({ doNotContact: false });
    expect(res.status).toBe(400);
    expect(H.state.LEADS.find((l) => l.id === 3)!.doNotContact).toBe(true);
  });

  it("clearing consent in bulk is still allowed", async () => {
    const res = await bulk({ tcpaConsent: false });
    expect(res.status).toBe(200);
    expect(H.state.LEADS.every((l) => l.tcpaConsent === false)).toBe(true);
  });

  it("marking a list do-not-contact in bulk is still allowed", async () => {
    const res = await bulk({ doNotContact: true }, [1, 2]);
    expect(res.status).toBe(200);
    expect(H.state.LEADS.filter((l) => l.id !== 3).every((l) => l.doNotContact)).toBe(true);
  });

  it("an ordinary bulk update is untouched", async () => {
    const res = await bulk({ status: "contacted" }, [1, 2]);
    expect(res.status).toBe(200);
  });
});
