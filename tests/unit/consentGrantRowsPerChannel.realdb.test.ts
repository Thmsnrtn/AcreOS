/**
 * Per-channel consent grant rows, against a real Postgres, through the real
 * POST /api/leads and PUT /api/leads/:id handlers and the real repository.
 * Only auth/org middleware and fire-and-forget side rails are stood in for.
 *
 *   - a lead created with consent → exactly one grant row per granted channel
 *     (sms, phone), each naming its channel, all sharing the server-stamped
 *     source and the same created_at, and that source is the lead row's;
 *   - a lead created without consent → no grant rows;
 *   - re-asserting consent on the lead (an edit) → no new rows, and the
 *     lead's original consent date / source do not move;
 *   - the SMS opt-in keyword records the same per-channel shape.
 * The no-database half (writer shape, writer population, the AI-voice gate's
 * verdict) is consentGrantRowsPerChannel.test.ts.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { useRealDb, realDbAvailable } from "../helpers/realDb";

useRealDb("consentGrantRowsPerChannel.realdb.test.ts");

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/auth", () => ({ isAuthenticated: (_req: any, _res: any, next: any) => next() }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({ getOrCreateOrg: (_req: any, _res: any, next: any) => next() }));
vi.mock("../../server/middleware/usageLimitGate", () => ({
  usageLimitGate: () => (_req: any, _res: any, next: any) => next(),
  aiByokThresholdGate: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../server/middleware/roleScope", () => ({ requireScope: () => (_req: any, _res: any, next: any) => next() }));
vi.mock("../../server/utils/permissions", () => ({
  attachPermissionContext: () => (_req: any, _res: any, next: any) => next(),
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../server/services/usageLimits", () => ({ checkUsageLimit: vi.fn(async () => ({ allowed: true, current: 0, limit: null })) }));
vi.mock("../../server/services/workflow-engine", () => ({
  emitLeadEvent: vi.fn(),
  emitPropertyEvent: vi.fn(),
  emitDealEvent: vi.fn(),
  emitPaymentEvent: vi.fn(),
  emitParcelEvent: vi.fn(),
  workflowEngine: { emit: vi.fn() },
}));
vi.mock("../../server/services/leadAssigner", () => ({ assignLead: async () => null }));
vi.mock("../../server/services/activation", () => ({ recordActivationEventAsync: () => {} }));
vi.mock("../../server/services/compliance/ofacScreening", () => ({ screenCounterpartyAsync: () => {} }));
vi.mock("../../server/services/mlSnapshots", () => ({ recordSnapshotAsync: () => {} }));
vi.mock("../../server/services/webhookDispatcher", () => ({ webhookLeadCreated: async () => ({}) }));
vi.mock("../../server/services/teamWebhookDispatcher", () => ({ dispatchTeamEvent: async () => ({}) }));
vi.mock("../../server/services/leadNurturer", () => ({
  leadNurturerService: { calculateLeadScore: () => ({ score: 10, factors: {} }), segmentLead: () => "cold", generateFollowUp: async () => null },
}));
vi.mock("../../server/services/propertyEnrichment", () => ({ propertyEnrichmentService: { enrichLead: vi.fn(async () => null) } }));
vi.mock("../../server/services/alerting", () => ({ alertingService: { send: vi.fn() } }));

const tag = `cgr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ids = { org: 0 };

describe.runIf(realDbAvailable)("per-channel consent grant rows (real database)", () => {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
  let app: express.Express;

  beforeAll(async () => {
    const { db } = await import("../../server/db");
    const { organizations } = await import("@shared/schema");
    ids.org = (await db.insert(organizations).values({ name: tag, slug: tag, ownerId: `${tag}-o` } as any).returning())[0].id;
    const { registerLeadRoutes } = await import("../../server/routes-leads");
    app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.organization = { id: ids.org, name: tag, settings: {} };
      req.organizationId = ids.org;
      req.user = { id: `${tag}-user` };
      next();
    });
    registerLeadRoutes(app);
  });
  afterAll(async () => {
    if (!ids.org) return;
    const { db } = await import("../../server/db");
    const { eq } = await import("drizzle-orm");
    const { leads, activityLog, auditLog, organizations } = await import("@shared/schema");
    const { leadConsentEvents } = await import("@shared/schema/comms-email");
    await db.delete(leadConsentEvents).where(eq(leadConsentEvents.organizationId, ids.org)).catch(() => undefined);
    await db.delete(activityLog).where(eq(activityLog.organizationId, ids.org)).catch(() => undefined);
    await db.delete(auditLog).where(eq(auditLog.organizationId, ids.org)).catch(() => undefined);
    await db.delete(leads).where(eq(leads.organizationId, ids.org)).catch(() => undefined);
    await db.delete(organizations).where(eq(organizations.id, ids.org)).catch(() => undefined);
  });

  const grantRows = async (leadId: number) => {
    const { db } = await import("../../server/db");
    const { and, eq, asc } = await import("drizzle-orm");
    const { leadConsentEvents } = await import("@shared/schema/comms-email");
    return db
      .select()
      .from(leadConsentEvents)
      .where(and(eq(leadConsentEvents.organizationId, ids.org), eq(leadConsentEvents.leadId, leadId), eq(leadConsentEvents.eventType, "granted")))
      .orderBy(asc(leadConsentEvents.id));
  };
  const reload = async (id: number) => {
    const { db } = await import("../../server/db");
    const { leads } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    return (await db.select().from(leads).where(eq(leads.id, id)))[0];
  };

  it("a lead created with consent gets one grant row per granted channel, sharing the stamped source and date", async () => {
    const res = await request(app).post("/api/leads").send({
      firstName: "Pat",
      lastName: `${tag}-yes`,
      tcpaConsent: true,
      consentSource: "written",
      consentText: "I agree to be called and texted at this number.",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const lead = await reload(res.body.id);
    expect(lead.tcpaConsent).toBe(true);
    expect(lead.consentSource).toBe("written");

    const rows = await grantRows(lead.id);
    expect(rows.map((r) => r.channels)).toEqual([["sms"], ["phone"]]);
    for (const r of rows) {
      expect(r.channels).toHaveLength(1);
      expect(r.source, "the row's source is the persisted lead's").toBe(lead.consentSource);
      expect(r.consentText).toBe("I agree to be called and texted at this number.");
      expect(r.organizationId).toBe(ids.org);
    }
    expect(new Set(rows.map((r) => new Date(r.createdAt).getTime())).size, "one grant → one timestamp").toBe(1);
    expect(new Set(rows.map((r) => r.source)).size).toBe(1);
    expect(rows.flatMap((r) => r.channels)).not.toContain("email");
    expect(rows.flatMap((r) => r.channels)).not.toContain("direct_mail");
  });

  it("the default-source grant (no source named) is stamped and recorded the same way", async () => {
    const res = await request(app).post("/api/leads").send({ firstName: "Dee", lastName: `${tag}-default`, tcpaConsent: true });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const lead = await reload(res.body.id);
    const rows = await grantRows(lead.id);
    expect(rows.map((r) => r.channels)).toEqual([["sms"], ["phone"]]);
    expect(rows.every((r) => r.source === lead.consentSource && r.source === "admin_manual")).toBe(true);
  });

  it("a lead created without consent gets no grant rows", async () => {
    const res = await request(app).post("/api/leads").send({ firstName: "Nia", lastName: `${tag}-no` });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await grantRows(res.body.id)).toEqual([]);
  });

  it("a list-level source grants nothing, so it records nothing", async () => {
    const res = await request(app).post("/api/leads").send({ firstName: "Lu", lastName: `${tag}-list`, tcpaConsent: true, consentSource: "purchased_list" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await reload(res.body.id)).tcpaConsent).not.toBe(true);
    expect(await grantRows(res.body.id)).toEqual([]);
  });

  it("re-asserting consent on an existing lead adds no rows and keeps the original date and source", async () => {
    const created = await request(app).post("/api/leads").send({ firstName: "Ro", lastName: `${tag}-re`, tcpaConsent: true, consentSource: "written" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const before = await reload(created.body.id);
    const rowsBefore = await grantRows(before.id);
    expect(rowsBefore).toHaveLength(2);

    await new Promise((r) => setTimeout(r, 20));
    const edited = await request(app)
      .put(`/api/leads/${before.id}`)
      .send({ tcpaConsent: true, consentSource: "website", notes: "re-asserted" });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);

    const after = await reload(before.id);
    expect(after.notes).toBe("re-asserted");
    expect(new Date(after.consentDate!).getTime()).toBe(new Date(before.consentDate!).getTime());
    expect(after.consentSource).toBe("written");
    expect((await grantRows(before.id)).map((r) => r.id)).toEqual(rowsBefore.map((r) => r.id));
  });

  it("the SMS opt-in keyword records one row per TCPA channel", async () => {
    const { db } = await import("../../server/db");
    const { leads } = await import("@shared/schema");
    const phone = `+1555${String(Date.now()).slice(-7)}`;
    const [lead] = await db.insert(leads).values({ organizationId: ids.org, firstName: "K", lastName: `${tag}-kw`, phone } as any).returning();
    const { processOptKeyword } = await import("../../server/services/tcpaCompliance");
    await processOptKeyword(ids.org, phone, "START", `SM${tag}`);
    const rows = await grantRows(lead.id);
    expect(rows.map((r) => r.channels)).toEqual([["sms"], ["phone"]]);
    expect(rows.every((r) => r.source === "sms_double_optin")).toBe(true);
  });
});
