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
 *   5. The demotion map carries thirteen dated entries (OD-5, 2026-08-17)
 *      and every one has a written reason. WHICH verticals are demoted is
 *      pinned in verticalReadiness.test.ts against measured evidence, not
 *      here against a hand-written list — this file guards the derivation,
 *      that one guards the claim.
 */

import { describe, expect, it } from "vitest";

import {
  BUSINESS_TYPES,
  BUSINESS_TYPE_IDS,
  type BusinessTypeId,
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

/** Effective tier the derivation contract promises for an id. */
function expectedTier(id: BusinessTypeId): VerticalMaturity {
  return DEMOTE_ON_LANDING[id]?.to ?? BUSINESS_TYPES[id].maturity;
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
});

describe("DEMOTE_ON_LANDING — the only sanctioned public conservatism", () => {
  it("carries the thirteen OD-5 demotions, and every one is dated", () => {
    // WAS: `expect(Object.keys(DEMOTE_ON_LANDING)).toHaveLength(0)` with the
    // note that the registry truth pass had superseded all hardcoded
    // demotions. That pin was correct until the truth pass itself was
    // checked: verticalReadiness.test.ts measured that all fifteen verticals
    // declare `core` and exactly two record a decision, so the map is no
    // longer empty and must not be.
    //
    // REWRITTEN, not deleted — the invariant is still "a demotion is a
    // deliberate, documented act", and it is asserted more strongly now:
    // every entry must carry a reason and the date it was decided. The
    // membership itself is pinned in verticalReadiness.test.ts against the
    // EVIDENCE rather than against a hand-written list, so this file does not
    // duplicate that.
    const entries = Object.entries(DEMOTE_ON_LANDING);
    expect(entries).toHaveLength(13);
    for (const [id, d] of entries) {
      expect(d!.reason.trim().length, `${id} has an empty reason`).toBeGreaterThan(0);
      expect(d!.decidedOn, `${id} is undated`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(d!.to, `${id} demotes to an unexpected tier`).toBe("beta");
    }
  });

  it("rejects a demotion entry with an empty/whitespace reason", () => {
    const anyId = BUSINESS_TYPE_IDS.find(
      (id) =>
        !LANDING_EXCLUDED_IDS.includes(id) &&
        BUSINESS_TYPES[id].maturity !== "roadmap",
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
  });
});
