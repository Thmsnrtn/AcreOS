/**
 * Lot-pricing engine (developer vertical, Stage 1a) — per-lot asking prices.
 *
 * A subdivision's asking prices are money the operator lists and sells on, so
 * the rules get behavioural tests, not source assertions:
 *   • the base price per acre is the parent's OWN value ÷ acreage (or a fixed
 *     operator rate) — and REFUSES (null) when neither is derivable;
 *   • premiums are SIGNED — a discount lot prices below base, never clamped;
 *   • the grid math is base × (1 + summed premium), rounded.
 */
import { describe, it, expect } from "vitest";
import {
  deriveBasePerAcreCents,
  evaluateRules,
  computeLotPricingGrid,
  type LotPricingRule,
  type LotPricingChild,
} from "../../shared/subdivision/lotPricing";

function child(overrides: Partial<LotPricingChild> = {}): LotPricingChild {
  return {
    id: 1,
    childLotNumber: "Lot 1",
    sizeAcres: 2,
    attributes: { acres: 2 },
    ...overrides,
  };
}

describe("deriveBasePerAcreCents — the parent's own value, or refuse", () => {
  it("uses an operator fixed $/acre when the source is fixed_per_acre", () => {
    const base = deriveBasePerAcreCents({
      source: "fixed_per_acre",
      fixedPerAcreCents: 1_200_000,
      marketValueCents: null,
      purchasePriceCents: null,
      acres: 10,
    });
    expect(base).toBe(1_200_000);
  });

  it("derives base/acre from the parent's MARKET VALUE ÷ acreage", () => {
    // $150,000 AVM over 10 acres → $15,000/acre = 1,500,000 cents.
    const base = deriveBasePerAcreCents({
      source: "avm_per_acre",
      fixedPerAcreCents: null,
      marketValueCents: 15_000_000,
      purchasePriceCents: 9_000_000,
      acres: 10,
    });
    expect(base).toBe(1_500_000);
  });

  it("falls back to the parent's PURCHASE PRICE when there's no market value", () => {
    const base = deriveBasePerAcreCents({
      source: "avm_per_acre",
      fixedPerAcreCents: null,
      marketValueCents: 0,
      purchasePriceCents: 9_000_000,
      acres: 10,
    });
    expect(base).toBe(900_000);
  });

  it("REFUSES (null) when the parent has neither market value nor purchase price", () => {
    const base = deriveBasePerAcreCents({
      source: "avm_per_acre",
      fixedPerAcreCents: null,
      marketValueCents: 0,
      purchasePriceCents: 0,
      acres: 10,
    });
    expect(base).toBeNull();
  });

  it("REFUSES (null) when acreage is zero or negative (undivided base)", () => {
    expect(
      deriveBasePerAcreCents({
        source: "avm_per_acre",
        fixedPerAcreCents: null,
        marketValueCents: 15_000_000,
        purchasePriceCents: null,
        acres: 0,
      }),
    ).toBeNull();
    expect(
      deriveBasePerAcreCents({
        source: "avm_per_acre",
        fixedPerAcreCents: null,
        marketValueCents: 15_000_000,
        purchasePriceCents: null,
        acres: -5,
      }),
    ).toBeNull();
  });

  it("does NOT use a fixed rate of zero — falls through to the AVM base", () => {
    const base = deriveBasePerAcreCents({
      source: "fixed_per_acre",
      fixedPerAcreCents: 0,
      marketValueCents: 15_000_000,
      purchasePriceCents: null,
      acres: 10,
    });
    expect(base).toBe(1_500_000);
  });
});

describe("computeLotPricingGrid — premium math, base × (1 + premium)", () => {
  const basePerAcre = 1_500_000; // $15,000/acre

  it("applies no premium when no rule matches (asking = base)", () => {
    const grid = computeLotPricingGrid(basePerAcre, [child({ sizeAcres: 2 })], []);
    expect(grid[0].basePriceCents).toBe(3_000_000); // 1.5M × 2ac
    expect(grid[0].premiumPct).toBe(0);
    expect(grid[0].askingPriceCents).toBe(3_000_000);
    expect(grid[0].matchedRules).toEqual([]);
  });

  it("applies a POSITIVE premium (corner +10%)", () => {
    const rules: LotPricingRule[] = [
      { attribute: "corner", operator: "==", threshold: true, premiumPct: 0.1 },
    ];
    const grid = computeLotPricingGrid(
      basePerAcre,
      [child({ sizeAcres: 2, attributes: { acres: 2, corner: true } })],
      rules,
    );
    expect(grid[0].premiumPct).toBeCloseTo(0.1);
    expect(grid[0].askingPriceCents).toBe(3_300_000); // 3M × 1.10
    expect(grid[0].matchedRules).toEqual([{ attribute: "corner", premiumPct: 0.1 }]);
  });

  it("honours a NEGATIVE (signed) premium — a discount lot prices BELOW base", () => {
    const rules: LotPricingRule[] = [
      { attribute: "acres", operator: "<", threshold: 1.5, premiumPct: -0.1 },
    ];
    const grid = computeLotPricingGrid(
      basePerAcre,
      [child({ sizeAcres: 1, attributes: { acres: 1 } })],
      rules,
    );
    expect(grid[0].basePriceCents).toBe(1_500_000); // 1.5M × 1ac
    expect(grid[0].premiumPct).toBeCloseTo(-0.1);
    expect(grid[0].askingPriceCents).toBe(1_350_000); // 1.5M × 0.90 — below base
  });

  it("STACKS multiple matched premiums (signed sum): +10% corner and −5% no-view", () => {
    const rules: LotPricingRule[] = [
      { attribute: "corner", operator: "==", threshold: true, premiumPct: 0.1 },
      { attribute: "view", operator: "==", threshold: "none", premiumPct: -0.05 },
    ];
    const grid = computeLotPricingGrid(
      basePerAcre,
      [child({ sizeAcres: 2, attributes: { acres: 2, corner: true, view: "none" } })],
      rules,
    );
    expect(grid[0].premiumPct).toBeCloseTo(0.05); // +0.10 − 0.05
    expect(grid[0].askingPriceCents).toBe(3_150_000); // 3M × 1.05
    expect(grid[0].matchedRules).toHaveLength(2);
  });

  it("does not fire a rule whose attribute is absent from the lot's facts", () => {
    const rules: LotPricingRule[] = [
      { attribute: "water_feature", operator: "==", threshold: true, premiumPct: 0.15 },
    ];
    const grid = computeLotPricingGrid(
      basePerAcre,
      [child({ sizeAcres: 2, attributes: { acres: 2 } })], // no water_feature fact
      rules,
    );
    expect(grid[0].premiumPct).toBe(0);
    expect(grid[0].askingPriceCents).toBe(3_000_000);
  });
});

describe("evaluateRules — numeric comparisons require numbers on both sides", () => {
  it("matches a > comparison only when both fact and threshold are numbers", () => {
    const rules: LotPricingRule[] = [
      { attribute: "frontage", operator: ">", threshold: 150, premiumPct: 0.08 },
    ];
    expect(evaluateRules(rules, { frontage: 200 }).totalPremiumPct).toBeCloseTo(0.08);
    expect(evaluateRules(rules, { frontage: 100 }).totalPremiumPct).toBe(0);
    // A non-numeric fact never satisfies a numeric comparison.
    expect(evaluateRules(rules, { frontage: "wide" }).totalPremiumPct).toBe(0);
  });
});
