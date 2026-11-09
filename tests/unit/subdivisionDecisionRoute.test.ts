/**
 * Subdivision V1, Leg 4 — POST /api/subdivision/decide (§6.1; §8.4 tests 15 + 17).
 *
 * The scenario store and the decision store are MOCKED so every write is
 * countable. The scenario mock still recomputes through the REAL engine
 * registry (as recordScenario does), so metrics in the response are the
 * engine's own arithmetic over the golden Leg 3 inputs. The db mock is
 * tenant-aware: it returns a row only when the rendered WHERE carries the
 * organisation, so dropping the org predicate from the route would hand it
 * another tenant's parcel and the cross-tenant test would go red.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const dialect = new PgDialect();
const renderWhere = (w: unknown) => dialect.sqlToQuery(w as SQL);

const stores = vi.hoisted(() => ({
  scenarios: [] as Array<{ org: number; req: any; body: any }>,
  decisions: [] as Array<{ org: number; input: any; asOf: Date; scenarioIds: number[] }>,
}));
const world = vi.hoisted(() => ({
  properties: [] as any[],
  runs: [] as any[],
  reads: [] as Array<{ table: unknown; text: string; params: unknown[] }>,
}));

vi.mock("../../server/db", async () => {
  const { properties, subdivisionScreenRuns } = await import("@shared/schema");
  const chain = (rows: unknown[]) => {
    const p = Promise.resolve(rows) as Promise<unknown[]> & Record<string, unknown>;
    p.orderBy = () => chain(rows);
    p.limit = () => Promise.resolve(rows);
    return p;
  };
  return {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: (w: unknown) => {
            const { sql: text, params } = renderWhere(w);
            world.reads.push({ table, text, params });
            // A row comes back only if the WHERE names it AND, when the WHERE is
            // org-scoped, names its organisation.
            const scoped = (r: any, key: string) =>
              params.includes(r[key]) && (!text.includes('"organization_id"') || params.includes(r.organizationId));
            if (table === properties) return chain(world.properties.filter((r) => scoped(r, "id")));
            if (table === subdivisionScreenRuns) return chain(world.runs.filter((r) => scoped(r, "parentParcelId")));
            return chain([]);
          },
        }),
      }),
    },
  };
});
vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { id: "user_1", claims: { sub: "user_1" } };
    next();
  },
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: any, next: any) => {
    req.organization = { id: 7 };
    req.organizationId = 7;
    next();
  },
}));
vi.mock("../../server/types/request", async (orig) => ({
  ...(await orig<object>()),
  getUserId: () => "user_1",
  getOrganizationId: (req: any) => req.organizationId,
}));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/economics/scenarioStore", () => ({
  // Recompute through the REAL registry, exactly as the real recordScenario does;
  // a throw (unknown key, refused input) happens BEFORE anything is counted.
  recordScenario: async (org: number, req: any) => {
    const body = computeScenario(req, ALL_ENGINES);
    stores.scenarios.push({ org, req, body });
    return { id: stores.scenarios.length, computedAt: new Date(0), body };
  },
  scenariosForSubject: async () => [],
}));
vi.mock("../../server/services/decisions/decisionStore", () => ({
  recordDecision: async (org: number, input: any, asOf: Date, scenarioIds: number[]) => {
    stores.decisions.push({ org, input, asOf, scenarioIds });
    return { id: 100 + stores.decisions.length, decidedAt: new Date(0), body: {} };
  },
  decisionsForSubject: async () => [],
}));

import { registerSubdivisionDecisionRoutes } from "../../server/routes-subdivision-decision";
import { subdivisionScreenRuns } from "@shared/schema";
import { computeScenario } from "../../shared/economics/scenario";
import { ALL_ENGINES } from "../../server/services/economics/engines";

type Handler = (req: any, res: any, next: (err?: unknown) => void) => unknown;
const routes = new Map<string, Handler[]>();
const appStub: any = {};
for (const m of ["get", "post", "patch", "put", "delete"]) appStub[m] = (p: string, ...h: Handler[]) => routes.set(`${m.toUpperCase()} ${p}`, h);
registerSubdivisionDecisionRoutes(appStub);

async function post(body: unknown) {
  const req: any = { params: {}, body, headers: {} };
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      return this;
    },
  };
  for (const h of routes.get("POST /api/subdivision/decide")!) {
    let next = false;
    await h(req, res, () => {
      next = true;
    });
    if (!next) break;
  }
  return res;
}

const $ = (d: number) => d * 100;
/** The Leg 3 GOLDEN PROJECT (subdivisionFeasibility.test.ts), in wire form (cents). */
const WIRE: Record<string, number | string> = {
  landCostCents: $(100_000),
  lotCount: 10,
  grossProceedsCents: $(400_000),
  absorptionLotsPerMonth: 5,
  wastewater: "septic",
  gradingCents: $(20_000),
  roadsCents: $(50_000),
  waterCents: $(10_000),
  septicCents: $(30_000),
  stormwaterCents: $(5_000),
  utilitiesCents: $(15_000),
  landscapingCents: 0,
  engineeringSurveyCents: $(12_000),
  legalCents: $(3_000),
  permittingFeesCents: $(10_000),
  financingCents: 0,
  marketingCents: $(20_000),
  contingencyCents: $(5_000),
  timelineP50Days: 60,
  timelineP90Days: 90,
  holdingCostMonthlyCents: $(1_000),
};
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const bodyFor = (over: Record<string, unknown> = {}) => ({
  propertyId: 42,
  inputs: WIRE,
  kind: "pursue",
  choice: "Proceed to entitlement",
  rationale: "Margin clears our floor on the stated inputs.",
  reviewDueAt: inDays(30),
  ...over,
});
const metric = (res: any, id: string) => res.body.metrics.find((m: any) => m.id === id)?.value;
const nothingWritten = () => {
  expect(stores.scenarios).toHaveLength(0);
  expect(stores.decisions).toHaveLength(0);
};

const OWN_PARCEL = { id: 42, organizationId: 7, address: "12 Ridge Rd", county: "Pima", state: "AZ", apn: "123-45", parentParcelId: null };
const SCREEN_RUN = {
  id: 9,
  organizationId: 7,
  parentParcelId: 42,
  ruleVersion: "buildability-screen v1",
  triggeredCount: 2,
  notDeterminableCount: 3,
  yieldEstimate: {
    yield: {
      low: { value: 8, refusedReason: null, basis: "Gross 20 ac minus floodway, at 1.2 ac minimum" },
      high: { value: 10, refusedReason: null, basis: "Gross 20 ac at 1.5 ac target" },
    },
  },
};

beforeEach(() => {
  stores.scenarios.length = 0;
  stores.decisions.length = 0;
  world.reads.length = 0;
  world.properties = [{ ...OWN_PARCEL }];
  world.runs = [];
});

describe("POST /api/subdivision/decide — registration", () => {
  it("is registered behind isAuthenticated + getOrCreateOrg, and nothing else is", () => {
    expect(routes.get("POST /api/subdivision/decide")).toHaveLength(3);
    expect(routes.get("GET /api/subdivision/parcels/:id/desk")).toHaveLength(3);
    expect([...routes.keys()].sort()).toEqual(["GET /api/subdivision/parcels/:id/desk", "POST /api/subdivision/decide"]);
  });
});

describe("§8.4 test 15 — a valid pursue writes exactly one scenario and one decision, correctly", () => {
  it("one scenario + one decision; pack is the literal 'subdivider'; the decision cites the scenario; review date as sent", async () => {
    const reviewDueAt = inDays(45);
    const res = await post(bodyFor({ reviewDueAt }));
    expect(res.statusCode).toBe(200);
    expect(stores.scenarios).toHaveLength(1);
    expect(stores.decisions).toHaveLength(1);

    const { org, input, scenarioIds } = stores.decisions[0];
    expect(org).toBe(7);
    expect(input.strategyPackId).toBe("subdivider");
    expect(stores.scenarios[0].req.strategyPackId).toBe("subdivider");
    expect(input.subjectType).toBe("property");
    expect(input.subjectId).toBe(42);
    expect(input.kind).toBe("pursue");
    expect(input.choice).toBe("Proceed to entitlement");
    expect(input.actorType).toBe("user");
    expect(input.actorRef).toBe("user_1");
    expect(input.authority).toBe("org_member:subdivision_decide");
    // The decision cites the scenario that was just written (its id, not any other).
    expect(scenarioIds).toEqual([1]);
    // The review date on the record is the one the operator sent — not a default, not shifted.
    expect(input.reviewDueAt).toEqual(new Date(reviewDueAt));
    expect(stores.scenarios[0].org).toBe(7);

    expect(res.body).toMatchObject({ recordKind: "decision", scenarioId: 1, decisionId: 101 });
  });

  it("kind 'pass' is accepted and recorded as pass", async () => {
    const res = await post(bodyFor({ kind: "pass", choice: "Pass on this parcel" }));
    expect(res.statusCode).toBe(200);
    expect(stores.decisions[0].input.kind).toBe("pass");
    expect(stores.decisions[0].input.choice).toBe("Pass on this parcel");
  });

  it("the scenario's inputs are the operator's inputs, recomputed through the REAL engine (golden metrics, to the cent)", async () => {
    const res = await post(bodyFor());
    expect(res.statusCode).toBe(200);
    expect(stores.scenarios[0].req.inputs).toEqual(WIRE);
    expect(stores.scenarios[0].req.engineId).toBe("subdivision_feasibility");
    // Hand arithmetic from the Leg 3 golden project: cost 280,000 · margin 120,000 · profit (after p50 carry) 118,000.
    expect(metric(res, "project_cost_before_carry")).toBe($(280_000));
    expect(metric(res, "margin_before_carry")).toBe($(120_000));
    expect(metric(res, "profit")).toBe($(118_000));
    // And the response is the engine's own output, not a hand-built object.
    expect(res.body.metrics).toEqual(stores.scenarios[0].body.metrics);
    // Changing one operator input moves the recomputed number: the route does not pass numbers through.
    stores.scenarios.length = 0;
    stores.decisions.length = 0;
    const res2 = await post(bodyFor({ inputs: { ...WIRE, landCostCents: $(150_000) } }));
    expect(metric(res2, "project_cost_before_carry")).toBe($(330_000));
  });

  it("the engine is fixed: the recorded scenario is on 'subdivision_feasibility', the only engine that declares subdivider", async () => {
    const declaring = ALL_ENGINES.filter((e: any) => (e.verticals ?? []).includes("subdivider")).map((e: any) => e.id);
    expect(declaring).toEqual(["subdivision_feasibility"]);
    await post(bodyFor());
    expect(stores.scenarios[0].req.engineId).toBe("subdivision_feasibility");
    expect(stores.scenarios[0].body.engineId).toBe("subdivision_feasibility");
    expect(stores.scenarios[0].body.strategyPackId).toBe("subdivider");
    // A body-supplied engine or pack is not a way to substitute one: unknown keys are not the route's contract,
    // and the recorded engine/pack stay fixed.
    stores.scenarios.length = 0;
    stores.decisions.length = 0;
    await post(bodyFor({ engineId: "rental_acquisition", strategyPackId: "buy_and_hold" }));
    expect(stores.scenarios[0].req.engineId).toBe("subdivision_feasibility");
    expect(stores.scenarios[0].req.strategyPackId).toBe("subdivider");
    expect(stores.decisions[0].input.strategyPackId).toBe("subdivider");
  });

  it("an input the engine refuses (unknown key) is a 400 and writes nothing", async () => {
    const res = await post(bodyFor({ inputs: { ...WIRE, notALine: 5 } }));
    expect(res.statusCode).toBe(400);
    nothingWritten();
  });
});

describe("§6.1 — the screen evidence is frozen on the scenario, or the absence of a screen is", () => {
  it("with a screen run on record: run id, rule version, counts and BOTH yield ends with their bases", async () => {
    world.runs = [{ ...SCREEN_RUN }];
    const res = await post(bodyFor());
    expect(res.statusCode).toBe(200);
    const assumptions = stores.scenarios[0].req.assumptions as Array<{ key: string; value: unknown; origin: string; basis: string; unit?: string }>;
    expect(assumptions.map((a) => a.key)).toEqual([
      "screen_run_id",
      "screen_rule_version",
      "screen_triggered_count",
      "screen_not_determinable_count",
      "yield_low_lots",
      "yield_high_lots",
    ]);
    const by = Object.fromEntries(assumptions.map((a) => [a.key, a]));
    expect(by.screen_run_id.value).toBe(9);
    expect(by.screen_rule_version.value).toBe("buildability-screen v1");
    expect(by.screen_triggered_count.value).toBe(2);
    expect(by.screen_not_determinable_count.value).toBe(3);
    expect(by.yield_low_lots).toMatchObject({ value: 8, unit: "lots", origin: "derived" });
    expect(by.yield_high_lots).toMatchObject({ value: 10, unit: "lots", origin: "derived" });
    expect(by.yield_low_lots.basis).toBe(
      "Frozen from buildability screen run 9's low yield end. Basis: Gross 20 ac minus floodway, at 1.2 ac minimum",
    );
    expect(by.yield_high_lots.basis).toBe("Frozen from buildability screen run 9's high yield end. Basis: Gross 20 ac at 1.5 ac target");
    for (const a of assumptions) expect(a.origin).toBe("derived");
    // The run did exist, so the 'not screened' statement must NOT be present.
    expect(assumptions.map((a) => a.key)).not.toContain("screen_state");
    // The evidence rides on the recorded scenario body, ahead of the engine's own assumptions.
    expect(res.body.assumptions.slice(0, 6).map((a: any) => a.key)).toEqual(assumptions.map((a) => a.key));
  });

  it("a yield end that did not compute is not frozen as a number (no invented zero)", async () => {
    world.runs = [
      {
        ...SCREEN_RUN,
        yieldEstimate: { yield: { low: { value: null, refusedReason: "floodway not entered", basis: null }, high: { value: 10, refusedReason: null, basis: null } } },
      },
    ];
    await post(bodyFor());
    const assumptions = stores.scenarios[0].req.assumptions as Array<{ key: string; value: unknown; basis: string }>;
    expect(assumptions.map((a) => a.key)).not.toContain("yield_low_lots");
    const high = assumptions.find((a) => a.key === "yield_high_lots")!;
    expect(high.value).toBe(10);
    expect(high.basis).toBe("Frozen from buildability screen run 9's high yield end. Basis: not recorded on the run");
  });

  it("with no screen run: the 'screen_state: not screened' assumption, and no run evidence", async () => {
    world.runs = [];
    const res = await post(bodyFor());
    expect(res.statusCode).toBe(200);
    expect(stores.scenarios[0].req.assumptions).toEqual([
      {
        key: "screen_state",
        value: "not screened",
        origin: "derived",
        basis: "No buildability screen had been run on this parcel when the decision was recorded.",
      },
    ]);
  });

  it("another org's screen run is never frozen onto this org's decision", async () => {
    world.runs = [{ ...SCREEN_RUN, organizationId: 8 }];
    await post(bodyFor());
    expect((stores.scenarios[0].req.assumptions as any[]).map((a) => a.key)).toEqual(["screen_state"]);
  });
});

describe("§6.1 — the review date is an answer, and a past date is refused", () => {
  it("a missing reviewDueAt key is refused (422) and nothing is read or written", async () => {
    const { reviewDueAt: _omit, ...unanswered } = bodyFor();
    const res = await post(unanswered);
    expect(res.statusCode).toBe(422);
    nothingWritten();
    expect(world.reads).toHaveLength(0);
  });

  it("an explicit null ('no set date') succeeds and is recorded as null, never defaulted", async () => {
    const res = await post(bodyFor({ reviewDueAt: null }));
    expect(res.statusCode).toBe(200);
    expect(stores.decisions).toHaveLength(1);
    expect(stores.decisions[0].input.reviewDueAt).toBeNull();
  });

  it("a past review date is refused (422), stores empty; one second in the future is accepted", async () => {
    for (const past of [new Date(Date.now() - 86_400_000).toISOString(), "2020-01-01T00:00:00.000Z"]) {
      const res = await post(bodyFor({ reviewDueAt: past }));
      expect(res.statusCode, past).toBe(422);
    }
    nothingWritten();
    const ok = await post(bodyFor({ reviewDueAt: new Date(Date.now() + 60_000).toISOString() }));
    expect(ok.statusCode).toBe(200);
    expect(stores.decisions).toHaveLength(1);
  });

  it("a non-ISO review date is refused", async () => {
    const res = await post(bodyFor({ reviewDueAt: "next month" }));
    expect(res.statusCode).toBe(422);
    nothingWritten();
  });
});

describe("§6.1 — only pursue and pass are subdivision decisions", () => {
  it("kind 'defer' is refused (ruling 2026-11-05: defer is dropped) — stores empty, nothing read", async () => {
    const res = await post(bodyFor({ kind: "defer" }));
    expect(res.statusCode).toBe(422);
    nothingWritten();
    expect(world.reads).toHaveLength(0);
  });

  it("kind 'offer' is refused — stores empty", async () => {
    const res = await post(bodyFor({ kind: "offer" }));
    expect(res.statusCode).toBe(422);
    nothingWritten();
  });

  it("a missing kind, a blank choice and a short rationale are refused too", async () => {
    for (const over of [{ kind: undefined }, { choice: "   " }, { rationale: "too short" }]) {
      const res = await post(bodyFor(over));
      expect(res.statusCode, JSON.stringify(over)).toBe(422);
    }
    nothingWritten();
  });
});

describe("§8.4 test 17 — cross-tenant and lineage", () => {
  it("a property in another org → 404, stores empty (the lookup is org-scoped)", async () => {
    world.properties = [{ ...OWN_PARCEL, organizationId: 8 }];
    const res = await post(bodyFor());
    expect(res.statusCode).toBe(404);
    nothingWritten();
    // The property read carried the caller's org (7) as a bound parameter.
    expect(world.reads[0].text).toContain('"organization_id"');
    expect(world.reads[0].params).toContain(7);
  });

  it("a property that does not exist → 404, stores empty", async () => {
    world.properties = [];
    const res = await post(bodyFor({ propertyId: 999 }));
    expect(res.statusCode).toBe(404);
    nothingWritten();
  });

  it("a child lot (parentParcelId set) is refused (400, names the parent) — stores empty", async () => {
    world.properties = [{ ...OWN_PARCEL, parentParcelId: 41 }];
    const res = await post(bodyFor());
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/parent parcel, not a child lot/);
    nothingWritten();
  });

  it("the lineage read is org-scoped too: a parent parcel of this org proceeds, and the screen-run read carries org + parcel", async () => {
    await post(bodyFor());
    const runRead = world.reads.find((r) => r.table === subdivisionScreenRuns);
    expect(runRead).toBeDefined();
    expect(runRead!.text).toContain('"organization_id"');
    expect(runRead!.params).toContain(7);
    expect(runRead!.params).toContain(42);
    expect(stores.decisions).toHaveLength(1);
  });
});
