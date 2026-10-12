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
