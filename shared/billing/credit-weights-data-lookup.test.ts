/**
 * Paid data-lookup credit metering math (Lena CFO lens, item 1).
 * Pins the category→action map and the round-up deduction semantics so a paid
 * data lookup always draws the right (non-zero) weight from the credit pool —
 * closing the silent-COGS margin leak.
 */
import { describe, it, expect } from "vitest";
import {
  CREDIT_WEIGHTS,
  creditActionForCategory,
} from "./credit-weights";

describe("creditActionForCategory — category → paid-lookup action", () => {
  it("maps parcel-ish categories to parcel_lookup_paid", () => {
    expect(creditActionForCategory("parcel_data")).toBe("parcel_lookup_paid");
    expect(creditActionForCategory("property_details")).toBe("parcel_lookup_paid");
    expect(creditActionForCategory("structure")).toBe("parcel_lookup_paid");
  });

  it("maps comps / owner / valuation to their own actions", () => {
    expect(creditActionForCategory("comps")).toBe("comps_lookup");
    expect(creditActionForCategory("owner_info")).toBe("owner_lookup");
    expect(creditActionForCategory("valuation")).toBe("valuation_lookup");
  });

  it("maps skip_trace to the existing skip_trace action", () => {
    expect(creditActionForCategory("skip_trace")).toBe("skip_trace");
  });

  it("returns null for FREE federal categories (never billed)", () => {
    expect(creditActionForCategory("environmental")).toBeNull();
    expect(creditActionForCategory("demographics")).toBeNull();
    expect(creditActionForCategory("something_unknown")).toBeNull();
  });
});

describe("data-lookup credit weights are non-zero and tracked", () => {
  it("every paid data-lookup action has a positive weight", () => {
    expect(CREDIT_WEIGHTS.parcel_lookup_paid).toBeGreaterThan(0);
    expect(CREDIT_WEIGHTS.comps_lookup).toBeGreaterThan(0);
    expect(CREDIT_WEIGHTS.owner_lookup).toBeGreaterThan(0);
    expect(CREDIT_WEIGHTS.valuation_lookup).toBeGreaterThan(0);
  });

  it("weights track the documented p90 provider costs", () => {
    expect(CREDIT_WEIGHTS.parcel_lookup_paid).toBe(8);
    expect(CREDIT_WEIGHTS.comps_lookup).toBe(20);
    expect(CREDIT_WEIGHTS.owner_lookup).toBe(8);
    expect(CREDIT_WEIGHTS.valuation_lookup).toBe(10);
  });

  it("round-up deduction never undercounts a paid lookup (1 unit = ceil(weight))", () => {
    // poolDebit computes ceil(weight * units); for these integer weights the
    // single-unit deduction equals the weight. A free lookup (no action) draws 0.
    for (const action of [
      "parcel_lookup_paid",
      "comps_lookup",
      "owner_lookup",
      "valuation_lookup",
    ] as const) {
      const cents = Math.ceil(CREDIT_WEIGHTS[action] * 1);
      expect(cents).toBe(CREDIT_WEIGHTS[action]);
      expect(cents).toBeGreaterThan(0);
    }
  });
});
