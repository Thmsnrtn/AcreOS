/**
 * Rehab exit-decision and realized-economics routes against a REAL database
 * (fix-and-flip package, Leg 4, §8.3 #14).
 *
 *   - The exit decision is refused before the listing; at listing it is recorded
 *     through the decision store (a decision_snapshots row, strategy pack
 *     fix_and_flip) and mints NO scenario. It surfaces as due once its review
 *     date passes. A hold exit writes nothing beyond that one snapshot.
 *   - Realized facts are written once, at close, and graded against the frozen
 *     flip_mao scenario. The deltas are hand-computed here from the fixture
 *     constants — never by re-calling gradeRealized.
 *   - Cross-tenant: another org's exit and realized POSTs are 404s, with
 *     nothing written.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("rehabExitRealizedRoutes.realdb.test.ts");

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/auth", () => ({ isAuthenticated: (_r: unknown, _s: unknown, next: () => void) => next() }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({ getOrCreateOrg: (_r: unknown, _s: unknown, next: () => void) => next() }));

const tag = `ex-${Math.random().toString(36).slice(2, 10)}`;
let orgA = 0;
let orgB = 0;
let propA = 0;
let propB = 0;
let rehabA = "";
let rehabB = "";

// ── The fixture, hand-computed ─────────────────────────────────────────────
const PURCHASE = 12_000_000;
const REHAB_SPENT = 6_000_000;
const HOLDING = 900_000;
const STARTED = "2025-10-01";
const SALE = 30_000_000;
const SELLING = 1_500_000;
const CLOSING = "2026-03-31";
const SC_ARV = 32_000_000;
const SC_PROFIT = 8_000_000;
const SC_ROI = 0.4;
const SC_HOLD_MONTHS = 5;
// Oct 1 2025 → Mar 31 2026
const HOLD_DAYS = 181;
const NET = SALE - SELLING - PURCHASE - REHAB_SPENT - HOLDING; // 9_600_000
const INVESTED = PURCHASE + REHAB_SPENT + HOLDING; // 18_900_000

async function appFor(organizationId: number, opts: { decisions?: boolean } = {}) {
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => {
    req.organization = { id: organizationId };
    req.organizationId = organizationId;
    req.user = { id: `${tag}-user` };
    next();
  });
  if (opts.decisions) {
    // Mounted as server/routes.ts mounts it: app.use('/api/decisions', …, decisionsRouter).
    const { default: decisionsRouter } = await import("../../server/routes-decisions");
    a.use("/api/decisions", decisionsRouter);
  } else {
    const { registerRehabRoutes } = await import("../../server/routes-rehabs");
    registerRehabRoutes(a);
  }
  return a;
}
async function q<T = Record<string, any>>(text: string, ...vals: unknown[]): Promise<T[]> {
  const { pool } = await import("../../server/db");
  return (await pool.query(text, vals)).rows as T[];
}
const count = async (text: string, ...vals: unknown[]) => Number((await q<{ c: string }>(text, ...vals))[0].c);
const scenarioCount = () => count("SELECT COUNT(*) AS c FROM scenarios WHERE organization_id = $1", orgA);
const snapshotCount = () => count("SELECT COUNT(*) AS c FROM decision_snapshots WHERE organization_id = $1 AND subject_id = $2", orgA, propA);
const outcomeCount = () => count("SELECT COUNT(*) AS c FROM outcomes WHERE organization_id = $1", orgA);
const holdingCount = () => count("SELECT COUNT(*) AS c FROM rehab_holding_cost_entries WHERE rehab_id = $1", rehabA);
const rehabRow = async () => (await q<{ j: string }>("SELECT row_to_json(r)::text AS j FROM rehabs r WHERE id = $1", rehabA))[0].j;
const lineRows = async () => (await q<{ j: string }>("SELECT row_to_json(l)::text AS j FROM rehab_line_items l WHERE rehab_id = $1 ORDER BY id", rehabA)).map((r) => r.j);
const realizedColumns = () =>
  q(
    `SELECT realized_sale_price_cents::text AS sale, realized_selling_costs_cents::text AS selling,
            realized_closing_date::text AS closing, realized_recorded_by AS by, realized_recorded_at::text AS at
       FROM rehabs WHERE id = $1`,
    rehabA,
  );
const setStatus = (status: string) => q("UPDATE rehabs SET status = $2 WHERE id = $1", rehabA, status);
const futureIso = () => new Date(Date.now() + 30 * 86_400_000).toISOString();

describe.runIf(realDbAvailable)("rehab exit & realized routes — real database", () => {
  let sellDecisionId = 0;

  beforeAll(async () => {
    const [a] = await q<{ id: number }>("INSERT INTO organizations (name, slug, owner_id) VALUES ($1, $1, $2) RETURNING id", `${tag}-a`, `${tag}-oa`);
    const [b] = await q<{ id: number }>("INSERT INTO organizations (name, slug, owner_id) VALUES ($1, $1, $2) RETURNING id", `${tag}-b`, `${tag}-ob`);
    orgA = a.id;
    orgB = b.id;
    const prop = async (org: number, apn: string) =>
      (await q<{ id: number }>("INSERT INTO properties (organization_id, apn, county, state, size_acres, status) VALUES ($1, $2, 'Middlesex', 'MA', '0.2', 'owned') RETURNING id", org, apn))[0].id;
    propA = await prop(orgA, `${tag}-a`);
    propB = await prop(orgB, `${tag}-b`);

    rehabA = (await q<{ id: string }>(
      "INSERT INTO rehabs (organization_id, property_id, name, started_at, purchase_price_cents) VALUES ($1, $2, 'A', $3, $4) RETURNING id",
      orgA, propA, STARTED, PURCHASE,
    ))[0].id;
    rehabB = (await q<{ id: string }>("INSERT INTO rehabs (organization_id, property_id, name) VALUES ($1, $2, 'B') RETURNING id", orgB, propB))[0].id;

    await q(
      "INSERT INTO rehab_line_items (organization_id, rehab_id, category, scope, budget_cents, spent_cents) VALUES ($1, $2, 'kitchen', 'Kitchen', 5000000, $3)",
      orgA, rehabA, REHAB_SPENT,
    );

    // The recorded flip_mao scenario the exit/realized grading reads.
    await q(
      `INSERT INTO scenarios (organization_id, subject_type, subject_id, label, engine_id, engine_version, strategy_pack_id, inputs, assumptions, metrics)
       VALUES ($1, 'property', $2, 'Flip decision', 'flip_mao', 'flip-mao-1', 'fix_and_flip', $3::jsonb, '[]'::jsonb, $4::jsonb)`,
      orgA,
      propA,
      JSON.stringify({ arvCents: SC_ARV, holdMonths: SC_HOLD_MONTHS }),
      JSON.stringify([
        { id: "profit", value: SC_PROFIT, unit: "cents" },
        { id: "roi", value: SC_ROI, unit: "ratio" },
      ]),
    );
  });

  afterAll(async () => {
    const { pool } = await import("../../server/db");
    if (orgA) await pool.query("DELETE FROM organizations WHERE id = ANY($1)", [[orgA, orgB]]);
    await pool.end();
  });

  it("1. the exit decision is refused before listing, recorded through the decision store at listing, and mints no scenario", async () => {
    const app = await appFor(orgA);
    const body = { exitKind: "sell", expectedPriceCents: 31_000_000, rationale: "Retail buyers dominate this zip.", reviewDueAt: futureIso() };

    for (const status of ["planning", "demo"]) {
      await setStatus(status);
      const refused = await request(app).post(`/api/rehabs/${rehabA}/exit-decision`).send(body);
      expect(refused.status, `${status}: ${JSON.stringify(refused.body)}`).toBe(400);
    }
    expect(await snapshotCount()).toBe(0);

    await setStatus("listed");
    const scenariosBefore = await scenarioCount();
    const ok = await request(app).post(`/api/rehabs/${rehabA}/exit-decision`).send(body);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ kind: "dispose", exitKind: "sell", recordKind: "decision" });
    sellDecisionId = ok.body.decisionId;

    const rows = await q<{ id: number; kind: string; strategy_pack_id: string; assumptions: Array<{ key: string; value: unknown }> }>(
      "SELECT id, kind, strategy_pack_id, assumptions FROM decision_snapshots WHERE organization_id = $1 AND subject_id = $2",
      orgA, propA,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: sellDecisionId, kind: "dispose", strategy_pack_id: "fix_and_flip" });
    expect(rows[0].assumptions.find((a) => a.key === "exit_kind")?.value).toBe("sell");

    // Recording an exit does not run an engine: no scenario is minted.
    expect(await scenarioCount()).toBe(scenariosBefore);

    const detail = (await request(app).get(`/api/rehabs/${rehabA}`).expect(200)).body;
    expect(detail.exit.decisions).toHaveLength(1);
    expect(detail.exit.decisions[0]).toMatchObject({ id: sellDecisionId, exitKind: "sell", kind: "dispose", expectedPriceCents: 31_000_000 });
  });

  it("2. once its review date passes, the exit decision is in /api/decisions/due", async () => {
    // Fixture manipulation only: the route refuses a past review date by design.
    await q("UPDATE decision_snapshots SET review_due_at = now() - interval '1 day' WHERE id = $1 AND organization_id = $2", sellDecisionId, orgA);

    const decisionsApp = await appFor(orgA, { decisions: true });
    const res = await request(decisionsApp).get("/api/decisions/due");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.due.map((d: any) => d.id)).toContain(sellDecisionId);
    expect(res.body.count).toBe(res.body.due.length);

    // Another org's due list never carries it.
    const other = await request(await appFor(orgB, { decisions: true })).get("/api/decisions/due");
    expect(other.body.due.map((d: any) => d.id)).not.toContain(sellDecisionId);
  });

  it("3. a hold exit adds a decision_snapshots row and nothing else anywhere", async () => {
    const app = await appFor(orgA);
    const before = {
      rehab: await rehabRow(),
      lines: await lineRows(),
      scenarios: await scenarioCount(),
      outcomes: await outcomeCount(),
      holding: await holdingCount(),
      snapshots: await snapshotCount(),
    };
    expect(before.outcomes).toBe(0);

    const res = await request(app)
      .post(`/api/rehabs/${rehabA}/exit-decision`)
      .send({ exitKind: "hold", expectedPriceCents: null, rationale: "Rent covers carry; hold for the refi.", reviewDueAt: futureIso() });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ kind: "hold", exitKind: "hold" });

    expect(await snapshotCount()).toBe(before.snapshots + 1);
    const [row] = await q<{ kind: string }>("SELECT kind FROM decision_snapshots WHERE id = $1", res.body.decisionId);
    expect(row.kind).toBe("hold");

    expect(await rehabRow()).toBe(before.rehab);
    expect(await lineRows()).toEqual(before.lines);
    expect(await scenarioCount()).toBe(before.scenarios);
    expect(await outcomeCount()).toBe(0);
    expect(await holdingCount()).toBe(before.holding);

    // Sell wants a price; a hold without one is fine, a sell without one is not.
    const noPrice = await request(app)
      .post(`/api/rehabs/${rehabA}/exit-decision`)
      .send({ exitKind: "sell", expectedPriceCents: null, rationale: "No price stated here.", reviewDueAt: null });
    expect(noPrice.status).toBe(400);
    expect(await snapshotCount()).toBe(before.snapshots + 1);
  });

  it("4. realized facts are written once, at close, and graded against the frozen scenario", async () => {
    const app = await appFor(orgA);
    const facts = { salePriceCents: SALE, sellingCostsCents: SELLING, closingDate: CLOSING };

    // Not closed yet: refused, nothing written.
    const early = await request(app).post(`/api/rehabs/${rehabA}/realized`).send(facts);
    expect(early.status, JSON.stringify(early.body)).toBe(400);
    expect((await realizedColumns())[0].sale).toBeNull();

    // One recorded holding cost, so the net has all three components.
    await request(app)
      .post(`/api/rehabs/${rehabA}/holding-entries`)
      .send({ entryDate: "2026-01-15", category: "taxes", amountCents: HOLDING })
      .expect(200);

    await setStatus("closed");
    const scenariosBefore = await scenarioCount();
    const ok = await request(app).post(`/api/rehabs/${rehabA}/realized`).send(facts);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.realized.grading.realizedNetCents).toBe(NET);

    const detail = (await request(app).get(`/api/rehabs/${rehabA}`).expect(200)).body;
    expect(detail.realized.facts).toMatchObject({ ...facts, recordedBy: `${tag}-user` });
    expect(detail.realized.facts.recordedAt).toBeTruthy();

    // The scenario is echoed as the frozen forecast it graded against.
    expect(detail.realized.scenario).toEqual({
      arvCents: SC_ARV,
      profitCents: SC_PROFIT,
      roiRatio: SC_ROI,
      holdMonths: SC_HOLD_MONTHS,
    });

    const g = detail.realized.grading;
    expect(g.holdDays).toBe(HOLD_DAYS);
    expect(g.netMissing).toEqual([]);
    expect(g.realizedNetCents).toBe(NET);
    expect(g.investedCents).toBe(INVESTED);
    expect(g.investedParts).toEqual({ purchaseCents: PURCHASE, rehabSpentCents: REHAB_SPENT, holdingRecordedCents: HOLDING });
    expect(g.realizedRoiRatio).toBeCloseTo(NET / INVESTED, 10);
    expect(g.deltas.saleVsArvCents).toBe(SALE - SC_ARV); // −2_000_000
    expect(g.deltas.holdDaysVsScenarioDays).toBe(HOLD_DAYS - SC_HOLD_MONTHS * 30); // 31
    expect(g.deltas.netVsScenarioProfitCents).toBe(NET - SC_PROFIT); // 1_600_000
    expect(g.deltas.roiVsScenarioRatio).toBeCloseTo(NET / INVESTED - SC_ROI, 10);

    // Grading wrote no scenario.
    expect(await scenarioCount()).toBe(scenariosBefore);

    // Write-once: a second POST with different numbers is refused and changes nothing.
    const storedBefore = await realizedColumns();
    const second = await request(app)
      .post(`/api/rehabs/${rehabA}/realized`)
      .send({ salePriceCents: 99_000_000, sellingCostsCents: 1, closingDate: "2027-01-01" });
    expect(second.status, JSON.stringify(second.body)).toBe(400);
    expect(await realizedColumns()).toEqual(storedBefore);
    expect(storedBefore[0]).toMatchObject({ sale: String(SALE), selling: String(SELLING), closing: CLOSING });
  });

  it("5. cross-tenant: org B's exit and realized POSTs on org A's rehab are 404s, with nothing written", async () => {
    const appB = await appFor(orgB);
    const snapshotsBefore = await snapshotCount();
    const realizedBefore = await realizedColumns();
    const rehabBefore = await rehabRow();

    const exit = await request(appB)
      .post(`/api/rehabs/${rehabA}/exit-decision`)
      .send({ exitKind: "sell", expectedPriceCents: 1_000_000, rationale: "Cross-tenant attempt.", reviewDueAt: futureIso() });
    expect(exit.status).toBe(404);

    const realized = await request(appB)
      .post(`/api/rehabs/${rehabA}/realized`)
      .send({ salePriceCents: 1, sellingCostsCents: 1, closingDate: "2026-04-01" });
    expect(realized.status).toBe(404);

    // Sanity: B's own rehab answers, so the 404s are tenancy and not a broken mount.
    expect((await request(appB).get(`/api/rehabs/${rehabB}`)).status).toBe(200);

    expect(await snapshotCount()).toBe(snapshotsBefore);
    expect(await count("SELECT COUNT(*) AS c FROM decision_snapshots WHERE organization_id = $1", orgB)).toBe(0);
    expect(await realizedColumns()).toEqual(realizedBefore);
    expect(await rehabRow()).toBe(rehabBefore);
    expect(await q("SELECT realized_sale_price_cents FROM rehabs WHERE id = $1", rehabB)).toEqual([{ realized_sale_price_cents: null }]);
  });
});
