/**
 * POST /api/note-investor/underwrite — the note investor's decision route
 * (Step 0 item N4). FALSIFYING: on pre-slice main the route module does not
 * exist and the kit refuses every note_investor decision.
 *
 * Proves:
 *   - the note_price_yield scenario is written first, under note_investor,
 *     and the decision cites it — a decision_snapshot citing an N3 scenario;
 *   - the decision carries the operator's review date (and "no set date" is
 *     an answer, while an unanswered or past date is refused);
 *   - the property lookup is org-scoped; another org's property writes
 *     nothing;
 *   - pack and engine are literals a body cannot steer;
 *   - the kit's ownership guard, unmodified, accepts note_price_yield for
 *     note_investor and refuses every cross pairing, writing nothing.
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

const { default: router } = await import("../../server/routes-note-underwriting");
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
  a.use("/api/note-investor", router);
  return a;
}

const inputs = {
  currentBalanceCents: 1_200_000,
  noteRatePct: 0,
  paymentAmountCents: 100_000,
  remainingTermMonths: 12,
  targetYieldPct: 12,
};
const body = {
  propertyId: 7,
  inputs,
  kind: "acquire",
  choice: "Acquire at up to $11,292 at a 12% yield",
  rationale: "Zero-rate paper at a discount to face; the schedule is short and simple.",
  reviewDueAt: new Date(Date.now() + 45 * 86_400_000).toISOString(),
};
const post = (b: unknown) => request(app()).post("/api/note-investor/underwrite").send(b as object);

beforeEach(() => {
  h.rows = [{ id: 7, address: "9 Main St", county: "Harris", state: "TX", apn: "1" }];
  h.where = null;
  h.calls = [];
  h.scenarioReq = null;
  h.decisionArgs = null;
});

describe("POST /api/note-investor/underwrite", () => {
  it("records the note_price_yield scenario, then a note_investor decision citing it", async () => {
    const res = await post(body);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ scenarioId: 501, decisionId: 901 });
    expect(h.calls).toEqual(["scenario", "decision"]);
    expect(h.scenarioReq).toMatchObject({ engineId: "note_price_yield", strategyPackId: "note_investor", subjectId: 7 });

    const [org, decision, , scenarioIds] = h.decisionArgs as [number, Record<string, unknown>, Date, number[]];
    expect(org).toBe(ORG_ID);
    expect(decision).toMatchObject({ strategyPackId: "note_investor", kind: "acquire", actorRef: USER_ID, subjectId: 7, authority: "org_member:note_underwrite" });
    expect(decision.reviewDueAt).toEqual(new Date(body.reviewDueAt));
    expect(scenarioIds).toEqual([501]);
  });

  it.each(["offer", "pass"] as const)("%s is a recordable call too", async (kind) => {
    const res = await post({ ...body, kind });
    expect(res.status).toBe(200);
    expect((h.decisionArgs as [number, Record<string, unknown>])[1].kind).toBe(kind);
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
    ["a foreign kind", { kind: "hold" }],
    ["a rationale too short to grade later", { rationale: "cheap" }],
  ])("refuses %s before anything is written", async (_label, patch) => {
    const res = await post({ ...body, ...patch });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(h.calls).toEqual([]);
  });

  it("pack and engine are literals — a body cannot choose them", async () => {
    const res = await post({ ...body, engineId: "note_payoff", strategyPackId: "land_flipper" });
    expect(res.status).toBe(200);
    expect(h.scenarioReq).toMatchObject({ engineId: "note_price_yield", strategyPackId: "note_investor" });
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

  it("accepts note_price_yield under note_investor", async () => {
    await expect(recordUnderwrittenDecision(ORG_ID, { ...kitInput, engineId: "note_price_yield", strategyPackId: "note_investor" })).resolves.toMatchObject({ decisionId: 901 });
  });

  it.each([
    ["note_payoff", "note_investor"],
    ["note_price_yield", "land_flipper"],
    ["note_price_yield", "buy_and_hold"],
  ] as const)("refuses %s under %s, writing nothing", async (engineId, strategyPackId) => {
    await expect(recordUnderwrittenDecision(ORG_ID, { ...kitInput, engineId, strategyPackId })).rejects.toBeInstanceOf(ScenarioEngineError);
    expect(h.calls).toEqual([]);
  });
});
