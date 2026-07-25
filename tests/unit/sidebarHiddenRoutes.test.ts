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
