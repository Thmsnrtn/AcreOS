/**
 * V-Tax-1 T4b — the tax → Land exit and the redeemable-deed gate against a
 * REAL database built from this repository, over HTTP. SYNTHETIC data.
 *
 *   - the move is refused while the position is redeemable; with the deed
 *     held it asks for acreage the list never stated, then creates the
 *     property as owned with the price paid, records the move on the
 *     property's activity, and links the certificate; a second move is a no-op;
 *   - a deed for a parcel already in Land links that property (it becomes
 *     owned) instead of creating a second one;
 *   - spend (a subdivision plan) and marketing (a buyer blast) on a held
 *     parcel are refused with what clears them; an attorney-reviewed
 *     exception on the quiet-title case clears the gate and the plan is made;
 *   - the property carries its tax history and what the position has cost;
 *   - another organization can neither move a certificate nor read the history.
 */
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("taxLandExit.realdb.test.ts");

const h = vi.hoisted(() => ({ org: { id: 0 }, user: { id: "t4b-user", claims: { sub: "t4b-user" } } }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/auth", () => ({ isAuthenticated: (req: any, _res: any, next: any) => { req.user = h.user; next(); } }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({ getOrCreateOrg: (req: any, _res: any, next: any) => { req.organization = h.org; req.organizationId = h.org.id; next(); } }));
vi.mock("../../server/middleware/roleGuard", () => ({ requireRole: () => (_req: any, _res: any, next: any) => next() }));

const tag = `t4b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const county = `Synth${tag}`;
const orgIds: number[] = [];
let app: express.Express;
const ids: Record<string, any> = {};

describe.runIf(realDbAvailable)("tax → Land exit and the redeemable-deed gate — real database", () => {
  beforeAll(async () => {
    const { db } = await import("../../server/db");
    const { organizations, properties, taxCertificates } = await import("@shared/schema");
    for (const s of ["a", "b"]) {
      const [org] = await db.insert(organizations).values({ name: `${tag}-${s}`, slug: `${tag}-${s}`, ownerId: `${tag}-${s}` } as never).returning();
      orgIds.push(org.id);
    }
    h.org = { id: orgIds[0] };
    const cert = (apn: string, status: string, deadline: string) =>
      ({ organizationId: orgIds[0], state: "OH", county, apn, saleType: "redeemable_deed", saleDate: "2024-06-01", purchaseAmountCents: 481_250, redemptionDeadline: deadline, deadlineSource: "operator_entered", status }) as never;
    const [redeemable] = await db.insert(taxCertificates).values(cert(`${tag}-R`, "active", "2099-06-01")).returning({ id: taxCertificates.id });
    const [unlinked] = await db.insert(taxCertificates).values(cert(`${tag}-U`, "active", "2099-06-01")).returning({ id: taxCertificates.id });
    const [deed] = await db.insert(taxCertificates).values(cert(`${tag}-D`, "deed_obtained", "2025-06-01")).returning({ id: taxCertificates.id });
    const [deedExisting] = await db.insert(taxCertificates).values(cert(`${tag}-E`, "deed_obtained", "2025-06-01")).returning({ id: taxCertificates.id });
    const [existing] = await db.insert(properties).values({ organizationId: orgIds[0], apn: `${tag}-E`, county, state: "OH", sizeAcres: "4.5", status: "prospect" } as never).returning({ id: properties.id });
    const [heldByRedeemable] = await db.insert(properties).values({ organizationId: orgIds[0], apn: `${tag}-R`, county, state: "OH", sizeAcres: "2", status: "owned" } as never).returning({ id: properties.id });
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`UPDATE tax_certificates SET property_id = ${heldByRedeemable.id} WHERE id = ${redeemable.id}`);
    Object.assign(ids, { unlinked: unlinked.id, redeemable: redeemable.id, deed: deed.id, deedExisting: deedExisting.id, existing: existing.id, heldByRedeemable: heldByRedeemable.id });

    const { registerTaxCertificateRoutes } = await import("../../server/routes-tax-certificates");
    const { registerSubdivisionPlanRoutes } = await import("../../server/routes-subdivision-plans");
    const { registerBuyerBlastRoutes } = await import("../../server/routes-buyer-blasts");
    const { registerQuietTitleRoutes } = await import("../../server/routes-quiet-title");
    app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => { req.user = h.user; req.organization = h.org; req.organizationId = h.org.id; next(); });
    registerTaxCertificateRoutes(app);
    registerSubdivisionPlanRoutes(app);
    registerBuyerBlastRoutes(app);
    registerQuietTitleRoutes(app);
  });

  afterAll(async () => {
    const { db, pool } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    for (const id of orgIds) {
      await db.execute(sql`DELETE FROM activity_events WHERE organization_id = ${id}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM subdivision_plans WHERE organization_id = ${id}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM quiet_title_cases WHERE organization_id = ${id}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM tax_certificates WHERE organization_id = ${id}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM properties WHERE organization_id = ${id}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM organizations WHERE id = ${id}`).catch(() => undefined);
    }
    await pool.end();
  });

  const move = (certId: string, body: object = {}) => request(app).post(`/api/tax-certificates/${certId}/move-to-land`).send(body);
  const q1 = async (text: ReturnType<typeof import("drizzle-orm").sql>) => {
    const { db } = await import("../../server/db");
    return (await db.execute(text)).rows[0] as any;
  };

  it("a redeemable position does not move: the land is not yours yet", async () => {
    const r = await move(ids.unlinked);
    expect(r.status).toBe(422);
    expect(r.body.message).toMatch(/still redeemable until 2099-06-01/);
  });

  it("with the deed held it asks for acreage, then creates the property as owned, logs the move and links the certificate", async () => {
    const first = await move(ids.deed);
    expect(first.status).toBe(422);
    expect(first.body.details).toMatchObject({ needsAcreage: true });
    const r = await move(ids.deed, { sizeAcres: { value: "10.25", source: "SYNTHETIC recorded plat" } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "linked", created: true, alreadyLinked: false });
    ids.created = r.body.propertyId;
    const { sql } = await import("drizzle-orm");
    expect(await q1(sql`SELECT status, size_acres::text AS acres, purchase_price::text AS price FROM properties WHERE id = ${ids.created}`)).toEqual({ status: "owned", acres: "10.25", price: "4812.50" });
    expect((await q1(sql`SELECT property_id FROM tax_certificates WHERE id = ${ids.deed}`)).property_id).toBe(ids.created);
    expect(await q1(sql`SELECT event_type, metadata->>'acreageSource' AS src FROM activity_events WHERE entity_type = 'property' AND entity_id = ${ids.created}`)).toEqual({ event_type: "tax_position_moved_to_land", src: "SYNTHETIC recorded plat" });
    expect((await move(ids.deed)).body).toMatchObject({ status: "linked", propertyId: ids.created, alreadyLinked: true });
  });

  it("a deed for a parcel already in Land links that property instead of creating another", async () => {
    const r = await move(ids.deedExisting);
    expect(r.body).toMatchObject({ status: "linked", propertyId: ids.existing, created: false });
    const { sql } = await import("drizzle-orm");
    expect((await q1(sql`SELECT status FROM properties WHERE id = ${ids.existing}`)).status).toBe("owned");
    expect((await q1(sql`SELECT count(*)::int AS n FROM properties WHERE organization_id = ${orgIds[0]} AND apn = ${`${tag}-E`}`)).n).toBe(1);
  });

  it("spend and marketing on a held parcel are refused with what clears them", async () => {
    let r = await request(app).post(`/api/parcels/${ids.heldByRedeemable}/plans`).send({ name: "SYNTHETIC plat" });
    expect(r.status).toBe(422);
    expect(r.body.details).toMatchObject({ redeemableDeedGate: true, held: [{ certificateId: ids.redeemable, phase: "redeemable" }] });
    expect(r.body.message).toMatch(/A subdivision plan waits until this parcel is marketable in AcreOS.*still redeemable until 2099-06-01/);
    r = await request(app).post(`/api/parcels/${ids.created}/plans`).send({ name: "SYNTHETIC plat" });
    expect(r.status).toBe(422);
    expect(r.body.message).toMatch(/quiet-title petition is not yet filed/);
    r = await request(app).post(`/api/properties/${ids.created}/blast-buyers`).send({ subject: "SYNTHETIC", body: "SYNTHETIC", dryRun: true });
    expect(r.status).toBe(422);
    expect(r.body.details).toMatchObject({ redeemableDeedGate: true });
    const { sql } = await import("drizzle-orm");
    expect((await q1(sql`SELECT count(*)::int AS n FROM subdivision_plans WHERE organization_id = ${orgIds[0]}`)).n).toBe(0);
  });

  it("an attorney-reviewed exception on the quiet-title case clears the gate", async () => {
    const c = await request(app).post("/api/quiet-title/cases").send({ certificateId: ids.deed, deedRecordationDate: "2025-07-01" });
    expect([200, 201]).toContain(c.status);
    const caseId = c.body.case?.id ?? c.body.id;
    expect((await request(app).post(`/api/quiet-title/cases/${caseId}/market-exception`).send({ attorneyName: "SYNTHETIC Counsel", reason: "SYNTHETIC: the redemption period ran and notice was served" })).status).toBe(200);
    const r = await request(app).post(`/api/parcels/${ids.created}/plans`).send({ name: "SYNTHETIC plat" });
    expect(r.status).toBe(201);
  });

  it("the property carries its tax history and what the position cost", async () => {
    expect((await request(app).post(`/api/tax-certificates/${ids.deed}/ledger`).send({ kind: "subsequent_tax_paid", paidOn: "2025-02-01", amountCents: 51_000, taxYear: "2024", source: "SYNTHETIC receipt" })).status).toBe(200);
    const r = await request(app).get(`/api/properties/${ids.created}/tax-history`);
    expect(r.status).toBe(200);
    expect(r.body.history.positions).toHaveLength(1);
    expect(r.body.history.positions[0]).toMatchObject({ certificateId: ids.deed, clock: { phase: "deed_held", marketable: { eligible: true } } });
    expect(r.body.history.positions[0].events.map((e: any) => e.eventType)).toContain("subsequent_tax_paid");
    expect(r.body.history.moneyIn).toMatchObject({ purchaseCents: 481_250, subsequentTaxesCents: 51_000, totalCents: 532_250 });
    expect((await request(app).get(`/api/properties/${ids.existing}/tax-history`)).body.history.positions).toHaveLength(1);
  });

  it("another organization can neither move a certificate nor read the history", async () => {
    h.org = { id: orgIds[1] };
    try {
      expect((await move(ids.deedExisting)).status).toBe(404);
      expect((await request(app).get(`/api/properties/${ids.created}/tax-history`)).status).toBe(404);
    } finally {
      h.org = { id: orgIds[0] };
    }
  });
});
