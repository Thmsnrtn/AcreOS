/**
 * Stripe checkout guard.
 *
 * A checkout for a tier whose STRIPE_PRICE_* env var is unset must fail with an
 * honest, NAMED error rather than handing `undefined` to the Stripe API and
 * producing a silent broken checkout. The error names the missing env var —
 * never its value.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  stripePriceEnvVarName,
  stripePriceIdFor,
  isTierPurchasable,
  requireStripePriceId,
  StripePriceNotConfiguredError,
} from "@shared/billing/tier-pricing";

const PRICE_VARS = [
  "STRIPE_PRICE_SOLO_MONTHLY",
  "STRIPE_PRICE_SOLO_YEARLY",
  "STRIPE_PRICE_OPERATOR_MONTHLY",
  "STRIPE_PRICE_EMPIRE_YEARLY",
];

describe("Stripe checkout guard", () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const v of PRICE_VARS) {
      original[v] = process.env[v];
      delete process.env[v];
    }
  });

  afterEach(() => {
    for (const v of PRICE_VARS) {
      if (original[v] === undefined) delete process.env[v];
      else process.env[v] = original[v];
    }
  });

  it("maps tiers to their legacy STRIPE_PRICE_* env var names", () => {
    expect(stripePriceEnvVarName("starter", "monthly")).toBe("STRIPE_PRICE_SOLO_MONTHLY");
    expect(stripePriceEnvVarName("pro", "yearly")).toBe("STRIPE_PRICE_OPERATOR_YEARLY");
    expect(stripePriceEnvVarName("scale", "monthly")).toBe("STRIPE_PRICE_EMPIRE_MONTHLY");
  });

  it("reports a tier as not purchasable when its price env var is unset", () => {
    expect(isTierPurchasable("starter", "monthly")).toBe(false);
    expect(stripePriceIdFor("starter", "monthly")).toBeUndefined();
  });

  it("throws a NAMED error (not the value) when a price id is missing", () => {
    expect(() => requireStripePriceId("starter", "monthly")).toThrow(StripePriceNotConfiguredError);
    try {
      requireStripePriceId("starter", "monthly");
    } catch (e) {
      const err = e as StripePriceNotConfiguredError;
      expect(err.envVarName).toBe("STRIPE_PRICE_SOLO_MONTHLY");
      expect(err.message).toContain("STRIPE_PRICE_SOLO_MONTHLY");
      expect(err.tier).toBe("starter");
    }
  });

  it("resolves the configured price id once the env var is set", () => {
    // NOTE: this is a fake test price id, not a real secret.
    process.env.STRIPE_PRICE_SOLO_MONTHLY = "price_test_fake_solo_monthly";
    expect(isTierPurchasable("starter", "monthly")).toBe(true);
    expect(requireStripePriceId("starter", "monthly")).toBe("price_test_fake_solo_monthly");
  });
});
