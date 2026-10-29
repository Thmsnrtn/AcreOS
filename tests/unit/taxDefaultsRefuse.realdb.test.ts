/**
 * Tax defaults refuse instead of inventing (V-Tax-1 T0; founder decision
 * 2026-10-28). The real certificate and quiet-title routes over HTTP, against
 * a REAL database built from this repository. SYNTHETIC data.
 *
 *   - a certificate in a state AcreOS has no encoded rule for is REFUSED
 *     without the county's own deadline — it is never recorded as an owned
 *     deed whose deadline is the sale date (the defect this replaces);
 *   - with the county's deadline and its source it is an ACTIVE certificate,
 *     and the source is on the record;
 *   - the encoded no-redemption state (NC) is still the deed it was, and an
 *     encoded state still gets its computed deadline;
 *   - no amount is computed without a rule: the list shows null with the
 *     reason, and marking it redeemed snapshots nothing instead of a guess;
 *   - a quiet-title case opens with every step undated, in procedure order.
 */
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("taxDefaultsRefuse.realdb.test.ts");

const h = vi.hoisted(() => ({ org: { id: 0 }, user: { id: "t0-user" } }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/auth", () => ({ isAuthenticated: (req: any, _res: any, next: any) => { req.user = h.user; next(); } }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({ getOrCreateOrg: (req: any, _res: any, next: any) => { req.organization = h.org; req.organizationId = h.org.id; next(); } }));
vi.mock("../../server/middleware/roleGuard", () => ({ requireRole: () => (_req: any, _res: any, next: any) => next() }));
// The acquired/redeemed workflow lanes are not under test here.
vi.mock("../../server/services/certificateEvents", () => ({ emitCertAcquired: vi.fn(), emitCertRedeemed: vi.fn(), certEventRowFrom: (r: unknown) => r }));

const tag = `t0${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let app: express.Express;
const base = { county: "SYNTHETIC", saleType: "lien", saleDate: "2026-03-01", purchaseAmountCents: 125_000 };

describe.runIf(realDbAvailable)("tax defaults refuse instead of inventing — real database", () => {
  beforeAll(async () => {
    const { db } = await import("../../server/db");
    const { organizations } = await import("@shared/schema");
    const [org] = await db.insert(organizations).values({ name: tag, slug: tag, ownerId: `${tag}-o` } as never).returning();
    h.org = { id: org.id };
    const { registerTaxCertificateRoutes } = await import("../../server/routes-tax-certificates");
    const { registerQuietTitleRoutes } = await import("../../server/routes-quiet-title");
    app = express();
    app.use(express.json());
    registerTaxCertificateRoutes(app);
    registerQuietTitleRoutes(app);
  });

  afterAll(async () => {
    const { db, pool } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`DELETE FROM quiet_title_steps WHERE organization_id = ${h.org.id}`).catch(() => undefined);
    await db.execute(sql`DELETE FROM quiet_title_cases WHERE organization_id = ${h.org.id}`).catch(() => undefined);
    await db.execute(sql`DELETE FROM tax_certificates WHERE organization_id = ${h.org.id}`).catch(() => undefined);
    await db.execute(sql`DELETE FROM organizations WHERE id = ${h.org.id}`).catch(() => undefined);
    await pool.end();
  });

  const count = async () => {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const r = await db.execute(sql`SELECT count(*)::int AS n FROM tax_certificates WHERE organization_id = ${h.org.id}`);
    return Number((r.rows[0] as { n: number }).n);
  };

  it("a state with no encoded rule is refused without the county's deadline — never recorded as an owned deed", async () => {
    const res = await request(app).post("/api/tax-certificates").send({ ...base, state: "OH", apn: `${tag}-OH-1` });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no encoded redemption rule for OH/);
    expect(res.body.message).toMatch(/will not guess/);
    expect(res.body.details).toEqual({ needs: ["redemptionDeadline", "redemptionDeadlineSource"] });
    expect(await count()).toBe(0);
  });

  it("a deadline needs its source, and may not precede the sale", async () => {
    const noSource = await request(app).post("/api/tax-certificates").send({ ...base, state: "OH", apn: `${tag}-OH-2`, redemptionDeadline: "2027-03-01" });
    expect(noSource.status).toBe(422);
    const early = await request(app).post("/api/tax-certificates").send({ ...base, state: "OH", apn: `${tag}-OH-2`, redemptionDeadline: "2026-01-01", redemptionDeadlineSource: "SYNTHETIC county certificate 7" });
    expect(early.status).toBe(400);
    expect(await count()).toBe(0);
  });

  let ohId = "";
  it("with the county's deadline and its source, it is an active certificate and the source is recorded", async () => {
    const res = await request(app).post("/api/tax-certificates").send({ ...base, state: "OH", apn: `${tag}-OH-3`, redemptionDeadline: "2027-03-01", redemptionDeadlineSource: "SYNTHETIC county certificate 7" });
    expect(res.status).toBe(201);
    expect(res.body.certificate).toMatchObject({ status: "active", redemptionDeadline: "2027-03-01" });
    expect(res.body.certificate.notes).toMatch(/entered by the operator.*Source: SYNTHETIC county certificate 7/);
    ohId = res.body.certificate.id;
  });

  it("the encoded no-redemption state is still the deed; an encoded state still gets its computed deadline", async () => {
    const nc = await request(app).post("/api/tax-certificates").send({ ...base, state: "NC", saleType: "deed", apn: `${tag}-NC-1` });
    expect(nc.status).toBe(201);
    expect(nc.body.certificate).toMatchObject({ status: "deed_obtained" });
    const fl = await request(app).post("/api/tax-certificates").send({ ...base, state: "FL", apn: `${tag}-FL-1` });
    expect(fl.status).toBe(201);
    expect(fl.body.certificate.status).toBe("active");
    expect(fl.body.certificate.redemptionDeadline > base.saleDate).toBe(true);
  });

  it("no rule, no amount: the list shows null with the reason; redeeming snapshots nothing", async () => {
    const list = await request(app).get("/api/tax-certificates?status=all");
    expect(list.status).toBe(200);
    const oh = list.body.certificates.find((c: { id: string }) => c.id === ohId);
    expect(oh).toMatchObject({ currentRedemptionAmountCents: null, currentInterestCents: null, appliedRateBps: null, modelUsed: "no_rule" });
    expect(oh.amountRefusalReason).toMatch(/no encoded redemption rule for OH/);
    const fl = list.body.certificates.find((c: { state: string }) => c.state === "FL");
    expect(typeof fl.currentRedemptionAmountCents).toBe("number");

    const redeemed = await request(app).patch(`/api/tax-certificates/${ohId}`).send({ status: "redeemed", redeemedAt: "2026-09-01" });
    expect(redeemed.status).toBe(200);
    expect(redeemed.body.certificate).toMatchObject({ status: "redeemed", redeemedAmountCents: null });
  });

  it("a quiet-title case opens with every step undated, listed in procedure order", async () => {
    const res = await request(app).post("/api/quiet-title/cases").send({ certificateId: ohId, deedRecordationDate: "2027-04-01" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ stepCount: 10, stepDatesSet: false });
    const detail = await request(app).get(`/api/quiet-title/cases/${res.body.case.id}`);
    expect(detail.status).toBe(200);
    const { QUIET_TITLE_STEP_KEYS } = await import("@shared/schema");
    expect(detail.body.steps.map((s: { stepKey: string }) => s.stepKey)).toEqual([...QUIET_TITLE_STEP_KEYS]);
    expect(detail.body.steps.every((s: { requiredByDate: string | null }) => s.requiredByDate === null)).toBe(true);
  });
});
