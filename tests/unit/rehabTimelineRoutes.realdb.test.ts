/**
 * Rehab timeline routes against a REAL database (fix-and-flip package, Leg 3).
 *
 *   - Baselines are a revision CHAIN: a second POST points at the first, and
 *     the detail payload measures variance against the ORIGINAL, never the
 *     latest revision.
 *   - The status log records genuine moves only: a PATCH that touches no status
 *     appends nothing, a real move appends exactly one row, and a rehab created
 *     through the route starts the log with a from_status-null record.
 *   - Holding entries are facts; a zero amount is refused. The MAO scenario is
 *     read for comparison and is byte-identical after the read — rendering
 *     writes nothing.
 *   - Cross-tenant: another org's rehab is a 404 from every one of these
 *     routes, with nothing written.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("rehabTimelineRoutes.realdb.test.ts");

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/auth", () => ({ isAuthenticated: (_r: unknown, _s: unknown, next: () => void) => next() }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({ getOrCreateOrg: (_r: unknown, _s: unknown, next: () => void) => next() }));

const tag = `rt-${Math.random().toString(36).slice(2, 10)}`;
let orgA = 0;
let orgB = 0;
let propA = 0;
let propA2 = 0;
let propB = 0;
let rehabA = "";
let rehabB = "";

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
const transitionRows = () =>
  q<{ from_status: string | null; to_status: string }>(
    "SELECT from_status, to_status FROM rehab_status_transitions WHERE rehab_id = $1 ORDER BY transitioned_at, id",
    rehabA,
  );
const baselineCount = async () =>
  Number((await q<{ c: string }>("SELECT COUNT(*) AS c FROM rehab_baselines WHERE rehab_id = $1", rehabA))[0].c);
const entryCount = async () =>
  Number((await q<{ c: string }>("SELECT COUNT(*) AS c FROM rehab_holding_cost_entries WHERE rehab_id = $1", rehabA))[0].c);

describe.runIf(realDbAvailable)("rehab timeline routes — real database", () => {
  beforeAll(async () => {
    const [a] = await q<{ id: number }>("INSERT INTO organizations (name, slug, owner_id) VALUES ($1, $1, $2) RETURNING id", `${tag}-a`, `${tag}-oa`);
    const [b] = await q<{ id: number }>("INSERT INTO organizations (name, slug, owner_id) VALUES ($1, $1, $2) RETURNING id", `${tag}-b`, `${tag}-ob`);
    orgA = a.id;
    orgB = b.id;

    const prop = async (org: number, apn: string) =>
      (await q<{ id: number }>("INSERT INTO properties (organization_id, apn, county, state, size_acres, status) VALUES ($1, $2, 'Middlesex', 'MA', '0.2', 'owned') RETURNING id", org, apn))[0].id;
    propA = await prop(orgA, `${tag}-a`);
    propA2 = await prop(orgA, `${tag}-a2`);
    propB = await prop(orgB, `${tag}-b`);

    // Inserted by SQL, so no creation record exists until a route writes one.
    rehabA = (await q<{ id: string }>("INSERT INTO rehabs (organization_id, property_id, name) VALUES ($1, $2, 'A') RETURNING id", orgA, propA))[0].id;
    rehabB = (await q<{ id: string }>("INSERT INTO rehabs (organization_id, property_id, name) VALUES ($1, $2, 'B') RETURNING id", orgB, propB))[0].id;
  });

  afterAll(async () => {
    const { pool } = await import("../../server/db");
    if (orgA) await pool.query("DELETE FROM organizations WHERE id = ANY($1)", [[orgA, orgB]]);
    await pool.end();
  });

  it("1. a revised baseline supersedes the first, and variance stays measured against the original", async () => {
    const app = await appFor(orgA);

    const first = await request(app).post(`/api/rehabs/${rehabA}/baselines`).send({
      plannedStartDate: "2026-09-01",
      plannedListingDate: "2026-12-01",
      plannedHoldMonths: 4,
      plannedHoldingMonthlyCents: 100_000,
      phasePlans: [{ phase: "demo", plannedDate: "2026-09-05" }],
    });
    expect(first.status, JSON.stringify(first.body)).toBe(200);

    const second = await request(app).post(`/api/rehabs/${rehabA}/baselines`).send({ plannedListingDate: "2026-12-20" });
    expect(second.status, JSON.stringify(second.body)).toBe(200);

    const [chain] = await q<{ supersedes_id: string | null }>(
      "SELECT supersedes_id FROM rehab_baselines WHERE id = $1",
      second.body.baseline.id,
    );
    expect(chain.supersedes_id).toBe(first.body.baseline.id);

    const detail = await request(app).get(`/api/rehabs/${rehabA}`).expect(200);
    const timeline = detail.body.timeline;
    expect(timeline.baselines).toHaveLength(2);

    const originals = timeline.baselines.filter((b: any) => b.isOriginal);
    expect(originals).toHaveLength(1);
    expect(originals[0].id).toBe(first.body.baseline.id);

    // The revision moved the listing date; the schedule still reads the original's plan.
    const demo = timeline.schedule.phases.find((p: any) => p.phase === "demo");
    expect(demo).toMatchObject({ plannedDate: "2026-09-05", actualDate: null, varianceDays: null });
  });

  it("2. only a genuine status move appends a transition, and the schedule reads it back", async () => {
    const app = await appFor(orgA);

    await request(app).patch(`/api/rehabs/${rehabA}`).send({ name: "renamed" }).expect(200);
    expect(await transitionRows()).toHaveLength(0);

    await request(app).patch(`/api/rehabs/${rehabA}`).send({ status: "demo" }).expect(200);
    expect(await transitionRows()).toEqual([{ from_status: "planning", to_status: "demo" }]);

    const [row] = await q<{ d: string }>(
      "SELECT transitioned_at::date::text AS d FROM rehab_status_transitions WHERE rehab_id = $1",
      rehabA,
    );
    const detail = await request(app).get(`/api/rehabs/${rehabA}`).expect(200);
    const demo = detail.body.timeline.schedule.phases.find((p: any) => p.phase === "demo");
    expect(demo.actualDate).toBe(row.d);
  });

  it("3. creating a rehab writes the log's creation record (from_status null)", async () => {
    const app = await appFor(orgA);
    const res = await request(app).post("/api/rehabs").send({ propertyId: propA2, name: "C" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const rows = await q<{ from_status: string | null; to_status: string }>(
      "SELECT from_status, to_status FROM rehab_status_transitions WHERE rehab_id = $1",
      res.body.rehab.id,
    );
    expect(rows).toEqual([{ from_status: null, to_status: "planning" }]);
  });

  it("4. holding entries accumulate; the MAO scenario is compared and never rewritten by the read", async () => {
    const app = await appFor(orgA);

    const [scenario] = await q<{ id: number; inputs_text: string; assumptions_text: string }>(
      `INSERT INTO scenarios (organization_id, subject_type, subject_id, label, engine_id, engine_version, strategy_pack_id, inputs, assumptions)
       VALUES ($1, 'property', $2, 'Flip decision', 'flip_mao', 'flip-mao-1', 'fix_and_flip', $3::jsonb, $4::jsonb)
       RETURNING id, inputs::text AS inputs_text, assumptions::text AS assumptions_text`,
      orgA,
      propA,
      JSON.stringify({ holdMonths: 6, monthlyHoldingCostCents: 120_000 }),
      JSON.stringify([
        { key: "rule_hold_months", value: 6, origin: "user", basis: "test" },
        { key: "holdingCost", value: "$1,200", origin: "platform-default", basis: "test" },
      ]),
    );

    const entries = [
      { entryDate: "2026-10-01", category: "taxes", amountCents: 500_000 },
      { entryDate: "2026-10-15", category: "insurance", amountCents: 300_000 },
      { entryDate: "2026-10-16", category: "other", amountCents: -50_000, note: "Corrects the Oct 15 insurance entry" },
    ];
    for (const body of entries) {
      const r = await request(app).post(`/api/rehabs/${rehabA}/holding-entries`).send(body);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }

    // A zero amount is not a cost. Zod refusals come back as 422 through
    // Errors.validationFailed (the repo's error contract), not 400.
    const zero = await request(app)
      .post(`/api/rehabs/${rehabA}/holding-entries`)
      .send({ entryDate: "2026-10-17", category: "other", amountCents: 0 });
    expect(zero.status, JSON.stringify(zero.body)).toBe(422);

    const detail = await request(app).get(`/api/rehabs/${rehabA}`).expect(200);
    const holding = detail.body.timeline.holding;
    expect(holding.scenario).toEqual({
      holdMonths: 6,
      monthlyHoldingCostCents: 120_000,
      assumedTotalCents: 720_000,
      holdMonthsOrigin: "user",
      monthlyOrigin: "platform-default",
    });
    expect(holding.actuals.entriesTotalCents).toBe(750_000);
    expect(holding.disagreement.spendPastScenario).toBe(true);
    expect(detail.body.timeline.holdingEntries).toHaveLength(3);

    // Rendering wrote nothing: the frozen forecast is byte-identical.
    const [after] = await q<{ inputs_text: string; assumptions_text: string }>(
      "SELECT inputs::text AS inputs_text, assumptions::text AS assumptions_text FROM scenarios WHERE id = $1",
      scenario.id,
    );
    expect(after.inputs_text).toBe(scenario.inputs_text);
    expect(after.assumptions_text).toBe(scenario.assumptions_text);
  });

  it("5. cross-tenant: org B's writes and reads on org A's rehab are 404s, with nothing written", async () => {
    const app = await appFor(orgB);
    const baselinesBefore = await baselineCount();
    const entriesBefore = await entryCount();

    expect((await request(app).post(`/api/rehabs/${rehabA}/baselines`).send({ plannedHoldMonths: 2 })).status).toBe(404);
    expect((await request(app).post(`/api/rehabs/${rehabA}/holding-entries`).send({ entryDate: "2026-10-01", category: "taxes", amountCents: 100 })).status).toBe(404);
    expect((await request(app).get(`/api/rehabs/${rehabA}`)).status).toBe(404);
    // The app for the OTHER org still sees its own rehab (a sanity check that the 404 is tenancy, not a broken mount).
    expect((await request(app).get(`/api/rehabs/${rehabB}`)).status).toBe(200);

    expect(await baselineCount()).toBe(baselinesBefore);
    expect(await entryCount()).toBe(entriesBefore);
  });
});
