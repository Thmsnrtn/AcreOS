/**
 * Pillar 9.3 — per-request log-budget test.
 *
 * The logger module wraps requests in an AsyncLocalStorage context so
 * that the (LOG_BUDGET_PER_REQUEST+1)-th info call gets demoted to
 * debug. This test exercises the wrapper without spinning up Express.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("Pillar 9.3 — LOG_BUDGET_PER_REQUEST", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleDebugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleDebugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleDebugSpy.mockRestore();
  });

  it("exports the constant", async () => {
    const { LOG_BUDGET_PER_REQUEST } = await import("../../server/utils/logger");
    expect(LOG_BUDGET_PER_REQUEST).toBe(5);
  });

  it("demotes info calls beyond the budget to debug when inside withRequestLogBudget", async () => {
    const { logger, withRequestLogBudget, LOG_BUDGET_PER_REQUEST } =
      await import("../../server/utils/logger");

    withRequestLogBudget(() => {
      for (let i = 0; i < LOG_BUDGET_PER_REQUEST + 3; i++) {
        logger.info(`msg ${i}`);
      }
    });

    // First N calls = console.log; the overflow goes to console.debug
    // (which the logger only actually emits in non-production).
    expect(consoleLogSpy.mock.calls.length).toBe(LOG_BUDGET_PER_REQUEST);
  });

  it("does not demote info logs outside of the request context", async () => {
    const { logger } = await import("../../server/utils/logger");
    for (let i = 0; i < 10; i++) {
      logger.info(`background msg ${i}`);
    }
    // All 10 should hit console.log when there's no budget context.
    expect(consoleLogSpy.mock.calls.length).toBe(10);
  });
});
