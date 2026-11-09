/**
 * POST /api/wholesale/underwrite — the residential wholesaler's decision route
 * (Leg 1). FALSIFYING: on pre-leg main the route module does not exist and the
 * kit refuses every residential_wholesaler decision.
 *
 * Proves:
 *   - the wholesale_mao scenario is written first, under residential_wholesaler,
 *     with the operator's comp / ARV / fee evidence frozen on it as their own
 *     ("user") assumptions;
 *   - the decision cites it, with the operator's review date;
 *   - the property lookup is org-scoped; another org's property writes nothing;
 *   - missing evidence, a future comp date, an unanswered review date and a
 *     foreign decision kind are refused before anything is written;
 *   - pack and engine are literals a body cannot steer;
 *   - the kit's ownership guard, unmodified, accepts wholesale_mao for
 *     residential_wholesaler and refuses every cross pairing, writing nothing.
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

const { default: router } = await import("../../server/routes-wholesale-underwriting");
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
  a.use("/api/wholesale", router);
  return a;
}

const inputs = {
  arvCents: 30_000_000,
  rehabEstimateCents: 4_000_000,
  targetFeeCents: 1_000_000,
  sellerRulePct: 75,
  sellerContingencyPct: 10,
  buyerRulePct: 70,
  buyerContingencyPct: 10,
};
const evidence = {
  comps: [
    { address: "12 Oak St", soldPriceCents: 29_500_000, soldOn: "2026-09-14" },
    { address: "40 Birch Ave", soldPriceCents: 30_800_000, soldOn: "2026-08-02" },
  ],
  arvBasis: "Average of two renovated 3/2 sales within half a mile.",
  feeBasis: "My floor for a deal needing a full kitchen.",
};
const body = {
  propertyId: 7,
  inputs,
  evidence,
  kind: "offer",
  choice: "Offer up to $156,000 to assign at a $10,000 fee",
  rationale: "The buyer's 70% number binds; the fee still clears my floor.",
  reviewDueAt: new Date(Date.now() + 45 * 86_400_000).toISOString(),
};
const post = (b: unknown) => request(app()).post("/api/wholesale/underwrite").send(b as object);

beforeEach(() => {
  h.rows = [{ id: 7, address: "9 Main St", county: "Harris", state: "TX", apn: "1" }];
  h.where = null;
  h.calls = [];
  h.scenarioReq = null;
  h.decisionArgs = null;
});

describe("POST /api/wholesale/underwrite", () => {
  it("records the wholesale_mao scenario with the evidence, then a residential_wholesaler decision citing it", async () => {
    const res = await post(body);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ scenarioId: 501, decisionId: 901 });
    expect(h.calls).toEqual(["scenario", "decision"]);
    expect(h.scenarioReq).toMatchObject({ engineId: "wholesale_mao", strategyPackId: "residential_wholesaler", subjectId: 7 });

    const assumptions = (h.scenarioReq as { assumptions: Array<Record<string, unknown>> }).assumptions;
    expect(assumptions).toEqual([
      { key: "comp_1", value: 29_500_000, unit: "cents", origin: "user", basis: "Sold comp: 12 Oak St, sold 2026-09-14" },
      { key: "comp_2", value: 30_800_000, unit: "cents", origin: "user", basis: "Sold comp: 40 Birch Ave, sold 2026-08-02" },
      { key: "arv_basis", value: evidence.arvBasis, origin: "user" },
      { key: "fee_basis", value: evidence.feeBasis, origin: "user" },
    ]);

    const [org, decision, , scenarioIds] = h.decisionArgs as [number, Record<string, unknown>, Date, number[]];
    expect(org).toBe(ORG_ID);
    expect(decision).toMatchObject({ strategyPackId: "residential_wholesaler", kind: "offer", actorRef: USER_ID, subjectId: 7, authority: "org_member:wholesale_underwrite" });
    expect(decision.reviewDueAt).toEqual(new Date(body.reviewDueAt));
    expect(scenarioIds).toEqual([501]);
  });

  it("'pass' is a recordable call too", async () => {
    const res = await post({ ...body, kind: "pass" });
    expect(res.status).toBe(200);
    expect((h.decisionArgs as [number, Record<string, unknown>])[1].kind).toBe("pass");
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
    ["no evidence at all", { evidence: undefined }],
    ["no comps", { evidence: { ...evidence, comps: [] } }],
    ["a comp sold in the future", { evidence: { ...evidence, comps: [{ ...evidence.comps[0], soldOn: "2099-01-01" }] } }],
    ["a comp sold on a day that does not exist", { evidence: { ...evidence, comps: [{ ...evidence.comps[0], soldOn: "2026-02-30" }] } }],
    ["a comp with no price", { evidence: { ...evidence, comps: [{ ...evidence.comps[0], soldPriceCents: 0 }] } }],
    ["no ARV basis", { evidence: { ...evidence, arvBasis: "" } }],
    ["no fee basis", { evidence: { ...evidence, feeBasis: "short" } }],
    ["an unanswered review date", { reviewDueAt: undefined }],
    ["a past review date", { reviewDueAt: new Date(Date.now() - 86_400_000).toISOString() }],
    ["a foreign kind", { kind: "acquire" }],
  ])("refuses %s before anything is written", async (_label, patch) => {
    const res = await post({ ...body, ...patch });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(h.calls).toEqual([]);
  });

  it("pack and engine are literals — a body cannot choose them", async () => {
    const res = await post({ ...body, engineId: "flip_mao", strategyPackId: "fix_and_flip" });
    expect(res.status).toBe(200);
    expect(h.scenarioReq).toMatchObject({ engineId: "wholesale_mao", strategyPackId: "residential_wholesaler" });
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

  it("accepts wholesale_mao under residential_wholesaler", async () => {
    await expect(recordUnderwrittenDecision(ORG_ID, { ...kitInput, engineId: "wholesale_mao", strategyPackId: "residential_wholesaler" })).resolves.toMatchObject({ decisionId: 901 });
  });

  it.each([
    ["flip_mao", "residential_wholesaler"],
    ["wholesale_mao", "fix_and_flip"],
    ["wholesale_mao", "buy_and_hold"],
  ] as const)("refuses %s under %s, writing nothing", async (engineId, strategyPackId) => {
    await expect(recordUnderwrittenDecision(ORG_ID, { ...kitInput, engineId, strategyPackId })).rejects.toBeInstanceOf(ScenarioEngineError);
    expect(h.calls).toEqual([]);
  });
});
