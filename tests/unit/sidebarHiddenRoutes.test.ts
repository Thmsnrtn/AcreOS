/**
 * Doors doctrine ratchet (CLAUDE.md): "Persona changes only the CONTENT
 * behind each door … never the doors themselves."
 *
 * The 2026-07 design panel found the five-doors doctrine breached in
 * production: sidebar-hidden-routes hid /maps (the Map door) for six
 * business types and /money+/finance for detected wholesalers, while the
 * mobile bottom nav (deliberately unfiltered) kept all five — the same
 * account saw four doors on desktop and five on the phone. This suite
 * pins the cure: no combination of persona axes may ever hide a door,
 * while secondary-route gating keeps working.
 */
import { describe, expect, it } from "vitest";
import {
  resolveHiddenRoutes,
  _SIDEBAR_HIDDEN_ROUTES_REGISTRY,
  type InvestorType,
  type OrgInvestorType,
} from "../../client/src/lib/sidebar-hidden-routes";

const DOORS = ["/today", "/maps", "/deals", "/pipeline", "/money", "/finance", "/ai", "/inbox", "/settings"];

const ALL_BUSINESS_TYPES = Object.keys(_SIDEBAR_HIDDEN_ROUTES_REGISTRY.byBusinessType);
const ALL_DETECTED = Object.keys(
  _SIDEBAR_HIDDEN_ROUTES_REGISTRY.byDetectedInvestorType,
) as InvestorType[];
const ALL_ORG = Object.keys(
  _SIDEBAR_HIDDEN_ROUTES_REGISTRY.byOrgInvestorType,
) as OrgInvestorType[];

describe("five-doors doctrine — doors are unhideable", () => {
  it("no persona-axis combination hides any door", () => {
    for (const businessType of [undefined, ...ALL_BUSINESS_TYPES]) {
      for (const detectedInvestorType of ALL_DETECTED) {
        for (const orgInvestorType of ALL_ORG) {
          const hidden = resolveHiddenRoutes({ businessType, detectedInvestorType, orgInvestorType });
          for (const door of DOORS) {
            expect(hidden, `${businessType}/${detectedInvestorType}/${orgInvestorType} hides door ${door}`).not.toContain(door);
          }
        }
      }
    }
  });

  it("secondary-route gating still works (wholesaler loses portfolio surfaces, not doors)", () => {
    const hidden = resolveHiddenRoutes({
      businessType: "residential_wholesaler",
      detectedInvestorType: "residential_wholesaler",
      orgInvestorType: "both",
    });
    expect(hidden).toContain("/portfolio");
    expect(hidden).toContain("/land-credit");
    expect(hidden).not.toContain("/maps");
    expect(hidden).not.toContain("/money");
    expect(hidden).not.toContain("/finance");
  });
});

describe("landlord family (V1, founder ruling #11) — siblings share buy_and_hold's profile", () => {
  const SIBLINGS = ["short_term_rental", "multifamily", "mobile_home"] as const;

  it("STR / multifamily / mobile-home resolve to the exact same hidden set as buy_and_hold", () => {
    const base = resolveHiddenRoutes({
      businessType: "buy_and_hold",
      detectedInvestorType: "new_investor",
      orgInvestorType: "both",
    });
    for (const sibling of SIBLINGS) {
      const hidden = resolveHiddenRoutes({
        businessType: sibling,
        detectedInvestorType: "new_investor",
        orgInvestorType: "both",
      });
      expect([...hidden].sort(), `${sibling} must match buy_and_hold`).toEqual([...base].sort());
    }
  });

  it("siblings hide note-investor surfaces like buy_and_hold (not the old /maps-only profile)", () => {
    for (const sibling of SIBLINGS) {
      const hidden = resolveHiddenRoutes({
        businessType: sibling,
        detectedInvestorType: "new_investor",
        orgInvestorType: "both",
      });
      expect(hidden, sibling).toContain("/notes");
      expect(hidden, sibling).toContain("/notes/pipeline");
      expect(hidden, sibling).toContain("/borrower-portal");
      expect(hidden, sibling).toContain("/land-credit");
      // /maps is in the registry entry but is a protected door — stays visible.
      expect(hidden, sibling).not.toContain("/maps");
    }
  });
});
