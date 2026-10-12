/**
 * Lead → deal, against a real database (POST /api/leads/:id/convert-to-deal).
 *
 * Through the real route, the real middleware chain (getOrCreateOrg and the
 * gates it chains) and the real transaction; only authentication is a header.
 * What it pins:
 *   - happy path: the lead's APN/county/state/acreage become ONE property
 *     (seller = the lead) and ONE acquisition deal at the opening stage, with
 *     both audit entries written inside the transaction;
 *   - idempotent: a retry, two concurrent clicks, and a second lead naming
 *     the same parcel in another spelling all land on the same property and
 *     deal; an existing property for the parcel is reused, not duplicated;
 *   - honest refusal: a lead missing APN / county / state / acreage is a 400
 *     naming what to add, and nothing is written;
 *   - tenancy: another org's lead id is a 404 and nothing is written anywhere;
 *   - VA scope: an unassigned lead is refused (the by-id gate answers 404 in
 *     the production chain, and the handler's own rule answers 403 if the gate
 *     is bypassed); a role that may not create deals is a 403; a VA converts
 *     their own lead.
 *
 * Audit writes are stubbed (audit_log is append-only; a fixture row would be
 * stranded) but asserted to receive the transaction's executor. Workflow and
 * lifecycle announcements are stubbed and asserted to fire once per creation.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("leadToDeal.db");

const gateControl = vi.hoisted(() => ({ bypass: false, bypassViewer: false }));

vi.mock("../../server/auth", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../server/auth")>();
  return {
    ...real,
    isAuthenticated: (req: any, res: any, next: any) => {
      const id = req.header("x-test-user");
      if (!id) return res.status(401).json({ error: "unauthorized" });
      req.user = { id, email: null };
      next();
    },
  };
});
vi.mock("../../server/middleware/assignedLeadScopeGate", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../server/middleware/assignedLeadScopeGate")>();
  return {
    ...real,
    assignedLeadScopeGate: (req: any, res: any, next: any) =>
      gateControl.bypass ? next() : real.assignedLeadScopeGate(req, res, next),
  };
});
vi.mock("../../server/middleware/viewerReadOnlyGate", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../server/middleware/viewerReadOnlyGate")>();
  return {
    ...real,
    viewerReadOnlyGate: (req: any, res: any, next: any) =>
      gateControl.bypassViewer ? next() : real.viewerReadOnlyGate(req, res, next),
  };
});
vi.mock("../../server/services/loginAnomalyDetector", () => ({ recordAndAlertIfNew: async () => undefined }));
vi.mock("../../server/services/emailChangeDetector", () => ({ detectAndAlertEmailChange: async () => undefined }));
const announce = vi.hoisted(() => ({ dealCreated: 0, dealLifecycle: 0, propertyCreated: 0 }));
vi.mock("../../server/services/dealEvents", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../server/services/dealEvents")>();
  return { ...real, emitDealCreated: () => void announce.dealCreated++ };
});
vi.mock("../../server/services/dealLifecycleEvents", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../server/services/dealLifecycleEvents")>();
  return { ...real, publishDealLifecycle: () => void announce.dealLifecycle++ };
});
vi.mock("../../server/services/propertyEvents", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../server/services/propertyEvents")>();
  return { ...real, emitPropertyCreated: () => void announce.propertyCreated++ };
});

describe.runIf(realDbAvailable)("lead → deal conversion", () => {
  const tag = `l2d-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ownerId = `${tag}-owner`;
  const vaId = `${tag}-va`;
  const viewerId = `${tag}-viewer`;
  const otherOwnerId = `${tag}-other`;

  let app: import("express").Express;
  let db: typeof import("../../server/db").db;
  let schema: typeof import("../../shared/schema");
  let orm: typeof import("drizzle-orm");
  let auditSpy: ReturnType<typeof vi.fn>;

  const orgIds: number[] = [];
  let orgId = 0;
  let otherOrgId = 0;
  let vaMemberId = 0;
  let viewerMemberId = 0;

  const as = (user: string) => ({ "x-test-user": user });
  const convert = (leadId: number, user = ownerId) =>
    request(app).post(`/api/leads/${leadId}/convert-to-deal`).set(as(user)).send({});

  async function lead(values: Record<string, unknown>, org = orgId): Promise<number> {
    const [row] = await db
      .insert(schema.leads)
      .values({ organizationId: org, firstName: "Seller", lastName: tag, type: "seller", ...values } as never)
      .returning();
    return row.id;
  }
  async function counts(org = orgId) {
    const p = await db.select().from(schema.properties).where(orm.eq(schema.properties.organizationId, org));
    const d = await db.select().from(schema.deals).where(orm.eq(schema.deals.organizationId, org));
    return { properties: p.length, deals: d.length };
  }
  const parcel = (apn: string) => ({ apn, county: "Travis County", state: "tx", acreage: "5.5" });

  beforeAll(async () => {
    const express = (await import("express")).default;
    ({ db } = await import("../../server/db"));
    schema = await import("../../shared/schema");
    orm = await import("drizzle-orm");
    const { storage } = await import("../../server/storage");
    auditSpy = vi.spyOn(storage, "createAuditLogEntry").mockResolvedValue({} as never) as never;

    const { registerLeadRoutes } = await import("../../server/routes-leads");
    app = express();
    app.use(express.json());
    registerLeadRoutes(app);

    const [org] = await db.insert(schema.organizations).values({ name: `${tag}-org`, slug: `${tag}-org`, ownerId, subscriptionTier: "starter", subscriptionStatus: "active" } as never).returning();
    orgId = org.id;
    orgIds.push(org.id);
    const members = await db
      .insert(schema.teamMembers)
      .values([
        { organizationId: orgId, userId: ownerId, role: "owner", isActive: true },
        { organizationId: orgId, userId: vaId, role: "va", isActive: true },
        { organizationId: orgId, userId: viewerId, role: "viewer", isActive: true },
      ] as never)
      .returning();
    vaMemberId = members[1].id;
    viewerMemberId = members[2].id;

    const [other] = await db.insert(schema.organizations).values({ name: `${tag}-other`, slug: `${tag}-other`, ownerId: otherOwnerId } as never).returning();
    otherOrgId = other.id;
    orgIds.push(other.id);
    await db.insert(schema.teamMembers).values({ organizationId: otherOrgId, userId: otherOwnerId, role: "owner", isActive: true } as never);
  });

  beforeEach(() => {
    gateControl.bypass = false;
    gateControl.bypassViewer = false;
    auditSpy.mockClear();
    announce.dealCreated = 0;
    announce.dealLifecycle = 0;
    announce.propertyCreated = 0;
  });

  afterAll(async () => {
    if (orgIds.length === 0) return;
    // deals → properties is ON DELETE RESTRICT, so clear deals before the org cascade.
    await db.delete(schema.deals).where(orm.inArray(schema.deals.organizationId, orgIds));
    await db.delete(schema.properties).where(orm.inArray(schema.properties.organizationId, orgIds));
    await db.delete(schema.organizations).where(orm.inArray(schema.organizations.id, orgIds));
  });

  it("creates ONE property from the lead's parcel and ONE opening-stage deal, audited inside the transaction", async () => {
    const leadId = await lead(parcel("100-200-300"));
    const before = await counts();
    const r = await convert(leadId);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ createdDeal: true, createdProperty: true });

    const [prop] = await db.select().from(schema.properties).where(orm.eq(schema.properties.id, r.body.property.id));
    expect(prop).toMatchObject({ organizationId: orgId, apn: "100-200-300", county: "Travis County", state: "TX", sellerId: leadId });
    expect(Number(prop.sizeAcres)).toBe(5.5);
    const [deal] = await db.select().from(schema.deals).where(orm.eq(schema.deals.id, r.body.deal.id));
    expect(deal).toMatchObject({ organizationId: orgId, propertyId: prop.id, type: "acquisition", status: "negotiating" });
    expect(await counts()).toEqual({ properties: before.properties + 1, deals: before.deals + 1 });

    // Both audit entries, each handed the transaction's executor (not the pool).
    expect(auditSpy).toHaveBeenCalledTimes(2);
    for (const call of auditSpy.mock.calls) expect(call[1], "audit write must join the transaction").toBeDefined();
    expect(auditSpy.mock.calls.map((c) => (c[0] as { entityType: string }).entityType).sort()).toEqual(["deal", "property"]);
    expect(announce).toEqual({ dealCreated: 1, dealLifecycle: 1, propertyCreated: 1 });

    const state = await request(app).get(`/api/leads/${leadId}/deal-state`).set(as(ownerId));
    expect(state.body).toMatchObject({ ready: true, existingDealId: deal.id });
  });

  it("is idempotent: a retry, two concurrent clicks, and another spelling of the parcel all land on the same rows", async () => {
    const leadId = await lead(parcel("400-500-600"));
    const [a, b] = await Promise.all([convert(leadId), convert(leadId)]);
    expect([a.status, b.status], JSON.stringify([a.body, b.body])).toEqual([200, 200]);
    expect([a.body.createdDeal, b.body.createdDeal].sort(), "exactly one of two racing clicks creates").toEqual([false, true]);
    expect(a.body.deal.id).toBe(b.body.deal.id);
    const before = await counts();

    const retry = await convert(leadId);
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ createdDeal: false, createdProperty: false });
    expect(retry.body.deal.id).toBe(a.body.deal.id);

    // A second lead naming the same parcel: county without "County", state upper, padded APN.
    const twin = await lead({ apn: " 400-500-600 ", county: "travis", state: "TX", acreage: "5.5" });
    const t = await convert(twin);
    expect(t.status).toBe(200);
    expect(t.body.deal.id).toBe(a.body.deal.id);
    expect(t.body.property.id).toBe(a.body.property.id);
    expect(await counts()).toEqual(before);
    expect(announce.dealCreated, "one announcement for one creation").toBe(1);
  });

  it("reuses an existing property for the parcel instead of creating a second one", async () => {
    const [existing] = await db
      .insert(schema.properties)
      .values({ organizationId: orgId, apn: "700-800-900", county: "Travis", state: "TX", sizeAcres: "5.5" } as never)
      .returning();
    const leadId = await lead(parcel("700-800-900"));
    const before = await counts();
    const r = await convert(leadId);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ createdDeal: true, createdProperty: false });
    expect(r.body.property.id).toBe(existing.id);
    expect(r.body.property.sellerId).toBe(leadId);
    expect(await counts()).toEqual({ properties: before.properties, deals: before.deals + 1 });
  });

  it("refuses a lead without APN, county, state or acreage — naming what to add — and writes nothing", async () => {
    const cases: Array<[Record<string, unknown>, string[]]> = [
      [{ county: "Travis", state: "TX", acreage: "5" }, ["apn"]],
      [{ apn: "1-2-3", state: "TX", acreage: "5" }, ["county"]],
      [{ apn: "1-2-3", county: "Travis", acreage: "5" }, ["state"]],
      [{ apn: "1-2-3", county: "Travis", state: "TX" }, ["acreage"]],
      [{}, ["apn", "county", "state", "acreage"]],
    ];
    for (const [values, missing] of cases) {
      const leadId = await lead(values);
      const before = await counts();
      const r = await convert(leadId);
      expect(r.status, JSON.stringify(values)).toBe(400);
      expect([...r.body.details.missing].sort()).toEqual([...missing].sort());
      expect(r.body.message).toMatch(/^Add .* to this lead before making it a deal\. Nothing was created\.$/);
      expect(await counts()).toEqual(before);
      const state = await request(app).get(`/api/leads/${leadId}/deal-state`).set(as(ownerId));
      expect(state.body).toMatchObject({ ready: false, reason: "missing", existingDealId: null });
    }
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it("a new property past the plan's property limit is refused and nothing is written", async () => {
    const leadId = await lead(parcel("555-000-001"));
    const before = await counts();
    await db.update(schema.organizations).set({ subscriptionTier: "free" } as never).where(orm.eq(schema.organizations.id, orgId));
    try {
      expect(before.properties, "fixture must already be at the free limit").toBeGreaterThanOrEqual(3);
      const r = await convert(leadId);
      expect(r.status, JSON.stringify(r.body)).toBe(429);
      expect(await counts()).toEqual(before);
    } finally {
      await db.update(schema.organizations).set({ subscriptionTier: "starter" } as never).where(orm.eq(schema.organizations.id, orgId));
    }
  });

  it("another org's lead id is a 404 and nothing is written in either org", async () => {
    const foreign = await lead(parcel("111-222-333"), otherOrgId);
    const mine = await counts();
    const theirs = await counts(otherOrgId);
    const r = await convert(foreign);
    expect(r.status).toBe(404);
    expect((await request(app).get(`/api/leads/${foreign}/deal-state`).set(as(ownerId))).status).toBe(404);
    expect(await counts()).toEqual(mine);
    expect(await counts(otherOrgId)).toEqual(theirs);

    // The same parcel held as a property by ANOTHER org is never reused.
    const [foreignProp] = await db
      .insert(schema.properties)
      .values({ organizationId: otherOrgId, apn: "123-456-789", county: "Travis", state: "TX", sizeAcres: "5.5" } as never)
      .returning();
    const local = await lead(parcel("123-456-789"));
    const ok = await convert(local);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.createdProperty).toBe(true);
    expect(ok.body.property.id).not.toBe(foreignProp.id);
    expect(ok.body.property.organizationId).toBe(orgId);
    const [stillForeign] = await db.select().from(schema.properties).where(orm.eq(schema.properties.id, foreignProp.id));
    expect(stillForeign.sellerId, "another org's property is never linked to this org's lead").toBeNull();
  });

  it("a VA converts only leads assigned to them; a role that may not create deals is refused", async () => {
    const unassigned = await lead(parcel("900-000-001"));
    const before = await counts();
    const refused = await convert(unassigned, vaId);
    expect(refused.status, "production chain: the by-id gate hides the lead").toBe(404);

    // The handler holds the rule itself, independent of the read gate.
    gateControl.bypass = true;
    const refusedInHandler = await convert(unassigned, vaId);
    expect(refusedInHandler.status, JSON.stringify(refusedInHandler.body)).toBe(403);
    gateControl.bypass = false;
    expect(await counts()).toEqual(before);

    const viewerLead = await lead({ ...parcel("900-000-002"), assignedTo: viewerMemberId });
    const viewer = await convert(viewerLead, viewerId);
    expect(viewer.status).toBe(403);
    // The route's own canCreateDeals check, independent of the viewer read-only
    // gate — on a parcel that is already a property, so no property write (and
    // no canCreateProperties refusal) stands in for it.
    await db.insert(schema.properties).values({ organizationId: orgId, apn: "900-000-002", county: "Travis", state: "TX", sizeAcres: "5.5" } as never);
    const withProperty = await counts();
    gateControl.bypassViewer = true;
    const viewerInHandler = await convert(viewerLead, viewerId);
    gateControl.bypassViewer = false;
    expect(viewerInHandler.status, JSON.stringify(viewerInHandler.body)).toBe(403);
    expect(await counts()).toEqual(withProperty);

    const own = await lead({ ...parcel("900-000-003"), assignedTo: vaMemberId });
    const ok = await convert(own, vaId);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.property.sellerId).toBe(own);
  });
});
