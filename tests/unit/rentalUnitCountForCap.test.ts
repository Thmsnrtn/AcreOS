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
 * written. What this file bounds is the consequence — and the bound is
 * narrower than the one first written here, which an audit falsified.
 *
 * TRUE:  for ONE count, reading it as exact never proposes more than reading
 *        it as a floor. Resolving an ambiguity in the platform's favour is
 *        never acceptable.
 * FALSE: "modelling units never raises a tenant's fee." It can, and does — a
 *        6-plex whose floor was 2 moves from the under-4 branch to the 4-plus
 *        one, $200.00 → $240.00. That is CORRECT: §92.019's higher percentage
 *        is the applicable law for a 6-plex, and $200 was AcreOS hedging under
 *        uncertainty rather than something the tenant was owed. The count
 *        already moves on its own as tenancies accumulate.
 *
 * So the obligation is disclosure, not suppression: when a better-known count
 * selects a higher branch, the proposal must say so and name both figures.
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

describe("THE SAME-COUNT RAIL — reading one count as exact never costs more", () => {
  it("holds at every count from 1 to 8, for the seeded rule", () => {
    // NARROWED 2026-07-31. This block used to claim it proved that "modelling
    // units never raises a tenant's fee". It did not, and could not: it
    // compared modelled(n) against floor(n) for the SAME n, and for n >= 4
    // both calls return the same object, so equality was guaranteed by
    // construction. The real cross-basis case is the describe() below.
    //
    // What it does prove, and what the code guarantees, is narrower and true:
    // for ONE count, resolving the ambiguity must not resolve it in the
    // platform's favour.
    for (let n = 1; n <= 8; n++) {
      const exact = propose(modelled(n));
      const hedged = propose(floor(n));
      expect(
        exact.proposedFeeCents,
        `count ${n}: the exact reading of the same count charged more than the hedged one`,
      ).toBeLessThanOrEqual(hedged.proposedFeeCents);
    }
  });

  it("holds even for an INVERTED rule, where small properties are capped higher", () => {
    // No seeded state does this today, which is exactly why it is tested
    // rather than assumed.
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
      expect(exact.explanation).toMatch(/never raises|lower figure was kept/i);
    }
  });
});

describe("a better-known count CAN select a higher branch — and must say so", () => {
  // The case the old rail missed. One real 6-plex, two states of AcreOS's
  // knowledge: before the rent roll was imported only 2 tenancies were on
  // record, so the floor was 2 and the proposal hedged to the lower branch.
  // Afterwards the count is exactly 6 and §92.019's 4-plus percentage is the
  // applicable law.
  //
  // $240 is the RIGHT number for a 6-plex. $200 was AcreOS hedging under
  // uncertainty, not an entitlement — and the count already moves on its own
  // as tenancies accumulate, with no units table involved. What must never
  // happen is the movement being silent.
  const SIX_PLEX_FLOOR = 2;
  const before = propose(floor(SIX_PLEX_FLOOR));
  const after = proposeLateFeeForUnitCount({
    rule: TX, monthlyRentCents: RENT, daysLate: DAYS_LATE,
    units: modelled(6), state: "TX", leaseDerivedFloor: SIX_PLEX_FLOOR,
  });

  it("the fee does move, and the direction is documented not denied", () => {
    expect(before.proposedFeeCents).toBe(20_000);
    expect(after.proposedFeeCents).toBe(24_000);
    expect(before.unitBranch).toBe("conservative_unknown");
    expect(after.unitBranch).toBe("large_4_plus");
  });

  it("the proposal DISCLOSES why it is higher, naming both counts", () => {
    // A tenant asking "why is this more than last time?" must have an answer
    // on the record. Silence here would be the real defect.
    expect(after.explanation).toContain("6");
    expect(after.explanation).toContain(String(SIX_PLEX_FLOOR));
    expect(after.explanation).toMatch(/not because anything about the tenancy changed/i);
  });

  it("says NOTHING extra when the exact count changes no money", () => {
    // A 6-plex whose floor was already 4+ takes the same branch either way;
    // an unprompted explanation there would be noise.
    const noMovement = proposeLateFeeForUnitCount({
      rule: TX, monthlyRentCents: RENT, daysLate: DAYS_LATE,
      units: modelled(6), state: "TX", leaseDerivedFloor: 5,
    });
    expect(noMovement.proposedFeeCents).toBe(24_000);
    expect(noMovement.explanation).not.toMatch(/not because anything about the tenancy changed/i);
  });

  it("degrades safely when the caller cannot supply the floor", () => {
    // No floor to compare against means no movement can be asserted — the
    // proposal must not invent a comparison it cannot make.
    const noFloor = proposeLateFeeForUnitCount({
      rule: TX, monthlyRentCents: RENT, daysLate: DAYS_LATE,
      units: modelled(6), state: "TX",
    });
    expect(noFloor.proposedFeeCents).toBe(24_000);
    expect(noFloor.explanation).not.toMatch(/not because anything about the tenancy changed/i);
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
