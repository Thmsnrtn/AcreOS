/**
 * V-Tax-1 T2a — procedure objects and the bidding lock against a REAL database
 * built from this repository, over HTTP. SYNTHETIC data.
 *
 *   - recording a procedure creates version 1, unverified → bidding locked;
 *   - completing the county-verification task creates version 2 → biddable;
 *   - recording a change creates version 3, unverified again → locked again;
 *     earlier versions stay on record (the table refuses edits);
 *   - the bid log refuses a "bid" or "won" on a locked county (422, with the
 *     reasons) and records nothing, and still records a "passed";
 *   - another organization sees no procedure for the same county;
 *   - an organization holding versions is still erasable.
 */
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("taxProcedures.realdb.test.ts");

const h = vi.hoisted(() => ({ org: { id: 0 }, user: { id: "t2a-user" } }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/auth", () => ({ isAuthenticated: (req: any, _res: any, next: any) => { req.user = h.user; next(); } }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({ getOrCreateOrg: (req: any, _res: any, next: any) => { req.organization = h.org; req.organizationId = h.org.id; next(); } }));
vi.mock("../../server/middleware/roleGuard", () => ({ requireRole: () => (_req: any, _res: any, next: any) => next() }));

const tag = `t2a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const county = `Synth${tag}`;
const orgIds: number[] = [];
let app: express.Express;
let listingId = 0;
const today = new Date().toISOString().slice(0, 10);
const f = (value: unknown) => ({ value, source: "SYNTHETIC Code §33.54", asOf: today, basis: "state_law", verification: "checked_against_statute" });
const FIELDS = { instrument: f("redeemable_deed"), bidMethod: f("premium bid"), returnModel: f({ kind: "flat_penalty", penaltyBps: 2500 }), redemptionPeriodMonths: f(6) };
const path = `/api/tax-procedures/TX/${county}`;

describe.runIf(realDbAvailable)("procedure objects and the bidding lock — real database", () => {
  beforeAll(async () => {
    const { db } = await import("../../server/db");
    const { organizations, taxSaleListings } = await import("@shared/schema");
    for (const s of ["a", "b"]) {
      const [org] = await db.insert(organizations).values({ name: `${tag}-${s}`, slug: `${tag}-${s}`, ownerId: `${tag}-${s}` } as never).returning();
      orgIds.push(org.id);
    }
    h.org = { id: orgIds[0] };
    const [l] = await db.insert(taxSaleListings).values({ organizationId: orgIds[0], apn: `${tag}-1`, county, state: "TX", saleType: "redeemable_deed" }).returning({ id: taxSaleListings.id });
    listingId = l.id;
    const { registerTaxProcedureRoutes } = await import("../../server/routes-tax-procedures");
    const taxResearcherRouter = (await import("../../server/routes-tax-researcher")).default;
    app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => { req.user = h.user; req.organization = h.org; req.organizationId = h.org.id; next(); });
    registerTaxProcedureRoutes(app);
    app.use("/api/tax-researcher", taxResearcherRouter);
  });

  afterAll(async () => {
    const { db, pool } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    for (const id of orgIds) {
      await db.execute(sql`DELETE FROM auction_bid_log WHERE organization_id = ${id}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM tax_sale_listings WHERE organization_id = ${id}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM tax_procedure_objects WHERE organization_id = ${id}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM organizations WHERE id = ${id}`).catch(() => undefined);
    }
    await pool.end();
  });

  const bids = async () => {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    return (await db.execute(sql`SELECT action FROM auction_bid_log WHERE listing_id = ${listingId} ORDER BY created_at`)).rows.map((r: any) => r.action);
  };

  it("with no procedure, bidding is locked: a bid is refused with the reason and nothing is recorded; a pass is recorded", async () => {
    const bid = await request(app).post(`/api/tax-researcher/listings/${listingId}/bid-log`).send({ action: "bid", amountCents: 10_000 });
    expect(bid.status).toBe(422);
    expect(bid.body.message).toMatch(/Bidding is locked .*No procedure has been recorded/);
    expect(bid.body.details).toMatchObject({ biddingLocked: true, lockReasons: [expect.objectContaining({ code: "no_procedure" })] });
    expect(await bids()).toEqual([]);
    expect((await request(app).post(`/api/tax-researcher/listings/${listingId}/bid-log`).send({ action: "passed" })).status).toBe(201);
    expect(await bids()).toEqual(["passed"]);
  });

  it("version 1 is unverified and locked; verification makes version 2 biddable; a change makes version 3 locked again", async () => {
    const v1 = await request(app).post(path).send({ fields: FIELDS });
    expect(v1.status).toBe(200);
    expect(v1.body.procedure).toMatchObject({ version: 1, countyVerification: null });
    let g = await request(app).get(path);
    expect(g.body.standing).toMatchObject({ biddable: false, lockReasons: [expect.objectContaining({ code: "not_verified" })] });

    const v2 = await request(app).post(`${path}/verification`).send({ completedOn: today, method: "called the SYNTHETIC county tax office" });
    expect(v2.status).toBe(200);
    expect(v2.body.procedure).toMatchObject({ version: 2, countyVerification: { completedOn: today, completedBy: "t2a-user" } });
    g = await request(app).get(path);
    expect(g.body.standing).toMatchObject({ biddable: true, lockReasons: [] });
    expect((await request(app).post(`/api/tax-researcher/listings/${listingId}/bid-log`).send({ action: "bid", amountCents: 10_000 })).status).toBe(201);

    const v3 = await request(app).post(path).send({ fields: { ...FIELDS, redemptionPeriodMonths: f(24) } });
    expect(v3.body.procedure).toMatchObject({ version: 3, countyVerification: null });
    g = await request(app).get(path);
    expect(g.body.standing.biddable).toBe(false);
    expect(g.body.history.map((x: { version: number; verified: boolean }) => [x.version, x.verified])).toEqual([[3, false], [2, true], [1, false]]);
    expect((await request(app).post(`/api/tax-researcher/listings/${listingId}/bid-log`).send({ action: "won", amountCents: 10_000 })).status).toBe(422);
    expect(await bids()).toEqual(["passed", "bid"]);
  });

  it("a field needs its source; a future-dated source or verification is refused", async () => {
    expect((await request(app).post(path).send({ fields: { instrument: { value: "deed", asOf: today, basis: "state_law", verification: "unverified" } } })).status).toBe(422);
    expect((await request(app).post(path).send({ fields: { instrument: { ...f("deed"), asOf: "2999-01-01" } } })).status).toBe(400);
    expect((await request(app).post(`${path}/verification`).send({ completedOn: "2999-01-01", method: "called the county" })).status).toBe(400);
  });

  it("versions are never edited; another organization sees none; erasure still completes", async () => {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const codeOf = (q: Promise<unknown>) => q.then(() => null, (e: { code?: string; cause?: { code?: string } }) => e.code ?? e.cause?.code);
    expect(await codeOf(db.execute(sql`UPDATE tax_procedure_objects SET version = 99 WHERE organization_id = ${orgIds[0]}`))).toBe("23001");
    h.org = { id: orgIds[1] };
    const other = await request(app).get(path);
    expect(other.body).toMatchObject({ current: null, history: [], standing: { biddable: false } });
    h.org = { id: orgIds[0] };
    const { deleteOrganization } = await import("../../server/services/orgDeletion");
    expect(await deleteOrganization(orgIds[0])).toMatchObject({ orgRowDeleted: true, residualTables: [] });
    expect(Number((await db.execute(sql`SELECT count(*)::int AS n FROM tax_procedure_objects WHERE organization_id = ${orgIds[0]}`)).rows[0].n)).toBe(0);
  });
});
