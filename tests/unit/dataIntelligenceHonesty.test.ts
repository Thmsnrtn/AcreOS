/**
 * An unmeasured signal may not become a finding.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `dataIntelligenceEngine` scored parcels and counties from `?? <constant>`
 * defaults, and two of those constants did not merely inflate a score — they
 * fell into a band that PUSHES A FLAG. Both routes pass `req.body || {}`
 * straight in, so `{}` was a fully-formed assessment:
 *
 *   inputs.medianDomDays ?? 180        -> negative flag: "180+ median DOM ·
 *                                         Illiquid market — exit may be difficult"
 *   inputs.distanceToPrimaryRoad ?? 10 -> negative flag: "10.0 miles to road ·
 *                                         Remote location limits buyer pool"
 *   inputs.acresSize ?? 5              -> POSITIVE flag: "5.0 acres · Optimal
 *                                         parcel size for owner-financed land"
 *
 * The last is the sharpest: an invented measurement presented as a favourable
 * finding, in a scorer whose recommendation ranges over STRONG_BUY … DEAL_KILLER.
 * It is also the fifth place in this codebase where a parcel of unknown size
 * was assumed to be five acres.
 *
 * `scoreCounty({})` likewise returned a real TIER — a buy/avoid instruction —
 * from `medianDomDays ?? 180` (5 pts), `dataQualityScore ?? 0.5` (4 pts, on the
 * dimension that is ABOUT how much data exists) and `ruralUrbanCode ?? 5`.
 *
 * ── WHAT IS GATED ───────────────────────────────────────────────────────────
 * An empty input produces NO flag that states a measurement, no tier, and a
 * data basis naming what is absent — while a fully-measured input still scores
 * exactly as before, so the fix cannot have been "make everything unknown".
 */

import { describe, it, expect } from "vitest";
import {
  calculateOpportunityScore,
  scoreCounty,
} from "../../server/services/dataIntelligenceEngine";

/** Every signal that used to carry a numeric default, with real values. */
const MEASURED_PARCEL = {
  medianDomDays: 25,
  pricePerAcreTrend: 12,
  distanceToPrimaryRoad: 0.2,
  acresSize: 10,
  slopePercent: 3,
  assessedVsMarketRatio: 0.2,
} as const;

describe("the parcel scorer states no measurement it was not given", () => {
  it("an empty input pushes no flag containing a fabricated number", () => {
    const score = calculateOpportunityScore({});
    const signals = score.flags.map((f) => f.signal).join(" | ");

    // The three exact strings the defaults produced.
    expect(signals, "the 180-day DOM default is back").not.toMatch(/180\+? median DOM/);
    expect(signals, "the 10-mile road default is back").not.toMatch(/10\.0 miles to road/);
    expect(signals, "the 5-acre default is back").not.toMatch(/5\.0 acres/);

    // And the general form: with nothing supplied, no flag may assert a
    // number at all. This is the behaviour, not the three literals.
    const numericClaims = score.flags.filter((f) => /\d/.test(f.signal));
    expect(
      numericClaims.map((f) => f.signal),
      "a flag states a numeric measurement for a parcel with no inputs",
    ).toEqual([]);
  });

  it("an empty input says what is missing instead", () => {
    const score = calculateOpportunityScore({});
    const signals = score.flags.map((f) => f.signal).join(" | ");
    expect(signals).toMatch(/No median DOM on file/);
    expect(signals).toMatch(/No road distance on file/);
    expect(signals).toMatch(/No parcel size on file/);
  });

  it("confidence stays inside its documented 0-1 range when nothing is measured", () => {
    // The unmeasured branches subtract, and the clamp used to be one-sided.
    const score = calculateOpportunityScore({});
    expect(score.confidence).toBeGreaterThan(0);
    expect(score.confidence).toBeLessThanOrEqual(1);
  });

  it("a fully measured parcel still scores, and scores HIGHER", () => {
    // The other direction: a fix that made everything unknown would pass every
    // assertion above.
    const empty = calculateOpportunityScore({});
    const full = calculateOpportunityScore(MEASURED_PARCEL);
    expect(full.marketScore).toBeGreaterThan(empty.marketScore);
    expect(full.valueScore).toBeGreaterThan(empty.valueScore);
    expect(full.confidence).toBeGreaterThan(empty.confidence);
    // And it DOES state the measurements it was given.
    expect(full.flags.map((f) => f.signal).join(" | ")).toMatch(/25 median DOM/);
    expect(full.flags.map((f) => f.signal).join(" | ")).toMatch(/10\.0 acres/);
  });
});

describe("the county scorer refuses a tier it cannot support", () => {
  it("an empty input is UNSCORED, not a tier", () => {
    const score = scoreCounty({});
    // A tier is a buy/avoid instruction. `{}` used to produce one.
    expect(score.tier).toBe("UNSCORED");
    expect(score.total).toBe(0);
    expect(score.explanation).toMatch(/absence of data, not a finding/);
    expect(score.dataBasis.measured).toEqual([]);
    expect(score.dataBasis.missing.length).toBe(8);
  });

  it("one or two signals is still not enough for a tier", () => {
    expect(scoreCounty({ medianDomDays: 30 }).tier).toBe("UNSCORED");
    expect(scoreCounty({ medianDomDays: 30, soldCompsLast12mo: 60 }).tier).toBe("UNSCORED");
  });

  it("three signals scores, and reports what it was based on", () => {
    const score = scoreCounty({
      medianDomDays: 30,
      soldCompsLast12mo: 60,
      pricePerAcreTrend1yr: 10,
    });
    expect(score.tier).not.toBe("UNSCORED");
    expect(score.dataBasis.measured).toHaveLength(3);
    expect(score.dataBasis.missing).toContain("medianHouseholdIncome");
    // The basis travels in the prose a caller renders, not only in a field.
    expect(score.explanation).toMatch(/Based on 3 of 8 signals/);
    expect(score.explanation).toMatch(/not on file:/);
  });

  it("an unmeasured signal contributes no points", () => {
    const withDom = scoreCounty({
      medianDomDays: 30,
      soldCompsLast12mo: 60,
      pricePerAcreTrend1yr: 10,
    });
    const withoutDom = scoreCounty({
      soldCompsLast12mo: 60,
      pricePerAcreTrend1yr: 10,
      hasGisPortal: true,
    });
    // DOM of 30 is worth 15 market-health points; its absence is worth none,
    // and the caller is told so rather than credited 5 for a default 180.
    expect(withDom.marketHealth).toBeGreaterThan(withoutDom.marketHealth);
    expect(withoutDom.recommendedActions.join(" ")).toMatch(
      /No median days-on-market on file/,
    );
  });

  it("a data-quality score nobody assessed earns nothing on the data-access axis", () => {
    const assessed = scoreCounty({
      medianDomDays: 30,
      soldCompsLast12mo: 60,
      dataQualityScore: 1,
    });
    const unassessed = scoreCounty({
      medianDomDays: 30,
      soldCompsLast12mo: 60,
      pricePerAcreTrend1yr: 10,
    });
    expect(assessed.dataAccessibility).toBeGreaterThan(unassessed.dataAccessibility);
    expect(unassessed.recommendedActions.join(" ")).toMatch(/No data-quality assessment/);
  });
});
