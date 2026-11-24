/**
 * POST /api/wholesale/underwrite against a REAL database built from this
 * repository (Leg 1). The mocked route test proves the body discipline; this
 * proves what the stores hold afterwards. FALSIFYING: on pre-leg main the route
 * module is absent and the kit refuses any residential_wholesaler decision.
 *
 *   1. one scenario + one decision citing it, both residential_wholesaler; the
 *      metrics equal a direct engine run; the comp / ARV / fee evidence is
 *      frozen on the scenario as the operator's own assumptions;
 *   2. preview ≡ record for the numbers;
 *   3. ownership guard: flip_mao under residential_wholesaler writes nothing;
 *      a body naming another engine/pack cannot steer the route;
 *   4. an input the engine refuses (no buyer rule) writes nothing — no default;
 *   5. cross-tenant: org B's property posted by org A is a 404, nothing written.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("wholesaleUnderwriting.realdb.test.ts");

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const tag = `whs-${Math.random().toString(36).slice(2, 10)}`;
const USER_ID = `${tag}-user`;
let orgA = 0;
let orgB = 0;
let propA = 0;
let propB = 0;

const INPUTS = {
  arvCents: 30_000_000,
  rehabEstimateCents: 4_000_000,
  targetFeeCents: 1_000_000,
  sellerRulePct: 75,
  sellerContingencyPct: 10,
  buyerRulePct: 70,
  buyerContingencyPct: 10,
};
const EVIDENCE = {
  comps: [{ address: "12 Oak St", soldPriceCents: 29_500_000, soldOn: "2026-09-14" }],
  arvBasis: "One renovated 3/2 sale two streets over.",
  feeBasis: "My floor for a full-kitchen rehab.",
};
const decideBody = (propertyId: number, inputs: Record<string, number> = INPUTS) => ({
  propertyId,
  inputs,
  evidence: EVIDENCE,
  kind: "offer",
  choice: "Offer up to $156,000 to assign at $10,000",
  rationale: "The buyer's number binds and the fee holds.",
  reviewDueAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
});

async function appFor(organizationId: number) {
  const { default: wholesale } = await import("../../server/routes-wholesale-underwriting");
  const { default: scenariosRouter } = await import("../../server/routes-scenarios");
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => {
    req.organization = { id: organizationId };
    req.organizationId = organizationId;
    req.user = { id: USER_ID };
    next();
  });
  a.use("/api/wholesale", wholesale);
  a.use("/api/scenarios", scenariosRouter);
  return a;
}

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

describe.runIf(realDbAvailable)("wholesale underwriting — real database", () => {
  beforeAll(async () => {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const { organizations } = await import("@shared/schema");
    const [a] = await db.insert(organizations).values({ name: `${tag}-a`, slug: `${tag}-a`, ownerId: `${tag}-oa` } as never).returning();
    const [b] = await db.insert(organizations).values({ name: `${tag}-b`, slug: `${tag}-b`, ownerId: `${tag}-ob` } as never).returning();
    orgA = a.id;
    orgB = b.id;
    const pa = await db.execute(sql`
      INSERT INTO properties (organization_id, apn, county, state, size_acres, status, address)
      VALUES (${orgA}, ${`${tag}-apn-a`}, 'Harris', 'TX', '0.2', 'prospect', '9 Main St') RETURNING id`);
    const pb = await db.execute(sql`
      INSERT INTO properties (organization_id, apn, county, state, size_acres, status, address)
      VALUES (${orgB}, ${`${tag}-apn-b`}, 'Harris', 'TX', '0.2', 'prospect', '3 Pine St') RETURNING id`);
    propA = (pa as unknown as { rows: Array<{ id: number }> }).rows[0].id;
    propB = (pb as unknown as { rows: Array<{ id: number }> }).rows[0].id;
  });

  afterAll(async () => {
    const { db, pool } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    if (orgA) {
      await clearOrg(orgA);
      await clearOrg(orgB);
      await db.execute(sql`DELETE FROM properties WHERE organization_id IN (${orgA}, ${orgB})`);
      await db.execute(sql`DELETE FROM organizations WHERE id IN (${orgA}, ${orgB})`);
    }
    await pool.end();
  });

  it("1. one scenario + one decision citing it; metrics = the engine's; evidence frozen as the operator's", async () => {
    await clearOrg(orgA);
    const res = await request(await appFor(orgA)).post("/api/wholesale/underwrite").send(decideBody(propA));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const { scenarios, decisions } = await rows(orgA);
    expect(scenarios).toHaveLength(1);
    expect(decisions).toHaveLength(1);
    const [s] = scenarios;
    const [d] = decisions;
    expect(s).toMatchObject({ engine_id: "wholesale_mao", strategy_pack_id: "residential_wholesaler", subject_id: propA });
    expect(d).toMatchObject({ strategy_pack_id: "residential_wholesaler", kind: "offer", subject_id: propA });
    expect(d.scenarios).toHaveLength(1);
    expect(d.scenarios[0]).toMatchObject({ scenarioId: s.id, engineId: "wholesale_mao" });
    expect(d.scenarios[0].predicted).toEqual(s.metrics);

    const { computeScenario } = await import("@shared/economics/scenario");
    const { ALL_ENGINES } = await import("../../server/services/economics/engines");
    const direct = computeScenario({ subjectType: "property", subjectId: propA, label: "direct", engineId: "wholesale_mao", inputs: INPUTS }, ALL_ENGINES);
    expect(s.metrics).toEqual(direct.metrics);
    const offer = (s.metrics as Array<{ id: string; value: number }>).find((m) => m.id === "max_allowable_offer")?.value;
    expect(offer).toBe(15_600_000);

    const byKey = Object.fromEntries((s.assumptions as Array<{ key: string }>).map((a) => [a.key, a]));
    expect(byKey.comp_1).toMatchObject({ value: 29_500_000, origin: "user" });
    expect(byKey.arv_basis).toMatchObject({ value: EVIDENCE.arvBasis, origin: "user" });
    expect(byKey.fee_basis).toMatchObject({ value: EVIDENCE.feeBasis, origin: "user" });
    expect(byKey.binding_side).toMatchObject({ value: "buyer", origin: "derived" });
  });

  it("2. preview ≡ record for the numbers", async () => {
    await clearOrg(orgA);
    const app = await appFor(orgA);
    const prev = await request(app).post("/api/scenarios/preview").send({ engineId: "wholesale_mao", inputs: INPUTS });
    expect(prev.status, JSON.stringify(prev.body)).toBe(200);
    await request(app).post("/api/wholesale/underwrite").send(decideBody(propA)).expect(200);
    const [s] = (await rows(orgA)).scenarios;
    expect(s.metrics).toEqual(prev.body.metrics);
  });

  it("3. ownership guard: flip_mao under residential_wholesaler writes nothing; the body cannot steer", async () => {
    await clearOrg(orgA);
    const { recordUnderwrittenDecision } = await import("../../server/services/underwriting/verticalDecision");
    await expect(
      recordUnderwrittenDecision(orgA, {
        subjectType: "property",
        subjectId: propA,
        engineId: "flip_mao",
        strategyPackId: "residential_wholesaler",
        inputs: INPUTS,
        scenarioLabel: "engineered",
        kind: "offer",
        choice: "x",
        rationale: "engineered to cross verticals",
        actorRef: USER_ID,
        authority: "org_member:wholesale_underwrite",
        reviewDueAt: null,
      }),
    ).rejects.toThrow(/does not underwrite residential_wholesaler/);
    expect((await rows(orgA)).scenarios).toHaveLength(0);

    const res = await request(await appFor(orgA))
      .post("/api/wholesale/underwrite")
      .send({ ...decideBody(propA), engineId: "flip_mao", strategyPackId: "fix_and_flip" });
    expect(res.status).toBe(200);
    const r = await rows(orgA);
    expect(r.scenarios.map((s) => [s.engine_id, s.strategy_pack_id])).toEqual([["wholesale_mao", "residential_wholesaler"]]);
  });

  it("4. a missing buyer rule is refused and nothing is written — no default is assumed", async () => {
    await clearOrg(orgA);
    const { buyerRulePct: _omit, ...noBuyerRule } = INPUTS;
    const res = await request(await appFor(orgA)).post("/api/wholesale/underwrite").send(decideBody(propA, noBuyerRule));
    expect(res.status).toBe(400);
    const r = await rows(orgA);
    expect(r.scenarios).toHaveLength(0);
    expect(r.decisions).toHaveLength(0);
  });

  it("5. cross-tenant: org B's property posted by org A is a 404 and nothing is written for either", async () => {
    await clearOrg(orgA);
    await clearOrg(orgB);
    const res = await request(await appFor(orgA)).post("/api/wholesale/underwrite").send(decideBody(propB));
    expect(res.status).toBe(404);
    for (const org of [orgA, orgB]) {
      const r = await rows(org);
      expect(r.scenarios).toHaveLength(0);
      expect(r.decisions).toHaveLength(0);
    }
    const own = await request(await appFor(orgB)).post("/api/wholesale/underwrite").send(decideBody(propB));
    expect(own.status).toBe(200);
  });
});
