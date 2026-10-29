/**
 * V-Tax-1 T3a — bid discipline against a REAL database built from this
 * repository, over HTTP. SYNTHETIC data.
 *
 *   - a max bid is recorded only from a complete rights stack, with its line
 *     items; a stack with a gap is refused, naming the gap, and nothing is set;
 *   - a bid or win needs the amount actually bid or paid;
 *   - a bid over the max is refused with how far over, and nothing is
 *     recorded; with a stated reason it is recorded beside the max it went over;
 *   - the database itself refuses an over-max reason that explains nothing;
 *   - a discarded lot cannot be bid on (a pass still records); reopening keeps
 *     the discard on record and restores the prior status;
 *   - a typed max that differs drops its basis; triage lists the discard
 *     separately and reads the recorded lien search;
 *   - another organization can neither read nor write any of it.
 */
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("taxBidDiscipline.realdb.test.ts");

const h = vi.hoisted(() => ({ org: { id: 0 }, user: { id: "t3a-user" } }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/auth", () => ({ isAuthenticated: (req: any, _res: any, next: any) => { req.user = h.user; next(); } }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({ getOrCreateOrg: (req: any, _res: any, next: any) => { req.organization = h.org; req.organizationId = h.org.id; next(); } }));
vi.mock("../../server/middleware/roleGuard", () => ({ requireRole: () => (_req: any, _res: any, next: any) => next() }));

const tag = `t3a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const county = `Synth${tag}`;
const orgIds: number[] = [];
let app: express.Express;
let listingId = 0;
let otherListingId = 0;
const today = new Date().toISOString().slice(0, 10);
const f = (value: unknown) => ({ value, source: "SYNTHETIC Code §1", asOf: today, basis: "state_law", verification: "checked_against_statute" });
const FIELDS = { instrument: f("deed"), bidMethod: f("premium bid"), returnModel: f({ kind: "none" }), redemptionPeriodMonths: f(0) };

const STACK = {
  value: { status: "known", amountCents: 4_000_000, source: "SYNTHETIC broker opinion", asOf: today },
  survivingLiens: { status: "known", amountCents: 650_000, source: "SYNTHETIC title search #T-1", asOf: today },
  otherTaxes: { status: "searched_none", source: "SYNTHETIC county treasurer", asOf: today },
  costs: [{ label: "Quiet title", amountCents: 290_000, source: "SYNTHETIC attorney quote" }],
  requiredReturn: { kind: "pct_of_value", bps: 2500 },
};
const MAX = 4_000_000 - 650_000 - 290_000 - 1_000_000;

describe.runIf(realDbAvailable)("bid discipline — real database", () => {
  beforeAll(async () => {
    const { db } = await import("../../server/db");
    const { organizations, taxSaleListings } = await import("@shared/schema");
    for (const s of ["a", "b"]) {
      const [org] = await db.insert(organizations).values({ name: `${tag}-${s}`, slug: `${tag}-${s}`, ownerId: `${tag}-${s}` } as never).returning();
      orgIds.push(org.id);
    }
    h.org = { id: orgIds[0] };
    const [l] = await db.insert(taxSaleListings).values({ organizationId: orgIds[0], apn: `${tag}-1`, county, state: "GA", saleType: "tax_deed" }).returning({ id: taxSaleListings.id });
    listingId = l.id;
    const [o] = await db.insert(taxSaleListings).values({ organizationId: orgIds[1], apn: `${tag}-x`, county, state: "GA", saleType: "tax_deed" }).returning({ id: taxSaleListings.id });
    otherListingId = o.id;
    const { registerTaxProcedureRoutes } = await import("../../server/routes-tax-procedures");
    const taxResearcherRouter = (await import("../../server/routes-tax-researcher")).default;
    app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => { req.user = h.user; req.organization = h.org; req.organizationId = h.org.id; next(); });
    registerTaxProcedureRoutes(app);
    app.use("/api/tax-researcher", taxResearcherRouter);
    // A biddable county, so the bid lock (T2a) is not what these tests measure.
    expect((await request(app).post(`/api/tax-procedures/GA/${county}`).send({ fields: FIELDS })).status).toBe(200);
    expect((await request(app).post(`/api/tax-procedures/GA/${county}/verification`).send({ completedOn: today, method: "called the SYNTHETIC county" })).status).toBe(200);
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

  const listing = async () => {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    return (await db.execute(sql`SELECT max_bid_cents, max_bid_basis, discard, status FROM tax_sale_listings WHERE id = ${listingId}`)).rows[0] as any;
  };
  const log = async () => {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    return (await db.execute(sql`SELECT action, amount_cents, max_bid_cents_at_action, over_max_reason FROM auction_bid_log WHERE listing_id = ${listingId} ORDER BY created_at`)).rows as any[];
  };
  const post = (p: string, body: object) => request(app).post(`/api/tax-researcher/listings/${listingId}${p}`).send(body);

  it("a stack with a gap is refused, naming it, and no max is set", async () => {
    const r = await request(app).put(`/api/tax-researcher/listings/${listingId}/max-bid`).send({ ...STACK, survivingLiens: { status: "unknown" }, costs: null });
    expect(r.status).toBe(422);
    expect(r.body.message).toMatch(/Liens your search says survive the sale.*Costs to clear title and hold/);
    expect(r.body.details.missing.map((m: { key: string }) => m.key)).toEqual(["survivingLiens", "costs"]);
    expect((await listing()).max_bid_cents).toBeNull();
  });

  it("a line with no source is invalid, not derived", async () => {
    const r = await request(app).put(`/api/tax-researcher/listings/${listingId}/max-bid`).send({ ...STACK, value: { status: "known", amountCents: 1, source: "", asOf: today } });
    expect(r.status).toBe(422);
    expect((await listing()).max_bid_cents).toBeNull();
  });

  it("a complete stack records the max with its line items; the screen route derives without saving", async () => {
    const screen = await post("/max-bid/screen", STACK);
    expect(screen.status).toBe(200);
    expect(screen.body.screen).toMatchObject({ status: "derived", maxBidCents: MAX });
    expect((await listing()).max_bid_cents).toBeNull();

    const r = await request(app).put(`/api/tax-researcher/listings/${listingId}/max-bid`).send(STACK);
    expect(r.status).toBe(200);
    const row = await listing();
    expect(Number(row.max_bid_cents)).toBe(MAX);
    expect(row.max_bid_basis).toMatchObject({ maxBidCents: MAX, recordedByUserId: "t3a-user", input: { survivingLiens: { source: "SYNTHETIC title search #T-1" } } });
    expect(row.max_bid_basis.lines.map((l: { key: string }) => l.key)).toEqual(["value", "survivingLiens", "otherTaxes", "costs", "requiredReturn"]);
  });

  it("a bid or a win needs the amount actually bid or paid", async () => {
    for (const action of ["bid", "won"]) {
      const r = await post("/bid-log", { action });
      expect(r.status).toBe(422);
      expect(r.body.details).toMatchObject({ amountRequired: true });
    }
    expect(await log()).toEqual([]);
  });

  it("over the max is refused with how far over and records nothing; with a reason it records beside the max", async () => {
    const over = await post("/bid-log", { action: "bid", amountCents: MAX + 5_000 });
    expect(over.status).toBe(422);
    expect(over.body.details).toMatchObject({ overMax: true, maxBidCents: MAX, overByCents: 5_000, derived: true });
    expect(over.body.message).toMatch(/\$50\.00 over your max .*derived from your rights stack/);
    expect(await log()).toEqual([]);

    expect((await post("/bid-log", { action: "bid", amountCents: MAX })).status).toBe(201);
    expect((await post("/bid-log", { action: "bid", amountCents: MAX + 5_000, overMaxReason: "SYNTHETIC: adjoining my own parcel" })).status).toBe(201);
    expect(await log()).toEqual([
      { action: "bid", amount_cents: String(MAX), max_bid_cents_at_action: String(MAX), over_max_reason: null },
      { action: "bid", amount_cents: String(MAX + 5_000), max_bid_cents_at_action: String(MAX), over_max_reason: "SYNTHETIC: adjoining my own parcel" },
    ]);
  });

  it("the database refuses an over-max reason on a bid that was not over", async () => {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const constraintOf = (q: Promise<unknown>) => q.then(() => "accepted", (e: any) => (e?.cause ?? e)?.constraint ?? String(e));
    expect(await constraintOf(db.execute(sql`INSERT INTO auction_bid_log (organization_id, listing_id, action, amount_cents, max_bid_cents_at_action, over_max_reason) VALUES (${orgIds[0]}, ${listingId}, 'bid', 100, 200, 'not over')`))).toBe("auction_bid_log_over_max_reason_check");
    expect(await constraintOf(db.execute(sql`INSERT INTO auction_bid_log (organization_id, listing_id, action, amount_cents, over_max_reason) VALUES (${orgIds[0]}, ${listingId}, 'bid', 100, 'no max to be over')`))).toBe("auction_bid_log_over_max_reason_check");
    expect(await constraintOf(db.execute(sql`UPDATE tax_sale_listings SET discard = '{"reason":"haunted"}'::jsonb WHERE id = ${listingId}`))).toBe("tax_sale_listings_discard_reason_check");
  });

  it("a discarded lot cannot be bid on; a pass still records; reopening keeps the record", async () => {
    expect((await post("/discard", { reason: "other" })).status).toBe(422); // "other" needs its reason
    const d = await post("/discard", { reason: "landlocked", note: "SYNTHETIC: no road frontage on the county map" });
    expect(d.status).toBe(200);
    expect((await listing()).status).toBe("discarded");
    expect((await post("/discard", { reason: "unbuildable" })).status).toBe(422);

    const bid = await post("/bid-log", { action: "bid", amountCents: 100 });
    expect(bid.status).toBe(422);
    expect(bid.body.message).toMatch(/discarded this lot before the sale: Landlocked \(no legal access\) — SYNTHETIC: no road frontage/);
    expect((await post("/bid-log", { action: "passed" })).status).toBe(201);
    expect((await listing()).status).toBe("discarded"); // the pass is logged; the discard stays the lot's state

    const { buildWatchTriage } = await import("../../server/services/tax/taxWatches");
    const { db } = await import("../../server/db");
    const { taxCountyWatches } = await import("@shared/schema");
    const [w] = await db.insert(taxCountyWatches).values({ organizationId: orgIds[0], state: "GA", county, terms: {}, createdBy: "t3a-user" } as never).returning();
    let t = await buildWatchTriage(orgIds[0], w.id);
    expect(t!.lots).toEqual([]);
    expect(t!.discarded).toEqual([expect.objectContaining({ listingId, discard: expect.objectContaining({ reason: "landlocked" }) })]);

    const r = await post("/reopen", { note: "SYNTHETIC: easement found" });
    expect(r.status).toBe(200);
    const row = await listing();
    expect(row.status).toBe("available"); // reopen restores the status the discard found
    expect(row.discard).toMatchObject({ reason: "landlocked", reopened: { byUserId: "t3a-user", note: "SYNTHETIC: easement found" } });
    expect((await post("/reopen", {})).status).toBe(422);

    t = await buildWatchTriage(orgIds[0], w.id);
    expect(t!.discarded).toEqual([]);
    expect(t!.lots[0].facts.find((x) => x.key === "seniorLiens")!.state).toMatchObject({ status: "known", source: expect.stringContaining("SYNTHETIC title search #T-1") });
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`DELETE FROM tax_county_watches WHERE id = ${w.id}`);
  });

  it("a typed max that differs drops its basis; the same number keeps it", async () => {
    await request(app).patch(`/api/tax-researcher/listings/${listingId}`).send({ maxBidCents: MAX, notes: "SYNTHETIC" });
    expect((await listing()).max_bid_basis).not.toBeNull();
    await request(app).patch(`/api/tax-researcher/listings/${listingId}`).send({ maxBidCents: MAX - 1 });
    const row = await listing();
    expect(Number(row.max_bid_cents)).toBe(MAX - 1);
    expect(row.max_bid_basis).toBeNull();
    const over = await post("/bid-log", { action: "bid", amountCents: MAX });
    expect(over.body.details).toMatchObject({ overMax: true, derived: false });
    expect(over.body.message).toMatch(/your typed number — no basis recorded/);
  });

  it("another organization can neither read nor write any of it", async () => {
    for (const [method, p, body] of [
      ["put", "/max-bid", STACK],
      ["post", "/discard", { reason: "landlocked" }],
      ["post", "/reopen", {}],
      ["post", "/bid-log", { action: "bid", amountCents: 1 }],
    ] as const) {
      const r = await (request(app) as any)[method](`/api/tax-researcher/listings/${otherListingId}${p}`).send(body);
      expect([404, 422], `${method} ${p}`).toContain(r.status);
    }
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const other = (await db.execute(sql`SELECT max_bid_cents, discard FROM tax_sale_listings WHERE id = ${otherListingId}`)).rows[0] as any;
    expect(other).toEqual({ max_bid_cents: null, discard: null });
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM auction_bid_log WHERE listing_id = ${otherListingId}`)).rows[0]).toEqual({ n: 0 });
  });
});
