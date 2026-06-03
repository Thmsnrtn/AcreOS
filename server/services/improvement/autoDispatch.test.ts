/**
 * Tests for evaluateForAutoDispatch — the real-queue wiring (Phase 2).
 *
 * Coverage:
 *  - Happy path: opportunity passes all 5 guardrails -> enqueueDispatch is
 *    called with the expected args -> opportunity row updated to
 *    dispatched_agent_id="dispatch:<id>".
 *  - Guardrail failure (G2 confidence floor): enqueueDispatch is NOT called;
 *    opportunity stays auto_dispatched=false.
 *  - enqueueDispatch throws: error is caught + logged; opportunity row is
 *    NOT marked dispatched.
 *  - team_member='solene' maps to agentRole='general-purpose'.
 *  - mapping helper: iris/soren/beatrice/krieger pass through verbatim.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamImprovementOpportunity } from "@shared/schema/team-improvement";

// ─────────────────────────────────────────────────────────────────────────
// Mocks — stub logger, db, capitalTracker, and dispatchQueue so the test
// is pure-CPU and deterministic.
// ─────────────────────────────────────────────────────────────────────────

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const updateSetMock = vi.fn();
const updateWhereMock = vi.fn().mockResolvedValue(undefined);
const updateMock = vi.fn(() => ({
  set: (...args: unknown[]) => {
    updateSetMock(...args);
    return { where: updateWhereMock };
  },
}));

vi.mock("../../db", () => ({
  db: {
    update: (...args: unknown[]) => updateMock(...args),
    // select / insert never invoked in these tests; provide no-ops just in case.
    select: vi.fn(),
    insert: vi.fn(),
  },
}));

vi.mock("../solene/capitalTracker", () => ({
  getMonthlyEnvelopeStatus: vi.fn().mockResolvedValue({
    envelopeUsd: 1000,
    monthToDateUsd: 50,
    percentUsed: 5,
  }),
}));

const enqueueDispatchMock = vi.fn();
vi.mock("../solene/dispatchQueue", () => ({
  enqueueDispatch: (...args: unknown[]) => enqueueDispatchMock(...args),
}));

// Import AFTER mocks so the module-level imports pick up the stubs.
import {
  evaluateForAutoDispatch,
  mapTeamMemberToAgentRole,
} from "./autoDispatch";
import { logger } from "../../utils/logger";

// ─────────────────────────────────────────────────────────────────────────
// Fixture builder
// ─────────────────────────────────────────────────────────────────────────

function makeOpportunity(
  overrides: Partial<TeamImprovementOpportunity> = {},
): TeamImprovementOpportunity {
  return {
    id: 42,
    detectedAt: new Date("2026-06-03T12:00:00Z"),
    teamMember: "iris",
    signalPattern: "recurring_gap",
    description: "Iris frequently re-pushes commits that fail the type-check stage.",
    evidence: {},
    confidence: "0.90" as unknown as number, // numeric stored as string by drizzle
    estimatedCostUsd: "10.00" as unknown as number,
    severity: "opportunity",
    autoDispatched: false,
    dispatchedAt: null,
    dispatchedAgentId: null,
    resolvedAt: null,
    resolutionCommit: null,
    ...overrides,
  } as TeamImprovementOpportunity;
}

// ─────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────

describe("evaluateForAutoDispatch — real queue wiring", () => {
  beforeEach(() => {
    enqueueDispatchMock.mockReset();
    updateMock.mockClear();
    updateSetMock.mockClear();
    updateWhereMock.mockClear();
    (logger.info as ReturnType<typeof vi.fn>).mockClear();
    (logger.warn as ReturnType<typeof vi.fn>).mockClear();
    (logger.error as ReturnType<typeof vi.fn>).mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("happy path: all guardrails pass -> enqueueDispatch called + opportunity row updated", async () => {
    enqueueDispatchMock.mockResolvedValueOnce(777);
    const opportunity = makeOpportunity();

    const result = await evaluateForAutoDispatch(opportunity, {
      now: new Date("2026-06-03T12:00:00Z"),
      countMemberDispatchesLast24h: async () => 0,
      getEnvelopeStatus: async () => ({
        envelopeUsd: 1000,
        monthToDateUsd: 50,
        percentUsed: 5,
      }),
    });

    expect(result.dispatched).toBe(true);
    expect(result.simulated).toBe(false);
    expect(result.dispatchId).toBe(777);
    expect(result.agentId).toBe("dispatch:777");
    expect(result.evaluation.passed).toBe(true);

    expect(enqueueDispatchMock).toHaveBeenCalledTimes(1);
    const call = enqueueDispatchMock.mock.calls[0][0];
    expect(call.sourceType).toBe("auto_dispatch");
    expect(call.sourceId).toBe("improvement:42");
    expect(call.agentRole).toBe("iris");
    expect(call.maxCostUsd).toBe(10);
    expect(call.timeoutMs).toBe(10 * 60 * 1000);
    expect(call.priority).toBe(1.0);
    expect(call.enqueuedBy).toBe("autoDispatch");
    expect(typeof call.promptText).toBe("string");
    expect(call.promptText.length).toBeGreaterThan(0);

    // Opportunity row update
    expect(updateMock).toHaveBeenCalledTimes(1);
    const setArg = updateSetMock.mock.calls[0][0] as {
      autoDispatched: boolean;
      dispatchedAgentId: string;
    };
    expect(setArg.autoDispatched).toBe(true);
    expect(setArg.dispatchedAgentId).toBe("dispatch:777");
  });

  it("urgent severity maps to priority=2.0", async () => {
    enqueueDispatchMock.mockResolvedValueOnce(901);
    const opportunity = makeOpportunity({ severity: "urgent" });

    await evaluateForAutoDispatch(opportunity, {
      now: new Date("2026-06-03T12:00:00Z"),
      countMemberDispatchesLast24h: async () => 0,
    });

    expect(enqueueDispatchMock).toHaveBeenCalledTimes(1);
    expect(enqueueDispatchMock.mock.calls[0][0].priority).toBe(2.0);
  });

  it("G2 confidence-floor failure: enqueueDispatch is NOT called and row is NOT updated", async () => {
    const opportunity = makeOpportunity({
      confidence: "0.50" as unknown as number,
    });

    const result = await evaluateForAutoDispatch(opportunity, {
      now: new Date("2026-06-03T12:00:00Z"),
      countMemberDispatchesLast24h: async () => 0,
    });

    expect(result.dispatched).toBe(false);
    expect(result.dispatchId).toBe(null);
    expect(result.agentId).toBe(null);
    expect(result.evaluation.passed).toBe(false);
    expect(result.evaluation.failed).toContain("confidence_floor");

    expect(enqueueDispatchMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("enqueueDispatch throws: error is caught + logged; opportunity row is NOT marked dispatched", async () => {
    enqueueDispatchMock.mockRejectedValueOnce(
      new Error("simulated DB outage"),
    );
    const opportunity = makeOpportunity();

    const result = await evaluateForAutoDispatch(opportunity, {
      now: new Date("2026-06-03T12:00:00Z"),
      countMemberDispatchesLast24h: async () => 0,
    });

    expect(result.dispatched).toBe(false);
    expect(result.dispatchId).toBe(null);
    expect(result.agentId).toBe(null);
    expect(result.evaluation.passed).toBe(true); // guardrails passed
    expect(result.enqueueError).toContain("simulated DB outage");

    expect(enqueueDispatchMock).toHaveBeenCalledTimes(1);
    // Row was NOT updated since enqueue threw.
    expect(updateMock).not.toHaveBeenCalled();
    // Error must have been logged.
    expect(logger.error).toHaveBeenCalled();
  });

  it("team_member='solene' maps to agentRole='general-purpose' in the dispatch", async () => {
    enqueueDispatchMock.mockResolvedValueOnce(555);
    const opportunity = makeOpportunity({ teamMember: "solene" });

    await evaluateForAutoDispatch(opportunity, {
      now: new Date("2026-06-03T12:00:00Z"),
      countMemberDispatchesLast24h: async () => 0,
    });

    expect(enqueueDispatchMock).toHaveBeenCalledTimes(1);
    expect(enqueueDispatchMock.mock.calls[0][0].agentRole).toBe(
      "general-purpose",
    );
  });

  it("G4 severity-gate (info) failure: enqueueDispatch not called", async () => {
    const opportunity = makeOpportunity({ severity: "info" });

    const result = await evaluateForAutoDispatch(opportunity, {
      now: new Date("2026-06-03T12:00:00Z"),
      countMemberDispatchesLast24h: async () => 0,
    });

    expect(result.dispatched).toBe(false);
    expect(result.evaluation.failed).toContain("severity_gate");
    expect(enqueueDispatchMock).not.toHaveBeenCalled();
  });

  it("G5 core-architecture-block (description mentions migration): enqueueDispatch not called", async () => {
    const opportunity = makeOpportunity({
      description: "Run a destructive migration to drop the audit table.",
    });

    const result = await evaluateForAutoDispatch(opportunity, {
      now: new Date("2026-06-03T12:00:00Z"),
      countMemberDispatchesLast24h: async () => 0,
    });

    expect(result.dispatched).toBe(false);
    expect(result.evaluation.failed).toContain("core_architecture_block");
    expect(enqueueDispatchMock).not.toHaveBeenCalled();
  });

  it("G1 per-member 24h ceiling failure: enqueueDispatch not called", async () => {
    const opportunity = makeOpportunity();

    const result = await evaluateForAutoDispatch(opportunity, {
      now: new Date("2026-06-03T12:00:00Z"),
      countMemberDispatchesLast24h: async () => 1,
    });

    expect(result.dispatched).toBe(false);
    expect(result.evaluation.failed).toContain("per_member_24h_ceiling");
    expect(enqueueDispatchMock).not.toHaveBeenCalled();
  });

  it("G3 cost-cap failure (>$50): enqueueDispatch not called", async () => {
    const opportunity = makeOpportunity({
      estimatedCostUsd: "75.00" as unknown as number,
    });

    const result = await evaluateForAutoDispatch(opportunity, {
      now: new Date("2026-06-03T12:00:00Z"),
      countMemberDispatchesLast24h: async () => 0,
    });

    expect(result.dispatched).toBe(false);
    expect(result.evaluation.failed).toContain("cost_cap");
    expect(enqueueDispatchMock).not.toHaveBeenCalled();
  });
});

describe("mapTeamMemberToAgentRole", () => {
  it("passes iris/soren/beatrice/krieger through verbatim", () => {
    expect(mapTeamMemberToAgentRole("iris")).toBe("iris");
    expect(mapTeamMemberToAgentRole("soren")).toBe("soren");
    expect(mapTeamMemberToAgentRole("beatrice")).toBe("beatrice");
    expect(mapTeamMemberToAgentRole("krieger")).toBe("krieger");
  });

  it("maps solene to general-purpose (orchestrator, not worker)", () => {
    expect(mapTeamMemberToAgentRole("solene")).toBe("general-purpose");
  });

  it("falls back to general-purpose for unknown members", () => {
    expect(mapTeamMemberToAgentRole("unknown")).toBe("general-purpose");
    expect(mapTeamMemberToAgentRole("")).toBe("general-purpose");
  });
});
