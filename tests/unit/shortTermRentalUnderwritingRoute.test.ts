/**
 * POST /api/str/underwrite — the short_term_rental vertical's decision route.
 *
 * Proves the route closes the loop with the right identity:
 *   - the str_acquisition scenario is written first, under short_term_rental;
 *   - the decision cites it, with the operator's own review date (or null when
 *     they chose "no set date");
 *   - the property is checked against the org (no tenant crossing);
 *   - an unanswered review date, a foreign decision kind or inputs the engine
 *     refuses are rejected before anything is written.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const ORG_ID = 42;
const USER_ID = "user_owner";

const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  where: null as unknown,
  calls: [] as string[],
  scenarioReq: null as Record<string, unknown> | null,
  decisionArgs: null as unknown[] | null,
}));

vi.mock("../../server/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (cond: unknown) => {
          h.where = cond;
          return Promise.resolve(h.rows);
        },
      }),
    }),
  },
}));
// The store is mocked for persistence only. It still COMPUTES, as the real
// store does (computeScenario over the registry, before the insert), so an
// input set the engine refuses fails here exactly as it would in production.
vi.mock("../../server/services/economics/scenarioStore", async () => {
  const { computeScenario } = await import("../../shared/economics/scenario");
  const { ALL_ENGINES } = await import("../../server/services/economics/engines");
  return {
    recordScenario: vi.fn(async (_org: number, req: Record<string, unknown>) => {
      const computed = computeScenario(req as never, ALL_ENGINES);
      h.calls.push("scenario");
      h.scenarioReq = req;
      return { id: 501, computedAt: new Date(0), body: { metrics: computed.metrics, assumptions: computed.assumptions } };
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

const { default: router } = await import("../../server/routes-str-underwriting");

function app() {
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => {
    req.organization = { id: ORG_ID };
    req.user = { id: USER_ID };
    next();
  });
  a.use("/api/str", router);
  return a;
}

const body = {
  propertyId: 7,
  inputs: {
    purchasePriceCents: 40_000_000,
    averageDailyRateCents: 25_000,
    occupancyPct: 70,
    nightsAvailablePerYear: 360,
    avgStayNights: 3,
    cleaningCostPerTurnoverCents: 9_000,
    platformFeePct: 3,
    managementPct: 20,
    monthlyFixedCostsCents: 110_000,
    reservesPct: 5,
  },
  kind: "acquire",
  choice: "Buy at $400,000 to run as a short-term rental",
  rationale: "Cash flow holds at 70% occupancy and our nightly rate.",
  // Relative to now, so the fixture never becomes a past date the route refuses.
  reviewDueAt: new Date(Date.now() + 60 * 86_400_000).toISOString(),
};

beforeEach(() => {
  h.rows = [{ id: 7, address: "12 Lake Rd", county: "Sevier", state: "TN", apn: "1" }];
  h.where = null;
  h.calls = [];
  h.scenarioReq = null;
  h.decisionArgs = null;
});

describe("POST /api/str/underwrite", () => {
  it("records the str_acquisition scenario, then a short_term_rental decision citing it", async () => {
    const res = await request(app()).post("/api/str/underwrite").send(body);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ scenarioId: 501, decisionId: 901 });
    expect(h.calls).toEqual(["scenario", "decision"]);
    expect(h.scenarioReq).toMatchObject({ engineId: "str_acquisition", strategyPackId: "short_term_rental", subjectId: 7 });
    const [org, decision, , scenarioIds] = h.decisionArgs as [number, Record<string, unknown>, Date, number[]];
    expect(org).toBe(ORG_ID);
    expect(decision).toMatchObject({
      strategyPackId: "short_term_rental",
      kind: "acquire",
      actorRef: USER_ID,
      subjectId: 7,
      authority: "org_member:short_term_rental_underwrite",
    });
    expect(decision.reviewDueAt).toEqual(new Date(body.reviewDueAt));
    expect(scenarioIds).toEqual([501]);
    // The engine actually ran on these inputs: total_cost is the price alone,
    // income is built from nights, and the omissions come back declared.
    expect(res.body.metrics.find((m: { id: string }) => m.id === "total_cost")?.value).toBe(40_000_000);
    expect(res.body.metrics.find((m: { id: string }) => m.id === "effective_gross_income")?.value).toBe(6_300_000);
    expect(res.body.assumptions.map((a: { key: string }) => a.key)).toEqual(
      expect.arrayContaining(["furnishing", "cleaning_fee_income", "financing"]),
    );
  });

  it("'no set date' is recorded as null — an answer, not a default", async () => {
    await request(app()).post("/api/str/underwrite").send({ ...body, reviewDueAt: null });
    expect((h.decisionArgs as [number, Record<string, unknown>])[1].reviewDueAt).toBeNull();
  });

  it("another org's property is not found, and nothing is written", async () => {
    h.rows = [];
    const res = await request(app()).post("/api/str/underwrite").send(body);
    expect(res.status).toBe(404);
    expect(h.calls).toEqual([]);
  });

  it("the property lookup is scoped to the caller's org, in the SQL itself", async () => {
    // The 404 above proves only that an EMPTY result is a 404. This proves the
    // lookup would return empty for a foreign row: the rendered WHERE binds the
    // caller's org id, not the property id alone (the IDOR shape).
    await request(app()).post("/api/str/underwrite").send(body);
    expect(h.where, "the route never queried the property").not.toBeNull();
    const q = new PgDialect().sqlToQuery(h.where as SQL);
    expect(q.sql).toMatch(/"organization_id" = \$\d/);
    // Both conditions must hold — `or(eq(id), eq(orgId))` names both columns too.
    expect(q.sql).toMatch(/^\(?"properties"\."id" = \$\d+ and "properties"\."organization_id" = \$\d+\)?$/);
    expect(q.sql).toMatch(/"id" = \$\d/);
    expect(q.params).toEqual(expect.arrayContaining([ORG_ID, 7]));
  });

  it("an unanswered review date is refused before anything is written", async () => {
    const { reviewDueAt: _omit, ...unanswered } = body;
    const res = await request(app()).post("/api/str/underwrite").send(unanswered);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(h.calls).toEqual([]);
  });

  it("a past review date is refused before anything is written", async () => {
    const res = await request(app())
      .post("/api/str/underwrite")
      .send({ ...body, reviewDueAt: new Date(Date.now() - 86_400_000).toISOString() });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(h.calls).toEqual([]);
  });

  it("a decision kind this vertical's call cannot be is refused", async () => {
    const res = await request(app()).post("/api/str/underwrite").send({ ...body, kind: "dispose" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(h.calls).toEqual([]);
  });

  it("inputs the engine refuses are a 400 with the engine's reason, and nothing is written", async () => {
    const res = await request(app())
      .post("/api/str/underwrite")
      .send({ ...body, inputs: { ...body.inputs, nightsAvailablePerYear: 0 } });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/Nights available/);
    expect(h.calls).toEqual([]);
  });

  it("loan terms typed without a down payment are a 400, and nothing is written", async () => {
    const res = await request(app())
      .post("/api/str/underwrite")
      .send({ ...body, inputs: { ...body.inputs, interestRatePct: 7, amortizationYears: 30 } });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/without a down payment/);
    expect(h.calls).toEqual([]);
  });
});
