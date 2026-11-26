/**
 * POST /api/commercial/underwrite — the commercial vertical's decision
 * route (Step 0 gap sheet commercial.md, work item 2, bar (b)).
 * FALSIFYING: on pre-slice main the route module does not exist and the
 * kit refuses every commercial decision.
 *
 * Proves:
 *   - the commercial_underwrite scenario is written first, under the
 *     commercial pack, and the decision cites it;
 *   - the decision carries the operator's review date (and "no set date"
 *     is an answer, while an unanswered or past date is refused);
 *   - the property lookup is org-scoped; another org's property writes
 *     nothing;
 *   - pack and engine are literals a body cannot steer;
 *   - the kit's ownership guard, unmodified, accepts
 *     commercial_underwrite for commercial and refuses every cross
 *     pairing, writing nothing.
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
vi.mock("../../server/services/economics/scenarioStore", () => ({
  recordScenario: vi.fn(async (_org: number, req: Record<string, unknown>) => {
    h.calls.push("scenario");
    h.scenarioReq = req;
    return { id: 501, computedAt: new Date(0), body: { metrics: [], assumptions: [] } };
  }),
}));
vi.mock("../../server/services/decisions/decisionStore", () => ({
  recordDecision: vi.fn(async (...args: unknown[]) => {
    h.calls.push("decision");
    h.decisionArgs = args;
    return { id: 901, decidedAt: new Date(0), body: {} };
  }),
}));

const { default: router } = await import("../../server/routes-commercial-underwriting");
const { recordUnderwrittenDecision } = await import("../../server/services/underwriting/verticalDecision");
const { ScenarioEngineError } = await import("../../shared/economics/scenario");

function app() {
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => {
    req.organization = { id: ORG_ID };
    req.user = { id: USER_ID };
    next();
  });
  a.use("/api/commercial", router);
  return a;
}

const inputs = {
  purchasePriceCents: 85_000_000,
  leaseCount: 3,
  baseMonthlyRentCents: 1_200_000,
  escalatedMonthlyRentCents: 1_260_000,
  expiringWithin12MonthsMonthlyRentCents: 400_000,
  camRecoveriesMonthlyCents: 150_000,
  rentableSqft: 20_000,
  measuredOpExMonthlyCents: 350_000,
  measuredOpExRowCount: 12,
  measuredOpExMonthsCovered: 12,
  asOfMonth: "2026-11",
};
const body = {
  propertyId: 7,
  inputs,
  kind: "acquire",
  choice: "Acquire — NOI $127,200/yr at a 14.96% cap rate on the recorded figures",
  rationale: "The recorded leases carry the income; expenses are measured from a full year of records.",
  reviewDueAt: new Date(Date.now() + 45 * 86_400_000).toISOString(),
};
const post = (b: unknown) => request(app()).post("/api/commercial/underwrite").send(b as object);

beforeEach(() => {
  h.rows = [{ id: 7, address: "9 Main St", county: "Harris", state: "TX", apn: "1" }];
  h.where = null;
  h.calls = [];
  h.scenarioReq = null;
  h.decisionArgs = null;
});

describe("POST /api/commercial/underwrite", () => {
  it("records the commercial_underwrite scenario, then a commercial decision citing it", async () => {
    const res = await post(body);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ scenarioId: 501, decisionId: 901 });
    expect(h.calls).toEqual(["scenario", "decision"]);
    expect(h.scenarioReq).toMatchObject({ engineId: "commercial_underwrite", strategyPackId: "commercial", subjectId: 7 });

    const [org, decision, , scenarioIds] = h.decisionArgs as [number, Record<string, unknown>, Date, number[]];
    expect(org).toBe(ORG_ID);
    expect(decision).toMatchObject({ strategyPackId: "commercial", kind: "acquire", actorRef: USER_ID, subjectId: 7, authority: "org_member:commercial_underwrite" });
    expect(decision.reviewDueAt).toEqual(new Date(body.reviewDueAt));
    expect(scenarioIds).toEqual([501]);
  });

  it("hold and pass are recordable calls too", async () => {
    for (const kind of ["hold", "pass"] as const) {
      const res = await post({ ...body, kind });
      expect(res.status).toBe(200);
      expect((h.decisionArgs as [number, Record<string, unknown>])[1].kind).toBe(kind);
    }
  });

  it("'no set date' (null) is an answer, recorded as null", async () => {
    const res = await post({ ...body, reviewDueAt: null });
    expect(res.status).toBe(200);
    expect((h.decisionArgs as [number, Record<string, unknown>])[1].reviewDueAt).toBeNull();
  });

  it("another org's property is not found, and nothing is written", async () => {
    h.rows = [];
    const res = await post(body);
    expect(res.status).toBe(404);
    expect(h.calls).toEqual([]);
  });

  it("the property lookup binds the caller's org in the SQL itself", async () => {
    await post(body);
    const q = new PgDialect().sqlToQuery(h.where as SQL);
    expect(q.sql).toMatch(/"organization_id" = \$\d/);
    expect(q.params).toEqual(expect.arrayContaining([ORG_ID, 7]));
  });

  it.each([
    ["an unanswered review date", { reviewDueAt: undefined }],
    ["a past review date", { reviewDueAt: new Date(Date.now() - 86_400_000).toISOString() }],
    ["a foreign kind", { kind: "offer" }],
    ["a rationale too short to grade later", { rationale: "cheap" }],
  ])("refuses %s before anything is written", async (_label, patch) => {
    const res = await post({ ...body, ...patch });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(h.calls).toEqual([]);
  });

  it("pack and engine are literals — a body cannot choose them", async () => {
    const res = await post({ ...body, engineId: "note_price_yield", strategyPackId: "note_investor" });
    expect(res.status).toBe(200);
    expect(h.scenarioReq).toMatchObject({ engineId: "commercial_underwrite", strategyPackId: "commercial" });
  });
});

describe("the kit's ownership guard — unmodified, both directions", () => {
  const kitInput = {
    subjectType: "property" as const,
    subjectId: 7,
    inputs,
    scenarioLabel: "t",
    kind: "acquire" as const,
    choice: "c",
    rationale: "a rationale",
    actorRef: USER_ID,
    authority: "org_member:test",
    reviewDueAt: null,
  };

  it("accepts commercial_underwrite under commercial", async () => {
    await expect(recordUnderwrittenDecision(ORG_ID, { ...kitInput, engineId: "commercial_underwrite", strategyPackId: "commercial" })).resolves.toMatchObject({ decisionId: 901 });
  });

  it.each([
    ["note_price_yield", "commercial"],
    ["commercial_underwrite", "note_investor"],
    ["commercial_underwrite", "land_flipper"],
  ] as const)("refuses %s under %s, writing nothing", async (engineId, strategyPackId) => {
    await expect(recordUnderwrittenDecision(ORG_ID, { ...kitInput, engineId, strategyPackId })).rejects.toBeInstanceOf(ScenarioEngineError);
    expect(h.calls).toEqual([]);
  });
});
