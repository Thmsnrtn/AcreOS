/**
 * Allocation-policy invariants — Pillar 1 / Pillar 4 foundation.
 *
 * The financial ledger debits every external-provider charge from
 * opex_available and reserves the rest for tax / refund / profit / draw.
 * If the policy ever sums to anything other than 1.0, every revenue post
 * silently mis-allocates. These tests are the runtime tripwire.
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_ALLOCATION_POLICY,
  assertValidAllocationPolicy,
  splitAmountByPolicy,
  BUCKET_NAMES,
} from "./allocation-policy";

describe("allocation policy", () => {
  it("the default policy sums to exactly 1.0", () => {
    const sum =
      DEFAULT_ALLOCATION_POLICY.tax_reserve +
      DEFAULT_ALLOCATION_POLICY.refund_reserve +
      DEFAULT_ALLOCATION_POLICY.profit_reserve +
      DEFAULT_ALLOCATION_POLICY.owner_draw +
      DEFAULT_ALLOCATION_POLICY.opex_available;
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });

  it("matches the plan's canonical 25 / 10 / 5 / 5 / 55 split", () => {
    expect(DEFAULT_ALLOCATION_POLICY.tax_reserve).toBe(0.25);
    expect(DEFAULT_ALLOCATION_POLICY.refund_reserve).toBe(0.1);
    expect(DEFAULT_ALLOCATION_POLICY.profit_reserve).toBe(0.05);
    expect(DEFAULT_ALLOCATION_POLICY.owner_draw).toBe(0.05);
    expect(DEFAULT_ALLOCATION_POLICY.opex_available).toBe(0.55);
  });

  it("assertValidAllocationPolicy accepts the default", () => {
    expect(() => assertValidAllocationPolicy(DEFAULT_ALLOCATION_POLICY)).not.toThrow();
  });

  it("assertValidAllocationPolicy rejects a policy that does not sum to 1", () => {
    expect(() =>
      assertValidAllocationPolicy({
        tax_reserve: 0.3,
        refund_reserve: 0.1,
        profit_reserve: 0.05,
        owner_draw: 0.05,
        opex_available: 0.55, // sums to 1.05
      }),
    ).toThrow();
  });

  it("splitAmountByPolicy preserves total cents with no rounding loss", () => {
    // Use a deliberately awkward amount that would expose rounding bugs.
    const amount = 12_345;
    const parts = splitAmountByPolicy(amount, DEFAULT_ALLOCATION_POLICY);
    const sum = BUCKET_NAMES.reduce((acc, k) => acc + parts[k], 0);
    expect(sum).toBe(amount);
  });

  it("splitAmountByPolicy roughly matches the policy proportions", () => {
    const amount = 10_000; // $100.00
    const parts = splitAmountByPolicy(amount, DEFAULT_ALLOCATION_POLICY);
    expect(parts.tax_reserve).toBe(2_500);
    expect(parts.refund_reserve).toBe(1_000);
    expect(parts.profit_reserve).toBe(500);
    expect(parts.owner_draw).toBe(500);
    expect(parts.opex_available).toBe(5_500);
  });
});
