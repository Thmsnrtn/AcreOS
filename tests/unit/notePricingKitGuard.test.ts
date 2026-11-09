/**
 * The decision kit's ownership guard holds for the note pricing engine, with
 * NO special case: server/services/underwriting/verticalDecision.ts is
 * untouched, and the guard reads `verticals` off the registered engine.
 *
 * The stores are mocked: this pins the guard (which runs BEFORE any write) and
 * the generic preview path only. It asserts nothing about what subject a note
 * decision would be keyed by — that is exactly what blocks recording today
 * (the stores key subjects by integer; notes are uuid-keyed). With the REAL
 * store, the guard lets note_pricing through, then recordScenario refuses
 * it before either write (subjectKind "note"). That is pinned in
 * tests/unit/scenarioSubjectGuard.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/economics/scenarioStore", () => ({
  recordScenario: vi.fn(async () => {
    h.calls.push("scenario");
    return { id: 7, computedAt: new Date(0), body: { metrics: [], assumptions: [] } };
  }),
}));
vi.mock("../../server/services/decisions/decisionStore", () => ({
  recordDecision: vi.fn(async () => {
    h.calls.push("decision");
    return { id: 11, decidedAt: new Date(0), body: {} };
  }),
}));

import { previewUnderwriting, recordUnderwrittenDecision, type UnderwrittenDecisionInput } from "../../server/services/underwriting/verticalDecision";
import { ALL_ENGINES } from "../../server/services/economics/engines";
import { BUSINESS_TYPE_IDS } from "../../shared/business-types";
import { ScenarioEngineError } from "../../shared/economics/scenario";

const WIRE = {
  upbCents: 100_000, noteRateBps: 1200, paymentCents: 50_751, remainingTermMonths: 2, status: "performing",
  targetYieldBps: 2400, servicingMonthlyCents: 1000, acquisitionCostsCents: 1500,
};

const input = (over: Partial<UnderwrittenDecisionInput>): UnderwrittenDecisionInput => ({
  subjectType: "deal", // placeholder for the mocked store only — see the header
  subjectId: 1,
  engineId: "note_pricing",
  strategyPackId: "note_investor",
  inputs: WIRE,
  scenarioLabel: "test",
  kind: "offer",
  choice: "test",
  rationale: "guard test only",
  actorRef: "user-1",
  authority: "org_member:test",
  reviewDueAt: null,
  ...over,
});

beforeEach(() => {
  h.calls.length = 0;
});

describe("the kit's ownership guard, for note_pricing", () => {
  it.each(BUSINESS_TYPE_IDS.filter((id) => id !== "note_investor"))("refuses note_pricing under the %s pack and writes nothing", async (pack) => {
    await expect(recordUnderwrittenDecision(9, input({ strategyPackId: pack }))).rejects.toThrow(ScenarioEngineError);
    expect(h.calls).toEqual([]);
  });

  it.each(ALL_ENGINES.filter((e) => e.id !== "note_pricing").map((e) => e.id))("refuses engine %s under note_investor and writes nothing", async (engineId) => {
    await expect(recordUnderwrittenDecision(9, input({ engineId }))).rejects.toThrow(ScenarioEngineError);
    expect(h.calls).toEqual([]);
  });

  it("the ownership guard lets note_pricing through under note_investor (positive control; the mocked store hides the real store's subject refusal)", async () => {
    await recordUnderwrittenDecision(9, input({}));
    expect(h.calls).toEqual(["scenario", "decision"]);
  });
});

describe("the generic preview path computes it and records nothing", () => {
  it("previews the max bid", () => {
    const p = previewUnderwriting("note_pricing", WIRE);
    expect(p.metrics.find((m) => m.id === "max_allowable_offer")?.value).toBe(95_094);
    expect(h.calls).toEqual([]);
  });
});
