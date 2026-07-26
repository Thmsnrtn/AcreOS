/**
 * A vertical pack may only be sold when its underlying vertical is
 * production-ready (core|beta). A `roadmap` vertical is on the waitlist —
 * fix_and_flip was demoted beta→roadmap by founder decision 2026-07-11 —
 * and the pack checkout must refuse it rather than charge for a frozen
 * product.
 *
 * These tests pin the wiring (pack → businessTypeId → maturity) so a new
 * pack can't be added without a vertical, and a frozen vertical's pack can't
 * silently become sellable.
 */

import { describe, expect, it } from "vitest";
import {
  VERTICAL_PACKS,
  isVerticalPackPurchasable,
  purchasableVerticalPacks,
  type VerticalPackKey,
} from "../../shared/billing/tier-pricing";
import { isProductionReady, getBusinessType } from "../../shared/business-types";

describe("vertical pack purchasability", () => {
  it("every pack maps to a real business type", () => {
    for (const pack of Object.values(VERTICAL_PACKS)) {
      expect(getBusinessType(pack.businessTypeId), pack.key).not.toBeNull();
    }
  });

  it("purchasability exactly tracks the vertical's production-readiness", () => {
    for (const [key, pack] of Object.entries(VERTICAL_PACKS)) {
      expect(isVerticalPackPurchasable(key as VerticalPackKey)).toBe(
        isProductionReady(pack.businessTypeId),
      );
    }
  });

  it("never sells a pack whose vertical is on the waitlist (roadmap)", () => {
    for (const pack of purchasableVerticalPacks()) {
      const maturity = getBusinessType(pack.businessTypeId)?.maturity;
      expect(maturity, pack.key).not.toBe("roadmap");
    }
  });

  it("refuses the fix_and_flip pack while that vertical is waitlisted", () => {
    // Guards the specific founder decision 2026-07-11. If the founder later
    // promotes fix_and_flip, they update business-types.ts and this flips
    // deliberately — it should never drift silently.
    const flipVertical = getBusinessType("fix_and_flip");
    if (flipVertical?.maturity === "roadmap") {
      expect(isVerticalPackPurchasable("fix_and_flipper")).toBe(false);
    }
  });

  it("unknown pack key is not purchasable", () => {
    expect(isVerticalPackPurchasable("nonexistent" as VerticalPackKey)).toBe(false);
  });
});
