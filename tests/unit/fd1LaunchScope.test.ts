/**
 * FD1 — launch scope & registry (founder decision 2026-11-12; recorded in
 * docs/company/founder-decisions-2026-11-12-launch-scope.md).
 *
 * The public promise is 4 core + 1 beta (FD1 as lifted 2026-11-18 and
 * 2026-11-19: Wholesale, then Tax, earned core on journey proof). The other TEN business types are
 * `registry_only`: registered, built, kept for every existing book — and not
 * offered to new signups or sold to strangers. Fix-and-Flip and Subdivider are
 * registry-only BY NAME (the original 2+3+8 framing left them unassigned).
 *
 * This file pins the exact 15-row presentation, so any flip — up or down — is a
 * deliberate edit here, not a drift. It also pins the three things the
 * presentation must mean in code: selectability (core|beta only), the public
 * projection (registry-only is told as "not sold"), and that nothing was
 * deleted (every registry-only type keeps its label, templates and modules).
 */
import { describe, expect, it } from "vitest";
import {
  BUSINESS_TYPES,
  BUSINESS_TYPE_IDS,
  isProductionReady,
  registryPublicTier,
  type BusinessTypeId,
  type VerticalMaturity,
} from "../../shared/business-types";
import {
  PUBLIC_CLAIM_DEMOTIONS,
  publicMaturityOf,
} from "../../shared/business-types/publicClaims";
import {
  VERTICAL_PACKS,
  isVerticalSelectable,
  selectableVerticals,
  type VerticalPackKey,
} from "../../shared/billing/tier-pricing";

/** The decision, one row per type. Exhaustive: the type forbids a missing key. */
const FD1_PRESENTATION: Record<BusinessTypeId, VerticalMaturity> = {
  land_flipper: "beta",
  note_investor: "core",
  tax_lien_deed: "core",
  residential_wholesaler: "core",
  buy_and_hold: "core",
  hybrid: "registry_only",
  fix_and_flip: "registry_only",
  short_term_rental: "registry_only",
  commercial: "registry_only",
  creative_finance: "registry_only",
  developer: "registry_only",
  subdivider: "registry_only",
  multifamily: "registry_only",
  mobile_home: "registry_only",
  agent_investor: "registry_only",
};

const byTier = (tier: VerticalMaturity): BusinessTypeId[] =>
  BUSINESS_TYPE_IDS.filter((id) => BUSINESS_TYPES[id].maturity === tier);

describe("FD1 — the registry states the launch presentation exactly", () => {
  it("every one of the 15 types carries its FD1 maturity, no more and no fewer types", () => {
    const actual = Object.fromEntries(
      BUSINESS_TYPE_IDS.map((id) => [id, BUSINESS_TYPES[id].maturity]),
    );
    expect(actual).toEqual(FD1_PRESENTATION);
    expect(BUSINESS_TYPE_IDS).toHaveLength(15);
  });

  it("4 core / 1 beta / 10 registry-only / 0 roadmap", () => {
    expect(byTier("core").sort()).toEqual(["buy_and_hold", "note_investor", "residential_wholesaler", "tax_lien_deed"]);
    expect(byTier("beta").sort()).toEqual(["land_flipper"]);
    expect(byTier("registry_only")).toHaveLength(10);
    expect(byTier("roadmap")).toEqual([]);
  });

  it("Fix-and-Flip and Subdivider are registry-only by name", () => {
    // The two types the original arithmetic left unassigned. Both still
    // measure `decided` (verticalReadiness.test.ts) — this is a presentation
    // decision, not a verdict on the build.
    expect(BUSINESS_TYPES.fix_and_flip.maturity).toBe("registry_only");
    expect(BUSINESS_TYPES.subdivider.maturity).toBe("registry_only");
  });
});

describe("FD1 — registry-only means NOT DELETED", () => {
  it.each(byTier("registry_only"))("%s keeps its label, workflow templates and spotlight modules", (id) => {
    const meta = BUSINESS_TYPES[id];
    expect(meta.id).toBe(id);
    expect(meta.label.trim().length).toBeGreaterThan(0);
    expect(meta.workflowTemplateIds.length).toBeGreaterThan(0);
    expect(meta.spotlightModules.length).toBeGreaterThan(0);
  });
});

describe("FD1 — what the presentation means in code", () => {
  it("only core|beta are selectable for a new signup; registry-only is not", () => {
    for (const id of BUSINESS_TYPE_IDS) {
      const m = BUSINESS_TYPES[id].maturity;
      expect(isProductionReady(id), id).toBe(m === "core" || m === "beta");
    }
    expect(BUSINESS_TYPE_IDS.filter((id) => isProductionReady(id)).sort()).toEqual(
      ["buy_and_hold", "land_flipper", "note_investor", "residential_wholesaler", "tax_lien_deed"],
    );
  });

  it("the vertical profiles follow: Fix-and-Flip and Subdivision packs are no longer selectable", () => {
    // tier-pricing's packs gate on isProductionReady, so the registry re-cut
    // reaches the pricing page and POST /api/verticals/select with no second list.
    const selectable = selectableVerticals().map((p) => p.key).sort();
    expect(selectable).toEqual(["buy_and_hold", "note_investor", "wholesale"]);
    expect(isVerticalSelectable("fix_and_flipper" as VerticalPackKey)).toBe(false);
    expect(isVerticalSelectable("subdivision" as VerticalPackKey)).toBe(false);
    // Vacuity: the packs still EXIST (registry-only ≠ deleted); they are
    // simply not offered.
    expect(VERTICAL_PACKS.fix_and_flipper.businessTypeId).toBe("fix_and_flip");
    expect(VERTICAL_PACKS.subdivision.businessTypeId).toBe("subdivider");
  });

  it("registry-only projects to the public 'not sold' tier; core and beta project to themselves", () => {
    expect(registryPublicTier("registry_only")).toBe("roadmap");
    expect(registryPublicTier("core")).toBe("core");
    expect(registryPublicTier("beta")).toBe("beta");
    expect(registryPublicTier("roadmap")).toBe("roadmap");
  });

  it("publicMaturityOf derives from the registry: strangers are told 4 core, 1 beta, 10 not sold", () => {
    const told = (tier: string) =>
      BUSINESS_TYPE_IDS.filter((id) => publicMaturityOf(BUSINESS_TYPES[id]) === tier).sort();
    expect(told("core")).toEqual(["buy_and_hold", "note_investor", "residential_wholesaler", "tax_lien_deed"]);
    expect(told("beta")).toEqual(["land_flipper"]);
    expect(told("roadmap")).toEqual(byTier("registry_only").sort());
  });

  it("the public demotion table is EMPTY and stays empty — the registry carries the conservatism now", () => {
    expect(PUBLIC_CLAIM_DEMOTIONS).toEqual({});
  });

  it("canary: the projection reads the registry, not a list — a synthetic flip moves the public tier", () => {
    // Falsifies the derivation against a registry state the live one is not in.
    const flipped = { ...BUSINESS_TYPES.commercial, maturity: "core" as const };
    expect(publicMaturityOf(flipped)).toBe("core");
    const demoted = { ...BUSINESS_TYPES.land_flipper, maturity: "registry_only" as const };
    expect(publicMaturityOf(demoted)).toBe("roadmap");
  });
});
