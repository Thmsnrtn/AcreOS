/**
 * Commercial contractual late-fee engine (Wave 4 Stage 5b).
 *
 * A commercial late fee is CONTRACTUAL — set by the lease, not by statute. The
 * engine computes it from the lease's own terms and REFUSES rather than invent a
 * fee when the term is missing, so it can never present a fabricated charge.
 */
import { describe, it, expect } from "vitest";
import {
  computeCommercialLateFee,
  type CommercialLateFeeLeaseTerms,
} from "../../shared/rental/commercialLateFee";

function terms(overrides: Partial<CommercialLateFeeLeaseTerms> = {}): CommercialLateFeeLeaseTerms {
  return {
    lateFeeType: "flat",
    lateFeeFlatCents: 5_000,
    lateFeePctBps: null,
    lateFeeGraceDays: 5,
    lateFeeMaxCents: null,
    lateFeePerDayCents: null,
    ...overrides,
  };
}

describe("no contractual term — refuse, never invent", () => {
  it("REFUSES (applicable=false) when the lease sets no late-fee type", () => {
    const r = computeCommercialLateFee({
      lease: terms({ lateFeeType: null }),
      overdueBalanceCents: 100_000,
      daysLate: 30,
    });
    expect(r.applicable).toBe(false);
    expect(r.lateFeeCents).toBeNull();
    expect(r.refusedReason).toBeTruthy();
  });
});

describe("explicit 'none' — a real zero", () => {
  it("returns 0 with basis 'none'", () => {
    const r = computeCommercialLateFee({
      lease: terms({ lateFeeType: "none" }),
      overdueBalanceCents: 100_000,
      daysLate: 30,
    });
    expect(r.lateFeeCents).toBe(0);
    expect(r.basis).toBe("none");
    expect(r.refusedReason).toBeNull();
  });
});

describe("grace period", () => {
  it("is zero and withinGrace while inside the grace window", () => {
    const r = computeCommercialLateFee({
      lease: terms({ lateFeeType: "flat", lateFeeFlatCents: 5_000, lateFeeGraceDays: 5 }),
      overdueBalanceCents: 100_000,
      daysLate: 5, // == grace, not yet chargeable
    });
    expect(r.withinGrace).toBe(true);
    expect(r.lateFeeCents).toBe(0);
  });
});

describe("flat", () => {
  it("charges the flat amount past grace", () => {
    const r = computeCommercialLateFee({
      lease: terms({ lateFeeType: "flat", lateFeeFlatCents: 5_000, lateFeeGraceDays: 5 }),
      overdueBalanceCents: 100_000,
      daysLate: 6,
    });
    expect(r.lateFeeCents).toBe(5_000);
    expect(r.basis).toBe("flat");
  });

  it("REFUSES a flat type with no amount", () => {
    const r = computeCommercialLateFee({
      lease: terms({ lateFeeType: "flat", lateFeeFlatCents: null }),
      overdueBalanceCents: 100_000,
      daysLate: 30,
    });
    expect(r.refusedReason).toBeTruthy();
    expect(r.lateFeeCents).toBeNull();
  });
});

describe("pct_of_overdue", () => {
  it("charges a percentage of the overdue balance", () => {
    const r = computeCommercialLateFee({
      lease: terms({ lateFeeType: "pct_of_overdue", lateFeeFlatCents: null, lateFeePctBps: 500, lateFeeGraceDays: 0 }),
      overdueBalanceCents: 200_000,
      daysLate: 10,
    });
    expect(r.lateFeeCents).toBe(10_000); // 5% of 200,000
  });

  it("REFUSES a percentage type with no rate", () => {
    const r = computeCommercialLateFee({
      lease: terms({ lateFeeType: "pct_of_overdue", lateFeeFlatCents: null, lateFeePctBps: null }),
      overdueBalanceCents: 200_000,
      daysLate: 10,
    });
    expect(r.refusedReason).toBeTruthy();
  });
});

describe("per_diem", () => {
  it("accrues per day PAST the grace period", () => {
    const r = computeCommercialLateFee({
      lease: terms({ lateFeeType: "per_diem", lateFeeFlatCents: null, lateFeePerDayCents: 1_000, lateFeeGraceDays: 5 }),
      overdueBalanceCents: 100_000,
      daysLate: 15, // 10 chargeable days
    });
    expect(r.lateFeeCents).toBe(10_000); // 1,000 × 10
  });

  it("REFUSES a per-diem type with no daily rate", () => {
    const r = computeCommercialLateFee({
      lease: terms({ lateFeeType: "per_diem", lateFeeFlatCents: null, lateFeePerDayCents: null }),
      overdueBalanceCents: 100_000,
      daysLate: 15,
    });
    expect(r.refusedReason).toBeTruthy();
  });
});

describe("max cap", () => {
  it("caps the fee at the contractual maximum and discloses it", () => {
    const r = computeCommercialLateFee({
      lease: terms({
        lateFeeType: "per_diem",
        lateFeeFlatCents: null,
        lateFeePerDayCents: 1_000,
        lateFeeGraceDays: 0,
        lateFeeMaxCents: 5_000,
      }),
      overdueBalanceCents: 100_000,
      daysLate: 30, // would be 30,000 uncapped
    });
    expect(r.lateFeeCents).toBe(5_000);
    expect(r.cappedByMax).toBe(true);
  });
});
