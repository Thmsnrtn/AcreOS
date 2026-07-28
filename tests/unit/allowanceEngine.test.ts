/**
 * Free-taste allowance derivation — founder decisions 2026-07-28, #2 + #6.
 *
 * The included monthly allowance per rail is DERIVED from the plan price and
 * the verified per-unit provider costs (≤ ~20% of the plan's monthly price),
 * never hand-set. These tests pin the pure derivation: the 20% budget, the
 * fixed rail split (45% letters / 40% data / 15% email, summing to 1),
 * floor-only rounding (never promise what the budget can't cover), the
 * zero-price plan, and the margin override.
 *
 * Unit costs used here mirror the real constants in code at time of writing
 * (letter 85¢ = LOB_LETTER_COST in server/services/mailProvider.ts; data
 * lookup 15¢ = batchdata skip_trace in
 * server/services/providers/batchdata-provider.ts; email 1¢ =
 * USAGE_ACTION_TYPES.email_sent in shared/schema.ts) — but the engine is
 * pure, so these are explicit inputs, not imports.
 */

import { describe, expect, it } from "vitest";
import {
  ALLOWANCE_RAIL_WEIGHTS,
  deriveAllowances,
  formatAllowanceSummary,
} from "../../shared/billing/allowanceEngine";

const REAL_UNIT_COSTS = { dataLookupCents: 15, letterCents: 85, emailCents: 1 };

describe("allowance rail weights", () => {
  it("sum to exactly 1 (the whole budget is allocated, nothing more)", () => {
    const sum =
      ALLOWANCE_RAIL_WEIGHTS.letters +
      ALLOWANCE_RAIL_WEIGHTS.dataLookups +
      ALLOWANCE_RAIL_WEIGHTS.email;
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });

  it("letters carry the largest slice (the wow moment), email the smallest", () => {
    expect(ALLOWANCE_RAIL_WEIGHTS.letters).toBeGreaterThan(ALLOWANCE_RAIL_WEIGHTS.dataLookups);
    expect(ALLOWANCE_RAIL_WEIGHTS.dataLookups).toBeGreaterThan(ALLOWANCE_RAIL_WEIGHTS.email);
  });
});

describe("deriveAllowances", () => {
  it("derives Pro ($49/mo) at the default 20% margin", () => {
    const d = deriveAllowances({ planPriceCents: 4900, unitCosts: REAL_UNIT_COSTS });

    // Budget: 20% of $49.00 = $9.80.
    expect(d.budgetCents).toBe(980);
    expect(d.marginFraction).toBe(0.2);

    // Letters: 45% of 980 = 441¢ → floor(441 / 85) = 5 letters (425¢ spent).
    expect(d.rails.letters).toEqual({
      count: 5,
      unitCostCents: 85,
      budgetShareCents: 441,
      spendCents: 425,
    });

    // Data: 40% of 980 = 392¢ → floor(392 / 15) = 26 lookups (390¢ spent).
    expect(d.rails.dataLookups).toEqual({
      count: 26,
      unitCostCents: 15,
      budgetShareCents: 392,
      spendCents: 390,
    });

    // Email: 15% of 980 = 147¢ → 147 emails at 1¢.
    expect(d.rails.email).toEqual({
      count: 147,
      unitCostCents: 1,
      budgetShareCents: 147,
      spendCents: 147,
    });

    // Margin-safe by construction: actual spend never exceeds the budget.
    expect(d.totalSpendCents).toBe(425 + 390 + 147);
    expect(d.totalSpendCents).toBeLessThanOrEqual(d.budgetCents);
    expect(d.budgetCents).toBeLessThanOrEqual(4900 * 0.2);
  });

  it("always rounds DOWN — a partially-affordable unit is never promised", () => {
    // 441 / 85 = 5.18…, 392 / 15 = 26.13… — both must floor, never round.
    const d = deriveAllowances({ planPriceCents: 4900, unitCosts: REAL_UNIT_COSTS });
    expect(d.rails.letters.count).toBe(5);
    expect(d.rails.dataLookups.count).toBe(26);

    // A rail whose slice can't afford even one unit derives 0, not 1.
    const tiny = deriveAllowances({
      planPriceCents: 100, // $1 plan → 20¢ budget → letters slice 9¢ < 85¢
      unitCosts: REAL_UNIT_COSTS,
    });
    expect(tiny.rails.letters.count).toBe(0);
    expect(tiny.rails.letters.spendCents).toBe(0);
  });

  it("a zero-price plan derives zero allowances everywhere", () => {
    const d = deriveAllowances({ planPriceCents: 0, unitCosts: REAL_UNIT_COSTS });
    expect(d.budgetCents).toBe(0);
    expect(d.rails.letters.count).toBe(0);
    expect(d.rails.dataLookups.count).toBe(0);
    expect(d.rails.email.count).toBe(0);
    expect(d.totalSpendCents).toBe(0);
  });

  it("honors a marginFraction override", () => {
    const d = deriveAllowances({
      planPriceCents: 4900,
      marginFraction: 0.1,
      unitCosts: REAL_UNIT_COSTS,
    });
    // 10% of $49 = 490¢; letters 45% → 220¢ → 2 letters; data 40% → 196¢ →
    // 13 lookups; email 15% → 73¢ → 73 emails.
    expect(d.budgetCents).toBe(490);
    expect(d.rails.letters.count).toBe(2);
    expect(d.rails.dataLookups.count).toBe(13);
    expect(d.rails.email.count).toBe(73);
    expect(d.totalSpendCents).toBeLessThanOrEqual(d.budgetCents);
  });

  it("stays within budget across a sweep of plan prices (margin-safe by construction)", () => {
    for (const priceCents of [0, 100, 999, 2000, 4900, 7900, 12345, 100000]) {
      const d = deriveAllowances({ planPriceCents: priceCents, unitCosts: REAL_UNIT_COSTS });
      expect(d.totalSpendCents, `price ${priceCents}`).toBeLessThanOrEqual(d.budgetCents);
      expect(d.budgetCents, `price ${priceCents}`).toBeLessThanOrEqual(priceCents * 0.2);
      for (const rail of Object.values(d.rails)) {
        expect(rail.count).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(rail.count)).toBe(true);
      }
    }
  });

  it("refuses unusable inputs rather than guessing", () => {
    // Negative or non-finite price.
    expect(() => deriveAllowances({ planPriceCents: -1, unitCosts: REAL_UNIT_COSTS })).toThrow();
    expect(() => deriveAllowances({ planPriceCents: NaN, unitCosts: REAL_UNIT_COSTS })).toThrow();

    // marginFraction outside (0, 1].
    expect(() =>
      deriveAllowances({ planPriceCents: 4900, marginFraction: 0, unitCosts: REAL_UNIT_COSTS }),
    ).toThrow();
    expect(() =>
      deriveAllowances({ planPriceCents: 4900, marginFraction: 1.5, unitCosts: REAL_UNIT_COSTS }),
    ).toThrow();

    // A zero/negative unit cost would derive an infinite allowance — refuse.
    expect(() =>
      deriveAllowances({
        planPriceCents: 4900,
        unitCosts: { ...REAL_UNIT_COSTS, letterCents: 0 },
      }),
    ).toThrow(/exclude the rail/);
    expect(() =>
      deriveAllowances({
        planPriceCents: 4900,
        unitCosts: { ...REAL_UNIT_COSTS, emailCents: -1 },
      }),
    ).toThrow();
  });
});

describe("formatAllowanceSummary", () => {
  it("states the derivation in plain words", () => {
    const d = deriveAllowances({ planPriceCents: 4900, unitCosts: REAL_UNIT_COSTS });
    const summary = formatAllowanceSummary(d);
    expect(summary).toContain("$49.00/mo plan");
    expect(summary).toContain("$9.80/mo");
    expect(summary).toContain("20%");
    expect(summary).toContain("5 letters");
    expect(summary).toContain("26 data lookups");
    expect(summary).toContain("147 emails");
    expect(summary).toContain("bring-your-own");
  });

  it("is honest when a plan derives nothing", () => {
    const d = deriveAllowances({ planPriceCents: 0, unitCosts: REAL_UNIT_COSTS });
    const summary = formatAllowanceSummary(d);
    expect(summary).toContain("no included platform sends or lookups");
    expect(summary).not.toMatch(/\b[1-9]\d* letters/);
  });
});
