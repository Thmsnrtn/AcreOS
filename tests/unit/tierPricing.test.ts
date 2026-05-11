import { describe, it, expect } from "vitest";
import {
  TIERS,
  TIER_PRICES_CENTS,
  tierPriceCents,
  tierPriceDollars,
  tierForSubscriptionTier,
  monthlyRevenueCentsFor,
  type Tier,
} from "@shared/billing/tier-pricing";

describe("shared/billing/tier-pricing", () => {
  it("defines exactly three canonical paid tiers", () => {
    expect(TIERS).toEqual(["starter", "pro", "scale"]);
    expect(Object.keys(TIER_PRICES_CENTS).sort()).toEqual(
      ["pro", "scale", "starter"],
    );
  });

  it.each(TIERS as readonly Tier[])(
    "tier %s has positive monthly + yearly prices",
    (tier) => {
      const pricing = TIER_PRICES_CENTS[tier];
      expect(pricing.priceMonthlyCents).toBeGreaterThan(0);
      expect(pricing.priceYearlyCents).toBeGreaterThan(0);
      expect(Number.isInteger(pricing.priceMonthlyCents)).toBe(true);
      expect(Number.isInteger(pricing.priceYearlyCents)).toBe(true);
      expect(pricing.displayName.length).toBeGreaterThan(0);
    },
  );

  it.each(TIERS as readonly Tier[])(
    "yearly price for %s is greater than monthly (annual subscription, not monthly)",
    (tier) => {
      const pricing = TIER_PRICES_CENTS[tier];
      expect(pricing.priceYearlyCents).toBeGreaterThan(pricing.priceMonthlyCents);
    },
  );

  it.each(TIERS as readonly Tier[])(
    "yearly price for %s is cheaper per-month than monthly (discount applied)",
    (tier) => {
      const pricing = TIER_PRICES_CENTS[tier];
      const monthlyEquivalentOfYearly = pricing.priceYearlyCents / 12;
      expect(monthlyEquivalentOfYearly).toBeLessThan(pricing.priceMonthlyCents);
    },
  );

  it("matches the documented canonical prices ($20 / $49 / $79 monthly)", () => {
    expect(TIER_PRICES_CENTS.starter.priceMonthlyCents).toBe(2000);
    expect(TIER_PRICES_CENTS.pro.priceMonthlyCents).toBe(4900);
    expect(TIER_PRICES_CENTS.scale.priceMonthlyCents).toBe(7900);
  });

  it("matches the documented canonical yearly prices ($200 / $490 / $790)", () => {
    expect(TIER_PRICES_CENTS.starter.priceYearlyCents).toBe(20000);
    expect(TIER_PRICES_CENTS.pro.priceYearlyCents).toBe(49000);
    expect(TIER_PRICES_CENTS.scale.priceYearlyCents).toBe(79000);
  });

  describe("tierPriceCents()", () => {
    it("returns monthly cents for monthly interval", () => {
      expect(tierPriceCents("starter", "monthly")).toBe(2000);
      expect(tierPriceCents("pro", "monthly")).toBe(4900);
      expect(tierPriceCents("scale", "monthly")).toBe(7900);
    });

    it("returns yearly cents for yearly interval", () => {
      expect(tierPriceCents("starter", "yearly")).toBe(20000);
      expect(tierPriceCents("pro", "yearly")).toBe(49000);
      expect(tierPriceCents("scale", "yearly")).toBe(79000);
    });
  });

  describe("tierPriceDollars()", () => {
    it("returns prices in dollars (cents / 100)", () => {
      expect(tierPriceDollars("starter", "monthly")).toBe(20);
      expect(tierPriceDollars("pro", "yearly")).toBe(490);
    });
  });

  describe("tierForSubscriptionTier()", () => {
    it("maps the legacy solo/operator/empire aliases", () => {
      expect(tierForSubscriptionTier("solo")).toBe("starter");
      expect(tierForSubscriptionTier("operator")).toBe("pro");
      expect(tierForSubscriptionTier("empire")).toBe("scale");
    });

    it("maps canonical starter/pro/scale to themselves", () => {
      expect(tierForSubscriptionTier("starter")).toBe("starter");
      expect(tierForSubscriptionTier("pro")).toBe("pro");
      expect(tierForSubscriptionTier("scale")).toBe("scale");
    });

    it("is case-insensitive", () => {
      expect(tierForSubscriptionTier("STARTER")).toBe("starter");
      expect(tierForSubscriptionTier("Empire")).toBe("scale");
    });

    it("returns null for free tier and unknown values", () => {
      expect(tierForSubscriptionTier("free")).toBeNull();
      expect(tierForSubscriptionTier(null)).toBeNull();
      expect(tierForSubscriptionTier(undefined)).toBeNull();
      expect(tierForSubscriptionTier("")).toBeNull();
      expect(tierForSubscriptionTier("nonsense")).toBeNull();
    });
  });

  describe("monthlyRevenueCentsFor() — MRR math", () => {
    it("returns monthly cents for monthly subscriptions", () => {
      expect(monthlyRevenueCentsFor("starter", "monthly")).toBe(2000);
      expect(monthlyRevenueCentsFor("pro", "monthly")).toBe(4900);
      expect(monthlyRevenueCentsFor("scale", "monthly")).toBe(7900);
    });

    it("amortises yearly subscriptions to a per-month figure", () => {
      // $200 / 12 ≈ $16.67 ≈ 1667 cents
      expect(monthlyRevenueCentsFor("starter", "yearly")).toBe(Math.round(20000 / 12));
      expect(monthlyRevenueCentsFor("pro", "yearly")).toBe(Math.round(49000 / 12));
      expect(monthlyRevenueCentsFor("scale", "yearly")).toBe(Math.round(79000 / 12));
    });

    it("contributes 0 for free / null / unknown tiers", () => {
      expect(monthlyRevenueCentsFor("free")).toBe(0);
      expect(monthlyRevenueCentsFor(null)).toBe(0);
      expect(monthlyRevenueCentsFor(undefined)).toBe(0);
      expect(monthlyRevenueCentsFor("nonsense")).toBe(0);
    });
  });

  describe("Stripe price ID env var wiring", () => {
    // These env vars may be undefined in local/CI — that is intentional.
    // The test fails ONLY if the env var IS set but does not match the
    // value carried in TIER_PRICES_CENTS. That catches drift between the
    // env config and the in-process pricing module.
    //
    // Env var names retain their legacy SOLO/OPERATOR/EMPIRE spelling
    // so deployed Stripe price IDs in Fly secrets keep resolving without
    // a billing-side rename. The CANONICAL tier keys are
    // starter/pro/scale; the env var names are decoupled.
    const ENV_TO_TIER: Array<[string, Tier, "monthly" | "yearly"]> = [
      ["STRIPE_PRICE_SOLO_MONTHLY", "starter", "monthly"],
      ["STRIPE_PRICE_SOLO_YEARLY", "starter", "yearly"],
      ["STRIPE_PRICE_OPERATOR_MONTHLY", "pro", "monthly"],
      ["STRIPE_PRICE_OPERATOR_YEARLY", "pro", "yearly"],
      ["STRIPE_PRICE_EMPIRE_MONTHLY", "scale", "monthly"],
      ["STRIPE_PRICE_EMPIRE_YEARLY", "scale", "yearly"],
    ];

    it.each(ENV_TO_TIER)(
      "%s env var (if set) matches TIER_PRICES_CENTS",
      (envName, tier, interval) => {
        const envValue = process.env[envName];
        if (!envValue) return; // Unset env → skip; not a failure.
        const pricing = TIER_PRICES_CENTS[tier];
        const stored = interval === "monthly"
          ? pricing.stripePriceIdMonthly
          : pricing.stripePriceIdYearly;
        expect(stored).toBe(envValue);
      },
    );

    it("does not fail when no Stripe env vars are set", () => {
      // Smoke test: the module should still expose all tier pricing without
      // those env vars and price IDs simply remain undefined.
      for (const tier of TIERS) {
        const pricing = TIER_PRICES_CENTS[tier];
        // monthly cents stay populated regardless of env state
        expect(pricing.priceMonthlyCents).toBeGreaterThan(0);
        // price IDs are either undefined or non-empty strings (never "")
        if (pricing.stripePriceIdMonthly !== undefined) {
          expect(pricing.stripePriceIdMonthly.length).toBeGreaterThan(0);
        }
        if (pricing.stripePriceIdYearly !== undefined) {
          expect(pricing.stripePriceIdYearly.length).toBeGreaterThan(0);
        }
      }
    });
  });
});
