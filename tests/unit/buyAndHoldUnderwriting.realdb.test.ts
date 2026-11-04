/**
 * POST /api/buy-and-hold/underwrite against a REAL database built from this
 * repository — the falsifying half of the buy-and-hold release
 * (claude-package buy-and-hold 2026-11, §8.1). The mocked route test
 * (buyAndHoldUnderwritingRoute.test.ts) proves the body discipline and the
 * call shape; a mock cannot prove what the two stores actually hold afterwards,
 * so every claim below is read back from `scenarios` and `decision_snapshots`.
 *
 *   1. happy path: exactly one scenario + one decision, the decision cites the
 *      scenario, both under `buy_and_hold`, and the response's metrics equal a
 *      direct engine computation on the same inputs;
 *   2. preview ≡ record: /api/scenarios/preview shows the operator exactly the
 *      metrics and assumptions that get frozen;
 *   3. ownership guard (evidence rule v2): a buy_and_hold decision on an engine
 *      that does not declare the pack is refused before ANY write, and a body
 *      that names another engine cannot steer the route off its literal one;
 *   4. cross-tenant: org B's property posted by org A is a 404 with nothing
 *      written for either org;
 *   6. assumption declaration: omitted closing costs, rehab and financing come
 *      back as exactly the engine's three declared platform-default
 *      assumptions, each with a basis; a fully specified set declares none;
 *   7. freeze integrity: mutating the property row and the caller's inputs
 *      afterwards changes nothing stored, the stored inputs reproduce the
 *      stored metrics byte-for-byte, and neither store exports an update path.
 *
 * Every run uses its own synthetic orgs (tagged, random) — no real customer.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("buyAndHoldUnderwriting.realdb.test.ts");

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const tag = `bnh-${Math.random().toString(36).slice(2, 10)}`;
const USER_ID = `${tag}-user`;
let orgA = 0;
let orgB = 0;
let propA = 0;
let propB = 0;

const FULL = {
  purchasePriceCents: 20_000_000,
  closingCostsCents: 400_000,
  rehabCents: 1_500_000,
  monthlyRentCents: 200_000,
  vacancyPct: 5,
  monthlyFixedExpensesCents: 50_000,
  managementPct: 8,
  reservesPct: 10,
  downPaymentPct: 25,
  interestRatePct: 7,
  amortizationYears: 30,
};
// Required fields only: no closing costs, no rehab, no financing.
const BARE = {
  purchasePriceCents: 20_000_000,
  monthlyRentCents: 200_000,
  vacancyPct: 5,
  monthlyFixedExpensesCents: 50_000,
  managementPct: 8,
  reservesPct: 10,
};
const future = () => new Date(Date.now() + 14 * 86_400_000).toISOString();
const decideBody = (propertyId: number, inputs: Record<string, number>) => ({
  propertyId,
  inputs,
  kind: "acquire",
  choice: "Buy and hold at $200,000",
  rationale: "Cash flow clears our floor at this price.",
  reviewDueAt: future(),
});

async function appFor(organizationId: number) {
  const { default: bnh } = await import("../../server/routes-buy-and-hold-underwriting");
  const { default: scenariosRouter } = await import("../../server/routes-scenarios");
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => {
    req.organization = { id: organizationId };
    req.organizationId = organizationId;
    req.user = { id: USER_ID };
    next();
  });
  a.use("/api/buy-and-hold", bnh);
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

describe.runIf(realDbAvailable)("buy-and-hold underwriting — real database", () => {
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
      VALUES (${orgA}, ${`${tag}-apn-a`}, 'Middlesex', 'MA', '0.2', 'prospect', '1 Elm St') RETURNING id`);
    const pb = await db.execute(sql`
      INSERT INTO properties (organization_id, apn, county, state, size_acres, status, address)
      VALUES (${orgB}, ${`${tag}-apn-b`}, 'Worcester', 'MA', '0.2', 'prospect', '9 Oak St') RETURNING id`);
    propA = (pa as unknown as { rows: Array<{ id: number }> }).rows[0].id;
    propB = (pb as unknown as { rows: Array<{ id: number }> }).rows[0].id;
  });

  afterAll(async () => {
    const { db, pool } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    if (orgA) await db.execute(sql`DELETE FROM organizations WHERE id IN (${orgA}, ${orgB})`);
    await pool.end();
  });

  it("1. writes exactly one scenario and one decision citing it, both buy_and_hold; metrics = the engine's", async () => {
    await clearOrg(orgA);
    const res = await request(await appFor(orgA)).post("/api/buy-and-hold/underwrite").send(decideBody(propA, FULL));
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const { scenarios, decisions } = await rows(orgA);
    expect(scenarios).toHaveLength(1);
    expect(decisions).toHaveLength(1);
    const [s] = scenarios;
    const [d] = decisions;
    expect(s).toMatchObject({ id: res.body.scenarioId, engine_id: "rental_acquisition", strategy_pack_id: "buy_and_hold", subject_type: "property", subject_id: propA });
    expect(d).toMatchObject({ id: res.body.decisionId, strategy_pack_id: "buy_and_hold", kind: "acquire", subject_id: propA });
    // The decision cites THIS scenario — read from the frozen row, not the response.
    expect(JSON.stringify(d)).toContain(String(s.id));
    expect(new Date(d.review_due_at).getTime()).toBeGreaterThan(Date.now());

    const { computeScenario } = await import("@shared/economics/scenario");
    const { ALL_ENGINES } = await import("../../server/services/economics/engines");
    const direct = computeScenario({ subjectType: "property", subjectId: propA, label: "direct", engineId: "rental_acquisition", inputs: FULL }, ALL_ENGINES);
    expect(res.body.metrics).toEqual(direct.metrics);
    expect(s.metrics).toEqual(direct.metrics);
    // Vacuity: the engine actually produced its twelve numbers.
    expect(direct.metrics.length).toBe(12);
  });

  it("2. preview ≡ record: what the operator saw is what got frozen", async () => {
    await clearOrg(orgA);
    const app = await appFor(orgA);
    const prev = await request(app).post("/api/scenarios/preview").send({ engineId: "rental_acquisition", inputs: BARE });
    expect(prev.status, JSON.stringify(prev.body)).toBe(200);
    const rec = await request(app).post("/api/buy-and-hold/underwrite").send(decideBody(propA, BARE));
    expect(rec.status).toBe(200);
    const [s] = (await rows(orgA)).scenarios;
    expect(s.metrics).toEqual(prev.body.metrics);
    expect(s.assumptions).toEqual(prev.body.assumptions);
    expect(prev.body.assumptions.length).toBeGreaterThan(0);
  });

  it("3. ownership guard: a buy_and_hold decision on an engine that does not declare it writes nothing", async () => {
    await clearOrg(orgA);
    const { recordUnderwrittenDecision } = await import("../../server/services/underwriting/verticalDecision");
    await expect(
      recordUnderwrittenDecision(orgA, {
        subjectType: "property",
        subjectId: propA,
        engineId: "flip_mao",
        strategyPackId: "buy_and_hold",
        inputs: BARE,
        scenarioLabel: "engineered",
        kind: "acquire",
        choice: "x",
        rationale: "engineered to cross verticals",
        actorRef: USER_ID,
        authority: "org_member:buy_and_hold_underwrite",
        reviewDueAt: null,
      }),
    ).rejects.toThrow(/does not underwrite buy_and_hold/);
    let r = await rows(orgA);
    expect(r.scenarios).toHaveLength(0);
    expect(r.decisions).toHaveLength(0);

    // And the route cannot be steered: an engineId in the body is not read.
    const res = await request(await appFor(orgA))
      .post("/api/buy-and-hold/underwrite")
      .send({ ...decideBody(propA, FULL), engineId: "flip_mao", strategyPackId: "fix_and_flip" });
    expect(res.status).toBe(200);
    r = await rows(orgA);
    expect(r.scenarios.map((s) => [s.engine_id, s.strategy_pack_id])).toEqual([["rental_acquisition", "buy_and_hold"]]);
    expect(r.decisions.map((d) => d.strategy_pack_id)).toEqual(["buy_and_hold"]);
  });

  it("4. cross-tenant: org B's property posted by org A is a 404 and nothing is written for either", async () => {
    await clearOrg(orgA);
    await clearOrg(orgB);
    const res = await request(await appFor(orgA)).post("/api/buy-and-hold/underwrite").send(decideBody(propB, FULL));
    expect(res.status).toBe(404);
    for (const org of [orgA, orgB]) {
      const r = await rows(org);
      expect(r.scenarios).toHaveLength(0);
      expect(r.decisions).toHaveLength(0);
    }
    // Positive control: org B posting its own property succeeds, so the 404 is tenancy, not a broken fixture.
    const own = await request(await appFor(orgB)).post("/api/buy-and-hold/underwrite").send(decideBody(propB, FULL));
    expect(own.status).toBe(200);
    await clearOrg(orgB);
  });

  it("6. omitted closing costs, rehab and financing are DECLARED — three platform-default assumptions with a basis; a full set declares none", async () => {
    await clearOrg(orgA);
    const app = await appFor(orgA);
    await request(app).post("/api/buy-and-hold/underwrite").send(decideBody(propA, BARE)).expect(200);
    await request(app).post("/api/buy-and-hold/underwrite").send(decideBody(propA, FULL)).expect(200);
    const [bare, full] = (await rows(orgA)).scenarios;
    expect(bare.assumptions).toHaveLength(3);
    for (const a of bare.assumptions as Array<{ origin: string; basis?: string }>) {
      expect(a.origin).toBe("platform-default");
      expect((a.basis ?? "").length).toBeGreaterThan(20);
    }
    // All-cash is declared, and its consequence is visible: no DSCR, never a fake one.
    expect(JSON.stringify(bare.assumptions)).toMatch(/all cash/i);
    expect((bare.metrics as Array<{ id: string; value: number | null }>).find((m) => m.id === "dscr")?.value).toBeNull();
    expect(full.assumptions).toEqual([]);
  });

  it("7. freeze integrity: later edits to the property and the inputs change nothing stored", async () => {
    await clearOrg(orgA);
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const inputs = { ...FULL };
    const res = await request(await appFor(orgA)).post("/api/buy-and-hold/underwrite").send(decideBody(propA, inputs));
    expect(res.status).toBe(200);
    const before = await rows(orgA);

    inputs.purchasePriceCents = 1;
    inputs.monthlyRentCents = 999_999_999;
    await db.execute(sql`UPDATE properties SET address = '2 Changed Rd', purchase_price = '1' WHERE id = ${propA}`);

    const after = await rows(orgA);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    const [s] = after.scenarios;
    expect(s.inputs.purchasePriceCents).toBe(FULL.purchasePriceCents);

    // The stored inputs reproduce the stored metrics byte-for-byte.
    const { computeScenario } = await import("@shared/economics/scenario");
    const { ALL_ENGINES } = await import("../../server/services/economics/engines");
    const again = computeScenario({ subjectType: "property", subjectId: propA, label: "re-read", engineId: s.engine_id, inputs: s.inputs }, ALL_ENGINES);
    expect(again.engineVersion).toBe(s.engine_version);
    // jsonb normalises key order, so compare canonical serialisations: every
    // id, unit and value identical, in the same metric order.
    const canon = (v: unknown): string =>
      JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
    expect(canon(again.metrics)).toBe(canon(s.metrics));
    expect(again.metrics).toStrictEqual(s.metrics);

    // Neither store exports a path that could edit a frozen row.
    const scenarioStore = await import("../../server/services/economics/scenarioStore");
    const decisionStore = await import("../../server/services/decisions/decisionStore");
    const mutators = [...Object.keys(scenarioStore), ...Object.keys(decisionStore)].filter((k) => /update|delete|remove|edit|patch|set[A-Z]/i.test(k));
    expect(mutators).toEqual([]);
    expect(Object.keys(scenarioStore)).toContain("recordScenario"); // vacuity: the module was read
    expect(Object.keys(decisionStore)).toContain("recordDecision");
  });
});
