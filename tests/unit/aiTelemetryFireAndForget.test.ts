import { describe, it, expect, vi } from "vitest";

// ============================================================================
// Contract test: recordAiCall is documented "fully fire-and-forget — every
// failure is logged but never rethrown", and every caller does
// `void recordAiCall(...)`. So a throw ANYWHERE in its body (even before the
// first inner try block) must never escape as a rejection — in CI that
// surfaces as vitest "Unhandled Rejection" (seen 2026-06-10 when
// coerceAiFeature raced module teardown); in prod it's an unhandledRejection
// on the process.
// ============================================================================

vi.mock("@shared/schema", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@shared/schema")>();
  return {
    ...actual,
    // Simulate the pre-try throw: the very first statement of the body.
    coerceAiFeature: () => {
      throw new Error("boom — simulated pre-try failure");
    },
  };
});

describe("ai-telemetry.recordAiCall — never-rejects contract", () => {
  it("resolves (does not reject) even when the body throws before any inner try", async () => {
    const { recordAiCall } = await import("../../server/services/ai-telemetry");
    await expect(
      recordAiCall({
        organizationId: null,
        model: "test-model",
        complexityClass: "simple",
        feature: "unit_test",
      } as Parameters<typeof recordAiCall>[0]),
    ).resolves.toBeUndefined();
  });
});
