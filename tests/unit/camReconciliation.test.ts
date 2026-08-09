/**
 * CAM reconciliation engine (Wave 4 Stage 2) — the honesty-critical money math.
 *
 * A CAM true-up is a bill a tenant pays, so every rule that keeps it honest gets
 * a behavioural test here, not just a source assertion:
 *   • only ACTUAL recoverable OPERATING spend enters the pool actual;
 *   • the pro-rata share is DERIVED (lease-fixed or sqft) or REFUSED, never guessed;
 *   • thin coverage is disclosed (coverageComplete=false + the statement caveat);
 *   • the standard order — gross-up → share → base-year stop → admin fee → delta.
 */
import { describe, it, expect } from "vitest";
import {
  computeCamReconciliation,
  renderCamStatementMarkdown,
  monthsInPeriod,
  formatCents,
  type CamPoolInput,
  type CamLeaseInput,
} from "../../shared/rental/camReconciliation";
import type { MeasurableExpenseRow } from "../../shared/rental/noi";

const FULL_YEAR = { periodStart: "2026-01-01", periodEnd: "2026-12-31" };

function pool(overrides: Partial<CamPoolInput> = {}): CamPoolInput {
  return {
    recoverableCategories: ["repairs", "utilities", "insurance"],
    totalRentableSqft: 10_000,
    adminFeeBps: null,
    grossUpPct: null,
    periodStart: FULL_YEAR.periodStart,
    periodEnd: FULL_YEAR.periodEnd,
    ...overrides,
  };
}

function lease(overrides: Partial<CamLeaseInput> = {}): CamLeaseInput {
  return {
    camProRataBps: null,
    rentableSqft: null,
    camBaseYearStopCents: null,
    leaseType: "nnn",
    ...overrides,
  };
}

const twoOperatingRows: MeasurableExpenseRow[] = [
  { category: "repairs", amountCents: 100_000, isOperating: true, incurredOn: "2026-03-15" },
  { category: "utilities", amountCents: 50_000, isOperating: true, incurredOn: "2026-06-10" },
];

describe("pool actual — only actual recoverable OPERATING spend", () => {
  it("sums operating rows in the recoverable categories", () => {
    const r = computeCamReconciliation({
      pool: pool(),
      lease: lease({ rentableSqft: 2_000 }),
      rows: twoOperatingRows,
      estimatedBilledCents: 25_000,
    });
    expect(r.poolActualCents).toBe(150_000);
    expect(r.byCategoryCents).toEqual({ repairs: 100_000, utilities: 50_000 });
  });

  it("excludes a NON-OPERATING row even if it is in the recoverable set (no financing cost recovers as CAM)", () => {
    const r = computeCamReconciliation({
      pool: pool({ recoverableCategories: ["repairs", "mortgage_interest"] }),
      lease: lease({ rentableSqft: 2_000 }),
      rows: [
        { category: "repairs", amountCents: 100_000, isOperating: true, incurredOn: "2026-03-15" },
        // mortgage_interest is stored isOperating=false; must never recover.
        { category: "mortgage_interest", amountCents: 999_999, isOperating: false, incurredOn: "2026-03-15" },
      ],
      estimatedBilledCents: 0,
    });
    expect(r.poolActualCents).toBe(100_000);
    expect(r.byCategoryCents.mortgage_interest).toBeUndefined();
  });

  it("excludes an operating row that is NOT in the recoverable set", () => {
    const r = computeCamReconciliation({
      pool: pool({ recoverableCategories: ["repairs"] }),
      lease: lease({ rentableSqft: 2_000 }),
      rows: twoOperatingRows, // utilities not recoverable here
      estimatedBilledCents: 0,
    });
    expect(r.poolActualCents).toBe(100_000);
    expect(r.byCategoryCents.utilities).toBeUndefined();
  });
});

describe("pro-rata — derived or refused, never guessed", () => {
  it("uses the lease-fixed share when set", () => {
    const r = computeCamReconciliation({
      pool: pool(),
      lease: lease({ camProRataBps: 1_500 }),
      rows: twoOperatingRows,
      estimatedBilledCents: 0,
    });
    expect(r.proRataBasis).toBe("lease_fixed");
    expect(r.proRataBps).toBe(1_500);
    // 150000 × 15% = 22500
    expect(r.recoverableShareCents).toBe(22_500);
  });

  it("derives the share from leased ÷ building rentable sqft when no fixed share", () => {
    const r = computeCamReconciliation({
      pool: pool({ totalRentableSqft: 10_000 }),
      lease: lease({ rentableSqft: 2_000 }),
      rows: twoOperatingRows,
      estimatedBilledCents: 0,
    });
    expect(r.proRataBasis).toBe("sqft");
    expect(r.proRataBps).toBe(2_000); // 20%
    expect(r.leasedSqftUsed).toBe(2_000);
    expect(r.totalRentableSqftUsed).toBe(10_000);
    expect(r.recoverableShareCents).toBe(30_000); // 150000 × 20%
  });

  it("REFUSES (no share, no delta, a reason) when neither basis is available", () => {
    const r = computeCamReconciliation({
      pool: pool({ totalRentableSqft: null }),
      lease: lease({ camProRataBps: null, rentableSqft: null }),
      rows: twoOperatingRows,
      estimatedBilledCents: 25_000,
    });
    expect(r.refusedReason).toBeTruthy();
    expect(r.proRataBps).toBeNull();
    expect(r.proRataBasis).toBeNull();
    expect(r.recoverableShareCents).toBeNull();
    expect(r.deltaCents).toBeNull();
    // The pool actual is still reported honestly — only the SHARE is refused.
    expect(r.poolActualCents).toBe(150_000);
  });

  it("clamps a sqft share to 100% (a lease cannot recover more than the whole pool)", () => {
    const r = computeCamReconciliation({
      pool: pool({ totalRentableSqft: 1_000 }),
      lease: lease({ rentableSqft: 5_000 }), // 500% raw
      rows: twoOperatingRows,
      estimatedBilledCents: 0,
    });
    expect(r.proRataBps).toBe(10_000);
    expect(r.recoverableShareCents).toBe(150_000);
  });
});

describe("gross-up, base-year stop, admin fee — the standard order", () => {
  it("applies the gross-up to the pool actual before the share", () => {
    const r = computeCamReconciliation({
      pool: pool({ grossUpPct: 5 }),
      lease: lease({ rentableSqft: 2_000 }),
      rows: twoOperatingRows,
      estimatedBilledCents: 0,
    });
    expect(r.grossedUpPoolCents).toBe(157_500); // 150000 × 1.05
    expect(r.recoverableShareCents).toBe(31_500); // × 20%
  });

  it("subtracts a modified-gross base-year stop, floored at zero", () => {
    const r = computeCamReconciliation({
      pool: pool(),
      lease: lease({ rentableSqft: 2_000, leaseType: "modified_gross", camBaseYearStopCents: 10_000 }),
      rows: twoOperatingRows,
      estimatedBilledCents: 0,
    });
    // 150000 × 20% = 30000, − 10000 stop = 20000
    expect(r.recoverableShareCents).toBe(20_000);
  });

  it("does NOT apply a base-year stop to an NNN lease", () => {
    const r = computeCamReconciliation({
      pool: pool(),
      lease: lease({ rentableSqft: 2_000, leaseType: "nnn", camBaseYearStopCents: 10_000 }),
      rows: twoOperatingRows,
      estimatedBilledCents: 0,
    });
    expect(r.recoverableShareCents).toBe(30_000); // stop ignored for nnn
  });

  it("adds the admin fee last", () => {
    const r = computeCamReconciliation({
      pool: pool({ adminFeeBps: 1_000 }), // 10%
      lease: lease({ rentableSqft: 2_000 }),
      rows: twoOperatingRows,
      estimatedBilledCents: 0,
    });
    expect(r.recoverableShareCents).toBe(33_000); // 30000 × 1.10
  });
});

describe("delta sign — who owes whom", () => {
  it("positive delta when the share exceeds what was billed (tenant owes)", () => {
    const r = computeCamReconciliation({
      pool: pool(),
      lease: lease({ rentableSqft: 2_000 }),
      rows: twoOperatingRows,
      estimatedBilledCents: 25_000,
    });
    expect(r.deltaCents).toBe(5_000); // 30000 − 25000
  });

  it("negative delta when the tenant was over-billed (credit due)", () => {
    const r = computeCamReconciliation({
      pool: pool(),
      lease: lease({ rentableSqft: 2_000 }),
      rows: twoOperatingRows,
      estimatedBilledCents: 40_000,
    });
    expect(r.deltaCents).toBe(-10_000);
  });
});

describe("coverage honesty", () => {
  it("marks coverage incomplete when only some months carry expenses", () => {
    const r = computeCamReconciliation({
      pool: pool(),
      lease: lease({ rentableSqft: 2_000 }),
      rows: twoOperatingRows, // 2 distinct months of a 12-month period
      estimatedBilledCents: 0,
    });
    expect(r.coverageMonths).toBe(2);
    expect(r.periodMonths).toBe(12);
    expect(r.coverageComplete).toBe(false);
  });

  it("marks coverage complete when every month of the period has a recorded expense", () => {
    const rows: MeasurableExpenseRow[] = Array.from({ length: 12 }, (_, i) => ({
      category: "utilities",
      amountCents: 10_000,
      isOperating: true,
      incurredOn: `2026-${String(i + 1).padStart(2, "0")}-05`,
    }));
    const r = computeCamReconciliation({
      pool: pool(),
      lease: lease({ rentableSqft: 2_000 }),
      rows,
      estimatedBilledCents: 0,
    });
    expect(r.coverageMonths).toBe(12);
    expect(r.coverageComplete).toBe(true);
  });
});

describe("monthsInPeriod", () => {
  it("counts inclusive month spans", () => {
    expect(monthsInPeriod("2026-01-01", "2026-12-31")).toBe(12);
    expect(monthsInPeriod("2026-01-15", "2026-01-20")).toBe(1);
    expect(monthsInPeriod("2026-01-01", "2027-03-31")).toBe(15);
  });
  it("returns 0 for a reversed or malformed range", () => {
    expect(monthsInPeriod("2026-12-31", "2026-01-01")).toBe(0);
    expect(monthsInPeriod("nonsense", "2026-01-01")).toBe(0);
  });
});

describe("formatCents", () => {
  it("formats with commas and a real minus sign", () => {
    expect(formatCents(150_000)).toBe("$1,500.00");
    expect(formatCents(-1_000)).toBe("−$10.00");
    expect(formatCents(1_234_567)).toBe("$12,345.67");
  });
});

describe("renderCamStatementMarkdown", () => {
  const ctx = { periodStart: "2026-01-01", periodEnd: "2026-12-31", poolKind: "cam" };

  it("includes the thin-coverage caveat when coverage is incomplete", () => {
    const r = computeCamReconciliation({
      pool: pool(),
      lease: lease({ rentableSqft: 2_000 }),
      rows: twoOperatingRows,
      estimatedBilledCents: 25_000,
    });
    const md = renderCamStatementMarkdown(r, ctx);
    expect(md).toContain("2 of 12");
    expect(md).toMatch(/provisional|PARTIAL/);
    expect(md).toContain("Balance due");
  });

  it("surfaces how the estimated-billed figure was determined (provenance in the statement)", () => {
    const r = computeCamReconciliation({
      pool: pool(),
      lease: lease({ rentableSqft: 2_000 }),
      rows: twoOperatingRows,
      estimatedBilledCents: 25_000,
    });
    const fromCharges = renderCamStatementMarkdown(r, { ...ctx, estimatedBilledBasis: "from_charges" });
    expect(fromCharges).toContain("from recorded CAM charges");
    const leaseEst = renderCamStatementMarkdown(r, { ...ctx, estimatedBilledBasis: "lease_estimate" });
    expect(leaseEst).toContain("lease's monthly CAM estimate");
    const none = renderCamStatementMarkdown(r, { ...ctx, estimatedBilledBasis: "none" });
    expect(none).toContain("none recorded");
  });

  it("renders a refusal, never a fabricated statement, when the engine refused", () => {
    const r = computeCamReconciliation({
      pool: pool({ totalRentableSqft: null }),
      lease: lease({ camProRataBps: null, rentableSqft: null }),
      rows: twoOperatingRows,
      estimatedBilledCents: 0,
    });
    const md = renderCamStatementMarkdown(r, ctx);
    expect(md).toContain("could not be produced");
    expect(md).not.toContain("Balance due");
  });
});
