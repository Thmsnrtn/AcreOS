/**
 * The plan tables cannot drift: SUBSCRIPTION_TIERS (shared/schema.ts) says
 * exactly what TIER_LIMITS and TIER_PRICES_CENTS say.
 *
 * THE DEFECT. SUBSCRIPTION_TIERS carried its own numbers while the gates read
 * TIER_LIMITS: Pro claimed 5,000 leads and 10 team members against an enforced
 * 500 leads and 2 included seats (max 5); Scale "25 team members" against 10
 * included; a $29 "Sprout" plan and an $899 Enterprise list price existed in no
 * other table. It is served publicly (GET /api/subscription/tiers) and its name
 * and price reach upgrade copy (skill-permissions.ts).
 *
 * WHAT IS PINNED is equality with the canonical tables, read entry by entry —
 * so a literal reintroduced into SUBSCRIPTION_TIERS (or a number changed in one
 * table and not the other) is red, whatever the field is called. The per-seat
 * add-on price is held in both pricing tables, so they are pinned equal too.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect } from "vitest";
import { SUBSCRIPTION_TIERS } from "@shared/schema";
import { TIER_LIMITS, type SubscriptionTier } from "@shared/billing/tier-limits";
import { TIER_PRICES_CENTS, type Tier } from "@shared/billing/tier-pricing";

const PAID: Tier[] = ["starter", "pro", "scale"];
const asCatalogue = (n: number | null) => (n === null ? -1 : n);

describe("SUBSCRIPTION_TIERS is a projection of the canonical plan tables", () => {
  it("lists exactly the tiers the gates know", () => {
    expect(Object.keys(SUBSCRIPTION_TIERS).sort()).toEqual(Object.keys(TIER_LIMITS).sort());
  });

  it("every limit equals TIER_LIMITS", () => {
    const keys = Object.keys(SUBSCRIPTION_TIERS) as SubscriptionTier[];
    expect(keys.length).toBeGreaterThanOrEqual(5);
    for (const t of keys) {
      const c = SUBSCRIPTION_TIERS[t].limits;
      const l = TIER_LIMITS[t];
      expect(c, t).toEqual({
        leads: asCatalogue(l.leads),
        properties: asCatalogue(l.properties),
        notes: asCatalogue(l.notes),
        includedSeats: l.includedSeats,
        maxSeats: asCatalogue(l.maxSeats),
        aiRequestsPerMonth: asCatalogue(l.ai_requests),
        campaigns: asCatalogue(l.campaigns),
      });
    }
  });

  it("every name and price equals TIER_PRICES_CENTS; free is $0 and enterprise carries no invented list price", () => {
    for (const t of PAID) {
      expect(SUBSCRIPTION_TIERS[t].price, t).toBe(TIER_PRICES_CENTS[t].priceMonthlyCents / 100);
      expect(SUBSCRIPTION_TIERS[t].name, t).toBe(TIER_PRICES_CENTS[t].displayName);
    }
    expect(SUBSCRIPTION_TIERS.free.price).toBe(0);
    expect(SUBSCRIPTION_TIERS.enterprise.price).toBeNull();
  });

  it("the per-seat add-on price is the same number in both pricing tables", () => {
    for (const t of PAID) {
      expect(TIER_PRICES_CENTS[t].priceMonthlyPerSeatCents, t).toBe(TIER_LIMITS[t].seatPriceCents);
    }
  });
});

/**
 * TAIL-B4: the Stripe SEED catalog cannot drift from the pricing copy.
 *
 * THE DEFECT. server/seed-products.ts priced the Pro seat add-on from the
 * STARTER tier's price — $49/seat under a "$20/seat" comment — and seeded
 * no Scale add-on at all, while scripts/setup-stripe-subscription-products.ts
 * (the canonical seeder) carried the right numbers as bare literals that
 * nothing pinned. A seed run would have created a wrongly-priced Stripe
 * product. Both seeders now DERIVE seat prices from TIER_PRICES_CENTS;
 * these source-level assertions (the seeders cannot be imported — they
 * run against Stripe on load) fail if a literal or a wrong-tier reference
 * comes back.
 */
describe("the Stripe seed catalog matches the pricing copy (TAIL-B4)", () => {
  const root = path.resolve(__dirname, "../..");
  const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

  it("the canonical seat prices the seeds must derive: Pro $20, Scale $25, Starter none", () => {
    expect(TIER_PRICES_CENTS.pro.priceMonthlyPerSeatCents).toBe(2000);
    expect(TIER_PRICES_CENTS.scale.priceMonthlyPerSeatCents).toBe(2500);
    expect(TIER_PRICES_CENTS.starter.priceMonthlyPerSeatCents).toBeNull();
  });

  it("the legacy seed derives BOTH seat add-ons from TIER_PRICES_CENTS and never from the Starter price", () => {
    const src = read("server/seed-products.ts");
    const seatBlock = src.slice(src.indexOf("SEAT_ADDON_PRODUCTS"), src.indexOf("SUBSCRIPTION_PRODUCTS"));
    expect(seatBlock).toMatch(/TIER_PRICES_CENTS\.pro\.priceMonthlyPerSeatCents/);
    expect(seatBlock).toMatch(/TIER_PRICES_CENTS\.scale\.priceMonthlyPerSeatCents/);
    expect(seatBlock).toMatch(/Scale Seat Add-on/);
    // The bug itself: a seat add-on priced off the base tier price.
    expect(seatBlock).not.toMatch(/TIER_PRICES_CENTS\.starter/);
    expect(seatBlock).not.toMatch(/TIER_PRICES_CENTS\.(pro|scale)\.priceMonthlyCents/);
  });

  it("the canonical setup script derives its seat specs from TIER_PRICES_CENTS (no seat-price literals)", () => {
    const src = read("scripts/setup-stripe-subscription-products.ts");
    const seatSpecs = src.slice(src.indexOf('"seat_pro"'), src.indexOf("];", src.indexOf('"seat_pro"')));
    expect(seatSpecs).toMatch(/TIER_PRICES_CENTS\.pro\.priceMonthlyPerSeatCents/);
    expect(seatSpecs).toMatch(/TIER_PRICES_CENTS\.scale\.priceMonthlyPerSeatCents/);
    expect(seatSpecs).not.toMatch(/(monthly|yearly)PriceCents:\s*\d/);
  });
});
