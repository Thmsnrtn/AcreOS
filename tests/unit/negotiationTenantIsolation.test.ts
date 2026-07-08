/**
 * Regression guard for the negotiation tenant-isolation fix (migration 0163).
 *
 * The orchestrator previously ranked strategies + rolled up performance with
 * `findMany({})` across ALL organizations. The fix org-scopes strategies and
 * outcomes and links threads → the strategy driving them. If any of these
 * columns is removed, the cross-tenant leak silently returns — so lock the
 * schema shape here.
 */
import { describe, it, expect } from "vitest";
import {
  negotiationStrategies,
  negotiationOutcomes,
  negotiationThreads,
} from "@shared/schema";

describe("negotiation tenant-isolation schema (migration 0163)", () => {
  it("negotiation_strategies is org-scoped", () => {
    expect(negotiationStrategies.organizationId).toBeDefined();
    expect(negotiationStrategies.organizationId.name).toBe("organization_id");
  });

  it("negotiation_outcomes is org-scoped", () => {
    expect(negotiationOutcomes.organizationId).toBeDefined();
    expect(negotiationOutcomes.organizationId.name).toBe("organization_id");
  });

  it("negotiation_threads link to the driving strategy", () => {
    expect(negotiationThreads.strategyId).toBeDefined();
    expect(negotiationThreads.strategyId.name).toBe("strategy_id");
  });

  it("the orchestrator source no longer reads strategies/threads cross-org", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../server/services/negotiationOrchestrator.ts"),
      "utf-8",
    );
    // The two unscoped global reads that caused the leak must be gone.
    expect(src).not.toContain("findMany({})");
    // getBestStrategy + updateStrategyPerformance must filter by org.
    expect(src).toContain("negotiationStrategies.organizationId");
    expect(src).toContain("negotiationThreads.organizationId");
  });
});
