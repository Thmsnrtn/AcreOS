/**
 * POST /api/parcels/:id/pricing-rules/lock — the subdivider's decision route.
 *
 * Proves the lock closes the canonical loop with the right identity:
 *   - the grid is written first (the act), then the `subdivision_lot_sale`
 *     scenario under the subdivider pack, then a subdivider decision that CITES
 *     it, with the operator's own review date (or null for "no set date");
 *   - the scenario computes on exactly what the lock froze: every locked lot
 *     price, an operator override included, and the parent's recorded basis;
 *   - with no basis recorded or typed, the scenario declares it and leaves
 *     total cost and profit null — never $0;
 *   - an unanswered or past review date, missing economics, a typed basis that
 *     contradicts the recorded one, and inputs the engine refuses are all
 *     rejected before anything is written;
 *   - every read and write is scoped to the caller's org, in the SQL itself.
 *
 * Hand-computed expectations (fixture below):
 *   lot 101: 2 ac × $30,000 = $60,000, corner +10%      → $66,000
 *   lot 102: 1.5 ac × $30,000 = $45,000, overridden to  → $48,000
 *   gross sell-out = 66,000 + 48,000                    = $114,000
 *   selling (10%)  = $11,400 → net proceeds             = $102,600
 *   total cost     = 40,000 basis + 3,000 survey + 200 × 12 carry = $45,400
 *   profit         = 102,600 − 45,400                   = $57,200
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const ORG_ID = 42;
const USER_ID = "user_owner";
const PARENT_ID = 50;

interface Where {
  table: string;
  fields: string[];
  cond: unknown;
}
interface Update {
  table: string;
  set: Record<string, unknown>;
  cond: unknown;
  inTx: boolean;
}

const h = vi.hoisted(() => ({
  calls: [] as string[],
  wheres: [] as Where[],
  updates: [] as Update[],
  rulesRows: [] as unknown[],
  children: [] as unknown[],
  parentRows: [] as unknown[],
  scenarioReq: null as Record<string, unknown> | null,
  scenarioBody: null as { metrics: Array<{ id: string; value: number | null }>; assumptions: Array<{ key: string; origin: string; basis?: string }> } | null,
  decisionArgs: null as unknown[] | null,
  failScenario: false,
}));

vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: { user?: unknown }, _s: unknown, n: () => void) => {
    req.user = { id: USER_ID };
    n();
  },
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: { organization?: unknown }, _s: unknown, n: () => void) => {
    req.organization = { id: ORG_ID };
    n();
  },
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/db", async () => {
  const { getTableName } = await import("drizzle-orm");
  const select = (fields?: Record<string, unknown>) => ({
    from: (table: Parameters<typeof getTableName>[0]) => ({
      where: (cond: unknown) => {
        const name = getTableName(table);
        const keys = Object.keys(fields ?? {});
        h.wheres.push({ table: name, fields: keys, cond });
        const rows =
          name === "lot_pricing_rules" ? h.rulesRows : keys.includes("childLotNumber") ? h.children : h.parentRows;
        return Object.assign(Promise.resolve(rows), { orderBy: () => Promise.resolve(rows) });
      },
    }),
  });
  const update = (inTx: boolean) => (table: Parameters<typeof getTableName>[0]) => ({
    set: (set: Record<string, unknown>) => ({
      where: (cond: unknown) => {
        h.calls.push(inTx ? "lock-write" : "link-write");
        h.updates.push({ table: getTableName(table), set, cond, inTx });
        return Promise.resolve();
      },
    }),
  });
  return {
    db: {
      select,
      update: update(false),
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        h.calls.push("tx");
        return fn({ update: update(true) });
      },
    },
  };
});

// The store is mocked for persistence only. It still COMPUTES, as the real
// store does (computeScenario over the registry, before the insert), so an
// input set the engine refuses fails here exactly as it would in production.
vi.mock("../../server/services/economics/scenarioStore", async () => {
  const { computeScenario } = await import("../../shared/economics/scenario");
  const { ALL_ENGINES } = await import("../../server/services/economics/engines");
  return {
    recordScenario: vi.fn(async (_org: number, req: Record<string, unknown>) => {
      if (h.failScenario) throw new Error("scenario insert failed");
      const computed = computeScenario(req as never, ALL_ENGINES);
      h.calls.push("scenario");
      h.scenarioReq = req;
      h.scenarioBody = computed as never;
      return { id: 501, computedAt: new Date(0), body: computed };
    }),
  };
});
vi.mock("../../server/services/decisions/decisionStore", () => ({
  recordDecision: vi.fn(async (...args: unknown[]) => {
    h.calls.push("decision");
    h.decisionArgs = args;
    return { id: 901, decidedAt: new Date(0), body: {} };
  }),
}));

const { registerLotPricingRoutes } = await import("../../server/routes-lot-pricing");
const { lotPriceInputKey } = await import("../../shared/calculators/subdivisionLotSale");

function app() {
  const a = express();
  a.use(express.json());
  registerLotPricingRoutes(a);
  return a;
}

const LOCK_URL = `/api/parcels/${PARENT_ID}/pricing-rules/lock`;
const body = {
  overrides: { "102": 4_800_000 },
  economics: {
    sellingCostPct: 10,
    monthsToSellOut: 12,
    surveyCents: 300_000,
    monthlyCarryCents: 20_000,
  },
  // Relative to now, so the fixture never becomes a past date the route refuses.
  reviewDueAt: new Date(Date.now() + 60 * 86_400_000).toISOString(),
};

const metric = (id: string) => h.scenarioBody?.metrics.find((m) => m.id === id)?.value;
const render = (cond: unknown) => new PgDialect().sqlToQuery(cond as SQL);

beforeEach(() => {
  h.calls = [];
  h.wheres = [];
  h.updates = [];
  h.scenarioReq = null;
  h.scenarioBody = null;
  h.decisionArgs = null;
  h.failScenario = false;
  h.rulesRows = [
    {
      id: "rules-1",
      organizationId: ORG_ID,
      parentParcelId: PARENT_ID,
      name: "Standard rural",
      // A fixed $/acre needs no parent load for the base — $30,000/acre.
      basePriceSource: "fixed_per_acre",
      fixedPerAcreCents: 3_000_000,
      rules: [{ attribute: "corner", operator: "==", threshold: true, premiumPct: 0.1, label: "Corner lot" }],
    },
  ];
  h.children = [
    { id: 101, childLotNumber: "1", sizeAcres: "2", zoning: "R", dd: { pricingFacts: { corner: true } } },
    { id: 102, childLotNumber: "2", sizeAcres: "1.5", zoning: "R", dd: null },
  ];
  h.parentRows = [{ purchasePrice: "40000.00" }];
});

describe("POST /api/parcels/:id/pricing-rules/lock", () => {
  it("locks, then records the subdivision_lot_sale scenario, then a subdivider decision citing it", async () => {
    const res = await request(app()).post(LOCK_URL).send(body);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ decisionSnapshotId: 901, scenarioId: 501 });
    // The act first, then the prediction, then the decision, then the link.
    expect(h.calls).toEqual(["tx", "lock-write", "lock-write", "lock-write", "scenario", "decision", "link-write"]);
    expect(h.scenarioReq).toMatchObject({
      engineId: "subdivision_lot_sale",
      strategyPackId: "subdivider",
      strategyPackVersion: null,
      subjectType: "property",
      subjectId: PARENT_ID,
    });
    const [org, decision, , scenarioIds] = h.decisionArgs as [number, Record<string, unknown>, Date, number[]];
    expect(org).toBe(ORG_ID);
    expect(decision).toMatchObject({
      strategyPackId: "subdivider",
      strategyPackVersion: null,
      kind: "price",
      actorType: "user",
      actorRef: USER_ID,
      subjectType: "property",
      subjectId: PARENT_ID,
      authority: "org_member:lot_pricing_lock",
    });
    expect(scenarioIds).toEqual([501]);
    expect(decision.reviewDueAt).toEqual(new Date(body.reviewDueAt));
  });

  it("the scenario computes on exactly what the lock froze", async () => {
    const res = await request(app()).post(LOCK_URL).send(body);
    expect(res.status).toBe(200);
    const frozen = h.updates.find((u) => u.table === "lot_pricing_rules" && u.inTx)!.set.lockedGrid as Array<{
      childParcelId: number;
      askingPriceCents: number;
    }>;
    expect(frozen.map((r) => r.askingPriceCents)).toEqual([6_600_000, 4_800_000]);
    const inputs = h.scenarioReq!.inputs as Record<string, number>;
    for (const row of frozen) expect(inputs[lotPriceInputKey(row.childParcelId)]).toBe(row.askingPriceCents);
    expect(inputs).toMatchObject({
      sellingCostPct: 10,
      monthsToSellOut: 12,
      surveyCents: 300_000,
      monthlyCarryCents: 20_000,
      // The parent's RECORDED purchase price, $40,000.
      parentBasisCents: 4_000_000,
    });
    const basis = h.scenarioBody!.assumptions.find((a) => a.key === "parent_basis");
    expect(basis?.origin).toBe("user");
    expect(basis?.basis).toMatch(/recorded on the parent parcel: \$40,000\.00/);
    expect(metric("gross_sellout")).toBe(11_400_000);
    expect(metric("net_proceeds")).toBe(10_260_000);
    expect(metric("total_cost")).toBe(4_540_000);
    expect(metric("profit")).toBe(5_720_000);
    expect(metric("hold_months")).toBe(12);
    expect(res.body.metrics.find((m: { id: string }) => m.id === "profit")?.value).toBe(5_720_000);
  });

  it("'no set date' is recorded as null — an answer, not a default", async () => {
    const res = await request(app()).post(LOCK_URL).send({ ...body, reviewDueAt: null });
    expect(res.status).toBe(200);
    expect((h.decisionArgs as [number, Record<string, unknown>])[1].reviewDueAt).toBeNull();
  });

  it("an unanswered review date is refused (422) before anything is read or written", async () => {
    const { reviewDueAt: _omit, ...unanswered } = body;
    const res = await request(app()).post(LOCK_URL).send(unanswered);
    expect(res.status).toBe(422);
    expect(h.calls).toEqual([]);
    expect(h.wheres).toEqual([]);
  });

  it("a past review date is refused before anything is written", async () => {
    const res = await request(app())
      .post(LOCK_URL)
      .send({ ...body, reviewDueAt: new Date(Date.now() - 86_400_000).toISOString() });
    expect(res.status).toBe(422);
    expect(h.calls).toEqual([]);
  });

  it("a lock without its economics is refused before anything is written", async () => {
    const { economics: _omit, ...noEconomics } = body;
    const res = await request(app()).post(LOCK_URL).send(noEconomics);
    expect(res.status).toBe(422);
    expect(h.calls).toEqual([]);
  });

  it("inputs the engine refuses are a 400 with its reason, and no list price moves", async () => {
    const res = await request(app())
      .post(LOCK_URL)
      .send({ ...body, economics: { ...body.economics, sellingCostPct: 150 } });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/between 0% and 100%/);
    expect(h.calls).toEqual([]);
  });

  it("a parent with no child lots is refused rather than locked as an empty project", async () => {
    h.children = [];
    const res = await request(app()).post(LOCK_URL).send({ ...body, overrides: {} });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/no lots/);
    expect(h.calls).toEqual([]);
  });
});

describe("the parent's basis is never invented", () => {
  it("none recorded and none typed: the lock is refused — never locked as an ungradeable decision", async () => {
    // REWRITTEN after the V2 audit. This recorded a decision whose total cost
    // and profit were null, so its outcome could never be graded — while the
    // evidence gate certified subdivider gradeable. The engine still declares
    // the basis rather than inventing it (subdivisionLotSaleEngine.test.ts);
    // the LOCK now asks for it instead of recording a decision nobody can grade.
    h.parentRows = [{ purchasePrice: null }];
    const res = await request(app()).post(LOCK_URL).send(body);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/could never be graded/);
    expect(h.calls, "a list price moved or a decision was written").toEqual([]);
  });

  it("none recorded: a basis typed at the lock is used and says where it came from", async () => {
    h.parentRows = [{ purchasePrice: null }];
    const res = await request(app())
      .post(LOCK_URL)
      .send({ ...body, economics: { ...body.economics, parentBasisCents: 3_500_000 } });
    expect(res.status).toBe(200);
    expect(h.scenarioReq!.inputs).toMatchObject({ parentBasisCents: 3_500_000 });
    const basis = h.scenarioBody!.assumptions.find((a) => a.key === "parent_basis");
    expect(basis?.origin).toBe("user");
    expect(basis?.basis).toMatch(/Typed at the lock/);
    // 102,600 − (35,000 + 3,000 + 2,400) = 62,200
    expect(metric("profit")).toBe(6_220_000);
  });

  it("a typed basis that contradicts the recorded one is refused, not silently ignored", async () => {
    const res = await request(app())
      .post(LOCK_URL)
      .send({ ...body, economics: { ...body.economics, parentBasisCents: 1_000_000 } });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/\$40,000\.00/);
    expect(h.calls).toEqual([]);
  });
});

describe("tenancy, in the SQL itself", () => {
  it("every read the lock makes binds the caller's org", async () => {
    await request(app()).post(LOCK_URL).send(body);
    expect(h.wheres.length, "the lock read nothing — the mock is not wired").toBeGreaterThanOrEqual(3);
    for (const w of h.wheres) {
      const q = render(w.cond);
      expect(q.sql, `${w.table} read`).toMatch(/"organization_id" = \$\d/);
      expect(q.params, `${w.table} read`).toContain(ORG_ID);
    }
  });

  it("the parent-basis lookup binds BOTH the parcel id and the org", async () => {
    // An `or(eq(id), eq(orgId))` names both columns too; the full shape pins the AND.
    await request(app()).post(LOCK_URL).send(body);
    const basisRead = h.wheres.find((w) => w.table === "properties" && w.fields.join() === "purchasePrice");
    expect(basisRead, "the route never looked up the parent's basis").toBeDefined();
    const q = render(basisRead!.cond);
    expect(q.sql).toMatch(/^\(?"properties"\."id" = \$\d+ and "properties"\."organization_id" = \$\d+\)?$/);
    expect(q.params).toEqual(expect.arrayContaining([ORG_ID, PARENT_ID]));
  });

  it("every write — the grid, each list price, the decision link — binds the caller's org", async () => {
    await request(app()).post(LOCK_URL).send(body);
    expect(h.updates).toHaveLength(4);
    for (const u of h.updates) {
      const q = render(u.cond);
      expect(q.sql, `${u.table} write`).toMatch(/"organization_id" = \$\d/);
      expect(q.sql, `${u.table} write`).toMatch(/ and /);
      expect(q.params, `${u.table} write`).toContain(ORG_ID);
    }
  });
});

describe("the record cannot outlive the act, and the act does not depend on the record", () => {
  it("a scenario that cannot be written fails neither the lock nor cites nothing", async () => {
    h.failScenario = true;
    const res = await request(app()).post(LOCK_URL).send(body);
    expect(res.status).toBe(200);
    expect(res.body.decisionSnapshotId).toBeNull();
    expect(res.body.scenarioId).toBeNull();
    // The lock committed; no decision was recorded without its scenario.
    expect(h.calls).toEqual(["tx", "lock-write", "lock-write", "lock-write"]);
  });
});
