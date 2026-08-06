/**
 * aiSpendGuard — cost-ceiling + telemetry for the tool-calling AI agents that
 * cannot route through routeAITask (audit F-16-1 / F-08-4).
 *
 * Proves the two protections hold:
 *   1. assertAiSpendAllowed delegates to the platform cost ceiling and
 *      propagates its throw — so an agent refuses when the platform is over
 *      its daily AI budget instead of spending unbounded.
 *   2. recordExternalAiSpend computes the call's cost and writes a telemetry
 *      row (so the agent's spend counts toward the ceiling + COGS), and never
 *      throws even if the DB write fails.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { assertWithinAiCostCeiling, computeCostUsd, dbInsert } = vi.hoisted(() => ({
  assertWithinAiCostCeiling: vi.fn(async () => {}),
  computeCostUsd: vi.fn(() => 0.05),
  dbInsert: vi.fn(() => ({ values: vi.fn(async () => {}) })),
}));

vi.mock("../../server/services/aiCostCeiling", () => ({ assertWithinAiCostCeiling }));
vi.mock("../../server/services/aiCostRates", () => ({ computeCostUsd }));
vi.mock("../../server/db", () => ({ db: { insert: dbInsert } }));
vi.mock("@shared/schema", () => ({ aiTelemetryEvents: { __table: "ai_telemetry_events" } }));
vi.mock("../../server/utils/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { assertAiSpendAllowed, recordExternalAiSpend } from "../../server/services/aiSpendGuard";

const flush = () => new Promise((r) => setImmediate(r));

describe("aiSpendGuard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("assertAiSpendAllowed enforces the platform cost ceiling", async () => {
    await assertAiSpendAllowed(7);
    expect(assertWithinAiCostCeiling).toHaveBeenCalledWith(7);
  });

  it("propagates the ceiling error — the agent refuses when over budget", async () => {
    assertWithinAiCostCeiling.mockRejectedValueOnce(
      Object.assign(new Error("over ceiling"), { code: "AI_COST_CEILING_EXCEEDED" }),
    );
    await expect(assertAiSpendAllowed(7)).rejects.toThrow("over ceiling");
  });

  it("recordExternalAiSpend computes cost and writes a telemetry row", async () => {
    const valuesSpy = vi.fn(async () => {});
    dbInsert.mockReturnValueOnce({ values: valuesSpy });

    recordExternalAiSpend({ orgId: 7, taskType: "support_chat", model: "gpt-4o", promptTokens: 100, completionTokens: 50 });
    await flush();

    expect(computeCostUsd).toHaveBeenCalledWith("gpt-4o", 100, 50);
    expect(valuesSpy).toHaveBeenCalledTimes(1);
    const row = valuesSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(row.organizationId).toBe(7);
    expect(row.taskType).toBe("support_chat");
    expect(row.model).toBe("gpt-4o");
    expect(row.provider).toBe("openai");
    expect(row.totalTokens).toBe(150);
  });

  it("recordExternalAiSpend never throws even if the DB write fails", async () => {
    dbInsert.mockReturnValueOnce({ values: vi.fn(async () => { throw new Error("db down"); }) });
    expect(() => recordExternalAiSpend({ orgId: 7, taskType: "va_briefing", model: "gpt-4o" })).not.toThrow();
    await flush(); // the swallowed rejection resolves without surfacing
  });
});
