/**
 * STR metrics engine — behavioural pin (short-term-rental Wave A).
 *
 * shared/rental/strMetrics.ts turns a window of reservations into
 * bookedNights / occupancyBps / roomRevenueCents / adrCents / revparCents.
 * It is pure, so this test exercises the real math with no DB. The two REFUSALS
 * are the point of the engine and are pinned in both directions:
 *
 *   1. ADR is NULL when bookedNights is 0 (no average rate across zero nights).
 *   2. Occupancy AND RevPAR are NULL when availableUnitNights is not derivable
 *      (0 or unknown) — never a ratio against an invented denominator.
 *
 * idempotent: true — pure function, no DATABASE_URL needed.
 */
import { describe, it, expect } from "vitest";
import { computeStrMetrics, windowNights } from "@shared/rental/strMetrics";

// A calendar month window: 2026-06-01 inclusive .. 2026-07-01 exclusive = 30 nights.
const JUNE_START = "2026-06-01";
const JULY_START = "2026-07-01";

describe("computeStrMetrics — the honest STR math", () => {
  it("computes booked nights, occupancy, room revenue, ADR and RevPAR for a fully-in-window stay", () => {
    const m = computeStrMetrics({
      reservations: [
        {
          checkIn: "2026-06-10",
          checkOut: "2026-06-15", // 5 nights, all inside the window
          status: "checked_out",
          grossBookingCents: 100_000,
          cleaningFeeCents: 10_000, // pass-through, excluded from room revenue
          taxesCents: 5_000, // pass-through, excluded from room revenue
        },
      ],
      windowStart: JUNE_START,
      windowEnd: JULY_START,
      availableUnitNights: 30, // 1 rentable unit × 30 window nights
    });

    expect(m.bookedNights).toBe(5);
    expect(m.availableNights).toBe(30);
    // room revenue = 100000 − 10000 − 5000 = 85000
    expect(m.roomRevenueCents).toBe(85_000);
    // occupancy = 5 / 30 = 16.6667% → 1667 bps (rounded)
    expect(m.occupancyBps).toBe(1667);
    // ADR = 85000 / 5 = 17000
    expect(m.adrCents).toBe(17_000);
    // RevPAR = 85000 / 30 = 2833 (rounded)
    expect(m.revparCents).toBe(2_833);
  });

  it("pro-rates nights AND room revenue for a stay straddling the window boundary", () => {
    const m = computeStrMetrics({
      reservations: [
        {
          checkIn: "2026-06-28",
          checkOut: "2026-07-03", // 5 nights total; only 3 (Jun 28,29,30) inside
          status: "booked",
          grossBookingCents: 50_000,
          cleaningFeeCents: null,
          taxesCents: null,
        },
      ],
      windowStart: JUNE_START,
      windowEnd: JULY_START,
      availableUnitNights: 30,
    });

    expect(m.bookedNights).toBe(3);
    // revenue pro-rated: 50000 × 3/5 = 30000
    expect(m.roomRevenueCents).toBe(30_000);
    // ADR is still revenue over the IN-WINDOW nights: 30000 / 3 = 10000
    expect(m.adrCents).toBe(10_000);
  });

  it("excludes cancelled stays from every metric", () => {
    const m = computeStrMetrics({
      reservations: [
        {
          checkIn: "2026-06-10",
          checkOut: "2026-06-15",
          status: "cancelled", // earns no night and no revenue
          grossBookingCents: 100_000,
          cleaningFeeCents: 0,
          taxesCents: 0,
        },
      ],
      windowStart: JUNE_START,
      windowEnd: JULY_START,
      availableUnitNights: 30,
    });

    expect(m.bookedNights).toBe(0);
    expect(m.roomRevenueCents).toBe(0);
    // occupancy is a real 0% (0/30) — the window is genuinely empty, not unknown
    expect(m.occupancyBps).toBe(0);
    expect(m.revparCents).toBe(0);
    // …but ADR refuses: there is no average rate across zero booked nights.
    expect(m.adrCents).toBeNull();
  });

  describe("REFUSAL 1 — ADR is null when nothing was booked", () => {
    it("returns null ADR for an empty window, while occupancy stays a real 0", () => {
      const m = computeStrMetrics({
        reservations: [],
        windowStart: JUNE_START,
        windowEnd: JULY_START,
        availableUnitNights: 30,
      });
      expect(m.bookedNights).toBe(0);
      expect(m.roomRevenueCents).toBe(0);
      expect(m.adrCents).toBeNull(); // <- refusal, not $0
      expect(m.occupancyBps).toBe(0);
      expect(m.availableNights).toBe(30);
    });
  });

  describe("REFUSAL 2 — occupancy and RevPAR are null when availableUnitNights is not derivable", () => {
    it("refuses occupancy + RevPAR when availableUnitNights is null (unknown), but still reports ADR", () => {
      const m = computeStrMetrics({
        reservations: [
          {
            checkIn: "2026-06-10",
            checkOut: "2026-06-15",
            status: "checked_out",
            grossBookingCents: 90_000,
            cleaningFeeCents: 0,
            taxesCents: 0,
          },
        ],
        windowStart: JUNE_START,
        windowEnd: JULY_START,
        availableUnitNights: null, // no rentable-unit count on record
      });

      expect(m.bookedNights).toBe(5);
      expect(m.roomRevenueCents).toBe(90_000);
      expect(m.adrCents).toBe(18_000); // ADR needs no denominator — 90000/5
      // …but the occupancy denominator is unknown, so both refuse:
      expect(m.availableNights).toBeNull();
      expect(m.occupancyBps).toBeNull();
      expect(m.revparCents).toBeNull();
    });

    it("also refuses when availableUnitNights is 0 (an empty/invalid denominator)", () => {
      const m = computeStrMetrics({
        reservations: [
          {
            checkIn: "2026-06-10",
            checkOut: "2026-06-15",
            status: "booked",
            grossBookingCents: 90_000,
            cleaningFeeCents: 0,
            taxesCents: 0,
          },
        ],
        windowStart: JUNE_START,
        windowEnd: JULY_START,
        availableUnitNights: 0,
      });
      expect(m.availableNights).toBeNull();
      expect(m.occupancyBps).toBeNull();
      expect(m.revparCents).toBeNull();
    });
  });

  it("drops a stay that falls entirely outside the window", () => {
    const m = computeStrMetrics({
      reservations: [
        {
          checkIn: "2026-05-01",
          checkOut: "2026-05-05", // wholly before the June window
          status: "checked_out",
          grossBookingCents: 40_000,
          cleaningFeeCents: 0,
          taxesCents: 0,
        },
      ],
      windowStart: JUNE_START,
      windowEnd: JULY_START,
      availableUnitNights: 30,
    });
    expect(m.bookedNights).toBe(0);
    expect(m.roomRevenueCents).toBe(0);
    expect(m.adrCents).toBeNull();
  });
});

describe("windowNights — the denominator multiplier", () => {
  it("counts the nights in a [start, end) window", () => {
    expect(windowNights(JUNE_START, JULY_START)).toBe(30);
    expect(windowNights("2026-06-01", "2026-06-08")).toBe(7);
  });

  it("returns null for an empty or inverted window (refuse, don't fabricate a denominator)", () => {
    expect(windowNights("2026-06-01", "2026-06-01")).toBeNull();
    expect(windowNights("2026-07-01", "2026-06-01")).toBeNull();
    expect(windowNights("bad", "2026-07-01")).toBeNull();
  });
});
