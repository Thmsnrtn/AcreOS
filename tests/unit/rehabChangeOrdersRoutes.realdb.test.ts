/**
 * Rehab change-order routes against a REAL database (fix-and-flip package,
 * Leg 4, §8.2 #10).
 *
 *   - A change order is created `proposed`; a $0 amount is refused; a line that
 *     is not on this rehab (another org's, or nonexistent) is a 404 and writes
 *     nothing.
 *   - Approving an order moves the EFFECTIVE estimate and the adjusted planned
 *     listing date — and never the stored budget, which stays byte-identical.
 *   - An order is decided once. A rejected order and a still-proposed order
 *     adjust nothing.
 *   - Cross-tenant: another org's create, decide and detail read are 404s, with
 *     nothing written.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("rehabChangeOrdersRoutes.realdb.test.ts");

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/auth", () => ({ isAuthenticated: (_r: unknown, _s: unknown, next: () => void) => next() }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({ getOrCreateOrg: (_r: unknown, _s: unknown, next: () => void) => next() }));

const tag = `co-${Math.random().toString(36).slice(2, 10)}`;
let orgA = 0;
let orgB = 0;
let rehabA = "";
let rehabB = "";
let line1 = "";
let line2 = "";
let lineB = "";

const BUDGET_1 = 1_500_000;
const BUDGET_2 = 300_000;

async function appFor(organizationId: number) {
  const { registerRehabRoutes } = await import("../../server/routes-rehabs");
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => {
    req.organization = { id: organizationId };
    req.organizationId = organizationId;
    req.user = { id: `${tag}-user` };
    next();
  });
  registerRehabRoutes(a);
  return a;
}
async function q<T = Record<string, any>>(text: string, ...vals: unknown[]): Promise<T[]> {
  const { pool } = await import("../../server/db");
  return (await pool.query(text, vals)).rows as T[];
}
const orderCount = async () =>
  Number((await q<{ c: string }>("SELECT COUNT(*) AS c FROM rehab_change_orders WHERE rehab_id = $1", rehabA))[0].c);
const storedBudgets = () =>
  q<{ id: string; budget_cents: string }>(
    "SELECT id, budget_cents::text AS budget_cents FROM rehab_line_items WHERE rehab_id = $1 ORDER BY id",
    rehabA,
  );

describe.runIf(realDbAvailable)("rehab change-order routes — real database", () => {
  beforeAll(async () => {
    const [a] = await q<{ id: number }>("INSERT INTO organizations (name, slug, owner_id) VALUES ($1, $1, $2) RETURNING id", `${tag}-a`, `${tag}-oa`);
    const [b] = await q<{ id: number }>("INSERT INTO organizations (name, slug, owner_id) VALUES ($1, $1, $2) RETURNING id", `${tag}-b`, `${tag}-ob`);
    orgA = a.id;
    orgB = b.id;

    const prop = async (org: number, apn: string) =>
      (await q<{ id: number }>("INSERT INTO properties (organization_id, apn, county, state, size_acres, status) VALUES ($1, $2, 'Middlesex', 'MA', '0.2', 'owned') RETURNING id", org, apn))[0].id;
    const pA = await prop(orgA, `${tag}-a`);
    const pB = await prop(orgB, `${tag}-b`);

    rehabA = (await q<{ id: string }>("INSERT INTO rehabs (organization_id, property_id, name) VALUES ($1, $2, 'A') RETURNING id", orgA, pA))[0].id;
    rehabB = (await q<{ id: string }>("INSERT INTO rehabs (organization_id, property_id, name) VALUES ($1, $2, 'B') RETURNING id", orgB, pB))[0].id;

    line1 = (await q<{ id: string }>("INSERT INTO rehab_line_items (organization_id, rehab_id, category, scope, budget_cents) VALUES ($1, $2, 'kitchen', 'Kitchen', $3) RETURNING id", orgA, rehabA, BUDGET_1))[0].id;
    line2 = (await q<{ id: string }>("INSERT INTO rehab_line_items (organization_id, rehab_id, category, scope, budget_cents) VALUES ($1, $2, 'flooring', 'Flooring', $3) RETURNING id", orgA, rehabA, BUDGET_2))[0].id;
    lineB = (await q<{ id: string }>("INSERT INTO rehab_line_items (organization_id, rehab_id, category, scope, budget_cents) VALUES ($1, $2, 'roof', 'B roof', 100) RETURNING id", orgB, rehabB))[0].id;
  });

  afterAll(async () => {
    const { pool } = await import("../../server/db");
    if (orgA) await pool.query("DELETE FROM organizations WHERE id = ANY($1)", [[orgA, orgB]]);
    await pool.end();
  });

  it("1. create records a proposed order; $0 is 422; a line not on this rehab is a 404 and writes nothing", async () => {
    const app = await appFor(orgA);
    const before = await orderCount();

    const ok = await request(app)
      .post(`/api/rehabs/${rehabA}/change-orders`)
      .send({ lineItemId: line2, description: "Upgrade to LVP", amountCents: 40_000, scheduleImpactDays: 1 });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.changeOrder).toMatchObject({ status: "proposed", lineItemId: line2, decidedBy: null, decidedAt: null });
    expect(Number(ok.body.changeOrder.amountCents)).toBe(40_000);
    expect(await orderCount()).toBe(before + 1);

    const zero = await request(app)
      .post(`/api/rehabs/${rehabA}/change-orders`)
      .send({ lineItemId: line1, description: "Nothing", amountCents: 0 });
    expect(zero.status, JSON.stringify(zero.body)).toBe(422);

    const foreignLine = await request(app)
      .post(`/api/rehabs/${rehabA}/change-orders`)
      .send({ lineItemId: lineB, description: "Reach into B", amountCents: 1_000 });
    expect(foreignLine.status).toBe(404);

    const nonexistent = await request(app)
      .post(`/api/rehabs/${rehabA}/change-orders`)
      .send({ lineItemId: "00000000-0000-4000-8000-000000000000", description: "Ghost line", amountCents: 1_000 });
    expect(nonexistent.status).toBe(404);

    expect(await orderCount()).toBe(before + 1);
  });

  it("2. approving moves the effective estimate and the listing date — never the stored budget", async () => {
    const app = await appFor(orgA);

    // A baseline with a planned listing date, so the schedule has something to adjust.
    await request(app)
      .post(`/api/rehabs/${rehabA}/baselines`)
      .send({ plannedStartDate: "2026-09-01", plannedListingDate: "2026-12-01" })
      .expect(200);

    const budgetsBefore = await storedBudgets();
    const detailBefore = (await request(app).get(`/api/rehabs/${rehabA}`).expect(200)).body;
    const originalProject = detailBefore.variance.project.estimateCents;
    expect(detailBefore.variance.project.effectiveEstimateCents - originalProject).toBe(0);
    expect(detailBefore.timeline.schedule.approvedChangeOrderDays).toBe(0);
    expect(detailBefore.timeline.schedule.adjustedPlannedListingDate).toBeNull();

    const created = await request(app)
      .post(`/api/rehabs/${rehabA}/change-orders`)
      .send({ lineItemId: line1, description: "Move the sink wall", amountCents: 250_000, scheduleImpactDays: 6 });
    expect(created.status, JSON.stringify(created.body)).toBe(200);

    // Proposed: nothing moves yet.
    const proposed = (await request(app).get(`/api/rehabs/${rehabA}`).expect(200)).body;
    expect(proposed.variance.project.effectiveEstimateCents).toBe(originalProject);
    expect(proposed.timeline.schedule.approvedChangeOrderDays).toBe(0);

    const decided = await request(app)
      .post(`/api/rehabs/${rehabA}/change-orders/${created.body.changeOrder.id}/decide`)
      .send({ decision: "approved" });
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);
    expect(decided.body.changeOrder).toMatchObject({ status: "approved", decidedBy: `${tag}-user` });
    expect(decided.body.changeOrder.decidedAt).toBeTruthy();

    const detail = (await request(app).get(`/api/rehabs/${rehabA}`).expect(200)).body;
    const v1 = detail.variance.lines.find((l: any) => l.id === line1);
    expect(v1.approvedChangeOrderCents).toBe(250_000);
    expect(v1.effectiveEstimateCents).toBe(BUDGET_1 + 250_000);
    // The other line's approved amount is zero: the $400 order on it is only proposed.
    const v2 = detail.variance.lines.find((l: any) => l.id === line2);
    expect(v2.approvedChangeOrderCents).toBe(0);
    expect(v2.effectiveEstimateCents).toBe(BUDGET_2);

    expect(detail.variance.project.approvedChangeOrderCents).toBe(250_000);
    expect(detail.variance.project.effectiveEstimateCents - detail.variance.project.estimateCents).toBe(250_000);

    expect(detail.changeOrders.totals).toEqual({
      originalEstimateCents: BUDGET_1 + BUDGET_2,
      approvedChangeOrderCents: 250_000,
      effectiveEstimateCents: BUDGET_1 + BUDGET_2 + 250_000,
      approvedCount: 1,
      proposedCount: 1, // the 40_000 flooring order from test 1
      rejectedCount: 0,
    });

    expect(detail.timeline.schedule.approvedChangeOrderDays).toBe(6);
    expect(detail.timeline.schedule.adjustedPlannedListingDate).toBe("2026-12-07"); // 2026-12-01 + 6 days

    // The stored estimate is byte-identical.
    expect(await storedBudgets()).toEqual(budgetsBefore);
  });

  it("3. an order is decided once; a rejected and a proposed order adjust nothing", async () => {
    const app = await appFor(orgA);
    const before = (await request(app).get(`/api/rehabs/${rehabA}`).expect(200)).body;
    const budgetsBefore = await storedBudgets();

    const approved = before.changeOrders.orders.find((o: any) => o.status === "approved");
    const again = await request(app)
      .post(`/api/rehabs/${rehabA}/change-orders/${approved.id}/decide`)
      .send({ decision: "rejected" });
    expect(again.status).toBe(400);
    expect(again.body.message).toMatch(/decided once/);

    const second = await request(app)
      .post(`/api/rehabs/${rehabA}/change-orders`)
      .send({ lineItemId: line1, description: "Gold taps", amountCents: 900_000, scheduleImpactDays: 20 });
    expect(second.status).toBe(200);
    await request(app)
      .post(`/api/rehabs/${rehabA}/change-orders/${second.body.changeOrder.id}/decide`)
      .send({ decision: "rejected" })
      .expect(200);
    // Rejected is final too.
    expect(
      (await request(app).post(`/api/rehabs/${rehabA}/change-orders/${second.body.changeOrder.id}/decide`).send({ decision: "approved" })).status,
    ).toBe(400);

    // A third order is left proposed.
    const third = await request(app)
      .post(`/api/rehabs/${rehabA}/change-orders`)
      .send({ lineItemId: line1, description: "Pot filler", amountCents: 75_000, scheduleImpactDays: 3 });
    expect(third.status).toBe(200);

    const after = (await request(app).get(`/api/rehabs/${rehabA}`).expect(200)).body;
    expect(after.changeOrders.totals).toMatchObject({
      approvedChangeOrderCents: before.changeOrders.totals.approvedChangeOrderCents,
      effectiveEstimateCents: before.changeOrders.totals.effectiveEstimateCents,
      approvedCount: 1,
      rejectedCount: 1,
      proposedCount: 2,
    });
    expect(after.variance.project.effectiveEstimateCents).toBe(before.variance.project.effectiveEstimateCents);
    expect(after.timeline.schedule.approvedChangeOrderDays).toBe(6);
    expect(after.timeline.schedule.adjustedPlannedListingDate).toBe("2026-12-07");
    expect(await storedBudgets()).toEqual(budgetsBefore);

    // The first decision's record is untouched by the refused second attempt.
    const [row] = await q<{ status: string }>("SELECT status FROM rehab_change_orders WHERE id = $1", approved.id);
    expect(row.status).toBe("approved");
  });

  it("4. cross-tenant: org B's create, decide and read on org A's rehab are 404s, with nothing written", async () => {
    const appB = await appFor(orgB);
    const appA = await appFor(orgA);
    const before = await orderCount();
    const detail = (await request(appA).get(`/api/rehabs/${rehabA}`).expect(200)).body;
    const proposed = detail.changeOrders.orders.find((o: any) => o.status === "proposed");
    const statusesBefore = await q("SELECT id, status, decided_by FROM rehab_change_orders WHERE rehab_id = $1 ORDER BY id", rehabA);

    expect(
      (await request(appB).post(`/api/rehabs/${rehabA}/change-orders`).send({ lineItemId: line1, description: "Cross-tenant", amountCents: 1_000 })).status,
    ).toBe(404);
    expect(
      (await request(appB).post(`/api/rehabs/${rehabA}/change-orders/${proposed.id}/decide`).send({ decision: "approved" })).status,
    ).toBe(404);
    expect((await request(appB).get(`/api/rehabs/${rehabA}`)).status).toBe(404);
    // Sanity: B's own rehab is readable, so the 404s above are tenancy, not a broken mount.
    expect((await request(appB).get(`/api/rehabs/${rehabB}`)).status).toBe(200);

    expect(await orderCount()).toBe(before);
    expect(await q("SELECT id, status, decided_by FROM rehab_change_orders WHERE rehab_id = $1 ORDER BY id", rehabA)).toEqual(statusesBefore);
  });
});
