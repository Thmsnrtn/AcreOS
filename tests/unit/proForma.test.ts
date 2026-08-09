/**
 * Pro-forma engine (developer vertical, Stage 2) — the subdivider's T-12
 * analogue. It combines parent basis (COGS), lot count, the LOCKED pricing grid
 * (gross proceeds), and carry over the county timeline into net project margin,
 * and its one discipline gets behavioural tests: REFUSE PER LINE, never assume.
 *   • a full pro-forma from seeded inputs (gross − COGS − carry, p50/p90);
 *   • no purchase price → COGS + net margin refuse;
 *   • no locked grid → gross proceeds + net margin refuse;
 *   • no lots → the lot-count line refuses;
 *   • no county timeline → carry refuses and the carry-INCLUSIVE margin is
 *     withheld, while the margin BEFORE carry (which IS computable) is reported.
 */
import { describe, it, expect } from "vitest";
import { computeProForma, type ProFormaInputs } from "../../shared/subdivision/proForma";
import type { CarryCostResult, CarryProjection } from "../../shared/subdivision/carryCost";

function carryProjection(totalCarryCents: number, months: number): CarryProjection {
  return {
    months,
    holdingCostCents: totalCarryCents,
    debtInterestCents: 0,
    opportunityCostCents: 0,
    totalCarryCents,
  };
}

const carryFound: CarryCostResult = {
  timelineFound: true,
  p50: carryProjection(5_000_000, 14),
  p90: carryProjection(8_000_000, 20),
};

const carryNoTimeline: CarryCostResult = { timelineFound: false, p50: null, p90: null };

function inputs(overrides: Partial<ProFormaInputs> = {}): ProFormaInputs {
  return {
    parentPurchasePriceCents: 50_000_000, // $500,000 basis / COGS
    lotCount: 3,
    lockedGrid: [
      { childParcelId: 1, askingPriceCents: 30_000_000 },
      { childParcelId: 2, askingPriceCents: 25_000_000 },
      { childParcelId: 3, askingPriceCents: 20_000_000 },
    ], // gross = $750,000
    carry: carryFound,
    ...overrides,
  };
}

describe("full pro-forma from seeded inputs", () => {
  it("computes gross proceeds, COGS, carry, and the p50/p90 net margin", () => {
    const r = computeProForma(inputs());

    expect(r.grossProceeds.cents).toBe(75_000_000); // 30M + 25M + 20M
    expect(r.grossProceeds.refusedReason).toBeNull();

    expect(r.cogs.cents).toBe(50_000_000);
    expect(r.cogs.refusedReason).toBeNull();

    expect(r.lotCount.count).toBe(3);
    expect(r.lotCount.refusedReason).toBeNull();

    expect(r.carry.p50Cents).toBe(5_000_000);
    expect(r.carry.p90Cents).toBe(8_000_000);
    expect(r.carry.refusedReason).toBeNull();

    // Net margin = gross − COGS − carry. Before carry = $250,000.
    expect(r.netMargin.beforeCarryCents).toBe(25_000_000);
    expect(r.netMargin.p50Cents).toBe(20_000_000); // 25M − 5M
    expect(r.netMargin.p90Cents).toBe(17_000_000); // 25M − 8M (higher carry → lower margin)
    expect(r.netMargin.refusedReason).toBeNull();
    expect(r.netMargin.carryRefusedReason).toBeNull();
  });
});

describe("per-line refusals — never an assumed number", () => {
  it("no parent purchase price → COGS and net margin refuse", () => {
    const r = computeProForma(inputs({ parentPurchasePriceCents: null }));
    expect(r.cogs.cents).toBeNull();
    expect(r.cogs.refusedReason).toMatch(/purchase price|basis/i);
    // Gross proceeds is still computable and honestly reported.
    expect(r.grossProceeds.cents).toBe(75_000_000);
    // Net margin refuses because COGS is missing.
    expect(r.netMargin.beforeCarryCents).toBeNull();
    expect(r.netMargin.p50Cents).toBeNull();
    expect(r.netMargin.refusedReason).toMatch(/insufficient inputs/i);
  });

  it("no locked pricing grid → gross proceeds and net margin refuse", () => {
    const r = computeProForma(inputs({ lockedGrid: null }));
    expect(r.grossProceeds.cents).toBeNull();
    expect(r.grossProceeds.refusedReason).toMatch(/locked pricing grid|lock/i);
    // COGS is still computable.
    expect(r.cogs.cents).toBe(50_000_000);
    expect(r.netMargin.beforeCarryCents).toBeNull();
    expect(r.netMargin.refusedReason).toMatch(/insufficient inputs/i);
  });

  it("an empty locked grid is treated as not-locked (refuse, not a $0 proceeds)", () => {
    const r = computeProForma(inputs({ lockedGrid: [] }));
    expect(r.grossProceeds.cents).toBeNull();
    expect(r.grossProceeds.refusedReason).toBeTruthy();
  });

  it("no lots → the lot-count line refuses", () => {
    const zero = computeProForma(inputs({ lotCount: 0 }));
    expect(zero.lotCount.count).toBeNull();
    expect(zero.lotCount.refusedReason).toMatch(/no child lots|lots/i);

    const nul = computeProForma(inputs({ lotCount: null }));
    expect(nul.lotCount.count).toBeNull();
    expect(nul.lotCount.refusedReason).toBeTruthy();
  });

  it("no county timeline → carry refuses and the carry-inclusive margin is WITHHELD", () => {
    const r = computeProForma(inputs({ carry: carryNoTimeline }));
    expect(r.carry.p50Cents).toBeNull();
    expect(r.carry.p90Cents).toBeNull();
    expect(r.carry.refusedReason).toMatch(/timeline/i);

    // The margin BEFORE carry is computable and reported honestly...
    expect(r.netMargin.beforeCarryCents).toBe(25_000_000);
    // ...but the carry-inclusive p50/p90 are withheld, with a reason — never a
    // carry-free number passed off as the real net margin.
    expect(r.netMargin.p50Cents).toBeNull();
    expect(r.netMargin.p90Cents).toBeNull();
    expect(r.netMargin.refusedReason).toBeNull();
    expect(r.netMargin.carryRefusedReason).toMatch(/timeline/i);
  });

  it("timeline on file but no carry inputs supplied → carry refuses with the inputs reason", () => {
    const r = computeProForma(inputs({ carry: { timelineFound: true, p50: null, p90: null } }));
    expect(r.carry.refusedReason).toMatch(/carry inputs not supplied|holding cost/i);
    expect(r.netMargin.carryRefusedReason).toMatch(/carry inputs not supplied|holding cost/i);
    expect(r.netMargin.beforeCarryCents).toBe(25_000_000);
  });
});
