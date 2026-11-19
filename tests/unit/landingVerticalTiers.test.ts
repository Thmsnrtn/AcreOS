/**
 * Wave V1 (founder ruling #11) — the landing page's vertical promise
 * DERIVES from the business-type registry instead of hardcoded strings.
 *
 * Pins the derivation LOGIC in
 * client/src/pages/landing/Positioning.tsx (deriveLandingTiers) against
 * the LIVE registry (shared/business-types.ts) — deliberately NOT a
 * snapshot of today's tiers, so a registry maturity flip (e.g. the
 * buy_and_hold roadmap→beta / creative_finance beta→roadmap flips
 * landing this wave) flows through without touching this file.
 *
 * Guarantees pinned:
 *   1. Every BUSINESS_TYPE_IDS entry except `hybrid` renders in exactly
 *      one tier (the whole ambition is visible, honestly labeled).
 *   2. Each vertical's tier equals its registry maturity, lowered only
 *      by an explicit DEMOTE_ON_LANDING entry.
 *   3. Chip labels are the registry labels verbatim.
 *   4. The exceptions map requires a non-empty reason (runtime throw;
 *      the `LandingDemotion` type also makes `reason` required at the
 *      type level) and can only DEMOTE — a promote/no-op entry throws.
 *   5. The demotion map is EMPTY since FD1 (2026-11-12): the registry states
 *      the launch presentation itself (4 core / 1 beta / 10 registry_only
 *      since Tax's 2026-11-19 lift, pinned in fd1LaunchScope.test.ts), and a registry_only vertical
 *      renders in the muted third tier — "not sold". WHICH verticals may
 *      claim what is pinned in verticalReadiness.test.ts against measured
 *      evidence, not here — this file guards the derivation, that one guards
 *      the claim.
 */

import { describe, expect, it } from "vitest";

import {
  BUSINESS_TYPES,
  BUSINESS_TYPE_IDS,
  registryPublicTier,
  type BusinessTypeId,
  type PublicMaturity,
  type VerticalMaturity,
} from "../../shared/business-types";
import {
  DEMOTE_ON_LANDING,
  LANDING_EXCLUDED_IDS,
  deriveLandingTiers,
  type LandingDemotion,
  type LandingVerticalTiers,
} from "../../client/src/pages/landing/Positioning";

const TIER_NAMES = ["core", "beta", "roadmap"] as const;

function allChips(tiers: LandingVerticalTiers) {
  return TIER_NAMES.flatMap((t) => tiers[t]);
}

/**
 * Effective tier the derivation contract promises for an id: the registry's
 * public projection (registry_only → the "not sold" roadmap tier), lowered
 * only by an explicit demotion.
 */
function expectedTier(id: BusinessTypeId): PublicMaturity {
  return DEMOTE_ON_LANDING[id]?.to ?? registryPublicTier(BUSINESS_TYPES[id].maturity);
}

/** Live-registry id of the given maturity (excluding non-chip ids), if any. */
function liveIdWithMaturity(m: VerticalMaturity): BusinessTypeId | undefined {
  return BUSINESS_TYPE_IDS.find(
    (id) =>
      BUSINESS_TYPES[id].maturity === m && !LANDING_EXCLUDED_IDS.includes(id),
  );
}

describe("landing vertical tiers derive from the business-type registry", () => {
  const tiers = deriveLandingTiers();

  it("renders every registry vertical except the excluded (hybrid) set in exactly one tier", () => {
    const rendered = allChips(tiers).map((c) => c.id);
    const expected = BUSINESS_TYPE_IDS.filter(
      (id) => !LANDING_EXCLUDED_IDS.includes(id),
    );

    // Exactly one tier each: no omissions, no duplicates across tiers.
    expect([...rendered].sort()).toEqual([...expected].sort());
    expect(new Set(rendered).size).toBe(rendered.length);
  });

  it("never renders hybrid as its own chip (land + notes = the two core chips)", () => {
    expect(LANDING_EXCLUDED_IDS).toContain("hybrid");
    expect(allChips(tiers).some((c) => c.id === "hybrid")).toBe(false);
  });

  it("places each vertical in the tier its registry maturity declares (minus explicit demotions)", () => {
    for (const tier of TIER_NAMES) {
      for (const chip of tiers[tier]) {
        expect(
          expectedTier(chip.id),
          `${chip.id} rendered in "${tier}" but registry+demotions say "${expectedTier(chip.id)}"`,
        ).toBe(tier);
      }
    }
  });

  it("uses each registry entry's label verbatim as the chip label", () => {
    for (const chip of allChips(tiers)) {
      expect(chip.label).toBe(BUSINESS_TYPES[chip.id].label);
    }
  });

  it("default invocation equals explicit live-registry invocation (build-time = live)", () => {
    expect(deriveLandingTiers(BUSINESS_TYPES, DEMOTE_ON_LANDING)).toEqual(tiers);
  });

  it("renders the FD1 presentation: every registry_only vertical in the muted 'not sold' tier, 4 core, 1 beta", () => {
    const registryOnly = BUSINESS_TYPE_IDS.filter(
      (id) => BUSINESS_TYPES[id].maturity === "registry_only" && !LANDING_EXCLUDED_IDS.includes(id),
    );
    expect(registryOnly.length).toBeGreaterThan(0);
    expect(tiers.roadmap.map((c) => c.id).sort()).toEqual([...registryOnly].sort());
    expect(tiers.core).toHaveLength(4);
    expect(tiers.beta).toHaveLength(1);
  });
});

describe("DEMOTE_ON_LANDING — the only sanctioned public conservatism", () => {
  it("is EMPTY under FD1 — the registry carries the conservatism, and the map is pinned empty", () => {
    // History of this pin, kept because each turn was a real finding:
    //   - originally `toHaveLength(0)` ("the registry truth pass superseded all
    //     hardcoded demotions") — correct until verticalReadiness.test.ts
    //     measured that all fifteen verticals declared `core` and two recorded
    //     a decision, so the map filled (13 at OD-5, 2026-08-17);
    //   - then a shrinking count as verticals closed the loop (land released
    //     2026-10-04; buy-and-hold released 2026-11-05 after its journey proof;
    //     11 at the last pin);
    //   - FD1 (2026-11-12) moved the conservatism INTO the registry
    //     (2 core / 3 beta / 10 registry_only), so the map is empty again — and
    //     this time the reason is pinned beside it in fd1LaunchScope.test.ts.
    //
    // The invariant is unchanged: a demotion is a deliberate, documented act.
    // Today there is none, and a new entry is a founder decision.
    expect(DEMOTE_ON_LANDING).toEqual({});
  });

  it("rejects a demotion entry with an empty/whitespace reason", () => {
    const anyId = BUSINESS_TYPE_IDS.find(
      (id) =>
        !LANDING_EXCLUDED_IDS.includes(id) &&
        BUSINESS_TYPES[id].maturity !== "roadmap" &&
        BUSINESS_TYPES[id].maturity !== "registry_only",
    );
    // Registry always carries at least one core/beta vertical (land_flipper
    // is the founding wedge); if that ever changes this test must be revisited.
    expect(anyId).toBeDefined();
    const demotions: Partial<Record<BusinessTypeId, LandingDemotion>> = {
      [anyId as BusinessTypeId]: { to: "roadmap", reason: "   ", decidedOn: "2026-08-17" },
    };
    expect(() => deriveLandingTiers(BUSINESS_TYPES, demotions)).toThrow(
      /non-empty reason/,
    );
  });

  it("applies a valid demotion (reason present, moves DOWN) to the lower tier", () => {
    const target = liveIdWithMaturity("core") ?? liveIdWithMaturity("beta");
    expect(target).toBeDefined();
    const id = target as BusinessTypeId;
    const demotions: Partial<Record<BusinessTypeId, LandingDemotion>> = {
      [id]: { to: "roadmap", reason: "test: documented conservatism", decidedOn: "2026-08-17" },
    };
    const tiers = deriveLandingTiers(BUSINESS_TYPES, demotions);
    expect(tiers.roadmap.map((c) => c.id)).toContain(id);
    expect(tiers.core.map((c) => c.id)).not.toContain(id);
    expect(tiers.beta.map((c) => c.id)).not.toContain(id);
  });

  it("rejects an entry that does not actually demote (no-op or promote)", () => {
    // REWRITTEN (Wave 5 — every live vertical is now core): a no-op/promote
    // demotion is UNCONSTRUCTABLE from the live registry, because
    // LandingDemotion.to is beta|roadmap and demoting any core vertical to either
    // is a genuine DOWN move. deriveLandingTiers is a pure function of its
    // registry arg, so the invariant is exercised on a SYNTHETIC registry (a real
    // meta with its maturity overridden) — this holds regardless of the live
    // maturity distribution, unlike the old assertion that assumed a beta/roadmap
    // vertical always exists.
    const asBeta = {
      ...BUSINESS_TYPES,
      commercial: { ...BUSINESS_TYPES.commercial, maturity: "beta" as const },
    };
    // No-op: a beta vertical demoted "to" beta.
    expect(() =>
      deriveLandingTiers(asBeta, { commercial: { to: "beta", reason: "stale", decidedOn: "2026-08-17" } }),
    ).toThrow(/must move a vertical DOWN/);
    const asRoadmap = {
      ...BUSINESS_TYPES,
      commercial: { ...BUSINESS_TYPES.commercial, maturity: "roadmap" as const },
    };
    // Promote: a roadmap vertical "demoted" to beta.
    expect(() =>
      deriveLandingTiers(asRoadmap, { commercial: { to: "beta", reason: "stale", decidedOn: "2026-08-17" } }),
    ).toThrow(/must move a vertical DOWN/);
    // And any still-live beta/roadmap vertical is likewise rejected on a no-op.
    const betaId = liveIdWithMaturity("beta");
    if (betaId) {
      expect(() =>
        deriveLandingTiers(BUSINESS_TYPES, { [betaId]: { to: "beta", reason: "stale", decidedOn: "2026-08-17" } }),
      ).toThrow(/must move a vertical DOWN/);
    }
    // FD1: a live registry_only vertical is already told as "not sold", so a
    // demotion to roadmap is a no-op and to beta is a promote — both refused.
    const registryOnlyId = liveIdWithMaturity("registry_only");
    expect(registryOnlyId, "FD1 leaves ten registry_only verticals; none found").toBeDefined();
    for (const to of ["roadmap", "beta"] as const) {
      expect(() =>
        deriveLandingTiers(BUSINESS_TYPES, { [registryOnlyId!]: { to, reason: "stale", decidedOn: "2026-11-12" } }),
      ).toThrow(/must move a vertical DOWN/);
    }
  });
});
