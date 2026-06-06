/**
 * reserve-floor — pure logic tests for the floor-rule helpers in
 * shared/finance/reserve-floor.ts.
 *
 * No DB. No mocks. Just math.
 */

import { describe, it, expect } from "vitest";
import {
  RESERVE_FLOOR_RULE,
  computeReserveFloorCents,
  assembleReserveFloorCheck,
} from "../../shared/finance/reserve-floor";

describe("RESERVE_FLOOR_RULE", () => {
  it("minFraction is a sane fraction (0..1)", () => {
    expect(RESERVE_FLOOR_RULE.minFraction).toBeGreaterThan(0);
    expect(RESERVE_FLOOR_RULE.minFraction).toBeLessThan(1);
  });

  it("trailingWindowDays is a reasonable quarter-ish window", () => {
    expect(RESERVE_FLOOR_RULE.trailingWindowDays).toBeGreaterThanOrEqual(30);
    expect(RESERVE_FLOOR_RULE.trailingWindowDays).toBeLessThanOrEqual(365);
  });

  it("reserveBuckets lists exactly the three constitutional reserve names", () => {
    expect([...RESERVE_FLOOR_RULE.reserveBuckets].sort()).toEqual(
      ["profit_reserve", "refund_reserve", "tax_reserve"].sort(),
    );
  });
});

describe("computeReserveFloorCents", () => {
  it("returns 0 for zero or negative revenue", () => {
    expect(computeReserveFloorCents(0)).toBe(0);
    expect(computeReserveFloorCents(-1)).toBe(0);
  });

  it("rounds floor to the nearest cent", () => {
    // 333 cents × 0.30 = 99.9 → round to 100.
    const floor = computeReserveFloorCents(333);
    expect(floor).toBe(Math.round(333 * RESERVE_FLOOR_RULE.minFraction));
  });

  it("handles non-finite input safely", () => {
    expect(computeReserveFloorCents(Number.NaN)).toBe(0);
    expect(computeReserveFloorCents(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("assembleReserveFloorCheck", () => {
  it("reports belowFloor=false when reserves are exactly at floor", () => {
    const trailingRevenueCents = 1_000_000; // $10,000
    const floorCents = Math.round(trailingRevenueCents * RESERVE_FLOOR_RULE.minFraction);
    const c = assembleReserveFloorCheck({
      reservesTotalCents: floorCents,
      trailingRevenueCents,
    });
    expect(c.belowFloor).toBe(false);
    expect(c.headroomCents).toBe(0);
    expect(c.floorCents).toBe(floorCents);
  });

  it("reports belowFloor=true when reserves are 1 cent short", () => {
    const trailingRevenueCents = 1_000_000;
    const floorCents = Math.round(trailingRevenueCents * RESERVE_FLOOR_RULE.minFraction);
    const c = assembleReserveFloorCheck({
      reservesTotalCents: floorCents - 1,
      trailingRevenueCents,
    });
    expect(c.belowFloor).toBe(true);
    expect(c.headroomCents).toBe(-1);
  });

  it("reports belowFloor=false when trailing revenue is zero (no denominator)", () => {
    // Pre-revenue platform — there is no floor to breach.
    const c = assembleReserveFloorCheck({
      reservesTotalCents: 0,
      trailingRevenueCents: 0,
    });
    expect(c.belowFloor).toBe(false);
    expect(c.reservesFraction).toBe(0);
    expect(c.floorCents).toBe(0);
  });

  it("computes reservesFraction as reserves / trailingRevenue", () => {
    const c = assembleReserveFloorCheck({
      reservesTotalCents: 600,
      trailingRevenueCents: 1500,
    });
    expect(c.reservesFraction).toBeCloseTo(0.4, 10);
  });

  it("steady-state allocation (no spend) leaves headroom", () => {
    // In steady state every revenue dollar splits 0.25/0.10/0.05/0.05/0.55.
    // Reserves total = 0.40 of revenue. Floor at 0.30 = 25% headroom.
    const trailingRevenueCents = 10_000_000; // $100k
    const reservesTotalCents = Math.round(trailingRevenueCents * 0.40);
    const c = assembleReserveFloorCheck({
      reservesTotalCents,
      trailingRevenueCents,
    });
    expect(c.belowFloor).toBe(false);
    expect(c.headroomCents).toBeGreaterThan(0);
  });
});
