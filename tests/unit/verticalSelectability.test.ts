/**
 * Vertical selectability — founder decision 2026-10-18: verticals are
 * INCLUDED profiles, not paid add-ons. A customer's subscription price is
 * determined ONLY by tier. There is no price, no Stripe product, and no
 * checkout for a vertical.
 *
 * A vertical is SELECTABLE when its underlying business type is
 * production-ready (core|beta). A `roadmap` vertical is on the waitlist.
 * Selection is free; this gates availability, never payment.
 *
 * These tests pin the wiring (vertical → businessTypeId → maturity) so a
 * new vertical can't be added without a business type, and a frozen
 * vertical can't silently become selectable.
 */

import { describe, expect, it } from "vitest";
import {
  VERTICAL_PACKS,
  isVerticalSelectable,
  selectableVerticals,
  type VerticalPackKey,
} from "../../shared/billing/tier-pricing";
import { isProductionReady, getBusinessType } from "../../shared/business-types";

describe("vertical selectability", () => {
  it("every vertical maps to a real business type", () => {
    for (const pack of Object.values(VERTICAL_PACKS)) {
      expect(getBusinessType(pack.businessTypeId), pack.key).not.toBeNull();
    }
  });

  it("selectability exactly tracks the vertical's production-readiness", () => {
    for (const [key, pack] of Object.entries(VERTICAL_PACKS)) {
      expect(isVerticalSelectable(key as VerticalPackKey)).toBe(
        isProductionReady(pack.businessTypeId),
      );
    }
  });

  it("never selects a vertical that is on the waitlist (roadmap)", () => {
    for (const pack of selectableVerticals()) {
      const maturity = getBusinessType(pack.businessTypeId)?.maturity;
      expect(maturity, pack.key).not.toBe("roadmap");
    }
  });

  it("verticals carry no pricing — selection is free", () => {
    for (const pack of Object.values(VERTICAL_PACKS)) {
      expect(pack, pack.key).not.toHaveProperty("priceMonthlyCents");
      expect(pack, pack.key).not.toHaveProperty("priceYearlyCents");
      expect(pack, pack.key).not.toHaveProperty("stripePriceIdMonthly");
      expect(pack, pack.key).not.toHaveProperty("stripePriceIdYearly");
    }
  });

  it("verticals carry feature lists for the selection UI", () => {
    for (const pack of Object.values(VERTICAL_PACKS)) {
      expect(Array.isArray(pack.features), pack.key).toBe(true);
      expect(pack.features.length, pack.key).toBeGreaterThan(0);
    }
  });

  it("the old purchase API is gone", async () => {
    const mod = (await import("../../shared/billing/tier-pricing")) as Record<string, unknown>;
    expect(mod.isVerticalPackPurchasable).toBeUndefined();
    expect(mod.purchasableVerticalPacks).toBeUndefined();
    expect(mod.packPriceCents).toBeUndefined();
    expect(mod.totalSubscriptionCents).toBeUndefined();
  });

  it("unknown vertical key is not selectable", () => {
    expect(isVerticalSelectable("nonexistent" as VerticalPackKey)).toBe(false);
  });
});
