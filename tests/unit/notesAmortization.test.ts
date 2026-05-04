/**
 * Note Investor vertical (Phase 5 §5) — amortization-schedule unit tests.
 *
 * Guards the pure computeAmortization() helper against regressions:
 *   • Schedule sums to currentBalance (principal portion).
 *   • Interest decreases monotonically as principal pays down.
 *   • Last row leaves balance at 0 (or short-circuits if payment doesn't
 *     cover interest — negative-amortization safeguard).
 *   • Day clamping for short months (Feb 30 → Feb 28/29).
 */
import { describe, it, expect } from "vitest";
import { computeAmortization } from "../../server/routes-notes";

describe("computeAmortization", () => {
  it("amortizes a small note to zero balance when given enough term", () => {
    // $10,000 principal, 8% APR, $250/mo payment over 120 months — fully
    // amortizes well before the term cap.
    const schedule = computeAmortization({
      currentBalanceCents: 10_000_00,
      interestRateBps: 800,
      paymentAmountCents: 250_00,
      termMonthsRemaining: 120,
      startDate: new Date("2026-01-15"),
      paymentDueDay: 15,
    });

    expect(schedule.length).toBeGreaterThan(0);
    expect(schedule.length).toBeLessThanOrEqual(120);
    // The last row should leave the balance at 0 (full pay-down).
    expect(schedule[schedule.length - 1]!.balance).toBe(0);
    // Principal across all rows must equal the starting balance (within
    // a few cents — rounding accumulates over many payments).
    const totalPrincipal = schedule.reduce((s, r) => s + r.principal, 0);
    expect(Math.abs(totalPrincipal - 10_000_00)).toBeLessThanOrEqual(50);
  });

  it("interest portion declines monotonically as principal pays down", () => {
    const schedule = computeAmortization({
      currentBalanceCents: 50_000_00,
      interestRateBps: 1000,
      paymentAmountCents: 600_00,
      termMonthsRemaining: 120,
      startDate: new Date("2026-02-01"),
      paymentDueDay: 1,
    });
    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i]!.interest).toBeLessThanOrEqual(schedule[i - 1]!.interest);
    }
  });

  it("clamps payment due day on short months (Feb 28/29)", () => {
    // Due day = 31, starting in Jan → due dates land on the last day of
    // the next month (Feb 28 in non-leap years).
    const schedule = computeAmortization({
      currentBalanceCents: 1_000_00,
      interestRateBps: 500,
      paymentAmountCents: 100_00,
      termMonthsRemaining: 12,
      startDate: new Date("2026-01-31"),
      paymentDueDay: 31,
    });
    // Payment 1 lands in Feb 2026 — non-leap, last day is 28.
    expect(schedule[0]!.dueDate.endsWith("-02-28")).toBe(true);
  });

  it("short-circuits when payment does not cover interest (no runaway)", () => {
    // $10k @ 24% = $200/mo interest; payment of $50 doesn't cover it.
    const schedule = computeAmortization({
      currentBalanceCents: 10_000_00,
      interestRateBps: 2400,
      paymentAmountCents: 50_00,
      termMonthsRemaining: 360,
      startDate: new Date("2026-01-01"),
      paymentDueDay: 1,
    });
    expect(schedule.length).toBe(0);
  });
});
