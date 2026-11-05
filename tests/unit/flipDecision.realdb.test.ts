/**
 * POST /api/fix-and-flip/decide against a REAL database built from this
 * repository (fix-and-flip package, Leg 1, §8.1). Every claim is read back from
 * `scenarios` and `decision_snapshots`, not from the response.
 *
 *   1. happy path: one scenario + one decision citing it, both fix_and_flip,
 *      the ARV row id + low/mid/high + comp count + the rules' provenance frozen
 *      in the scenario's assumptions, metrics = a direct computeMao run;
 *   2. preview ≡ record: the analyzer's /mao screen and the recorded scenario
 *      agree for identical inputs;
 *   3. ownership guard: a fix_and_flip decision on an engine that does not
 *      declare the pack writes nothing; the body cannot steer engine or pack;
 *   4. SOW-source truth: with a rehab project, the estimate IS the line-budget
 *      sum, naming the rehab; a typed number that disagrees is refused; without
 *      one, it is labelled operator-stated; later line edits and a newer ARV
 *      calculation do not move the frozen evidence;
 *   5. null-profit honesty: holding cost unset → profit recorded as null, with
 *      the exclusion named, through the API;
 *   6. screen vs decision: a /mao run is labelled a screen and records nothing;
 *      the decision's metrics carry the net model, never the 70%-rule line;
 *   7. body discipline + cross-tenant.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("flipDecision.realdb.test.ts");

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/auth", () => ({ isAuthenticated: (_r: unknown, _s: unknown, next: () => void) => next() }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({ getOrCreateOrg: (_r: unknown, _s: unknown, next: () => void) => next() }));

const tag = `ffd-${Math.random().toString(36).slice(2, 10)}`;
const USER_ID = `${tag}-user`;
let orgA = 0;
let orgB = 0;
let propA = 0; // has a saved ARV calculation, no rehab project
let propS = 0; // has a rehab project with priced scope lines
let propB = 0; // org B's
let arvRowId = "";
let rehabId = "";

/** Holding cost SET, so profit is computable; every other rule is the platform default. */
const RULES_WITH_HOLDING = { monthlyHoldingCostCents: 150_000 };

async function appFor(organizationId: number, flipRules: Record<string, number> | null = RULES_WITH_HOLDING) {
  const { default: flipDecision } = await import("../../server/routes-flip-decision");
  const { registerFlipAnalyzerRoutes } = await import("../../server/routes-flip-analyzer");
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => {
    req.organization = { id: organizationId, underwritingDefaults: flipRules ? { flip: flipRules } : null };
    req.organizationId = organizationId;
    req.user = { id: USER_ID };
    next();
  });
  a.use("/api/fix-and-flip", flipDecision);
  registerFlipAnalyzerRoutes(a);
  return a;
}

const future = () => new Date(Date.now() + 14 * 86_400_000).toISOString();
const decide = (propertyId: number, over: Record<string, unknown> = {}) => ({
  propertyId,
  arv: { source: "calculation" },
  operatorRehabEstimateCents: 4_000_000,
  purchasePriceCents: 15_000_000,
  kind: "acquire",
  choice: "Acquire at $150,000",
  rationale: "Net margin clears our floor on our own scope.",
  reviewDueAt: future(),
  ...over,
});

async function rows(organizationId: number) {
  const { db } = await import("../../server/db");
  const { sql } = await import("drizzle-orm");
  const s = await db.execute(sql`SELECT * FROM scenarios WHERE organization_id = ${organizationId} ORDER BY id`);
  const d = await db.execute(sql`SELECT * FROM decision_snapshots WHERE organization_id = ${organizationId} ORDER BY id`);
  return {
    scenarios: (s as unknown as { rows: Array<Record<string, any>> }).rows,
    decisions: (d as unknown as { rows: Array<Record<string, any>> }).rows,
  };
}
async function clearOrg(organizationId: number) {
  const { db } = await import("../../server/db");
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM decision_snapshots WHERE organization_id = ${organizationId}`);
  await db.execute(sql`DELETE FROM scenarios WHERE organization_id = ${organizationId}`);
}
const assumption = (s: Record<string, any>, key: string) => (s.assumptions as Array<{ key: string; value: unknown; origin: string; basis?: string }>).find((a) => a.key === key);

describe.runIf(realDbAvailable)("flip decision desk — real database", () => {
  beforeAll(async () => {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const { organizations } = await import("@shared/schema");
    const [a] = await db.insert(organizations).values({ name: `${tag}-a`, slug: `${tag}-a`, ownerId: `${tag}-oa` } as never).returning();
    const [b] = await db.insert(organizations).values({ name: `${tag}-b`, slug: `${tag}-b`, ownerId: `${tag}-ob` } as never).returning();
    orgA = a.id;
    orgB = b.id;
    const ins = async (org: number, apn: string) =>
      ((await db.execute(sql`INSERT INTO properties (organization_id, apn, county, state, size_acres, status, address)
        VALUES (${org}, ${apn}, 'Middlesex', 'MA', '0.2', 'prospect', ${`${apn} Elm St`}) RETURNING id`)) as unknown as { rows: Array<{ id: number }> }).rows[0].id;
    propA = await ins(orgA, `${tag}-a`);
    propS = await ins(orgA, `${tag}-s`);
    propB = await ins(orgB, `${tag}-b`);

    const comps = JSON.stringify([
      { address: "1 Comp Rd", soldPriceCents: 29_500_000, soldDate: "2026-09-01", sqft: 1500, finalAdjustedCents: 29_800_000 },
      { address: "2 Comp Rd", soldPriceCents: 30_400_000, soldDate: "2026-08-15", sqft: 1550, finalAdjustedCents: 30_100_000 },
      { address: "3 Comp Rd", soldPriceCents: 31_000_000, soldDate: "2026-07-20", sqft: 1620, finalAdjustedCents: 30_200_000 },
    ]);
    for (const p of [propA, propS]) {
      const r = await db.execute(sql`INSERT INTO arv_calculations (organization_id, property_id, comps_used, arv_low_cents, arv_mid_cents, arv_high_cents, confidence, is_current)
        VALUES (${orgA}, ${p}, ${comps}::jsonb, 29000000, 30000000, 31000000, 'medium', true) RETURNING id`);
      if (p === propA) arvRowId = (r as unknown as { rows: Array<{ id: string }> }).rows[0].id;
    }
    await db.execute(sql`INSERT INTO arv_calculations (organization_id, property_id, comps_used, arv_low_cents, arv_mid_cents, arv_high_cents, is_current)
      VALUES (${orgB}, ${propB}, ${comps}::jsonb, 1, 2, 3, true)`);

    const rh = await db.execute(sql`INSERT INTO rehabs (organization_id, property_id, name, budget_total_cents)
      VALUES (${orgA}, ${propS}, 'Scope fixture', 9999900) RETURNING id`);
    rehabId = (rh as unknown as { rows: Array<{ id: string }> }).rows[0].id;
    for (const [cat, scope, cents] of [["kitchen", "Kitchen refresh", 2_500_000], ["flooring", "LVP throughout", 1_200_000], ["interior_paint", "Repaint", 600_000]] as const) {
      await db.execute(sql`INSERT INTO rehab_line_items (organization_id, rehab_id, category, scope, budget_cents) VALUES (${orgA}, ${rehabId}, ${cat}, ${scope}, ${cents})`);
    }
  });

  afterAll(async () => {
    const { db, pool } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    if (orgA) await db.execute(sql`DELETE FROM organizations WHERE id IN (${orgA}, ${orgB})`);
    await pool.end();
  });

  beforeEach(async () => {
    await clearOrg(orgA);
    await clearOrg(orgB);
  });

  it("1. records one flip_mao scenario and one fix_and_flip decision citing it, with the ARV evidence and the rules' provenance", async () => {
    const res = await request(await appFor(orgA)).post("/api/fix-and-flip/decide").send(decide(propA));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.recordKind).toBe("decision");
    const { scenarios, decisions } = await rows(orgA);
    expect(scenarios).toHaveLength(1);
    expect(decisions).toHaveLength(1);
    const [s] = scenarios;
    const [d] = decisions;
    expect(s).toMatchObject({ engine_id: "flip_mao", strategy_pack_id: "fix_and_flip", subject_id: propA });
    expect(d).toMatchObject({ strategy_pack_id: "fix_and_flip", kind: "acquire", authority: "org_member:flip_decide", rationale: "Net margin clears our floor on our own scope." });
    expect(d.scenarios).toHaveLength(1);
    expect(d.scenarios[0]).toMatchObject({ scenarioId: s.id, engineId: "flip_mao" });

    // The ARV evidence, frozen: the row id and its headline figures.
    expect(assumption(s, "arv_source")?.value).toBe("calculation");
    expect(assumption(s, "arv_calculation_id")?.value).toBe(arvRowId);
    expect(assumption(s, "arv_low_cents")?.value).toBe(29_000_000);
    expect(assumption(s, "arv_mid_cents")?.value).toBe(30_000_000);
    expect(assumption(s, "arv_high_cents")?.value).toBe(31_000_000);
    expect(assumption(s, "arv_comp_count")?.value).toBe(3);
    expect(assumption(s, "arv_comp_source")?.value).toBe("not recorded");
    expect(assumption(s, "rehab_source")?.value).toBe("operator_stated");
    // The rules' provenance, field by field: the one the org set is the
    // operator's; the rest say platform default on their face.
    expect(assumption(s, "holdingCost")?.origin).toBe("user");
    expect(assumption(s, "maoRulePct")?.origin).toBe("platform-default");

    const { computeMao, resolveFlipDefaults } = await import("../../server/services/flipUnderwriting");
    const r = computeMao({ arvCents: 30_000_000, rehabEstimateCents: 4_000_000, purchasePriceCents: 15_000_000, feeCents: 0, defaults: resolveFlipDefaults(RULES_WITH_HOLDING).values });
    const m = Object.fromEntries((s.metrics as Array<{ id: string; value: number | null }>).map((x) => [x.id, x.value]));
    expect(m).toEqual({
      max_allowable_offer: r.maoCents,
      rehab_with_contingency: r.rehabWithContingencyCents,
      total_cost: r.totalCashInCents,
      profit: r.netProfitCents,
      roi: r.netRoiPct === null ? null : r.netRoiPct / 100,
    });
    expect(r.netProfitCents).not.toBeNull(); // vacuity: holding is set, so profit is real
  });

  it("2. preview ≡ record: the analyzer's /mao screen and the recorded scenario agree", async () => {
    const app = await appFor(orgA);
    const screen = await request(app).post("/api/flip-analyzer/mao").send({ propertyId: propA, arvCents: 30_000_000, rehabEstimateCents: 4_000_000, purchasePriceCents: 15_000_000, feeCents: 0 });
    expect(screen.status).toBe(200);
    await request(app).post("/api/fix-and-flip/decide").send(decide(propA)).expect(200);
    const [s] = (await rows(orgA)).scenarios;
    const m = Object.fromEntries((s.metrics as Array<{ id: string; value: number | null }>).map((x) => [x.id, x.value]));
    expect(m.max_allowable_offer).toBe(screen.body.maoCents);
    expect(m.rehab_with_contingency).toBe(screen.body.rehabWithContingencyCents);
    expect(m.total_cost).toBe(screen.body.totalCashInCents);
    expect(m.profit).toBe(screen.body.netProfitCents);
    // The same rule assumptions, with the same provenance.
    for (const a of screen.body.assumptions as Array<{ key: string; display: string; source: string }>) {
      expect(assumption(s, a.key), a.key).toMatchObject({ value: a.display, origin: a.source === "org_rule" ? "user" : "platform-default" });
    }
  });

  it("3. ownership guard: a fix_and_flip decision on an engine that does not declare it writes nothing, and the body cannot steer it", async () => {
    const { recordUnderwrittenDecision } = await import("../../server/services/underwriting/verticalDecision");
    await expect(
      recordUnderwrittenDecision(orgA, {
        subjectType: "property",
        subjectId: propA,
        engineId: "rental_acquisition",
        strategyPackId: "fix_and_flip",
        inputs: { purchasePriceCents: 1, monthlyRentCents: 1, vacancyPct: 1, monthlyFixedExpensesCents: 1, managementPct: 1, reservesPct: 1 },
        scenarioLabel: "engineered",
        kind: "acquire",
        choice: "x",
        rationale: "engineered to cross verticals",
        actorRef: USER_ID,
        authority: "org_member:flip_decide",
        reviewDueAt: null,
      }),
    ).rejects.toThrow(/does not underwrite fix_and_flip/);
    let r = await rows(orgA);
    expect(r.scenarios).toHaveLength(0);
    expect(r.decisions).toHaveLength(0);

    const res = await request(await appFor(orgA))
      .post("/api/fix-and-flip/decide")
      .send(decide(propA, { engineId: "rental_acquisition", strategyPackId: "buy_and_hold", inputs: { arvCents: 1 } }));
    expect(res.status).toBe(200);
    r = await rows(orgA);
    expect(r.scenarios.map((s) => [s.engine_id, s.strategy_pack_id])).toEqual([["flip_mao", "fix_and_flip"]]);
    expect(r.scenarios[0].inputs.arvCents).toBe(30_000_000); // the row's mid, not the body's
  });

  it("4. with a rehab project, the estimate IS the scope total (not the budget header), and it stays frozen", async () => {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const app = await appFor(orgA);
    // A typed number that disagrees with the scope is refused, naming the total.
    const typed = await request(app).post("/api/fix-and-flip/decide").send(decide(propS, { operatorRehabEstimateCents: 9_999_900 }));
    expect(typed.status).toBe(400);
    expect(typed.body.message).toMatch(/\$43,000/);
    expect((await rows(orgA)).scenarios).toHaveLength(0);

    const { operatorRehabEstimateCents: _omit, ...noTyped } = decide(propS);
    const res = await request(app).post("/api/fix-and-flip/decide").send(noTyped);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const before = await rows(orgA);
    const [s] = before.scenarios;
    expect(s.inputs.rehabEstimateCents).toBe(4_300_000); // 25k + 12k + 6k, not the 99,999 header
    expect(assumption(s, "rehab_source")?.value).toBe("sow");
    expect(assumption(s, "rehab_id")?.value).toBe(rehabId);
    expect(assumption(s, "rehab_sow_line_count")?.value).toBe(3);
    expect(assumption(s, "rehab_sow_total_cents")?.value).toBe(4_300_000);

    // Later: a line is re-priced and a newer ARV calculation supersedes the old.
    await db.execute(sql`UPDATE rehab_line_items SET budget_cents = 9000000 WHERE rehab_id = ${rehabId} AND category = 'kitchen'`);
    await db.execute(sql`UPDATE arv_calculations SET is_current = false WHERE property_id = ${propS}`);
    await db.execute(sql`INSERT INTO arv_calculations (organization_id, property_id, arv_low_cents, arv_mid_cents, arv_high_cents) VALUES (${orgA}, ${propS}, 1, 2, 3)`);
    expect(JSON.stringify(await rows(orgA))).toBe(JSON.stringify(before));
    await db.execute(sql`UPDATE rehab_line_items SET budget_cents = 2500000 WHERE rehab_id = ${rehabId} AND category = 'kitchen'`);
    await db.execute(sql`DELETE FROM arv_calculations WHERE property_id = ${propS} AND arv_mid_cents = 2`);
    await db.execute(sql`UPDATE arv_calculations SET is_current = true WHERE property_id = ${propS}`);
  });

  it("4b. without a project the rehab is operator-stated; with no estimate at all it refuses", async () => {
    const app = await appFor(orgA);
    const { operatorRehabEstimateCents: _o, ...none } = decide(propA);
    const refused = await request(app).post("/api/fix-and-flip/decide").send(none);
    expect(refused.status).toBe(400);
    expect((await rows(orgA)).scenarios).toHaveLength(0);
    await request(app).post("/api/fix-and-flip/decide").send(decide(propA, { arv: { source: "operator_stated", arvCents: 28_000_000 } })).expect(200);
    const [s] = (await rows(orgA)).scenarios;
    expect(assumption(s, "rehab_source")).toMatchObject({ value: "operator_stated", origin: "user" });
    expect(assumption(s, "arv_source")).toMatchObject({ value: "operator_stated", origin: "user" });
    expect(assumption(s, "arv_calculation_id")).toBeUndefined();
    expect(s.inputs.arvCents).toBe(28_000_000);
  });

  it("5. holding cost unset → profit is recorded as null with the exclusion named, never zero", async () => {
    const res = await request(await appFor(orgA, null)).post("/api/fix-and-flip/decide").send(decide(propA));
    expect(res.status).toBe(200);
    const profit = (res.body.metrics as Array<{ id: string; value: number | null }>).find((m) => m.id === "profit");
    expect(profit).toEqual(expect.objectContaining({ value: null }));
    const [s] = (await rows(orgA)).scenarios;
    expect((s.metrics as Array<{ id: string; value: number | null }>).find((m) => m.id === "profit")?.value).toBeNull();
    const holding = assumption(s, "holdingCost");
    expect(holding?.origin).toBe("platform-default");
    expect(`${holding?.value} ${holding?.basis}`).toMatch(/not set|excluded|unset/i);
  });

  it("6. a /mao run is a screen: labelled so, and it records nothing; a decision never headlines the 70%-rule line", async () => {
    const screen = await request(await appFor(orgA)).post("/api/flip-analyzer/mao").send({ propertyId: propA, arvCents: 30_000_000, rehabEstimateCents: 4_000_000 });
    expect(screen.status).toBe(200);
    expect(screen.body.recordKind).toBe("screen");
    expect(screen.body.decisionId).toBeUndefined();
    let r = await rows(orgA);
    expect(r.scenarios).toHaveLength(0);
    expect(r.decisions).toHaveLength(0);
    await request(await appFor(orgA)).post("/api/fix-and-flip/decide").send(decide(propA)).expect(200);
    r = await rows(orgA);
    const ids = (r.scenarios[0].metrics as Array<{ id: string }>).map((m) => m.id);
    expect(ids).toEqual(["max_allowable_offer", "rehab_with_contingency", "total_cost", "profit", "roi"]);
    expect(JSON.stringify(r.scenarios[0].metrics)).not.toMatch(/rule/i);
  });

  it("7. body discipline: review date required-nullable and future-only; kinds bounded; nothing written on refusal", async () => {
    const app = await appFor(orgA);
    const { reviewDueAt: _r, ...unanswered } = decide(propA);
    for (const [label, body] of [
      ["missing reviewDueAt", unanswered],
      ["past reviewDueAt", decide(propA, { reviewDueAt: new Date(Date.now() - 86_400_000).toISOString() })],
      ["unknown kind", decide(propA, { kind: "dispose" })],
      ["short rationale", decide(propA, { rationale: "too short" })],
      ["no arv source", decide(propA, { arv: { source: "guess" } })],
    ] as const) {
      const res = await request(app).post("/api/fix-and-flip/decide").send(body);
      expect(res.status, label).toBeGreaterThanOrEqual(400);
      expect(res.status, label).toBeLessThan(500);
    }
    expect((await rows(orgA)).scenarios).toHaveLength(0);
    await request(app).post("/api/fix-and-flip/decide").send(decide(propA, { reviewDueAt: null })).expect(200);
    expect((await rows(orgA)).decisions[0].review_due_at).toBeNull();
  });

  it("7b. cross-tenant: org B's property posted by org A is a 404 with nothing written for either", async () => {
    const res = await request(await appFor(orgA)).post("/api/fix-and-flip/decide").send(decide(propB));
    expect(res.status).toBe(404);
    for (const org of [orgA, orgB]) {
      const r = await rows(org);
      expect(r.scenarios).toHaveLength(0);
      expect(r.decisions).toHaveLength(0);
    }
    // Positive control: org B on its own property gets past tenancy.
    const own = await request(await appFor(orgB)).post("/api/fix-and-flip/decide").send(decide(propB));
    expect(own.status, JSON.stringify(own.body)).toBe(200);
  });
});
