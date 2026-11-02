/**
 * V-Tax-1 T3b — the sale calendar, the registration gate and the position
 * record against a REAL database built from this repository, over HTTP.
 * SYNTHETIC data.
 *
 *   - a time of day without the county's zone is refused; an unknown zone is
 *     refused; a stated zone yields the county's instant;
 *   - a bid on a lot in a sale is refused until registration is complete, with
 *     the open items named; resolving them opens bidding; a lot outside any
 *     sale is not gated; "registered" cannot be stated not-required;
 *   - the ledger records a subsequent tax, a notice the operator sent and the
 *     foreclosure-filing deadline (latest wins); a future payment is refused;
 *     the database refuses an event type it does not know;
 *   - another organization can neither read nor write any of it.
 */
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("taxCalendarLedger.realdb.test.ts");

const h = vi.hoisted(() => ({ org: { id: 0 }, user: { id: "t3b-user", claims: { sub: "t3b-user" } } }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/auth", () => ({ isAuthenticated: (req: any, _res: any, next: any) => { req.user = h.user; next(); } }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({ getOrCreateOrg: (req: any, _res: any, next: any) => { req.organization = h.org; req.organizationId = h.org.id; next(); } }));
vi.mock("../../server/middleware/roleGuard", () => ({ requireRole: () => (_req: any, _res: any, next: any) => next() }));

const tag = `t3b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const county = `Synth${tag}`;
const orgIds: number[] = [];
let app: express.Express;
let auctionId = 0;
let lotInSale = 0;
let lotOutside = 0;
let certId = "";
let otherCertId = "";
const today = new Date().toISOString().slice(0, 10);
const f = (value: unknown) => ({ value, source: "SYNTHETIC Code §1", asOf: today, basis: "state_law", verification: "checked_against_statute" });

describe.runIf(realDbAvailable)("sale calendar, registration gate and position record — real database", () => {
  beforeAll(async () => {
    const { db } = await import("../../server/db");
    const { organizations, taxSaleAuctions, taxSaleListings, taxCertificates } = await import("@shared/schema");
    for (const s of ["a", "b"]) {
      const [org] = await db.insert(organizations).values({ name: `${tag}-${s}`, slug: `${tag}-${s}`, ownerId: `${tag}-${s}` } as never).returning();
      orgIds.push(org.id);
    }
    h.org = { id: orgIds[0] };
    const [a] = await db.insert(taxSaleAuctions).values({ organizationId: orgIds[0], county, state: "GA", auctionType: "deed", auctionDate: new Date("2026-12-01T00:00:00Z"), auctionFormat: "in_person", scrapeStatus: "manual_entry" }).returning({ id: taxSaleAuctions.id });
    auctionId = a.id;
    const [l1] = await db.insert(taxSaleListings).values({ organizationId: orgIds[0], auctionId, apn: `${tag}-1`, county, state: "GA", saleType: "tax_deed" }).returning({ id: taxSaleListings.id });
    const [l2] = await db.insert(taxSaleListings).values({ organizationId: orgIds[0], apn: `${tag}-2`, county, state: "GA", saleType: "tax_deed" }).returning({ id: taxSaleListings.id });
    lotInSale = l1.id;
    lotOutside = l2.id;
    const cert = (org: number, apn: string) => ({ organizationId: org, state: "OH", county, apn, saleType: "tax_lien_certificate", saleDate: "2026-06-01", purchaseAmountCents: 481_250, redemptionDeadline: "2027-06-01", deadlineSource: "operator_entered", status: "active" }) as never;
    const [c1] = await db.insert(taxCertificates).values(cert(orgIds[0], `${tag}-c1`)).returning({ id: taxCertificates.id });
    const [c2] = await db.insert(taxCertificates).values(cert(orgIds[1], `${tag}-c2`)).returning({ id: taxCertificates.id });
    certId = c1.id;
    otherCertId = c2.id;

    const { registerTaxProcedureRoutes } = await import("../../server/routes-tax-procedures");
    const { registerTaxCertificateRoutes } = await import("../../server/routes-tax-certificates");
    const taxResearcherRouter = (await import("../../server/routes-tax-researcher")).default;
    app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => { req.user = h.user; req.organization = h.org; req.organizationId = h.org.id; next(); });
    registerTaxProcedureRoutes(app);
    registerTaxCertificateRoutes(app);
    app.use("/api/tax-researcher", taxResearcherRouter);
    // A biddable county, so the T2a lock is not what is measured here.
    expect((await request(app).post(`/api/tax-procedures/GA/${county}`).send({ fields: { instrument: f("deed"), bidMethod: f("premium bid"), returnModel: f({ kind: "none" }), redemptionPeriodMonths: f(0) } })).status).toBe(200);
    expect((await request(app).post(`/api/tax-procedures/GA/${county}/verification`).send({ completedOn: today, method: "called the SYNTHETIC county" })).status).toBe(200);
  });

  afterAll(async () => {
    const { db, pool } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    for (const id of orgIds) {
      await db.execute(sql`DELETE FROM auction_bid_log WHERE organization_id = ${id}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM tax_sale_listings WHERE organization_id = ${id}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM tax_sale_auctions WHERE organization_id = ${id}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM tax_certificates WHERE organization_id = ${id}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM tax_procedure_objects WHERE organization_id = ${id}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM organizations WHERE id = ${id}`).catch(() => undefined);
    }
    await pool.end();
  });

  const cal = (body: object) => request(app).put(`/api/tax-researcher/auctions/${auctionId}/calendar`).send(body);
  const reg = (item: string, body: object) => request(app).put(`/api/tax-researcher/auctions/${auctionId}/registration/${item}`).send(body);
  const bid = (listingId: number) => request(app).post(`/api/tax-researcher/listings/${listingId}/bid-log`).send({ action: "bid", amountCents: 10_000 });

  it("a time without the county's zone is refused; an unknown zone is refused; a stated zone gives the county's instant", async () => {
    expect((await cal({ timeZone: null, startTimeLocal: "10:00", registrationDeadline: null, funds: null })).body.details).toMatchObject({ timeZoneRequired: true });
    expect((await cal({ timeZone: { value: "Mars/Olympus", source: "SYNTHETIC", asOf: today }, startTimeLocal: "10:00", registrationDeadline: null, funds: null })).status).toBe(422);
    const ok = await cal({
      timeZone: { value: "America/New_York", source: "SYNTHETIC county sale notice", asOf: today },
      startTimeLocal: "10:00",
      registrationDeadline: { date: "2026-11-20", timeLocal: "16:30", source: "SYNTHETIC bidder packet" },
      funds: { depositCents: 50_000, form: "certified funds", source: "SYNTHETIC bidder packet" },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.calendar.start).toMatchObject({ status: "timed", zone: "America/New_York", instant: "2026-12-01T15:00:00.000Z" });
    expect(ok.body.calendar.registration).toMatchObject({ status: "timed", instant: "2026-11-20T21:30:00.000Z", source: "SYNTHETIC bidder packet" });
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const row = (await db.execute(sql`SELECT to_char(registration_deadline, 'YYYY-MM-DD') AS d FROM tax_sale_auctions WHERE id = ${auctionId}`)).rows[0] as any;
    expect(row.d).toBe("2026-11-20");
  });

  it("a bid on a lot in the sale is refused until registration is complete; a lot outside any sale is not gated", async () => {
    let r = await bid(lotInSale);
    expect(r.status).toBe(422);
    expect(r.body.details.registrationIncomplete).toBe(true);
    expect(r.body.details.open.map((i: { key: string }) => i.key)).toEqual(["deposit", "funds", "entity_docs", "w9", "bidder_registration"]);
    expect((await bid(lotOutside)).status).toBe(201);

    expect((await reg("bidder_registration", { kind: "requirement", requirement: { status: "not_required", source: "SYNTHETIC", asOf: today } })).status).toBe(422);
    expect((await reg("nonsense", { kind: "undone" })).status).toBe(404);
    const stated = (status: string) => ({ kind: "requirement", requirement: { status, source: "SYNTHETIC bidder packet", asOf: today } });
    await reg("deposit", stated("required"));
    await reg("funds", stated("required"));
    await reg("entity_docs", stated("not_required"));
    await reg("w9", stated("required"));
    for (const item of ["deposit", "funds", "w9", "bidder_registration"]) await reg(item, { kind: "done", note: `SYNTHETIC ${item}` });
    r = await bid(lotInSale);
    expect(r.status).toBe(201);

    // Undoing an item shuts the gate again.
    await reg("w9", { kind: "undone" });
    r = await bid(lotInSale);
    expect(r.status).toBe(422);
    expect(r.body.message).toMatch(/W-9 \(required \(SYNTHETIC bidder packet\) and not done yet\)/);
  });

  it("the position record: a subsequent tax, a notice the operator sent, the foreclosure deadline (latest wins)", async () => {
    const post = (body: object) => request(app).post(`/api/tax-certificates/${certId}/ledger`).send(body);
    expect((await post({ kind: "subsequent_tax_paid", paidOn: "2999-01-01", amountCents: 100, taxYear: "2026", source: "SYNTHETIC" })).status).toBe(422);
    expect((await post({ kind: "subsequent_tax_paid", paidOn: today, amountCents: 49_000, taxYear: "2025", source: "SYNTHETIC receipt #1" })).status).toBe(200);
    expect((await post({ kind: "redemption_notice_recorded", sentOn: today, method: "Certified mail", note: null, source: "SYNTHETIC receipt 7019" })).status).toBe(200);
    expect((await post({ kind: "foreclosure_filing_deadline", date: "2028-12-01", source: "SYNTHETIC procedure v1" })).status).toBe(200);
    const last = await post({ kind: "foreclosure_filing_deadline", date: "2029-06-01", source: "SYNTHETIC procedure v2" });
    expect(last.status).toBe(200);
    const l = (await request(app).get(`/api/tax-certificates/${certId}/ledger`)).body.ledger;
    expect(l.subsequentTaxes).toMatchObject({ totalCents: 49_000, payments: [{ amountCents: 49_000, taxYear: "2025", source: "SYNTHETIC receipt #1" }], reimbursement: { status: "not_stated" } });
    expect(l.notices).toEqual([{ sentOn: today, method: "Certified mail", note: null, source: "SYNTHETIC receipt 7019" }]);
    expect(l.foreclosureFilingDeadline).toEqual({ status: "stated", date: "2029-06-01", basis: "SYNTHETIC procedure v2" });
    expect(l.interest.status).toBe("not_computed"); // OH has no encoded rule
    expect(l.redemptionDeadline.basis).toMatch(/before AcreOS tracked|county's records/);
  });

  it("the database refuses an event type it does not know", async () => {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const constraintOf = (q: Promise<unknown>) => q.then(() => "accepted", (e: any) => (e?.cause ?? e)?.constraint ?? String(e));
    expect(await constraintOf(db.execute(sql`INSERT INTO tax_events (organization_id, certificate_id, event_type, event_date, rule_cited, recorded_by) VALUES (${orgIds[0]}, ${certId}, 'owner_texted', ${today}, '{}'::jsonb, 'x')`))).toBe("tax_events_event_type_check");
  });

  it("another organization can neither read nor write any of it", async () => {
    expect((await request(app).get(`/api/tax-certificates/${otherCertId}/ledger`)).status).toBe(404);
    expect((await request(app).post(`/api/tax-certificates/${otherCertId}/ledger`).send({ kind: "foreclosure_filing_deadline", date: "2030-01-01", source: "x" })).status).toBe(404);
    h.org = { id: orgIds[1] };
    try {
      expect((await request(app).get(`/api/tax-researcher/auctions/${auctionId}/calendar`)).status).toBe(404);
      expect((await cal({ timeZone: null, startTimeLocal: null, registrationDeadline: null, funds: null })).status).toBe(404);
      expect((await reg("deposit", { kind: "undone" })).status).toBe(404);
    } finally {
      h.org = { id: orgIds[0] };
    }
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM tax_events WHERE certificate_id = ${otherCertId}`)).rows[0]).toEqual({ n: 0 });
    const a = (await db.execute(sql`SELECT calendar IS NOT NULL AS has FROM tax_sale_auctions WHERE id = ${auctionId}`)).rows[0] as any;
    expect(a.has).toBe(true); // org b's PUT did not clear org a's calendar
  });
});
