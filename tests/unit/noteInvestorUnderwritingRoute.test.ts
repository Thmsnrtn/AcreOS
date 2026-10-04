/**
 * POST /api/note-underwriting/underwrite — the note investor vertical's decision route.
 *
 * Proves the route closes the loop with the right identity:
 *   - the note_acquisition scenario is written first, under note_investor;
 *   - the decision cites it, with the operator's own review date (or null when
 *     they chose "no set date");
 *   - the collateral property is checked against the org (no tenant crossing);
 *   - an unanswered review date, a foreign decision kind or inputs the engine
 *     refuses are turned away before anything is written.
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
// Like the real store, compute before "inserting": a request the engine refuses
// never reaches the write.
vi.mock("../../server/services/economics/scenarioStore", async () => {
  const { computeScenario } = await import("../../shared/economics/scenario");
  const { ALL_ENGINES } = await import("../../server/services/economics/engines");
  return {
    recordScenario: vi.fn(async (_org: number, req: Parameters<typeof computeScenario>[0]) => {
      const computed = computeScenario(req, ALL_ENGINES);
      h.calls.push("scenario");
      h.scenarioReq = req as unknown as Record<string, unknown>;
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

const { default: router } = await import("../../server/routes-note-underwriting");

function app() {
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => {
    req.organization = { id: ORG_ID };
    req.user = { id: USER_ID };
    next();
  });
  a.use("/api/note-underwriting", router);
  return a;
}

const body = {
  propertyId: 7,
  inputs: { unpaidPrincipalCents: 5_000_000, noteRatePct: 9, remainingTermMonths: 120, purchasePriceCents: 4_000_000 },
  kind: "acquire",
  choice: "Buy the note at $40,000 for $50,000 unpaid balance",
  rationale: "A 20% discount on a seasoned performing note clears our yield floor.",
  // Relative to now, so the fixture never becomes a past date the route refuses.
  reviewDueAt: new Date(Date.now() + 60 * 86_400_000).toISOString(),
};

beforeEach(() => {
  h.rows = [{ id: 7, address: "1 Elm St", county: "Pima", state: "AZ", apn: "1" }];
  h.where = null;
  h.calls = [];
  h.scenarioReq = null;
  h.decisionArgs = null;
});

describe("POST /api/note-underwriting/underwrite", () => {
  it("records the note_acquisition scenario, then a note_investor decision citing it", async () => {
    const res = await request(app()).post("/api/note-underwriting/underwrite").send(body);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ scenarioId: 501, decisionId: 901 });
    expect(h.calls).toEqual(["scenario", "decision"]);
    expect(h.scenarioReq).toMatchObject({ engineId: "note_acquisition", strategyPackId: "note_investor", subjectType: "property", subjectId: 7 });
    const [org, decision, , scenarioIds] = h.decisionArgs as [number, Record<string, unknown>, Date, number[]];
    expect(org).toBe(ORG_ID);
    expect(decision).toMatchObject({
      strategyPackId: "note_investor",
      kind: "acquire",
      actorRef: USER_ID,
      subjectType: "property",
      subjectId: 7,
      authority: "org_member:note_investor_underwrite",
    });
    expect(decision.reviewDueAt).toEqual(new Date(body.reviewDueAt));
    expect(scenarioIds).toEqual([501]);
  });

  it("'no set date' is recorded as null — an answer, not a default", async () => {
    await request(app()).post("/api/note-underwriting/underwrite").send({ ...body, reviewDueAt: null });
    expect((h.decisionArgs as [number, Record<string, unknown>])[1].reviewDueAt).toBeNull();
  });

  it("another org's property is not found, and nothing is written", async () => {
    h.rows = [];
    const res = await request(app()).post("/api/note-underwriting/underwrite").send(body);
    expect(res.status).toBe(404);
    expect(h.calls).toEqual([]);
  });

  it("the property lookup is scoped to the caller's org, in the SQL itself", async () => {
    // The 404 above proves only that an EMPTY result is a 404. This proves the
    // lookup would return empty for a foreign row: the rendered WHERE binds the
    // caller's org id, not the property id alone (the IDOR shape).
    await request(app()).post("/api/note-underwriting/underwrite").send(body);
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
    const res = await request(app()).post("/api/note-underwriting/underwrite").send(unanswered);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(h.calls).toEqual([]);
  });

  it("a decision kind this vertical's call cannot be is refused", async () => {
    const res = await request(app()).post("/api/note-underwriting/underwrite").send({ ...body, kind: "dispose" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(h.calls).toEqual([]);
  });

  it("inputs the engine refuses are a 400 with its message, and nothing is written", async () => {
    const res = await request(app())
      .post("/api/note-underwriting/underwrite")
      .send({ ...body, inputs: { ...body.inputs, noteRatePct: 45 } });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/Note rate/);
    expect(h.calls).toEqual([]);
  });
});
