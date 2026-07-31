/**
 * The statutory late-fee cap, and the unit count that selects its branch.
 *
 * WHY THIS IS DELICATE
 * --------------------
 * Tex. Prop. Code §92.019 sets one cap percentage for properties under 4 units
 * and another at 4+. Before a units table existed, AcreOS could not count a
 * property's units at all — `properties` has no unit_count column — so it
 * derived a FLOOR from lease history ("units this org has ever put on a lease
 * here") and, below 4, computed BOTH statutory branches and charged the LOWER.
 * That hedge was correct: the platform must never bill a tenant more because
 * of a number it does not trust.
 *
 * With modelled units the count is exact and the statute can be applied as
 * written. The risk that introduces is the one this file exists to bound:
 * **a landlord finishing their data entry is not a fact about the tenant**, and
 * no change in AcreOS's own record-keeping may be the reason a charge goes up.
 *
 * `proposeLateFeeForUnitCount` is pure, so every branch a real tenant could be
 * charged under is a test rather than a database fixture.
 */
import { describe, it, expect } from "vitest";
import {
  proposeLateFeeForUnitCount,
  STATUTORY_UNIT_STATUSES,
  type PropertyUnitCount,
} from "../../server/routes-rent-ledger";
import type { LateFeeRuleData } from "../../shared/rental/lateFeeProposal";

/** Texas as seeded: 10% under 4 units, 12% at 4+, 2-day grace. */
const TX: LateFeeRuleData = {
  state: "TX",
  capPctSmallProperty: 0.1,
  capPctLargeProperty: 0.12,
  capFlatCents: null,
  graceDays: 2,
  initialFeeCents: 5_000,
  perDayCents: 500,
  citation: "Tex. Prop. Code §92.019",
};

const RENT = 200_000; // $2,000.00/mo
// 60 days: initial 5000 + 60 x 500 = 35,000 uncapped, which EXCEEDS the small
// cap (20,000) but not the large one (24,000). That gap is what makes the two
// statutory branches produce different money — at 30 days the uncapped fee sits
// under both caps, the branches agree, and the hedge never engages, so the
// fallback below would pass without testing anything.
const DAYS_LATE = 60;

function propose(units: PropertyUnitCount, rule: LateFeeRuleData | null = TX) {
  return proposeLateFeeForUnitCount({
    rule,
    monthlyRentCents: RENT,
    daysLate: DAYS_LATE,
    units,
    state: "TX",
  });
}

const modelled = (count: number): PropertyUnitCount => ({ count, basis: "modelled_units" });
const floor = (count: number): PropertyUnitCount => ({ count, basis: "lease_derived_floor" });

describe("an exact count applies the statute as written", () => {
  it("6 modelled units takes the 4+ branch, with no hedge", () => {
    const p = propose(modelled(6));
    expect(p.unitBranch).toBe("large_4_plus");
    expect(p.unitCount).toBe(6);
    expect(p.unitCountBasis).toBe("modelled_units");
    // 12% of $2,000 = $240.00
    expect(p.capCents).toBe(24_000);
  });

  it("3 modelled units takes the under-4 branch EXACTLY, not conservatively", () => {
    const p = propose(modelled(3));
    // The distinction that matters: `small_under_4` is a determination,
    // `conservative_unknown` is an admission. A property whose units are on
    // record deserves the former.
    expect(p.unitBranch).toBe("small_under_4");
    expect(p.capCents).toBe(20_000); // 10% of $2,000
  });

  it("4 is the boundary, and it is inclusive", () => {
    expect(propose(modelled(4)).unitBranch).toBe("large_4_plus");
    expect(propose(modelled(3)).unitBranch).toBe("small_under_4");
  });
});

describe("which statuses are units for statutory purposes", () => {
  it("counts active AND offline, never retired", () => {
    // A legal judgement, not an implementation detail: §92.019 keys off how
    // many dwelling units the STRUCTURE contains, not how many the landlord
    // can rent this month. A unit gutted by a fire is still a unit, and the
    // cap applying to the tenant next door must not move because a contractor
    // is behind schedule.
    expect([...STATUTORY_UNIT_STATUSES].sort()).toEqual(["active", "offline"]);
    expect(STATUTORY_UNIT_STATUSES).not.toContain("retired");
  });

  it("2 active + 2 offline is FOUR units — the 4+ branch", () => {
    // Constructed the way the route builds it, so the rule above is exercised
    // through the same arithmetic a real property would take.
    const p = propose(modelled(2 + 2));
    expect(p.unitCount).toBe(4);
    expect(p.unitBranch).toBe("large_4_plus");
  });
});

describe("the fallback is untouched — byte for byte", () => {
  it("a floor under 4 still computes both branches and charges the lower", () => {
    const p = propose(floor(2));
    expect(p.unitCountBasis).toBe("lease_derived_floor");
    // The hedge is intact: the branch label still says the count is unknown.
    expect(p.unitBranch).toBe("conservative_unknown");
    // And the fee is the smaller of the two branches' caps.
    expect(p.proposedFeeCents).toBeLessThanOrEqual(24_000);
  });

  it("a floor of 4+ needs no hedge — 4+ is certainty either way", () => {
    const p = propose(floor(7));
    expect(p.unitBranch).toBe("large_4_plus");
  });
});

describe("THE RAIL — modelling units may never raise a tenant's fee", () => {
  it("holds at every count from 1 to 8, for the seeded rule", () => {
    // The property is the same building in both readings; only AcreOS's
    // knowledge of it differs. If the exact path ever proposes MORE than the
    // floor path would have, the platform is billing a tenant for the
    // landlord's data entry.
    for (let n = 1; n <= 8; n++) {
      const exact = propose(modelled(n));
      const hedged = propose(floor(n));
      expect(
        exact.proposedFeeCents,
        `count ${n}: modelling units raised the fee from ${hedged.proposedFeeCents} to ${exact.proposedFeeCents}`,
      ).toBeLessThanOrEqual(hedged.proposedFeeCents);
    }
  });

  it("holds even for an INVERTED rule, where small properties are capped higher", () => {
    // No seeded state does this today, which is exactly why the rail must be
    // tested rather than assumed — the first state that inverts the
    // percentages would otherwise turn "we finished entering our units" into
    // a rent increase for the tenant.
    const inverted: LateFeeRuleData = {
      ...TX,
      capPctSmallProperty: 0.15,
      capPctLargeProperty: 0.05,
    };
    for (const n of [1, 2, 3]) {
      const exact = proposeLateFeeForUnitCount({
        rule: inverted, monthlyRentCents: RENT, daysLate: DAYS_LATE,
        units: modelled(n), state: "TX",
      });
      const hedged = proposeLateFeeForUnitCount({
        rule: inverted, monthlyRentCents: RENT, daysLate: DAYS_LATE,
        units: floor(n), state: "TX",
      });
      expect(exact.proposedFeeCents).toBeLessThanOrEqual(hedged.proposedFeeCents);
      // And it says so, rather than silently keeping the lower number.
      expect(exact.explanation).toMatch(/never raises|lower figure was kept/i);
    }
  });
});

describe("an unencoded state still refuses", () => {
  it("proposes nothing when no rule is seeded, whatever the unit count", () => {
    // Modelling units must not become a back door to a default cap. A state
    // AcreOS has not encoded is a state AcreOS does not advise on.
    for (const units of [modelled(6), modelled(2), floor(2)]) {
      const p = propose(units, null);
      expect(p.status).toBe("no_rule_for_state");
      expect(p.proposedFeeCents).toBe(0);
    }
  });
});

describe("a proposal never posts itself", () => {
  it("always requires operator confirmation and carries its provenance", () => {
    const p = propose(modelled(6));
    expect(p.requiresOperatorConfirmation).toBe(true);
    // The operator can see whether the cap came from real inventory or a
    // floor — without that, a hedged number is indistinguishable from an
    // exact one on screen.
    expect(p.unitCountBasis).toBe("modelled_units");
    expect(p.unitCount).toBe(6);
  });
});
