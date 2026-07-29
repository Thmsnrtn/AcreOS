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

  it("sells the fix_and_flipper pack now that fix_and_flip is beta (ruling #11, wave V3)", () => {
    // 2026-07-29 wave V3: fix_and_flip flipped roadmap → beta because the
    // 2026-07-11 demotion's ROOT CAUSE is fixed — residential verticals'
    // comps/valuation route through the residentialComps seam (provider
    // registry restricted to ATTOM, pay-per-call, BYOK channel "attom")
    // with honest degradation when unkeyed, instead of the LAND data plane
    // the investorType fork implied. NOT a residential data plane — that
    // hard-stop stands (no bulk ingest, no dedicated vendors). Verified by
    // residentialComps / residentialNoLandFallback / residentialConsumerFork
    // tests; pinned here so a silent re-demotion (or a silent unsellable
    // pack) fails loudly.
    expect(getBusinessType("fix_and_flip")?.maturity).toBe("beta");
    expect(isVerticalPackPurchasable("fix_and_flipper")).toBe(true);
    expect(purchasableVerticalPacks().map((p) => p.key)).toContain("fix_and_flipper");
  });

  it("sells the property-management pack now that buy_and_hold is beta (ruling #11, wave V1)", () => {
    // 2026-07-29 truth pass: buy_and_hold flipped roadmap → beta because
    // the build justifies it (rental schema + routes + pages + Rentals nav
    // module). isVerticalPackPurchasable derives from that maturity, so the
    // pack becoming sellable is the ruling working as designed — pinned
    // here so a silent demotion would fail loudly.
    expect(getBusinessType("buy_and_hold")?.maturity).toBe("beta");
    expect(isVerticalPackPurchasable("buy_and_hold")).toBe(true);
    expect(purchasableVerticalPacks().map((p) => p.key)).toContain("buy_and_hold");
  });

  it("creative_finance is beta (ruling #11, wave V2) yet still has no pack — nothing to sell", () => {
    // 2026-07-29 wave V2: creative_finance flipped roadmap → beta because a
    // real surface now exists (Creative finance sidebar module + /today
    // cluster + the Close & Carry deal→note bridge + Dodd-Frank/Reg-Z
    // compliance stack — see the registry entry's evidence comment). There
    // is still deliberately NO vertical pack for it: adding one is a
    // pricing decision (founder hard-stop), not a maturity side effect —
    // pinned here so a pack can't appear silently.
    expect(getBusinessType("creative_finance")?.maturity).toBe("beta");
    const packVerticalIds = Object.values(VERTICAL_PACKS).map((p) => p.businessTypeId);
    expect(packVerticalIds).not.toContain("creative_finance");
  });

  it("unknown pack key is not purchasable", () => {
    expect(isVerticalPackPurchasable("nonexistent" as VerticalPackKey)).toBe(false);
  });
});
