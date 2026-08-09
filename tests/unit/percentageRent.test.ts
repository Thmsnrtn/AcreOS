/**
 * Percentage-rent engine (Wave 4 Stage 3) — retail overage, computed honestly.
 *
 * A percentage-rent charge is a bill, so its rules get behavioural tests:
 *   • the overage is a function of REPORTED sales — no sales, no bill (refuse);
 *   • the breakpoint is derived (natural = base ÷ rate) or given (artificial),
 *     and a missing input refuses rather than picks a denominator;
 *   • a lease with no percentage-rent term is a clean not-applicable, not a
 *     computed zero.
 */
import { describe, it, expect } from "vitest";
import {
  computePercentageRent,
  type PercentageRentLeaseInput,
} from "../../shared/rental/percentageRent";

function lease(overrides: Partial<PercentageRentLeaseInput> = {}): PercentageRentLeaseInput {
  return {
    pctRentBps: 600, // 6%
    pctRentBreakpointType: "natural",
    pctRentArtificialBreakpointCents: null,
    periodBaseRentCents: 6_000_000, // $60,000 → natural breakpoint $1,000,000
    ...overrides,
  };
}

describe("not applicable — no percentage-rent term", () => {
  it("returns applicable=false (a clean absence, not a computed zero)", () => {
    const r = computePercentageRent({ lease: lease({ pctRentBps: null }), grossSalesCents: 150_000_000 });
    expect(r.applicable).toBe(false);
    expect(r.percentageRentCents).toBeNull();
    expect(r.refusedReason).toBeNull();
  });
});

describe("natural breakpoint = base rent ÷ rate", () => {
  it("computes the overage above the natural breakpoint", () => {
    const r = computePercentageRent({ lease: lease(), grossSalesCents: 150_000_000 });
    expect(r.breakpointBasis).toBe("natural");
    expect(r.breakpointCents).toBe(100_000_000); // 6,000,000 / 0.06
    expect(r.overageSalesCents).toBe(50_000_000); // 150M − 100M
    expect(r.percentageRentCents).toBe(3_000_000); // 50M × 6%
  });

  it("is zero overage when sales are below the breakpoint (not a refusal — a real zero)", () => {
    const r = computePercentageRent({ lease: lease(), grossSalesCents: 80_000_000 });
    expect(r.overageSalesCents).toBe(0);
    expect(r.percentageRentCents).toBe(0);
    expect(r.refusedReason).toBeNull();
  });

  it("REFUSES a natural breakpoint when the period base rent is unknown", () => {
    const r = computePercentageRent({
      lease: lease({ periodBaseRentCents: null }),
      grossSalesCents: 150_000_000,
    });
    expect(r.refusedReason).toBeTruthy();
    expect(r.percentageRentCents).toBeNull();
  });
});

describe("artificial breakpoint = the negotiated figure", () => {
  it("uses the given breakpoint", () => {
    const r = computePercentageRent({
      lease: lease({
        pctRentBps: 500,
        pctRentBreakpointType: "artificial",
        pctRentArtificialBreakpointCents: 100_000_000,
        periodBaseRentCents: null, // irrelevant for artificial
      }),
      grossSalesCents: 150_000_000,
    });
    expect(r.breakpointBasis).toBe("artificial");
    expect(r.breakpointCents).toBe(100_000_000);
    expect(r.overageSalesCents).toBe(50_000_000);
    expect(r.percentageRentCents).toBe(2_500_000); // 50M × 5%
  });

  it("REFUSES an artificial breakpoint with no figure set", () => {
    const r = computePercentageRent({
      lease: lease({ pctRentBreakpointType: "artificial", pctRentArtificialBreakpointCents: null }),
      grossSalesCents: 150_000_000,
    });
    expect(r.refusedReason).toBeTruthy();
    expect(r.percentageRentCents).toBeNull();
  });
});

describe("no sales reported — refuse, never assume", () => {
  it("REFUSES when grossSales is null (no report), on an otherwise-valid lease", () => {
    const r = computePercentageRent({ lease: lease(), grossSalesCents: null });
    expect(r.applicable).toBe(true);
    expect(r.refusedReason).toMatch(/reported sales|assumed figure/i);
    expect(r.percentageRentCents).toBeNull();
    expect(r.reportedGrossSalesCents).toBeNull();
  });
});
