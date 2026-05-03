/**
 * vmResourceTracker — unit tests for the CPU normalisation helper.
 * The DB insert side-effect is exercised in integration tests; here we just
 * lock in the math so a 4-CPU box at 100% reads as 100, not 400.
 */

import { describe, it, expect } from "vitest";
import { computeCpuPercent } from "../../server/jobs/vmResourceTracker";

describe("computeCpuPercent", () => {
  it("returns 0 for a zero-window or zero-cpu input", () => {
    expect(computeCpuPercent({ user: 1000, system: 1000 }, 0, 1)).toBe(0);
    expect(computeCpuPercent({ user: 1000, system: 1000 }, 1000, 0)).toBe(0);
  });

  it("returns ~100 when a single CPU is fully pegged for the whole window", () => {
    // 1 second window in ms = 1000; in micros = 1_000_000.
    // Pegged 1 CPU for 1s = 1_000_000 micros of user time.
    const pct = computeCpuPercent({ user: 1_000_000, system: 0 }, 1000, 1);
    expect(pct).toBeGreaterThan(99);
    expect(pct).toBeLessThanOrEqual(100);
  });

  it("normalises by cpu count — 1 of 2 CPUs pegged ≈ 50%", () => {
    const pct = computeCpuPercent({ user: 1_000_000, system: 0 }, 1000, 2);
    expect(pct).toBeGreaterThan(49);
    expect(pct).toBeLessThan(51);
  });

  it("clamps to 100 when something feeds it a delta larger than the window", () => {
    const pct = computeCpuPercent({ user: 99_999_999, system: 0 }, 1000, 1);
    expect(pct).toBe(100);
  });

  it("never returns a negative value", () => {
    const pct = computeCpuPercent({ user: -1000, system: -1000 }, 1000, 1);
    expect(pct).toBeGreaterThanOrEqual(0);
  });
});
