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

  it("sells the fix_and_flipper pack now that fix_and_flip is core (audit Wave 1, beta→core)", () => {
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
    //
    // 2026-08 audit Wave 1: beta → core — the renovate half of the flip loop
    // is now LIVE (rehab.milestone + rehab.punch_list_complete emitted from the
    // rehab status machine; rehabEvents.ts + workflowActionHonesty pin it), so
    // the vertical passes the honesty bar for core. Purchasability is unchanged
    // (core, like beta, is production-ready) — this assertion now tracks core.
    expect(getBusinessType("fix_and_flip")?.maturity).toBe("core");
    expect(isVerticalPackPurchasable("fix_and_flipper")).toBe(true);
    expect(purchasableVerticalPacks().map((p) => p.key)).toContain("fix_and_flipper");
  });

  it("sells the property-management pack now that buy_and_hold is core (audit Wave 1, beta→core)", () => {
    // 2026-07-29 truth pass: buy_and_hold flipped roadmap → beta because
    // the build justifies it (rental schema + routes + pages + Rentals nav
    // module). isVerticalPackPurchasable derives from that maturity, so the
    // pack becoming sellable is the ruling working as designed — pinned
    // here so a silent demotion would fail loudly.
    //
    // 2026-08 audit Wave 1: beta → core — all four landlord templates are now
    // LIVE (rent.received on the rent-ledger POST seam,
    // maintenance.request_received on the maintenance POST seam, and
    // lease.renewal_countdown_60d + lease.expiring_60d from the daily
    // leaseExpiryDetector; rentalEvents.ts + workflowActionHonesty pin it). The
    // templates were de-fabricated in the same change WITHOUT touching the
    // residential-comps data plane (that hard-stop stands — the renewal template
    // prompts the operator to pull market rent on their own surface), so the
    // vertical passes the honesty bar for core. Purchasability is unchanged
    // (core, like beta, is production-ready) — this assertion now tracks core.
    expect(getBusinessType("buy_and_hold")?.maturity).toBe("core");
    expect(isVerticalPackPurchasable("buy_and_hold")).toBe(true);
    expect(purchasableVerticalPacks().map((p) => p.key)).toContain("buy_and_hold");
  });

  it("creative_finance is core (audit Wave 1) yet still has no pack — nothing to sell", () => {
    // 2026-07-29 wave V2: creative_finance flipped roadmap → beta because a
    // real surface now exists (Creative finance sidebar module + /today
    // cluster + the Close & Carry deal→note bridge + Dodd-Frank/Reg-Z
    // compliance stack — see the registry entry's evidence comment).
    //
    // 2026-08 audit Wave 1: beta → core — the vertical's ONLY genuinely-dead
    // template lane went live (note.balloon_approaching emitted from the daily
    // notePaymentDueDetector scan; noteEvents.ts + workflowActionHonesty pin it),
    // and the two balloon templates were de-fabricated ({{balloonAmount}} →
    // approximate {{outstandingBalance}}). There is still deliberately NO vertical
    // pack for it: adding one is a pricing decision (founder hard-stop), not a
    // maturity side effect — pinned here so a pack can't appear silently, and so a
    // silent re-demotion of the vertical fails loudly.
    expect(getBusinessType("creative_finance")?.maturity).toBe("core");
    const packVerticalIds = Object.values(VERTICAL_PACKS).map((p) => p.businessTypeId);
    expect(packVerticalIds).not.toContain("creative_finance");
  });

  it("residential_wholesaler is core and advertises no dishonest template", () => {
    // 2026-08 audit Wave 1: residential_wholesaler beta→core once three of its
    // four templates went live (deal.contract_signed + deal.assignment_pending
    // via wholesaleEvents.ts; buyer.match_created via buyerEvents.ts).
    //
    // THE STRIPE ASSERTION MOVED, 2026-08-18. This used to read
    // `expect(wholesaler?.integrations ?? []).not.toContain("stripe")`, guarding
    // the money-custody hard-stop (EMD and assignment funds must never transit
    // AcreOS). The invariant is real; the thing it was asserted against was not.
    // `BusinessTypeMeta.integrations` had ZERO production readers — no surface
    // rendered it, no route filtered on it — so re-adding "stripe" to that array
    // would have failed this test while changing nothing a customer could reach,
    // and NOT re-adding it proved nothing about where money actually moves.
    //
    // The real invariant is enforced where money is: moneyCustodyHardStop.test.ts
    // scans the whole corpus for a platform-take Stripe parameter outside the
    // guard that forbids it, and for raw bank details in any route file. That is
    // a semantic check against the behaviour; this was a name check against a
    // decoration. The field is deleted; keeping it alive so one test could assert
    // on it is the "exists only for its test" shape this repo has removed before.
    const wholesaler = getBusinessType("residential_wholesaler");
    expect(wholesaler?.maturity).toBe("core");
    // The occupied cash-for-keys template is no longer advertised (no occupancy
    // schema — cannot be made honest).
    expect(wholesaler?.workflowTemplateIds).not.toContain(
      "tpl_wholesaler_occupied_cash_for_keys",
    );
  });

  it("unknown pack key is not purchasable", () => {
    expect(isVerticalPackPurchasable("nonexistent" as VerticalPackKey)).toBe(false);
  });
});
