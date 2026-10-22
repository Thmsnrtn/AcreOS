/**
 * The vertical underwriting kit keeps the three guarantees every vertical's
 * decision route needs:
 *   1. the numbers are recomputed by a registered engine;
 *   2. the decision cites the scenario that justified it;
 *   3. the scenario and the decision carry the same pack, and that pack is one
 *      the engine DECLARES.
 *
 * Guarantee 3 is evidence rule v2 enforced at runtime
 * (decision-memos/2026-10-04-vertical-program.md §3). verticalEvidence.ts
 * credits a `recordUnderwrittenDecision(…)` call as scenario + decision, so this
 * file is what proves the kit actually performs both. Without it, the scanner's
 * trust in the call shape would be a claim.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ calls: [] as string[], scenarioArgs: [] as unknown[], decisionArgs: [] as unknown[] }));

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/economics/scenarioStore", () => ({
  recordScenario: vi.fn(async (_org: number, req: unknown) => {
    h.calls.push("scenario");
    h.scenarioArgs.push(req);
    return { id: 7, computedAt: new Date(0), body: { metrics: [{ id: "total_cost", value: 100, unit: "cents" }], assumptions: [] } };
  }),
}));
vi.mock("../../server/services/decisions/decisionStore", () => ({
  recordDecision: vi.fn(async (...args: unknown[]) => {
    h.calls.push("decision");
    h.decisionArgs.push(args);
    return { id: 11, decidedAt: new Date(0), body: {} };
  }),
}));

import {
  previewUnderwriting,
  recordUnderwrittenDecision,
  underwriteBodySchema,
  type UnderwrittenDecisionInput,
} from "../../server/services/underwriting/verticalDecision";
import { ScenarioEngineError } from "../../shared/economics/scenario";
import { wireInputs, type EngineField } from "../../shared/economics/engineFields";

const RENTAL = {
  purchasePriceCents: 20_000_000,
  monthlyRentCents: 200_000,
  vacancyPct: 5,
  monthlyFixedExpensesCents: 50_000,
  managementPct: 8,
  reservesPct: 10,
};

const base = (over: Partial<UnderwrittenDecisionInput> = {}): UnderwrittenDecisionInput => ({
  subjectType: "property",
  subjectId: 42,
  engineId: "rental_acquisition",
  strategyPackId: "buy_and_hold",
  inputs: RENTAL,
  scenarioLabel: "Buy at $200,000",
  kind: "acquire",
  choice: "Acquire at $200,000",
  rationale: "Cap rate clears our floor.",
  actorRef: "user-1",
  authority: "org_member:test",
  reviewDueAt: new Date("2026-12-01T00:00:00Z"),
  ...over,
});

beforeEach(() => {
  h.calls.length = 0;
  h.scenarioArgs.length = 0;
  h.decisionArgs.length = 0;
});

describe("recordUnderwrittenDecision", () => {
  it("writes the scenario, then the decision citing it, under one pack", async () => {
    const out = await recordUnderwrittenDecision(9, base());
    expect(h.calls).toEqual(["scenario", "decision"]);
    expect(h.scenarioArgs[0]).toMatchObject({ engineId: "rental_acquisition", strategyPackId: "buy_and_hold", subjectId: 42 });
    const [org, decision, , scenarioIds] = h.decisionArgs[0] as [number, Record<string, unknown>, Date, number[]];
    expect(org).toBe(9);
    expect(decision).toMatchObject({ strategyPackId: "buy_and_hold", kind: "acquire", actorType: "user", authority: "org_member:test" });
    expect(decision.reviewDueAt).toEqual(new Date("2026-12-01T00:00:00Z"));
    expect(scenarioIds).toEqual([7]);
    expect(out).toMatchObject({ scenarioId: 7, decisionId: 11 });
  });

  it("passes 'no set date' through as null, never a default", async () => {
    await recordUnderwrittenDecision(9, base({ reviewDueAt: null }));
    expect((h.decisionArgs[0] as [number, Record<string, unknown>])[1].reviewDueAt).toBeNull();
  });

  it("refuses a pack the engine does not declare — and writes nothing", async () => {
    await expect(recordUnderwrittenDecision(9, base({ strategyPackId: "fix_and_flip" }))).rejects.toThrow(ScenarioEngineError);
    expect(h.calls).toEqual([]);
  });

  it("refuses an unknown engine — and writes nothing", async () => {
    await expect(recordUnderwrittenDecision(9, base({ engineId: "made_up" }))).rejects.toThrow(/Unknown scenario engine/);
    expect(h.calls).toEqual([]);
  });
});

describe("previewUnderwriting", () => {
  it("computes with the registered engine and writes nothing", () => {
    const p = previewUnderwriting("rental_acquisition", RENTAL);
    expect(p.engineId).toBe("rental_acquisition");
    expect(p.metrics.find((m) => m.id === "total_cost")?.value).toBe(20_000_000);
    expect(h.calls).toEqual([]);
  });

  it("is deterministic — same inputs, same numbers", () => {
    const a = previewUnderwriting("rental_acquisition", RENTAL);
    const b = previewUnderwriting("rental_acquisition", RENTAL);
    expect(a).toEqual(b);
  });

  it("refuses an engine that underwrites no vertical", () => {
    expect(() => previewUnderwriting("note_payoff", {})).toThrow(/not a vertical underwriting engine/);
    expect(() => previewUnderwriting("rental_returns", RENTAL)).toThrow(/not a vertical underwriting engine/);
  });
});

describe("the route body", () => {
  const schema = underwriteBodySchema(["acquire", "pass"] as const);
  const body = { propertyId: 1, inputs: {}, kind: "acquire", choice: "x", rationale: "long enough reason", reviewDueAt: null };

  it("accepts 'no set date' as an answer", () => {
    expect(schema.safeParse(body).success).toBe(true);
  });

  it("refuses a body that never answered — absent is not 'never review'", () => {
    const { reviewDueAt: _omit, ...unanswered } = body;
    expect(schema.safeParse(unanswered).success).toBe(false);
  });

  it("refuses a kind this vertical's call cannot be", () => {
    expect(schema.safeParse({ ...body, kind: "dispose" }).success).toBe(false);
  });

  it("accepts a future review date and refuses a past one (due the instant it was recorded)", () => {
    expect(schema.safeParse({ ...body, reviewDueAt: new Date(Date.now() + 86_400_000).toISOString() }).success).toBe(true);
    expect(schema.safeParse({ ...body, reviewDueAt: new Date(Date.now() - 86_400_000).toISOString() }).success).toBe(false);
  });

  it("bounds the inputs it will freeze into an append-only row", () => {
    const many = Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`k${i}`, i]));
    expect(schema.safeParse({ ...body, inputs: many }).success).toBe(false);
    expect(schema.safeParse({ ...body, inputs: { ["k".repeat(65)]: 1 } }).success).toBe(false);
    expect(schema.safeParse({ ...body, inputs: { note: "x".repeat(201) } }).success).toBe(false);
    expect(schema.safeParse({ ...body, inputs: { priceCents: 1 } }).success).toBe(true);
  });
});

describe("engine field wiring", () => {
  const fields: EngineField[] = [
    { key: "priceCents", label: "Price", unit: "cents" },
    { key: "rate", label: "Rate", unit: "percent", max: 100 },
    { key: "expensesCents", label: "Expenses", unit: "cents", optional: true },
  ];

  it("dollars become integer cents; percent points pass through", () => {
    expect(wireInputs(fields, { priceCents: "$200,000.50", rate: "7.5" })).toEqual({
      inputs: { priceCents: 20_000_050, rate: 7.5 },
      missing: [],
    });
  });

  it("an empty optional is ABSENT, never zero", () => {
    expect(wireInputs(fields, { priceCents: "1", rate: "1", expensesCents: "" }).inputs).not.toHaveProperty("expensesCents");
  });

  it("an invalid or out-of-range value is reported, not coerced", () => {
    expect(wireInputs(fields, { priceCents: "abc", rate: "150" }).missing).toEqual(["priceCents", "rate"]);
  });
});
