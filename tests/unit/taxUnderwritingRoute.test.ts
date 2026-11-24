/**
 * POST /api/tax-lien/underwrite — the tax vertical's decision route
 * (Step 0 item T5). FALSIFYING: on pre-slice main the route module does
 * not exist and the kit refuses every tax_lien_deed decision.
 *
 * Proves:
 *   - the tax_max_bid scenario is written first, under tax_lien_deed,
 *     and the decision cites it — a decision_snapshot citing a T4 scenario;
 *   - the decision carries the operator's review date (and "no set date" is
 *     an answer, while an unanswered or past date is refused);
 *   - the property lookup is org-scoped; another org's property writes
 *     nothing;
 *   - pack and engine are literals a body cannot steer;
 *   - the kit's ownership guard, unmodified, accepts tax_max_bid for
 *     tax_lien_deed and refuses every cross pairing, writing nothing.
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

const { default: router } = await import("../../server/routes-tax-underwriting");
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
  a.use("/api/tax-lien", router);
  return a;
}

const inputs = {
  lotValueCents: 5_000_000,
  survivingLiensCents: 500_000,
  otherTaxesCents: 200_000,
  clearAndHoldCostsCents: 300_000,
  requiredReturnCents: 1_000_000,
};
const body = {
  propertyId: 7,
  inputs,
  kind: "offer",
  choice: "Bid up to $30,000",
  rationale: "The stack leaves my full return at $30,000; the liens are from my own search.",
  reviewDueAt: new Date(Date.now() + 45 * 86_400_000).toISOString(),
};
const post = (b: unknown) => request(app()).post("/api/tax-lien/underwrite").send(b as object);

beforeEach(() => {
  h.rows = [{ id: 7, address: "9 Main St", county: "Harris", state: "TX", apn: "1" }];
  h.where = null;
  h.calls = [];
  h.scenarioReq = null;
  h.decisionArgs = null;
});

describe("POST /api/tax-lien/underwrite", () => {
  it("records the tax_max_bid scenario, then a tax_lien_deed decision citing it", async () => {
    const res = await post(body);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ scenarioId: 501, decisionId: 901 });
    expect(h.calls).toEqual(["scenario", "decision"]);
    expect(h.scenarioReq).toMatchObject({ engineId: "tax_max_bid", strategyPackId: "tax_lien_deed", subjectId: 7 });

    const [org, decision, , scenarioIds] = h.decisionArgs as [number, Record<string, unknown>, Date, number[]];
    expect(org).toBe(ORG_ID);
    expect(decision).toMatchObject({ strategyPackId: "tax_lien_deed", kind: "offer", actorRef: USER_ID, subjectId: 7, authority: "org_member:tax_underwrite" });
    expect(decision.reviewDueAt).toEqual(new Date(body.reviewDueAt));
    expect(scenarioIds).toEqual([501]);
  });

  it("pass is a recordable call too", async () => {
    const res = await post({ ...body, kind: "pass" });
    expect(res.status).toBe(200);
    expect((h.decisionArgs as [number, Record<string, unknown>])[1].kind).toBe("pass");
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
    ["a foreign kind", { kind: "acquire" }],
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
    expect(h.scenarioReq).toMatchObject({ engineId: "tax_max_bid", strategyPackId: "tax_lien_deed" });
  });
});

describe("the kit's ownership guard — unmodified, both directions", () => {
  const kitInput = {
    subjectType: "property" as const,
    subjectId: 7,
    inputs,
    scenarioLabel: "t",
    kind: "offer" as const,
    choice: "c",
    rationale: "a rationale",
    actorRef: USER_ID,
    authority: "org_member:test",
    reviewDueAt: null,
  };

  it("accepts tax_max_bid under tax_lien_deed", async () => {
    await expect(recordUnderwrittenDecision(ORG_ID, { ...kitInput, engineId: "tax_max_bid", strategyPackId: "tax_lien_deed" })).resolves.toMatchObject({ decisionId: 901 });
  });

  it.each([
    ["note_price_yield", "tax_lien_deed"],
    ["tax_max_bid", "note_investor"],
    ["tax_max_bid", "land_flipper"],
  ] as const)("refuses %s under %s, writing nothing", async (engineId, strategyPackId) => {
    await expect(recordUnderwrittenDecision(ORG_ID, { ...kitInput, engineId, strategyPackId })).rejects.toBeInstanceOf(ScenarioEngineError);
    expect(h.calls).toEqual([]);
  });
});
