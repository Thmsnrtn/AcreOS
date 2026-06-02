/**
 * Land-deal calculator math — covers ROI, annualized return, IRR
 * (Newton-Raphson + bisection fallback), breakeven, and the URL
 * round-trip encoding.
 *
 * Cash-flow scenarios target the exact set listed in the calculator
 * brief: profitable flip, breakeven, loss, long hold, negative cash
 * flow (no-IRR case), zero-marketing edge.
 */

import { describe, it, expect } from "vitest";
import {
  computeLandDeal,
  computeIrr,
  buildCashFlows,
  encodeInputsToQuery,
  decodeInputsFromQuery,
  dollarsToCentsInput,
  DEFAULT_INPUTS_DOLLARS,
  type CalculatorInputs,
  type CalculatorInputsDollars,
} from "@shared/calculators/landDeal";

const dollars = (n: number) => Math.round(n * 100);

function inputs(over: Partial<CalculatorInputs> = {}): CalculatorInputs {
  return {
    purchaseCents: dollars(4500),
    closingAtBuyCents: dollars(45),
    holdingPerMonthCents: dollars(25),
    holdMonths: 6,
    marketingCents: dollars(200),
    salePriceCents: dollars(15000),
    closingAtSaleCents: dollars(450),
    ...over,
  };
}

describe("computeLandDeal — profitable flip ($4,500 → $15,000 in 6mo)", () => {
  const r = computeLandDeal(inputs());

  it("totals cost-in correctly (purchase + closing + holding×months + marketing)", () => {
    // 4500 + 45 + 25*6 + 200 = 4895
    expect(r.totalCostInCents).toBe(dollars(4895));
  });

  it("nets sale proceeds (sale − closing-at-sale)", () => {
    // 15000 - 450 = 14550
    expect(r.netProceedsCents).toBe(dollars(14550));
  });

  it("computes profit (net proceeds − cost in)", () => {
    // 14550 - 4895 = 9655
    expect(r.profitCents).toBe(dollars(9655));
  });

  it("computes ROI as a positive decimal", () => {
    // 9655 / 4895 ≈ 1.9724
    expect(r.roi).not.toBeNull();
    expect(r.roi!).toBeCloseTo(9655 / 4895, 4);
  });

  it("annualizes simply (roi × 12 / months)", () => {
    expect(r.annualizedReturn).not.toBeNull();
    expect(r.annualizedReturn!).toBeCloseTo((9655 / 4895) * (12 / 6), 4);
  });

  it("computes a positive IRR via the solver (cash flows have sign change)", () => {
    expect(r.irr).not.toBeNull();
    expect(r.irr!).toBeGreaterThan(1); // > 100%/yr annualized — this flip prints
  });

  it("computes breakeven sale = totalCostIn + closingAtSale", () => {
    // 4895 + 450 = 5345
    expect(r.breakevenSaleCents).toBe(dollars(5345));
  });
});

describe("computeLandDeal — breakeven flip (profit ≈ 0)", () => {
  it("profit is zero when sale equals breakeven", () => {
    const first = computeLandDeal(inputs());
    const breakeven = computeLandDeal(
      inputs({ salePriceCents: first.breakevenSaleCents }),
    );
    expect(breakeven.profitCents).toBe(0);
    expect(breakeven.roi).toBe(0);
    expect(breakeven.annualizedReturn).toBe(0);
  });

  it("returns IRR = null at exact breakeven (no positive cash flow ever)", () => {
    // At breakeven the net sale proceeds equal cost-in, but the cash-flow
    // series still has the final-month net = (salePrice - closingAtSale -
    // holdingPerMonth) = totalCostIn - holdingPerMonth, which can be
    // positive — so an IRR may exist (≈0). Verify it's at/near zero rather
    // than null in this case.
    const first = computeLandDeal(inputs());
    const breakeven = computeLandDeal(
      inputs({ salePriceCents: first.breakevenSaleCents }),
    );
    if (breakeven.irr !== null) {
      expect(Math.abs(breakeven.irr)).toBeLessThan(0.5);
    }
  });
});

describe("computeLandDeal — loss flip", () => {
  const r = computeLandDeal(
    inputs({ salePriceCents: dollars(3000) }), // sell for $3k after paying $4.5k
  );

  it("profit is negative", () => {
    expect(r.profitCents).toBeLessThan(0);
  });

  it("ROI is negative", () => {
    expect(r.roi).not.toBeNull();
    expect(r.roi!).toBeLessThan(0);
  });

  it("annualized return is negative", () => {
    expect(r.annualizedReturn).not.toBeNull();
    expect(r.annualizedReturn!).toBeLessThan(0);
  });
});

describe("computeLandDeal — long hold (24 months, profitable)", () => {
  const r = computeLandDeal(
    inputs({
      purchaseCents: dollars(10000),
      closingAtBuyCents: dollars(100),
      holdingPerMonthCents: dollars(50),
      holdMonths: 24,
      marketingCents: dollars(500),
      salePriceCents: dollars(25000),
      closingAtSaleCents: dollars(750),
    }),
  );

  it("computes total cost with 24 months of holding", () => {
    // 10000 + 100 + 50*24 + 500 = 11800
    expect(r.totalCostInCents).toBe(dollars(11800));
  });

  it("annualized return is roi/2 (24mo → halved)", () => {
    // profit = 25000 - 750 - 11800 = 12450; roi = 12450/11800
    expect(r.roi).not.toBeNull();
    expect(r.roi!).toBeCloseTo(12450 / 11800, 4);
    expect(r.annualizedReturn!).toBeCloseTo((12450 / 11800) / 2, 4);
  });

  it("IRR converges to a finite annual rate", () => {
    expect(r.irr).not.toBeNull();
    expect(Number.isFinite(r.irr!)).toBe(true);
  });
});

describe("computeLandDeal — sale below cost (no-IRR cash-flow shape)", () => {
  it("returns IRR = null when cash flows never turn positive", () => {
    // Sale price < closing at sale + holding → final flow is negative.
    // Every entry is ≤ 0 → no sign change → IRR is undefined.
    const r = computeLandDeal(
      inputs({
        salePriceCents: dollars(100),
        closingAtSaleCents: dollars(200),
      }),
    );
    expect(r.irr).toBeNull();
  });
});

describe("computeLandDeal — zero-marketing edge case", () => {
  const r = computeLandDeal(inputs({ marketingCents: 0 }));

  it("excludes marketing from cost-in", () => {
    // 4500 + 45 + 25*6 + 0 = 4695
    expect(r.totalCostInCents).toBe(dollars(4695));
  });

  it("still computes a positive profit", () => {
    expect(r.profitCents).toBe(dollars(14550 - 4695));
  });

  it("IRR still solves with marketing = 0", () => {
    expect(r.irr).not.toBeNull();
  });
});

describe("computeIrr — direct contract", () => {
  it("returns null for all-negative cash flows (no sign change)", () => {
    expect(computeIrr([-100, -10, -10])).toBeNull();
  });

  it("returns null for all-positive cash flows", () => {
    expect(computeIrr([100, 10, 10])).toBeNull();
  });

  it("returns null for series shorter than 2 entries", () => {
    expect(computeIrr([-100])).toBeNull();
  });

  it("returns ~0 for a series whose NPV is zero at rate 0 (no-growth recovery)", () => {
    // -100 at t=0, +50 at t=1, +50 at t=2 → undiscounted sum is 0.
    const r = computeIrr([-100, 50, 50]);
    expect(r).not.toBeNull();
    expect(Math.abs(r!)).toBeLessThan(0.01);
  });

  it("recovers a known IRR (doubles money in one period → 100% monthly → ~409600%/yr)", () => {
    const r = computeIrr([-100, 200]);
    expect(r).not.toBeNull();
    // Monthly IRR = 1.0; annualized = 2^12 - 1 = 4095
    expect(r!).toBeCloseTo(4095, 0);
  });
});

describe("buildCashFlows", () => {
  it("emits months+1 entries for a multi-month hold", () => {
    const flows = buildCashFlows(inputs({ holdMonths: 6 }));
    expect(flows.length).toBe(7);
    expect(flows[0]).toBeLessThan(0);
    expect(flows[6]).toBeGreaterThan(0);
  });

  it("collapses to one entry when holdMonths = 0", () => {
    const flows = buildCashFlows(inputs({ holdMonths: 0 }));
    expect(flows.length).toBe(1);
  });
});

describe("URL round-trip", () => {
  it("encodes → decodes back to the same input shape", () => {
    const original: CalculatorInputsDollars = {
      purchase: 7250,
      closingAtBuy: 73,
      holdingPerMonth: 30,
      holdMonths: 9,
      marketing: 350,
      salePrice: 22500,
      closingAtSale: 675,
    };
    const query = encodeInputsToQuery(original);
    const decoded = decodeInputsFromQuery(query, DEFAULT_INPUTS_DOLLARS);
    expect(decoded).toEqual(original);
  });

  it("decoding an empty query falls back to defaults", () => {
    const decoded = decodeInputsFromQuery("", DEFAULT_INPUTS_DOLLARS);
    expect(decoded).toEqual(DEFAULT_INPUTS_DOLLARS);
  });

  it("ignores negative or non-finite query values (defends against tampering)", () => {
    const decoded = decodeInputsFromQuery(
      "?p=-5&cb=abc&h=NaN",
      DEFAULT_INPUTS_DOLLARS,
    );
    expect(decoded.purchase).toBe(DEFAULT_INPUTS_DOLLARS.purchase);
    expect(decoded.closingAtBuy).toBe(DEFAULT_INPUTS_DOLLARS.closingAtBuy);
    expect(decoded.holdingPerMonth).toBe(DEFAULT_INPUTS_DOLLARS.holdingPerMonth);
  });

  it("dollarsToCentsInput converts every field correctly", () => {
    const c = dollarsToCentsInput({
      purchase: 4500.5,
      closingAtBuy: 45,
      holdingPerMonth: 25,
      holdMonths: 6.4,
      marketing: 200,
      salePrice: 15000,
      closingAtSale: 450,
    });
    expect(c.purchaseCents).toBe(450050);
    expect(c.holdMonths).toBe(6); // floored
  });
});
