/**
 * LQ-22 tripwire (PKG-4) — unit tests for the pure core:
 *
 *  - the counting rule under the INFERRED definition (status "active" AND
 *    a positive monthly-equivalent price — the same rule liveMrrDetail()
 *    stands behind), incl. free-tier, trialing, past_due, cancelled, and
 *    legacy-alias rows;
 *  - the definition is genuinely config-swappable: a determination that
 *    trials count is a one-line change to the constant, proven here by
 *    counting the same rows under a trial-inclusive definition;
 *  - threshold classification at every boundary (14/15, 19/20, 22/23,
 *    24/25);
 *  - freeze evaluation: frozen only when the route is frozen AND the
 *    ladder flag is enabled for no non-founder context;
 *  - the pinned constants + live wiring: the flag key names the gate the
 *    investor-network mounts actually use, the route is still in
 *    FROZEN_ROUTES, and the mounts still sit behind requireLadderFlag.
 *    (The source assertions follow the expansionLadder.test.ts idiom:
 *    facts that may only change deliberately, by someone who reads the
 *    failure.)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  LQ22_COUNTING_DEFINITION,
  LQ22_FROZEN_ROUTE,
  LQ22_LADDER_FLAG_KEY,
  LQ22_SETTINGS_KEY,
  LQ22_TRIPWIRE_THRESHOLDS,
  classifyTripwire,
  countPayingCustomers,
  evaluateFreezeState,
  isPayingOrg,
  type Lq22CountingDefinition,
  type OrgBillingRow,
} from "../../server/services/lq22Tripwire";
import { FROZEN_ROUTES, isFrozenRoute } from "../../shared/feature-freeze";

const org = (
  tier: string | null,
  status: string | null,
  interval: string | null = "monthly",
): OrgBillingRow => ({ tier, status, interval });

describe("counting under the inferred definition", () => {
  it("counts active paid-tier orgs, monthly and yearly", () => {
    expect(isPayingOrg(org("starter", "active"))).toBe(true);
    expect(isPayingOrg(org("pro", "active", "yearly"))).toBe(true);
    expect(isPayingOrg(org("scale", "active"))).toBe(true);
  });

  it("counts legacy tier aliases the billing source of truth counts", () => {
    // subscription_tier may hold solo/operator/empire (tier-pricing aliases).
    expect(isPayingOrg(org("solo", "active"))).toBe(true);
    expect(isPayingOrg(org("empire", "active", "yearly"))).toBe(true);
  });

  it("never counts free-tier orgs, even when active", () => {
    expect(isPayingOrg(org("free", "active"))).toBe(false);
    expect(isPayingOrg(org(null, "active"))).toBe(false);
    expect(isPayingOrg(org("unknown-tier", "active"))).toBe(false);
  });

  it("excludes trials, past_due, and cancelled subscriptions", () => {
    expect(isPayingOrg(org("scale", "trialing"))).toBe(false);
    expect(isPayingOrg(org("starter", "past_due"))).toBe(false);
    expect(isPayingOrg(org("starter", "cancelled"))).toBe(false);
    expect(isPayingOrg(org("starter", "canceled"))).toBe(false);
    expect(isPayingOrg(org("starter", null))).toBe(false);
  });

  it("counts a mixed population", () => {
    const rows = [
      org("starter", "active"),
      org("pro", "active", "yearly"),
      org("free", "active"),
      org("scale", "trialing"),
      org("pro", "past_due"),
      org("empire", "active"),
      org("starter", "cancelled"),
    ];
    expect(countPayingCustomers(rows)).toBe(3);
    expect(countPayingCustomers([])).toBe(0);
  });
});

describe("the counting definition is config-swappable", () => {
  it("pins the inferred definition as built", () => {
    expect(LQ22_COUNTING_DEFINITION.unit).toBe("paying_orgs");
    expect(LQ22_COUNTING_DEFINITION.countedStatuses).toEqual(["active"]);
    expect(LQ22_COUNTING_DEFINITION.requirePositiveMonthlyPrice).toBe(true);
  });

  it("a trial-inclusive determination changes the count with one line", () => {
    const rows = [org("starter", "active"), org("scale", "trialing")];
    const withTrials: Lq22CountingDefinition = {
      ...LQ22_COUNTING_DEFINITION,
      countedStatuses: ["active", "trialing"],
    };
    expect(countPayingCustomers(rows)).toBe(1);
    expect(countPayingCustomers(rows, withTrials)).toBe(2);
  });

  it("the price requirement is part of the definition, not hardcoded", () => {
    const noPriceRequirement: Lq22CountingDefinition = {
      ...LQ22_COUNTING_DEFINITION,
      requirePositiveMonthlyPrice: false,
    };
    expect(isPayingOrg(org("free", "active"), noPriceRequirement)).toBe(true);
    expect(isPayingOrg(org("free", "active"))).toBe(false);
  });
});

describe("threshold classification", () => {
  it("pins the thresholds from the spec and the ladder", () => {
    expect(LQ22_TRIPWIRE_THRESHOLDS.noticeAt).toEqual([15, 20]);
    expect(LQ22_TRIPWIRE_THRESHOLDS.briefAt).toBe(23);
    expect(LQ22_TRIPWIRE_THRESHOLDS.tripAt).toBe(25);
  });

  it("classifies every boundary", () => {
    expect(classifyTripwire(0)).toEqual({ band: "quiet", highestNoticeAt: null });
    expect(classifyTripwire(14)).toEqual({ band: "quiet", highestNoticeAt: null });
    expect(classifyTripwire(15)).toEqual({ band: "notice", highestNoticeAt: 15 });
    expect(classifyTripwire(19)).toEqual({ band: "notice", highestNoticeAt: 15 });
    expect(classifyTripwire(20)).toEqual({ band: "notice", highestNoticeAt: 20 });
    expect(classifyTripwire(22)).toEqual({ band: "notice", highestNoticeAt: 20 });
    expect(classifyTripwire(23)).toEqual({ band: "brief", highestNoticeAt: 20 });
    expect(classifyTripwire(24)).toEqual({ band: "brief", highestNoticeAt: 20 });
    expect(classifyTripwire(25)).toEqual({ band: "trip", highestNoticeAt: 20 });
    expect(classifyTripwire(40)).toEqual({ band: "trip", highestNoticeAt: 20 });
  });
});

describe("freeze-state evaluation", () => {
  const allOff = { "no-tier": false, starter: false, pro: false, scale: false };

  it("is frozen only when the route is frozen and the flag is off for everyone", () => {
    expect(
      evaluateFreezeState({ routeFrozen: true, ladderFlagEnabledByContext: allOff }),
    ).toEqual({ frozen: true, problems: [] });
  });

  it("a route removed from FROZEN_ROUTES is a lifted freeze", () => {
    const verdict = evaluateFreezeState({
      routeFrozen: false,
      ladderFlagEnabledByContext: allOff,
    });
    expect(verdict.frozen).toBe(false);
    expect(verdict.problems).toHaveLength(1);
    expect(verdict.problems[0]).toContain(LQ22_FROZEN_ROUTE);
  });

  it("a ladder flag enabled for ANY non-founder context is a lifted freeze", () => {
    const verdict = evaluateFreezeState({
      routeFrozen: true,
      ladderFlagEnabledByContext: { ...allOff, scale: true },
    });
    expect(verdict.frozen).toBe(false);
    expect(verdict.problems).toHaveLength(1);
    expect(verdict.problems[0]).toContain("scale");
    expect(verdict.problems[0]).toContain(LQ22_LADDER_FLAG_KEY);
  });

  it("reports every problem, not just the first", () => {
    const verdict = evaluateFreezeState({
      routeFrozen: false,
      ladderFlagEnabledByContext: { "no-tier": true, starter: false, pro: true, scale: false },
    });
    expect(verdict.frozen).toBe(false);
    expect(verdict.problems).toHaveLength(3);
  });
});

describe("wiring: the monitor watches the real gate", () => {
  it("names the ladder flag the investor-network mounts use", () => {
    expect(LQ22_LADDER_FLAG_KEY).toBe("feature_marketplace");
    expect(LQ22_FROZEN_ROUTE).toBe("/investor-network");
    expect(LQ22_SETTINGS_KEY).toBe("lq22_tripwire.latest");
  });

  it("the route is still in FROZEN_ROUTES", () => {
    expect(FROZEN_ROUTES).toContain("/investor-network");
    expect(isFrozenRoute(LQ22_FROZEN_ROUTE)).toBe(true);
  });

  it("the investor-network API mounts still sit behind requireLadderFlag", () => {
    const epic = readFileSync(
      resolve(__dirname, "../../server/routes-epic-services.ts"),
      "utf8",
    );
    const misc = readFileSync(
      resolve(__dirname, "../../server/routes-misc.ts"),
      "utf8",
    );
    expect(epic).toContain('requireLadderFlag("feature_marketplace")');
    expect(epic).toContain('"/investor-network"');
    expect(misc).toContain('requireLadderFlag("feature_marketplace")');
  });
});
