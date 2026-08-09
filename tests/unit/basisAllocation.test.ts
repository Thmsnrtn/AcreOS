/**
 * Basis-allocation engine (developer vertical, Stage 1b) — the CPA's
 * basis-per-lot, split honestly. These are tax-time numbers, so the rules get
 * behavioural tests:
 *   • no parent purchase price → REFUSE (no basis to split);
 *   • a zero denominator → REFUSE (never divide by zero);
 *   • override shares that don't sum to 1.0 → REFUSE;
 *   • cents are CONSERVED — allocations sum EXACTLY to the parent basis.
 */
import { describe, it, expect } from "vitest";
import {
  allocateBasis,
  realizeCogs,
  type BasisAllocationChild,
} from "../../shared/subdivision/basisAllocation";

const threeChildren: BasisAllocationChild[] = [
  { id: 1, numerator: 1 },
  { id: 2, numerator: 1 },
  { id: 3, numerator: 1 },
];

describe("refusals — never allocate a basis it can't defend", () => {
  it("REFUSES when the parent has no purchase price (no basis to split)", () => {
    const r = allocateBasis({ parentBasisCents: null, method: "acreage", children: threeChildren });
    expect(r.allocations).toBeNull();
    expect(r.denominator).toBeNull();
    expect(r.refusedReason).toMatch(/no purchase price|basis/i);
  });

  it("REFUSES when the denominator is zero (all numerators zero)", () => {
    const r = allocateBasis({
      parentBasisCents: 10_000_000,
      method: "acreage",
      children: [
        { id: 1, numerator: 0 },
        { id: 2, numerator: 0 },
      ],
    });
    expect(r.allocations).toBeNull();
    expect(r.refusedReason).toMatch(/denominator is zero|divide/i);
  });

  it("REFUSES override shares that don't sum to 1.0", () => {
    const r = allocateBasis({
      parentBasisCents: 10_000_000,
      method: "override",
      children: [
        { id: 1, numerator: 0.5 },
        { id: 2, numerator: 0.3 }, // sums to 0.8, not 1.0
      ],
    });
    expect(r.allocations).toBeNull();
    expect(r.refusedReason).toMatch(/sum to 1\.0/i);
  });

  it("ACCEPTS override shares within the cent tolerance of 1.0", () => {
    const r = allocateBasis({
      parentBasisCents: 10_000_000,
      method: "override",
      children: [
        { id: 1, numerator: 0.5 },
        { id: 2, numerator: 0.4999 }, // 0.9999 — within tolerance
      ],
    });
    expect(r.refusedReason).toBeNull();
    expect(r.allocations).not.toBeNull();
  });
});

describe("cent conservation — the split loses no cent", () => {
  it("sums EXACTLY to the parent basis even when the raw split doesn't divide evenly", () => {
    // 100 cents across 3 equal lots: 33.33 each. Independent rounding would give
    // 33+33+33 = 99 (a lost cent); the last lot absorbs the remainder → 100.
    const r = allocateBasis({ parentBasisCents: 100, method: "acreage", children: threeChildren });
    expect(r.allocations).not.toBeNull();
    const cents = r.allocations!.map((a) => a.allocatedBasisCents);
    expect(cents).toEqual([33, 33, 34]);
    const sum = cents.reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  it("conserves cents for an uneven acreage split", () => {
    // $1,000,000 basis (100,000,000 cents) over 3 / 5 / 7 acres.
    const r = allocateBasis({
      parentBasisCents: 100_000_000,
      method: "acreage",
      children: [
        { id: 1, numerator: 3 },
        { id: 2, numerator: 5 },
        { id: 3, numerator: 7 },
      ],
    });
    expect(r.denominator).toBe(15);
    const sum = r.allocations!.reduce((a, b) => a + b.allocatedBasisCents, 0);
    expect(sum).toBe(100_000_000); // conserved to the cent
    // Shares are proportional to acreage.
    expect(r.allocations![0].sharePct).toBeCloseTo(3 / 15);
    expect(r.allocations![1].sharePct).toBeCloseTo(5 / 15);
  });

  it("splits by explicit override shares (denominator 1.0) and conserves cents", () => {
    const r = allocateBasis({
      parentBasisCents: 10_000_001, // odd cent
      method: "override",
      children: [
        { id: 1, numerator: 0.25 },
        { id: 2, numerator: 0.25 },
        { id: 3, numerator: 0.5 },
      ],
    });
    expect(r.denominator).toBe(1.0);
    const sum = r.allocations!.reduce((a, b) => a + b.allocatedBasisCents, 0);
    expect(sum).toBe(10_000_001);
  });
});

describe("realizeCogs — inventory COGS = allocated basis", () => {
  it("COGS is exactly the allocated basis; gain is sale − COGS", () => {
    const { cogsCents, gainCents } = realizeCogs({ allocatedBasisCents: 4_000_000, salePriceCents: 6_500_000 });
    expect(cogsCents).toBe(4_000_000);
    expect(gainCents).toBe(2_500_000);
  });

  it("reports a real LOSS (negative gain) rather than clamping to zero", () => {
    const { gainCents } = realizeCogs({ allocatedBasisCents: 5_000_000, salePriceCents: 3_000_000 });
    expect(gainCents).toBe(-2_000_000);
  });
});
