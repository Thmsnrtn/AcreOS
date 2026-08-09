/**
 * Per-stay P&L engine — behavioural pin (short-term-rental Wave B).
 *
 * shared/rental/stayPnl.ts turns a reservation's OWN recorded money plus an
 * allocated operating expense into a per-stay P&L. It is pure, so this test
 * exercises the real math with no DB. The REFUSALS are the point of the engine
 * and are pinned in both directions:
 *
 *   1. NET MATH — net = gross − channelFee − cleaningFee − taxes − allocatedOpex,
 *      when every term is known (a genuine recorded 0 is known and subtracts 0).
 *   2. OMIT-NOT-FABRICATE ON A MISSING FEE — an UNRECORDED (null) fee omits its
 *      line (marked unavailable) and the net REFUSES (null), never a fabricated 0
 *      that would overstate the margin.
 *   3. OMIT-NOT-FABRICATE ON THE OPEX AXIS — when the property has NO measured
 *      operating expenses, the allocated op-ex is null (unavailable, disclosed)
 *      and the net refuses — NOT a guessed 40%-of-revenue ratio.
 *
 * idempotent: true — pure function, no DATABASE_URL needed.
 */
import { describe, it, expect } from "vitest";
import {
  computeStayPnl,
  allocateStayOperatingExpense,
  stayNightsBetween,
} from "@shared/rental/stayPnl";
import type { MeasurableExpenseRow } from "@shared/rental/noi";

describe("computeStayPnl — the honest per-stay P&L", () => {
  it("computes net = gross − channelFee − cleaningFee − taxes − allocatedOpex when every term is known", () => {
    const pnl = computeStayPnl({
      reservation: {
        grossBookingCents: 200_000,
        channelFeeCents: 30_000,
        cleaningFeeCents: 15_000,
        taxesCents: 10_000,
      },
      allocatedOperatingExpenseCents: 25_000,
    });

    // 200000 − 30000 − 15000 − 10000 − 25000 = 120000
    expect(pnl.netCents).toBe(120_000);
    expect(pnl.unavailableComponents).toEqual([]);
    expect(pnl.grossBookingCents).toBe(200_000);
    expect(pnl.allocatedOperatingExpenseCents).toBe(25_000);
    // Every line present and available.
    expect(pnl.lines.map((l) => l.key)).toEqual([
      "gross_booking",
      "channel_fee",
      "cleaning_fee",
      "taxes",
      "allocated_operating_expense",
    ]);
    expect(pnl.lines.every((l) => l.available)).toBe(true);
    const gross = pnl.lines.find((l) => l.key === "gross_booking");
    expect(gross?.kind).toBe("income");
  });

  it("treats a GENUINE recorded 0 fee as a real $0 line and subtracts 0 (direct booking, no channel fee)", () => {
    const pnl = computeStayPnl({
      reservation: {
        grossBookingCents: 100_000,
        channelFeeCents: 0, // genuinely absent — a direct booking, recorded as 0
        cleaningFeeCents: 0,
        taxesCents: 0,
      },
      allocatedOperatingExpenseCents: 0,
    });
    // A recorded 0 is KNOWN, so the net computes: 100000 − 0 − 0 − 0 − 0.
    expect(pnl.netCents).toBe(100_000);
    expect(pnl.unavailableComponents).toEqual([]);
    const channel = pnl.lines.find((l) => l.key === "channel_fee");
    expect(channel?.available).toBe(true);
    expect(channel?.amountCents).toBe(0); // a real recorded zero, not an omission
  });

  it("REFUSES the net and OMITS the line when a fee is UNKNOWN (null), never treating it as 0", () => {
    const pnl = computeStayPnl({
      reservation: {
        grossBookingCents: 100_000,
        channelFeeCents: null, // unrecorded — unknown, NOT zero
        cleaningFeeCents: 5_000,
        taxesCents: 5_000,
      },
      allocatedOperatingExpenseCents: 10_000,
    });
    // The net cannot be honestly computed against an unknown deduction.
    expect(pnl.netCents).toBeNull();
    expect(pnl.unavailableComponents).toEqual(["channel_fee"]);
    const channel = pnl.lines.find((l) => l.key === "channel_fee");
    expect(channel?.available).toBe(false);
    expect(channel?.amountCents).toBeNull(); // omitted, not a fabricated 0
    // The other lines are still reported with their real recorded values.
    expect(pnl.cleaningFeeCents).toBe(5_000);
    expect(pnl.grossBookingCents).toBe(100_000);
  });

  it("REFUSES the net when gross booking is unknown (no revenue anchor)", () => {
    const pnl = computeStayPnl({
      reservation: {
        grossBookingCents: null,
        channelFeeCents: 0,
        cleaningFeeCents: 0,
        taxesCents: 0,
      },
      allocatedOperatingExpenseCents: 0,
    });
    expect(pnl.netCents).toBeNull();
    expect(pnl.unavailableComponents).toContain("gross_booking");
    expect(pnl.grossBookingCents).toBeNull();
  });

  describe("OMIT-NOT-FABRICATE on the missing opex axis", () => {
    it("marks the op-ex line unavailable and refuses the net when allocatedOpex is null (no measured op-ex)", () => {
      const pnl = computeStayPnl({
        reservation: {
          grossBookingCents: 100_000,
          channelFeeCents: 10_000,
          cleaningFeeCents: 5_000,
          taxesCents: 5_000,
        },
        allocatedOperatingExpenseCents: null, // property has no measured operating expenses
      });
      // The net refuses rather than assume the operating overhead was zero, and
      // rather than substitute a guessed ratio.
      expect(pnl.netCents).toBeNull();
      expect(pnl.unavailableComponents).toEqual(["allocated_operating_expense"]);
      const opex = pnl.lines.find((l) => l.key === "allocated_operating_expense");
      expect(opex?.available).toBe(false);
      expect(opex?.amountCents).toBeNull(); // NOT a fabricated 40%-of-revenue ratio
      // The recorded booking terms are still surfaced honestly.
      expect(pnl.grossBookingCents).toBe(100_000);
      expect(pnl.channelFeeCents).toBe(10_000);
    });
  });
});

describe("allocateStayOperatingExpense — measured op-ex pro-rated to the stay", () => {
  it("allocates the MEASURED operating expenses over the window's nights, excluding non-operating lines", () => {
    const rows: MeasurableExpenseRow[] = [
      { category: "insurance", amountCents: 120_000, isOperating: true, incurredOn: "2026-06-15" },
      { category: "repairs", amountCents: 30_000, isOperating: true, incurredOn: "2026-06-20" },
      // Non-operating lines must NEVER enter the allocation (noi.ts's rule).
      { category: "mortgage_interest", amountCents: 500_000, isOperating: false, incurredOn: "2026-06-10" },
      { category: "depreciation", amountCents: 200_000, isOperating: false, incurredOn: "2026-06-01" },
    ];
    const alloc = allocateStayOperatingExpense({ expenseRows: rows, stayNights: 5 });

    // Operating sum = 120000 + 30000 = 150000 (financing/non-cash excluded).
    expect(alloc.operatingSumCents).toBe(150_000);
    expect(alloc.operatingRowCount).toBe(2);
    // Window spans June 2026 only (from the OPERATING rows): 2026-06-01..2026-07-01 = 30 nights.
    expect(alloc.windowNights).toBe(30);
    // 150000 × 5/30 = 25000.
    expect(alloc.allocatedOperatingExpenseCents).toBe(25_000);
  });

  it("spans the full window across non-contiguous operating months", () => {
    const rows: MeasurableExpenseRow[] = [
      { category: "insurance", amountCents: 92_000, isOperating: true, incurredOn: "2026-06-15" },
      { category: "utilities", amountCents: 0, isOperating: true, incurredOn: "2026-08-05" },
    ];
    const alloc = allocateStayOperatingExpense({ expenseRows: rows, stayNights: 92 });
    // Window: 2026-06-01 .. 2026-09-01 = 30 + 31 + 31 = 92 nights.
    expect(alloc.windowNights).toBe(92);
    // 92000 × 92/92 = 92000.
    expect(alloc.allocatedOperatingExpenseCents).toBe(92_000);
  });

  it("returns null (unavailable) when the property has NO measured operating expenses — never a guess", () => {
    const alloc = allocateStayOperatingExpense({ expenseRows: [], stayNights: 5 });
    expect(alloc.operatingRowCount).toBe(0);
    expect(alloc.allocatedOperatingExpenseCents).toBeNull();

    // A property whose ONLY expenses are non-operating still has no measured op-ex.
    const onlyFinancing: MeasurableExpenseRow[] = [
      { category: "mortgage_interest", amountCents: 500_000, isOperating: false, incurredOn: "2026-06-10" },
    ];
    const alloc2 = allocateStayOperatingExpense({ expenseRows: onlyFinancing, stayNights: 5 });
    expect(alloc2.operatingRowCount).toBe(0);
    expect(alloc2.windowNights).toBeNull();
    expect(alloc2.allocatedOperatingExpenseCents).toBeNull();
  });

  it("feeds the engine end-to-end: no measured op-ex ⇒ opex line unavailable ⇒ net refuses", () => {
    const alloc = allocateStayOperatingExpense({ expenseRows: [], stayNights: 3 });
    const pnl = computeStayPnl({
      reservation: {
        grossBookingCents: 60_000,
        channelFeeCents: 6_000,
        cleaningFeeCents: 4_000,
        taxesCents: 2_000,
      },
      allocatedOperatingExpenseCents: alloc.allocatedOperatingExpenseCents,
    });
    expect(pnl.netCents).toBeNull();
    expect(pnl.unavailableComponents).toEqual(["allocated_operating_expense"]);
  });
});

describe("stayNightsBetween", () => {
  it("counts whole nights (check-out exclusive)", () => {
    expect(stayNightsBetween("2026-06-10", "2026-06-15")).toBe(5);
    expect(stayNightsBetween("2026-06-10", "2026-06-11")).toBe(1);
  });
  it("refuses (null) an inverted, equal or malformed range", () => {
    expect(stayNightsBetween("2026-06-15", "2026-06-10")).toBeNull();
    expect(stayNightsBetween("2026-06-10", "2026-06-10")).toBeNull();
    expect(stayNightsBetween("bad", "2026-06-15")).toBeNull();
  });
});
