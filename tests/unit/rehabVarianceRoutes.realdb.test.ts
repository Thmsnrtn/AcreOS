/**
 * Rehab variance routes against a REAL database (fix-and-flip package, Leg 2,
 * §8.2 #8–#11, §8.4 #15).
 *
 *   - Budget lock (§4.3): in planning, estimates are editable. After the
 *     planning exit, an estimate PATCH, a new estimated line, deleting an
 *     estimated line, and a replacing template seed are each refused, naming
 *     the change-order path. Spent and committed stay writable.
 *   - Bid → committed (§4.1): accepting a bid writes nothing to the lines.
 *     Applying an accepted bid is the explicit act. It is all-or-nothing when a
 *     category cannot be mapped to exactly one line, and estimates are never
 *     touched.
 *   - The detail payload carries the three-way variance and flags. The
 *     dashboard carries the facts, and reading it writes nothing.
 *   - Cross-tenant: another org's rehab, line and bid are 404s with nothing
 *     written.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("rehabVarianceRoutes.realdb.test.ts");

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/auth", () => ({ isAuthenticated: (_r: unknown, _s: unknown, next: () => void) => next() }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({ getOrCreateOrg: (_r: unknown, _s: unknown, next: () => void) => next() }));

const tag = `rv-${Math.random().toString(36).slice(2, 10)}`;
let orgA = 0;
let orgB = 0;
let rehabId = "";
let rehabB = "";
const line: Record<string, string> = {};
let bidAccepted = "";
let bidOther = "";
let lineB = "";
let gcB = "";

async function appFor(organizationId: number) {
  const { registerRehabRoutes } = await import("../../server/routes-rehabs");
  const { registerBidEstimateRoutes } = await import("../../server/routes-bid-estimates");
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => {
    req.organization = { id: organizationId };
    req.organizationId = organizationId;
    req.user = { id: `${tag}-user` };
    next();
  });
  registerRehabRoutes(a);
  registerBidEstimateRoutes(a);
  return a;
}
async function q<T = Record<string, any>>(text: string, ...vals: unknown[]): Promise<T[]> {
  const { pool } = await import("../../server/db");
  return (await pool.query(text, vals)).rows as T[];
}
const lines = () => q<{ id: string; category: string; budget_cents: string; committed_cents: string; spent_cents: string }>(
  "SELECT id, category, budget_cents, committed_cents, spent_cents FROM rehab_line_items WHERE rehab_id = $1 ORDER BY category, id", rehabId,
);

describe.runIf(realDbAvailable)("rehab variance routes — real database", () => {
  beforeAll(async () => {
    const [a] = await q<{ id: number }>("INSERT INTO organizations (name, slug, owner_id) VALUES ($1, $1, $2) RETURNING id", `${tag}-a`, `${tag}-oa`);
    const [b] = await q<{ id: number }>("INSERT INTO organizations (name, slug, owner_id) VALUES ($1, $1, $2) RETURNING id", `${tag}-b`, `${tag}-ob`);
    orgA = a.id;
    orgB = b.id;
    const prop = async (org: number, apn: string) =>
      (await q<{ id: number }>("INSERT INTO properties (organization_id, apn, county, state, size_acres, status) VALUES ($1, $2, 'Middlesex', 'MA', '0.2', 'owned') RETURNING id", org, apn))[0].id;
    const pA = await prop(orgA, `${tag}-a`);
    const pB = await prop(orgB, `${tag}-b`);
    rehabId = (await q<{ id: string }>("INSERT INTO rehabs (organization_id, property_id, name) VALUES ($1, $2, 'A') RETURNING id", orgA, pA))[0].id;
    rehabB = (await q<{ id: string }>("INSERT INTO rehabs (organization_id, property_id, name) VALUES ($1, $2, 'B') RETURNING id", orgB, pB))[0].id;
    for (const [key, cat, budget] of [["kitchen", "kitchen", 1_500_000], ["floor1", "flooring", 300_000], ["floor2", "flooring", 300_000], ["paint", "interior_paint", 300_000]] as const) {
      line[key] = (await q<{ id: string }>("INSERT INTO rehab_line_items (organization_id, rehab_id, category, scope, budget_cents) VALUES ($1, $2, $3, $4, $5) RETURNING id", orgA, rehabId, cat, key, budget))[0].id;
    }
    lineB = (await q<{ id: string }>("INSERT INTO rehab_line_items (organization_id, rehab_id, category, scope, budget_cents) VALUES ($1, $2, 'roof', 'B roof', 100) RETURNING id", orgB, rehabB))[0].id;
    const gcA = (await q<{ id: string }>("INSERT INTO contractors (organization_id, name) VALUES ($1, 'GC A') RETURNING id", orgA))[0].id;
    gcB = (await q<{ id: string }>("INSERT INTO contractors (organization_id, name) VALUES ($1, 'GC B') RETURNING id", orgB))[0].id;
    bidAccepted = (await q<{ id: string }>("INSERT INTO bid_estimates (organization_id, rehab_id, contractor_id, total_cents, category_breakdown) VALUES ($1, $2, $3, 2260000, $4::jsonb) RETURNING id", orgA, rehabId, gcA, JSON.stringify({ kitchen: 1_650_000, interior_paint: 280_000, flooring: 330_000 })))[0].id;
    bidOther = (await q<{ id: string }>("INSERT INTO bid_estimates (organization_id, rehab_id, contractor_id, total_cents, category_breakdown) VALUES ($1, $2, $4, 930000, $3::jsonb) RETURNING id", orgA, rehabId, JSON.stringify({ kitchen: 930_000 }), gcA))[0].id;
  });

  afterAll(async () => {
    const { pool } = await import("../../server/db");
    if (orgA) await pool.query("DELETE FROM organizations WHERE id = ANY($1)", [[orgA, orgB]]);
    await pool.end();
  });

  it("in planning, an estimate is editable", async () => {
    const app = await appFor(orgA);
    await request(app).patch(`/api/rehab-line-items/${line.paint}`).send({ budgetCents: 310_000 }).expect(200);
    await request(app).patch(`/api/rehab-line-items/${line.paint}`).send({ budgetCents: 300_000 }).expect(200);
    const detail = await request(app).get(`/api/rehabs/${rehabId}`).expect(200);
    expect(detail.body.estimateLock).toEqual({ locked: false });
  });

  it("accepting a bid writes nothing to the lines; applying it is the act, and it is all-or-nothing", async () => {
    const app = await appFor(orgA);
    const before = await lines();
    await request(app).post(`/api/bids/${bidAccepted}/accept`).expect(200);
    expect(await lines()).toEqual(before);

    // An unaccepted bid cannot set committed.
    const notAccepted = await request(app).post(`/api/bids/${bidOther}/apply-to-lines`).send({ categories: ["kitchen"] });
    expect(notAccepted.status).toBe(400);
    // Flooring has two lines: the whole request is refused, naming it — kitchen is NOT applied either.
    const ambiguous = await request(app).post(`/api/bids/${bidAccepted}/apply-to-lines`).send({ categories: ["kitchen", "flooring"] });
    expect(ambiguous.status).toBe(400);
    expect(ambiguous.body.message).toMatch(/flooring: The project has 2 lines/);
    expect(await lines()).toEqual(before);

    // A category the bid has no amount for, or the project has no line for, is refused too.
    expect((await request(app).post(`/api/bids/${bidAccepted}/apply-to-lines`).send({ categories: ["roof"] })).body.message).toMatch(/roof: This bid has no amount/);
    const ok = await request(app).post(`/api/bids/${bidAccepted}/apply-to-lines`).send({ categories: ["kitchen", "interior_paint"] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const after = await lines();
    const byId = Object.fromEntries(after.map((l) => [l.id, l]));
    expect(Number(byId[line.kitchen].committed_cents)).toBe(1_650_000);
    expect(Number(byId[line.paint].committed_cents)).toBe(280_000);
    expect(Number(byId[line.floor1].committed_cents)).toBe(0);
    // Estimates untouched by applying a bid.
    expect(after.map((l) => l.budget_cents)).toEqual(before.map((l) => l.budget_cents));

    // A committed amount the operator already entered is not overwritten unless they say so.
    await request(app).patch(`/api/rehab-line-items/${line.kitchen}`).send({ committedCents: 1_700_000 }).expect(200);
    const keep = await request(app).post(`/api/bids/${bidAccepted}/apply-to-lines`).send({ categories: ["kitchen"] });
    expect(keep.status).toBe(400);
    expect(keep.body.message).toMatch(/already has \$17,000 committed/);
    await request(app).post(`/api/bids/${bidAccepted}/apply-to-lines`).send({ categories: ["kitchen"], replaceCommitted: true }).expect(200);
    const [{ committed_cents }] = await q<{ committed_cents: string }>("SELECT committed_cents FROM rehab_line_items WHERE id = $1", line.kitchen);
    expect(Number(committed_cents)).toBe(1_650_000);
  });

  it("after the planning exit, every route that would rewrite the estimate refuses, naming change orders", async () => {
    const app = await appFor(orgA);
    await request(app).patch(`/api/rehabs/${rehabId}`).send({ status: "demo" }).expect(200);
    const before = await lines();

    const refusals = [
      await request(app).patch(`/api/rehab-line-items/${line.kitchen}`).send({ budgetCents: 1_900_000 }),
      await request(app).post(`/api/rehabs/${rehabId}/line-items`).send({ category: "roof", scope: "New roof", budgetCents: 800_000 }),
      await request(app).delete(`/api/rehab-line-items/${line.paint}`),
      await request(app).post(`/api/rehabs/${rehabId}/seed-template`).send({ templateKey: "kitchen_midgrade", replaceExisting: true }),
    ];
    for (const r of refusals) {
      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(r.body.message).toMatch(/change order/);
    }
    expect(await lines()).toEqual(before);

    // Spent and committed still move; the same budget value is not a change.
    await request(app).patch(`/api/rehab-line-items/${line.kitchen}`).send({ spentCents: 1_824_000 }).expect(200);
    await request(app).patch(`/api/rehab-line-items/${line.floor1}`).send({ committedCents: 320_000, budgetCents: 300_000 }).expect(200);
    // An unplanned cost with a $0 estimate can still be tracked.
    await request(app).post(`/api/rehabs/${rehabId}/line-items`).send({ category: "other", scope: "Unplanned permit", budgetCents: 0, spentCents: 45_000 }).expect(201);

    // The lock cannot be lifted by stepping back into planning, nor dodged by
    // moving an estimated line to another category.
    const back = await request(app).patch(`/api/rehabs/${rehabId}`).send({ status: "planning" });
    expect(back.status).toBe(400);
    expect(back.body.message).toMatch(/cannot go back/);
    const moved = await request(app).patch(`/api/rehab-line-items/${line.kitchen}`).send({ category: "bathroom" });
    expect(moved.status).toBe(400);
    // A later stage is locked the same way.
    await request(app).patch(`/api/rehabs/${rehabId}`).send({ status: "on_hold" }).expect(200);
    expect((await request(app).patch(`/api/rehab-line-items/${line.kitchen}`).send({ budgetCents: 1 })).status).toBe(400);
    await request(app).patch(`/api/rehabs/${rehabId}`).send({ status: "demo" }).expect(200);
    const [{ status }] = await q<{ status: string }>("SELECT status FROM rehabs WHERE id = $1", rehabId);
    expect(status).toBe("demo");

    const detail = await request(app).get(`/api/rehabs/${rehabId}`).expect(200);
    expect(detail.body.estimateLock.locked).toBe(true);
    expect(detail.body.estimateLock.message).toMatch(/change order/);
    // The three-way payload, from the lines as they now stand.
    const kitchen = detail.body.variance.lines.find((l: any) => l.id === line.kitchen);
    expect(kitchen).toMatchObject({ estimateCents: 1_500_000, committedCents: 1_650_000, actualCents: 1_824_000, actualVsEstimateCents: 324_000, actualVsCommittedCents: 174_000 });
    const floor2 = detail.body.variance.lines.find((l: any) => l.id === line.floor2);
    expect(floor2.committedCents).toBeNull();
    expect(floor2.actualVsCommittedCents).toBeNull();
    const facts = detail.body.variance.flags.map((f: any) => f.fact);
    expect(facts).toContain("kitchen: spent $18,240 vs $15,000 estimate");
    expect(facts).toContain("Unplanned permit: spent $450 vs $0 estimate");
  });

  it("the dashboard carries the same facts, and reading it writes nothing", async () => {
    const before = JSON.stringify(await lines());
    const res = await request(await appFor(orgA)).get("/api/flipper/dashboard").expect(200);
    const mine = res.body.activeRehabs.find((r: any) => r.id === rehabId);
    expect(mine.flags.map((f: any) => f.fact)).toContain("kitchen: spent $18,240 vs $15,000 estimate");
    expect(JSON.stringify(await lines())).toBe(before);
  });

  it("bids carry their category amounts beside the project's estimate", async () => {
    const res = await request(await appFor(orgA)).get(`/api/rehabs/${rehabId}/bids`).expect(200);
    const other = res.body.bids.find((b: any) => b.id === bidOther);
    expect(other.vsEstimate).toEqual([{ category: "kitchen", bidCents: 930_000, estimateCents: 1_500_000, deltaCents: -570_000, deltaPct: -38 }]);
  });

  it("cross-tenant: org B's rehab, line and bid are 404s from org A, with nothing written", async () => {
    const app = await appFor(orgA);
    const before = await q("SELECT budget_cents, committed_cents, spent_cents FROM rehab_line_items WHERE id = $1", lineB);
    expect((await request(app).get(`/api/rehabs/${rehabB}`)).status).toBe(404);
    expect((await request(app).patch(`/api/rehab-line-items/${lineB}`).send({ spentCents: 1 })).status).toBe(404);
    expect((await request(app).delete(`/api/rehab-line-items/${lineB}`)).status).toBe(404);
    const otherBid = (await q<{ id: string }>("INSERT INTO bid_estimates (organization_id, rehab_id, contractor_id, total_cents, category_breakdown, is_accepted) VALUES ($1, $2, $3, 100, '{\"roof\":100}'::jsonb, true) RETURNING id", orgB, rehabB, gcB))[0].id;
    expect((await request(app).post(`/api/bids/${otherBid}/apply-to-lines`).send({ categories: ["roof"] })).status).toBe(404);
    expect(await q("SELECT budget_cents, committed_cents, spent_cents FROM rehab_line_items WHERE id = $1", lineB)).toEqual(before);
  });
});
