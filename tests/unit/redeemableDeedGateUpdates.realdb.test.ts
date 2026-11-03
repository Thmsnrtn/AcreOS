/**
 * V-Tax-1 T4b audit B2 (2026-11-01) — the redeemable-deed gate covers UPDATES,
 * not only creates. Against a REAL database built from this repository, over
 * HTTP. SYNTHETIC data.
 *
 * The audit found four PATCH routes the create-only ratchet markers never
 * read: PATCH /api/rehabs/:id, /api/rehab-line-items/:id, /api/ad-postings/:id
 * and /api/dd-assignments/:id. Each is rehab spend, DD vendor spend or
 * marketing on a parcel, exactly like the create it follows.
 *
 * For each route: on a parcel a redeemable tax position still holds the update
 * is refused (422, redeemableDeedGate) and the row is left exactly as it was;
 * on a parcel no position holds the same update goes through. The ad posting
 * and DD assignment can be re-pointed at another parcel by the body, so moving
 * one ONTO a held parcel is refused too.
 */
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("redeemableDeedGateUpdates.realdb.test.ts");

const h = vi.hoisted(() => ({ org: { id: 0 }, user: { id: "t4b-b2-user", claims: { sub: "t4b-b2-user" } } }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/auth", () => ({ isAuthenticated: (req: any, _res: any, next: any) => { req.user = h.user; next(); } }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({ getOrCreateOrg: (req: any, _res: any, next: any) => { req.organization = h.org; req.organizationId = h.org.id; next(); } }));
vi.mock("../../server/middleware/roleGuard", () => ({ requireRole: () => (_req: any, _res: any, next: any) => next() }));

const tag = `t4bb2${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const county = `Synth${tag}`;
let orgId = 0;
let app: express.Express;
const ids: Record<string, any> = {};

describe.runIf(realDbAvailable)("the redeemable-deed gate refuses UPDATES on a held parcel — real database", () => {
  beforeAll(async () => {
    const { db } = await import("../../server/db");
    const { organizations, properties, taxCertificates, rehabs, rehabLineItems, adPostings, ddAssignments } = await import("@shared/schema");
    const [org] = await db.insert(organizations).values({ name: tag, slug: tag, ownerId: tag } as never).returning();
    orgId = org.id;
    h.org = { id: orgId };
    const prop = (apn: string) => ({ organizationId: orgId, apn, county, state: "OH", sizeAcres: "2", status: "owned" }) as never;
    const [held] = await db.insert(properties).values(prop(`${tag}-H`)).returning({ id: properties.id });
    const [free] = await db.insert(properties).values(prop(`${tag}-F`)).returning({ id: properties.id });
    // A redeemable position (deadline far ahead) linked to the held parcel.
    await db.insert(taxCertificates).values({
      organizationId: orgId, state: "OH", county, apn: `${tag}-H`, saleType: "redeemable_deed", saleDate: "2024-06-01",
      purchaseAmountCents: 100_000, redemptionDeadline: "2099-06-01", deadlineSource: "operator_entered", status: "active", propertyId: held.id,
    } as never);
    ids.held = held.id;
    ids.free = free.id;
    for (const [k, propertyId] of [["H", held.id], ["F", free.id]] as const) {
      const [r] = await db.insert(rehabs).values({ organizationId: orgId, propertyId, name: `SYNTHETIC rehab ${k}` } as never).returning({ id: rehabs.id });
      const [li] = await db.insert(rehabLineItems).values({ organizationId: orgId, rehabId: r.id, category: "demolition", scope: `SYNTHETIC scope ${k}` } as never).returning({ id: rehabLineItems.id });
      const [ad] = await db.insert(adPostings).values({ organizationId: orgId, propertyId, platform: "facebook", title: `SYNTHETIC ad ${k}`, description: "SYNTHETIC", listingPrice: "1000" } as never).returning({ id: adPostings.id });
      const [dd] = await db.insert(ddAssignments).values({ organizationId: orgId, propertyId, assigneeType: "vendor", taskType: "survey" } as never).returning({ id: ddAssignments.id });
      Object.assign(ids, { [`rehab${k}`]: r.id, [`line${k}`]: li.id, [`ad${k}`]: ad.id, [`dd${k}`]: dd.id });
    }

    const { registerRehabRoutes } = await import("../../server/routes-rehabs");
    const { registerVAEngineRoutes } = await import("../../server/routes-va-engine");
    app = express();
    app.use(express.json());
    registerRehabRoutes(app);
    await registerVAEngineRoutes(app);
  });

  afterAll(async () => {
    const { db, pool } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    // One statement per table, children first, so each names its own table.
    await db.execute(sql`DELETE FROM dd_assignments WHERE organization_id = ${orgId}`).catch(() => undefined);
    await db.execute(sql`DELETE FROM ad_postings WHERE organization_id = ${orgId}`).catch(() => undefined);
    await db.execute(sql`DELETE FROM rehab_line_items WHERE organization_id = ${orgId}`).catch(() => undefined);
    await db.execute(sql`DELETE FROM rehabs WHERE organization_id = ${orgId}`).catch(() => undefined);
    await db.execute(sql`DELETE FROM tax_certificates WHERE organization_id = ${orgId}`).catch(() => undefined);
    await db.execute(sql`DELETE FROM activity_events WHERE organization_id = ${orgId}`).catch(() => undefined);
    await db.execute(sql`DELETE FROM properties WHERE organization_id = ${orgId}`).catch(() => undefined);
    await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`).catch(() => undefined);
    await pool.end();
  });

  const one = async (q: string) => {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    return (await db.execute(sql.raw(q))).rows[0] as any;
  };
  const refused = (r: request.Response) => {
    expect(r.status, r.text).toBe(422);
    expect(r.body.details).toMatchObject({ redeemableDeedGate: true });
    expect(r.body.message).toMatch(/waits until this parcel is marketable in AcreOS.*still redeemable until 2099-06-01/);
  };

  it("PATCH /api/rehabs/:id: refused on a held parcel, row untouched; allowed on a free one", async () => {
    refused(await request(app).patch(`/api/rehabs/${ids.rehabH}`).send({ name: "SYNTHETIC renamed" }));
    expect((await one(`SELECT name FROM rehabs WHERE id = '${ids.rehabH}'`)).name).toBe("SYNTHETIC rehab H");
    const ok = await request(app).patch(`/api/rehabs/${ids.rehabF}`).send({ name: "SYNTHETIC renamed" });
    expect(ok.status, ok.text).toBe(200);
    expect((await one(`SELECT name FROM rehabs WHERE id = '${ids.rehabF}'`)).name).toBe("SYNTHETIC renamed");
  });

  it("PATCH /api/rehab-line-items/:id: refused on a held parcel's rehab, row untouched; allowed on a free one", async () => {
    refused(await request(app).patch(`/api/rehab-line-items/${ids.lineH}`).send({ scope: "SYNTHETIC rescoped" }));
    expect((await one(`SELECT scope FROM rehab_line_items WHERE id = '${ids.lineH}'`)).scope).toBe("SYNTHETIC scope H");
    const ok = await request(app).patch(`/api/rehab-line-items/${ids.lineF}`).send({ scope: "SYNTHETIC rescoped" });
    expect(ok.status, ok.text).toBe(200);
    expect((await one(`SELECT scope FROM rehab_line_items WHERE id = '${ids.lineF}'`)).scope).toBe("SYNTHETIC rescoped");
  });

  it("PATCH /api/ad-postings/:id: refused on a held parcel and when re-pointed onto one; allowed on a free one", async () => {
    refused(await request(app).patch(`/api/ad-postings/${ids.adH}`).send({ title: "SYNTHETIC retitled" }));
    expect((await one(`SELECT title FROM ad_postings WHERE id = ${Number(ids.adH)}`)).title).toBe("SYNTHETIC ad H");
    refused(await request(app).patch(`/api/ad-postings/${ids.adF}`).send({ propertyId: ids.held }));
    expect((await one(`SELECT property_id FROM ad_postings WHERE id = ${Number(ids.adF)}`)).property_id).toBe(ids.free);
    const ok = await request(app).patch(`/api/ad-postings/${ids.adF}`).send({ title: "SYNTHETIC retitled" });
    expect(ok.status, ok.text).toBe(200);
    expect((await one(`SELECT title FROM ad_postings WHERE id = ${Number(ids.adF)}`)).title).toBe("SYNTHETIC retitled");
  });

  it("PATCH /api/dd-assignments/:id: refused on a held parcel and when re-pointed onto one; allowed on a free one", async () => {
    refused(await request(app).patch(`/api/dd-assignments/${ids.ddH}`).send({ vendorName: "SYNTHETIC Surveyor" }));
    expect((await one(`SELECT vendor_name FROM dd_assignments WHERE id = ${Number(ids.ddH)}`)).vendor_name).toBeNull();
    refused(await request(app).patch(`/api/dd-assignments/${ids.ddF}`).send({ propertyId: ids.held }));
    expect((await one(`SELECT property_id FROM dd_assignments WHERE id = ${Number(ids.ddF)}`)).property_id).toBe(ids.free);
    const ok = await request(app).patch(`/api/dd-assignments/${ids.ddF}`).send({ vendorName: "SYNTHETIC Surveyor" });
    expect(ok.status, ok.text).toBe(200);
    expect((await one(`SELECT vendor_name FROM dd_assignments WHERE id = ${Number(ids.ddF)}`)).vendor_name).toBe("SYNTHETIC Surveyor");
  });
});
