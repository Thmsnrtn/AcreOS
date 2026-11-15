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
  resolveCamEstimatedBilled,
  findCamDoubleRecovery,
  type CamPoolInput,
  type CamLeaseInput,
  type CamPoolScope,
} from "../../shared/rental/camReconciliation";
import type { MeasurableExpenseRow } from "../../shared/rental/noi";
import { formatCents } from "../../shared/finance/cents";

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
    // A term that spans FULL_YEAR, so every pre-existing case reconciles a lease
    // that was in force for the whole pool period (the only case the engine bills).
    termStart: "2025-01-01",
    termEnd: null,
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

describe("formatCents — now imported from its canonical home", () => {
  // This module used to export a byte-identical private copy, and this test
  // pinned it. The copy is gone (formatCentsIsCanonical.test.ts holds the repo
  // to one definition), but the INVARIANT it protected is unchanged and is
  // asserted here still: a CAM statement is a bill a tenant pays, so the way a
  // dollar reads on it is behaviour, not formatting trivia.
  it("formats with commas and a real minus sign", () => {
    expect(formatCents(150_000)).toBe("$1,500.00");
    expect(formatCents(-1_000)).toBe("−$10.00");
    expect(formatCents(1_234_567)).toBe("$12,345.67");
  });

  it("and the statement renderer really uses it", () => {
    // Vacuity guard for the swap. Asserting the helper in isolation would pass
    // even if the renderer had been left calling something else. Reuses the
    // file's own `pool()`/`lease()` builders so it stays valid as they evolve.
    const md = renderCamStatementMarkdown(
      computeCamReconciliation({
        pool: pool(),
        lease: lease({ rentableSqft: 2_000 }),
        rows: twoOperatingRows,
        estimatedBilledCents: 25_000,
      }),
      { periodStart: FULL_YEAR.periodStart, periodEnd: FULL_YEAR.periodEnd, poolKind: "cam" },
    );
    expect(md).toMatch(/\$[\d,]+\.\d{2}/);
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
    // REWRITTEN (W2-COMMERCIAL), not deleted: the invariant — the statement says
    // where the billed figure came from — stands. The two sources it can come
    // from changed: the ledger, or the landlord's own stated total. The retired
    // 'lease_estimate' (estimate × months) and 'none' ($0) bases were
    // assumptions, and resolveCamEstimatedBilled can no longer produce them (the
    // type no longer admits them either).
    const r = computeCamReconciliation({
      pool: pool(),
      lease: lease({ rentableSqft: 2_000 }),
      rows: twoOperatingRows,
      estimatedBilledCents: 25_000,
    });
    const fromCharges = renderCamStatementMarkdown(r, { ...ctx, estimatedBilledBasis: "from_charges" });
    expect(fromCharges).toContain("from recorded CAM charges");
    const stated = renderCamStatementMarkdown(r, { ...ctx, estimatedBilledBasis: "operator_stated" });
    expect(stated).toContain("as stated by the landlord; not recorded on the AcreOS ledger");
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

// ---------------------------------------------------------------------------
// W2-COMMERCIAL (2026-11-06) — refuse rather than default. These are the rules
// that had to hold before the engine could be put in front of a landlord: each
// case below produced a "Balance due" from an assumption before this change.
// ---------------------------------------------------------------------------

/** The refusal shape: no share, no delta, a reason — and the pool actual still reported. */
function expectRefused(r: ReturnType<typeof computeCamReconciliation>, reason: RegExp) {
  expect(r.refusedReason).toMatch(reason);
  expect(r.recoverableShareCents).toBeNull();
  expect(r.deltaCents).toBeNull();
  expect(r.poolActualCents).toBe(150_000);
}

describe("lease type — CAM applies only to a lease that reimburses it", () => {
  it("refuses an unrecorded lease type (never assumed to be net)", () => {
    const r = computeCamReconciliation({
      pool: pool(),
      lease: lease({ rentableSqft: 2_000, leaseType: null }),
      rows: twoOperatingRows,
      estimatedBilledCents: 25_000,
    });
    expectRefused(r, /type .* is not recorded/);
  });

  it("refuses a gross lease (rent is all-in; there is nothing to reconcile)", () => {
    const r = computeCamReconciliation({
      pool: pool(),
      lease: lease({ rentableSqft: 2_000, leaseType: "gross" }),
      rows: twoOperatingRows,
      estimatedBilledCents: 25_000,
    });
    expectRefused(r, /gross lease/);
  });
});

describe("lease term — a share is billed only for a period the lease covers in full", () => {
  it("refuses a lease that started after the pool period began (no invented proration)", () => {
    const r = computeCamReconciliation({
      pool: pool(),
      lease: lease({ rentableSqft: 2_000, termStart: "2026-07-01" }),
      rows: twoOperatingRows,
      estimatedBilledCents: 0,
    });
    expectRefused(r, /does not cover the whole pool period/);
  });

  it("refuses a lease that ended before the pool period ended", () => {
    const r = computeCamReconciliation({
      pool: pool(),
      lease: lease({ rentableSqft: 2_000, termStart: "2024-01-01", termEnd: "2026-06-30" }),
      rows: twoOperatingRows,
      estimatedBilledCents: 0,
    });
    expectRefused(r, /does not cover the whole pool period/);
  });

  it("bills a lease whose term exactly spans the period, and an open-ended one", () => {
    for (const term of [
      { termStart: "2026-01-01", termEnd: "2026-12-31" },
      { termStart: "2020-05-01", termEnd: null },
    ]) {
      const r = computeCamReconciliation({
        pool: pool(),
        lease: lease({ rentableSqft: 2_000, ...term }),
        rows: twoOperatingRows,
        estimatedBilledCents: 25_000,
      });
      expect(r.refusedReason).toBeNull();
      expect(r.deltaCents).toBe(5_000);
    }
  });

  it("reconciles a partial-year tenant against a pool whose period sits inside the term", () => {
    // The path the refusal names: a pool for the lease's own months.
    const r = computeCamReconciliation({
      pool: pool({ periodStart: "2026-07-01", periodEnd: "2026-12-31" }),
      lease: lease({ rentableSqft: 2_000, termStart: "2026-07-01" }),
      rows: [{ category: "repairs", amountCents: 60_000, isOperating: true, incurredOn: "2026-08-01" }],
      estimatedBilledCents: 10_000,
    });
    expect(r.refusedReason).toBeNull();
    expect(r.recoverableShareCents).toBe(12_000); // 60000 × 20%
    expect(r.periodMonths).toBe(6);
  });
});

describe("base-year stop — an annual figure applies to a twelve-month pool only", () => {
  it("refuses a modified-gross stop on a six-month pool rather than prorate it", () => {
    const r = computeCamReconciliation({
      pool: pool({ periodStart: "2026-01-01", periodEnd: "2026-06-30" }),
      lease: lease({ rentableSqft: 2_000, leaseType: "modified_gross", camBaseYearStopCents: 10_000 }),
      rows: twoOperatingRows,
      estimatedBilledCents: 0,
    });
    expectRefused(r, /base-year stop is an annual figure/);
  });

  it("does not refuse a six-month pool for a lease with no stop", () => {
    const r = computeCamReconciliation({
      pool: pool({ periodStart: "2026-01-01", periodEnd: "2026-06-30" }),
      lease: lease({ rentableSqft: 2_000, leaseType: "modified_gross", camBaseYearStopCents: null }),
      rows: twoOperatingRows,
      estimatedBilledCents: 0,
    });
    expect(r.refusedReason).toBeNull();
  });
});

describe("what was billed — a record, never an assumed figure", () => {
  it("refuses when nothing records what the tenant was billed (no $0 default)", () => {
    const r = computeCamReconciliation({
      pool: pool(),
      lease: lease({ rentableSqft: 2_000 }),
      rows: twoOperatingRows,
      estimatedBilledCents: null,
    });
    expectRefused(r, /no record of the CAM estimates billed/);
    // The refusal renders as a refusal, never as a statement with a balance.
    const md = renderCamStatementMarkdown(r, { periodStart: "2026-01-01", periodEnd: "2026-12-31", poolKind: "cam" });
    expect(md).toContain("could not be produced");
    expect(md).not.toContain("Balance due");
  });

  it("an explicit 0 the landlord entered IS a record, and bills the full share", () => {
    const r = computeCamReconciliation({
      pool: pool(),
      lease: lease({ rentableSqft: 2_000 }),
      rows: twoOperatingRows,
      estimatedBilledCents: 0,
    });
    expect(r.refusedReason).toBeNull();
    expect(r.deltaCents).toBe(30_000);
  });
});

describe("resolveCamEstimatedBilled — ledger first, then the landlord's own total, else nothing", () => {
  it("sums the ledger's CAM charges when there are any", () => {
    expect(resolveCamEstimatedBilled({ ledgerCamChargeCents: [10_000, 12_500], statedCents: null }))
      .toEqual({ cents: 22_500, basis: "from_charges", conflict: null });
  });

  it("uses the landlord's stated total when the ledger has no CAM charges", () => {
    expect(resolveCamEstimatedBilled({ ledgerCamChargeCents: [], statedCents: 18_000 }))
      .toEqual({ cents: 18_000, basis: "operator_stated", conflict: null });
  });

  it("returns NOTHING when neither exists — not $0, not an estimate × months", () => {
    const r = resolveCamEstimatedBilled({ ledgerCamChargeCents: [], statedCents: null });
    expect(r.cents).toBeNull();
    expect(r.basis).toBeNull();
  });

  it("accepts a stated total that agrees with the ledger, and refuses one that does not", () => {
    expect(resolveCamEstimatedBilled({ ledgerCamChargeCents: [10_000], statedCents: 10_000 }).basis)
      .toBe("from_charges");
    const conflict = resolveCamEstimatedBilled({ ledgerCamChargeCents: [10_000], statedCents: 9_000 });
    expect(conflict.cents).toBeNull();
    expect(conflict.conflict).toMatch(/\$100\.00 of CAM charges/);
  });
});

describe("findCamDoubleRecovery — one expense recovers once", () => {
  const thisPool: CamPoolScope = {
    poolKind: "cam",
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    recoverableCategories: ["repairs", "utilities"],
  };

  it("refuses when an overlapping pool this lease is reconciled in shares a category", () => {
    const reason = findCamDoubleRecovery(thisPool, [
      { poolKind: "all_in", periodStart: "2026-06-01", periodEnd: "2027-05-31", recoverableCategories: ["insurance", "utilities"] },
    ]);
    expect(reason).toMatch(/already reconciled in the all_in pool/);
    expect(reason).toContain('"utilities"');
  });

  it("allows an overlapping pool with disjoint categories (taxes and insurance pools beside CAM)", () => {
    expect(findCamDoubleRecovery(thisPool, [
      { poolKind: "insurance", periodStart: "2026-01-01", periodEnd: "2026-12-31", recoverableCategories: ["insurance"] },
    ])).toBeNull();
  });

  it("allows the same categories in a pool for a different, non-overlapping period", () => {
    expect(findCamDoubleRecovery(thisPool, [
      { poolKind: "cam", periodStart: "2025-01-01", periodEnd: "2025-12-31", recoverableCategories: ["repairs", "utilities"] },
    ])).toBeNull();
  });
});
