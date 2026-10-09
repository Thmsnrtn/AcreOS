/**
 * The VA role, end to end, against a real database: a VA reads and works only
 * the leads assigned to them.
 *
 * Every step goes through the real route handlers and the real middleware
 * chain (`getOrCreateOrg` and the gates it chains), with only authentication
 * replaced by a header. The VA's team membership is created by the real
 * invite-accept route, so the row it writes is the row production writes — the
 * defect this pins was a column default that silently overrode the role
 * default for exactly the rows that route creates.
 *
 * What it asserts, in the order a customer would meet it:
 *   - an invited VA reports assigned-only access on /api/me/permissions, the
 *     claim the client renders from;
 *   - an owner assigns a lead to the VA by TEAM MEMBER id (what
 *     `leads.assigned_to` stores), and an id that is not a member of the org is
 *     rejected — on the single, bulk and create paths;
 *   - the VA's list holds only the assigned lead;
 *   - a by-id read of an unassigned lead, and of its sub-resources, is a 404;
 *   - a write to an unassigned lead is refused and changes nothing, and a write
 *     to the VA's own lead succeeds.
 *
 * Audit writes are stubbed (audit_log is append-only, so a fixture row would
 * be stranded); workflow emitters and login-anomaly side effects are stubbed
 * because they are fire-and-forget writers this test does not own.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("vaRolePath.db");

vi.mock("../../server/auth", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../server/auth")>();
  return {
    ...real,
    isAuthenticated: (req: any, res: any, next: any) => {
      const id = req.header("x-test-user");
      if (!id) return res.status(401).json({ error: "unauthorized" });
      req.user = { id, email: req.header("x-test-email") ?? null };
      next();
    },
  };
});
vi.mock("../../server/services/loginAnomalyDetector", () => ({ recordAndAlertIfNew: async () => undefined }));
vi.mock("../../server/services/emailChangeDetector", () => ({ detectAndAlertEmailChange: async () => undefined }));
vi.mock("../../server/services/leadEvents", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../server/services/leadEvents")>();
  return { ...real, emitLeadCreated: () => undefined, emitLeadUpdated: () => undefined, safeEmitLeadEvent: () => undefined };
});

describe.runIf(realDbAvailable)("VA role path — a VA reads and works only assigned leads", () => {
  const tag = `va-path-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ownerId = `${tag}-owner`;
  const vaId = `${tag}-va`;
  const vaEmail = `${tag}-va@va-path.test`;
  const otherOwnerId = `${tag}-other`;

  let app: import("express").Express;
  let db: typeof import("../../server/db").db;
  let schema: typeof import("../../shared/schema");
  let orm: typeof import("drizzle-orm");

  const orgIds: number[] = [];
  let orgId = 0;
  let otherOrgMemberId = 0;
  let vaMemberId = 0;
  let assignedLead = 0;
  let unassignedLead = 0;
  let ownerLead = 0;
  let ownerMemberId = 0;

  const as = (user: string, email?: string) => ({ "x-test-user": user, ...(email ? { "x-test-email": email } : {}) });

  beforeAll(async () => {
    const express = (await import("express")).default;
    ({ db } = await import("../../server/db"));
    schema = await import("../../shared/schema");
    orm = await import("drizzle-orm");
    const { storage } = await import("../../server/storage");
    vi.spyOn(storage, "createAuditLogEntry").mockResolvedValue({} as never);

    const { registerLeadRoutes } = await import("../../server/routes-leads");
    const { registerOrganizationRoutes } = await import("../../server/routes-organization");
    app = express();
    app.use(express.json());
    registerLeadRoutes(app);
    registerOrganizationRoutes(app);
    // Mounted exactly as server/routes.ts mounts it.
    const { isAuthenticated } = await import("../../server/auth");
    const { getOrCreateOrg } = await import("../../server/middleware/getOrCreateOrg");
    app.use("/api/bulk", isAuthenticated, getOrCreateOrg, (await import("../../server/routes-bulk")).default);
    // A router whose handlers parse the id with radix-less parseInt.
    app.use("/api/seller-intent", isAuthenticated, getOrCreateOrg, (await import("../../server/routes-seller-intent")).default);

    const [org] = await db
      .insert(schema.organizations)
      .values({ name: `${tag}-org`, slug: `${tag}-org`, ownerId } as never)
      .returning();
    orgId = org.id;
    orgIds.push(org.id);
    const [ownerRow] = await db
      .insert(schema.teamMembers)
      .values({ organizationId: orgId, userId: ownerId, role: "owner", isActive: true } as never)
      .returning();
    ownerMemberId = ownerRow.id;

    // A second org with its own member: an id that exists, but not in this org.
    const [other] = await db
      .insert(schema.organizations)
      .values({ name: `${tag}-other`, slug: `${tag}-other`, ownerId: otherOwnerId } as never)
      .returning();
    orgIds.push(other.id);
    const [om] = await db
      .insert(schema.teamMembers)
      .values({ organizationId: other.id, userId: otherOwnerId, role: "owner", isActive: true } as never)
      .returning();
    otherOrgMemberId = om.id;

    const leads = await db
      .insert(schema.leads)
      .values([
        { organizationId: orgId, firstName: "Assigned", lastName: tag },
        { organizationId: orgId, firstName: "Unassigned", lastName: tag },
        { organizationId: orgId, firstName: "BulkAssigned", lastName: tag },
      ] as never)
      .returning();
    assignedLead = leads[0].id;
    unassignedLead = leads[1].id;
    ownerLead = leads[2].id;

    // The invitation row, exactly as the create route persists it (hash only).
    const { hashInviteToken, inviteTokenLast4 } = await import("../../server/utils/inviteTokens");
    const token = `${tag}-token-0123456789abcdef`;
    await db.insert(schema.organizationInvitations).values({
      organizationId: orgId,
      email: vaEmail,
      role: "va",
      inviteTokenHash: hashInviteToken(token),
      inviteTokenLast4: inviteTokenLast4(token),
      invitedByUserId: ownerId,
      expiresAt: new Date(Date.now() + 86_400_000),
    } as never);

    const accepted = await request(app)
      .post("/api/organization/invitations/accept")
      .set(as(vaId, vaEmail))
      .send({ token });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    const [row] = await db
      .select()
      .from(schema.teamMembers)
      .where(orm.and(orm.eq(schema.teamMembers.organizationId, orgId), orm.eq(schema.teamMembers.userId, vaId)));
    expect(row?.role).toBe("va");
    vaMemberId = row.id;
  });

  afterAll(async () => {
    if (orgIds.length === 0) return;
    // leads, team_members and invitations cascade from the organization.
    await db.delete(schema.organizations).where(orm.inArray(schema.organizations.id, orgIds));
  });

  it("an invited VA reports assigned-only access — the claim the client renders from", async () => {
    const r = await request(app).get("/api/me/permissions").set(as(vaId, vaEmail));
    expect(r.status).toBe(200);
    expect(r.body.role).toBe("va");
    expect(r.body.teamMemberId).toBe(vaMemberId);
    expect(r.body.permissions.viewOnlyAssignedLeads).toBe(true);
  });

  it("an owner assigns by team-member id; an id outside the org is rejected on every path", async () => {
    const ok = await request(app).put(`/api/leads/${assignedLead}`).set(as(ownerId)).send({ assignedTo: vaMemberId });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const [stored] = await db.select().from(schema.leads).where(orm.eq(schema.leads.id, assignedLead));
    expect(stored.assignedTo).toBe(vaMemberId);

    for (const bad of [otherOrgMemberId, 2_000_000_000]) {
      const put = await request(app).put(`/api/leads/${unassignedLead}`).set(as(ownerId)).send({ assignedTo: bad });
      expect(put.status, `PUT assignedTo=${bad}`).toBe(400);
      const bulk = await request(app)
        .post("/api/leads/bulk-update")
        .set(as(ownerId))
        .send({ ids: [unassignedLead], updates: { assignedTo: bad } });
      expect(bulk.status, `bulk assignedTo=${bad}`).toBe(400);
      const bulk2 = await request(app)
        .post("/api/bulk/leads/update")
        .set(as(ownerId))
        .send({ ids: [unassignedLead], updates: { assignedTo: bad } });
      expect(bulk2.status, `/api/bulk assignedTo=${bad}`).toBe(400);
    }
    const [still] = await db.select().from(schema.leads).where(orm.eq(schema.leads.id, unassignedLead));
    expect(still.assignedTo).toBeNull();
  });

  it("a valid team-member assignee is accepted on both bulk routes", async () => {
    const stored = async () => (await db.select().from(schema.leads).where(orm.eq(schema.leads.id, ownerLead)))[0].assignedTo;
    const a = await request(app)
      .post("/api/leads/bulk-update")
      .set(as(ownerId))
      .send({ ids: [ownerLead], updates: { assignedTo: ownerMemberId } });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(await stored()).toBe(ownerMemberId);
    const clear = await request(app).post("/api/bulk/leads/update").set(as(ownerId)).send({ ids: [ownerLead], updates: { assignedTo: null } });
    expect(clear.status, JSON.stringify(clear.body)).toBe(200);
    expect(await stored()).toBeNull();
    const b = await request(app)
      .post("/api/bulk/leads/update")
      .set(as(ownerId))
      .send({ ids: [ownerLead], updates: { assignedTo: ownerMemberId } });
    expect(b.status, JSON.stringify(b.body)).toBe(200);
    expect(await stored()).toBe(ownerMemberId);
  });

  it("the VA's list holds only the lead assigned to them", async () => {
    const r = await request(app).get("/api/leads?pageSize=100").set(as(vaId, vaEmail));
    expect(r.status).toBe(200);
    expect(r.body.data.map((l: { id: number }) => l.id)).toEqual([assignedLead]);
  });

  it("a by-id read of an unassigned lead — and of what hangs off it — is a 404", async () => {
    expect((await request(app).get(`/api/leads/${assignedLead}`).set(as(vaId, vaEmail))).status).toBe(200);
    const encoded = String(unassignedLead).split("").map((d) => `%3${d}`).join("");
    const n = unassignedLead;
    for (const path of [
      `/api/leads/${n}`,
      `/api/leads/${encoded}`,
      // Non-canonical forms a handler's Number()/parseInt() still reads as n.
      `/api/leads/%20${n}`,
      `/api/leads/${n}.0`,
      `/api/leads/00${n}`,
      `/api/leads/${n / 10}e1`,
      `/api/leads/0x${n.toString(16)}`,
      // Radix-less parseInt in routes-seller-intent reads this as n (hex).
      `/api/seller-intent/0x${n.toString(16)}zz`,
      `/api/leads/${unassignedLead}/activities`,
      `/api/leads/${unassignedLead}/timeline`,
      `/api/leads/${unassignedLead}/properties`,
    ]) {
      const r = await request(app).get(path).set(as(vaId, vaEmail));
      expect(r.status, path).toBe(404);
    }
  });

  it("a write to an unassigned lead is refused and changes nothing; a write to the VA's own lead succeeds", async () => {
    const refused = await request(app).put(`/api/leads/${unassignedLead}`).set(as(vaId, vaEmail)).send({ notes: "va edit" });
    expect(refused.status).toBe(404);
    const bulkRefused = await request(app)
      .post("/api/bulk/leads/update")
      .set(as(vaId, vaEmail))
      .send({ ids: [unassignedLead], updates: { status: "contacted" } });
    expect(bulkRefused.status).toBe(403);
    const [untouched] = await db.select().from(schema.leads).where(orm.eq(schema.leads.id, unassignedLead));
    expect(untouched.notes).toBeNull();

    const own = await request(app).put(`/api/leads/${assignedLead}`).set(as(vaId, vaEmail)).send({ notes: "va edit" });
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    const [edited] = await db.select().from(schema.leads).where(orm.eq(schema.leads.id, assignedLead));
    expect(edited.notes).toBe("va edit");
  });

  it("an owner's explicit override wins, and clearing it (null) restores the role default", async () => {
    const team = async () =>
      (await request(app).get("/api/team").set(as(ownerId))).body.find((m: { id: number }) => m.id === vaMemberId);
    const list = async () =>
      (await request(app).get("/api/leads?pageSize=100").set(as(vaId, vaEmail))).body.data.map((l: { id: number }) => l.id).sort((a: number, b: number) => a - b);
    // The roster shows the EFFECTIVE value, not the raw NULL override.
    expect(await team()).toMatchObject({ viewOnlyAssignedLeads: true, viewOnlyAssignedLeadsOverride: null });

    const off = await request(app).patch(`/api/team/${vaMemberId}/view-only-assigned-leads`).set(as(ownerId)).send({ viewOnlyAssignedLeads: false });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect((await request(app).get("/api/me/permissions").set(as(vaId, vaEmail))).body.permissions.viewOnlyAssignedLeads).toBe(false);
    expect(await list()).toEqual([assignedLead, unassignedLead, ownerLead].sort((a, b) => a - b));

    const reset = await request(app).patch(`/api/team/${vaMemberId}/view-only-assigned-leads`).set(as(ownerId)).send({ viewOnlyAssignedLeads: null });
    expect(reset.status, JSON.stringify(reset.body)).toBe(200);
    expect(await team()).toMatchObject({ viewOnlyAssignedLeads: true, viewOnlyAssignedLeadsOverride: null });
    expect(await list()).toEqual([assignedLead]);
  });
});
