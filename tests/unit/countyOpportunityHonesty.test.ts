/**
 * County opportunity score — a model may not be fed its own defaults.
 *
 * The defect
 * ──────────
 * `computeCountyOpportunityScore` takes 21 market signals. AcreOS measures
 * four of them, sometimes. All three production callers closed the gap with
 * literals:
 *
 *   routes-epic-services.ts      17 constants (`avgDaysOnMarket: 90`,
 *                                `monthsOfSupply: 6`,
 *                                `estimatedInvestorMailingCount: 10`,
 *                                `distanceToNearestMetroMiles: 80`,
 *                                four `has…: false`, …)
 *   routes-data-intelligence.ts  12 constants, same values
 *   marketReportGenerator.ts     `{ state, county } as any` — all 21 undefined
 *
 * So a county AcreOS holds no data for came back with a full markdown "Market
 * Intelligence Report": "Average days on market: 90 days", "Sales volume (12
 * months): 20 transactions", an opportunity score out of 100, and a
 * recommendation to BUY. A fixed number dressed as a proprietary model — the
 * exact thing `parcelIntelligenceFusion.ts` refused to do (its note at ~line
 * 207), and what the standing no-fabrication rule forbids.
 *
 * `lint:no-fabrication` did not catch any of it: that gate scans for
 * `Math.random`, so it proves "no randomness" and says nothing about an
 * invented constant presented as a measurement. This file covers the half the
 * lint cannot see.
 *
 * What is gated
 * ─────────────
 * 1. The model REFUSES (returns null) without its four required signals —
 *    stated as "no combination of the optional 17 can produce a score", not as
 *    one spot check, so the refusal cannot be routed around.
 * 2. An unmeasured signal contributes NEITHER points NOR weight. Falsified by
 *    comparing a fully-measured county against the same county with one
 *    dimension's signals removed: the surviving dimensions' subscores must be
 *    IDENTICAL, and the missing dimension must be `null`, not 0.
 * 3. `null` and `false` are different answers for the booleans — `false` is
 *    "checked, none", `null` is "never looked" — and they must score
 *    differently.
 * 4. The callers pass nulls, not constants: asserted against the live route
 *    source, because the type system accepts a literal `90` for
 *    `number | null` and always will.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeCountyOpportunityScore,
  generateCountyIntelligenceReport,
  REQUIRED_SIGNALS,
  type CountyOpportunityScoreInput,
} from "../../server/services/countyOpportunityScore";

const REPO = join(__dirname, "..", "..");

/**
 * Source with comments removed.
 *
 * The first draft of the scanners below matched their own documentation: the
 * fix comments quote the constants they removed (`avgDaysOnMarket: 90 used to
 * be written here…`), so a gate reading raw source flagged 24 "offenders"
 * that were all prose. A gate that reads comments is matching text, not
 * behaviour — strip them and scan code.
 */
function code(rel: string): string {
  return readFileSync(join(REPO, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

/** Nothing measured. Every caller's starting point, honestly expressed. */
const BLANK: CountyOpportunityScoreInput = {
  state: "OH",
  county: "Franklin",
  priceVelocity3Mo: null,
  priceVelocity12Mo: null,
  avgPricePerAcre: null,
  pricePerAcreVs2YrAvg: null,
  salesVolume90Days: null,
  salesVolume12Months: null,
  avgDaysOnMarket: null,
  domTrend: null,
  activeListings: null,
  monthsOfSupply: null,
  listingCountTrend: null,
  estimatedInvestorMailingCount: null,
  recentPriceIncreasePercent: null,
  populationGrowthRate: null,
  permitCountTrend: null,
  distanceToNearestMetroMiles: null,
  hasRecentInfrastructureAnnouncement: null,
  hasRecentEmployerAnnouncement: null,
  hasLakeOrRiver: null,
  hasNationalForest: null,
  hasRecreationalAmenities: null,
};

/** The four signals the model refuses without. */
const CORE = {
  priceVelocity12Mo: 8,
  avgPricePerAcre: 4200,
  salesVolume12Months: 24,
  avgDaysOnMarket: 70,
} as const;

const OPTIONAL_SIGNALS = (Object.keys(BLANK) as Array<keyof CountyOpportunityScoreInput>)
  .filter((k) => k !== "state" && k !== "county")
  .filter((k) => !(REQUIRED_SIGNALS as readonly string[]).includes(k));

describe("computeCountyOpportunityScore — refuses a county it cannot see", () => {
  it("vacuity guard: the populations under test are non-empty and disjoint", () => {
    expect(REQUIRED_SIGNALS.length).toBe(4);
    expect(OPTIONAL_SIGNALS.length).toBe(17);
    // 4 + 17 = the whole signal set; if a signal is added to neither list the
    // arithmetic below stops covering the model.
    const all = (Object.keys(BLANK) as string[]).filter((k) => k !== "state" && k !== "county");
    expect(all).toHaveLength(21);
  });

  it("returns null when nothing at all is measured", () => {
    expect(computeCountyOpportunityScore(BLANK)).toBeNull();
  });

  it("no amount of OPTIONAL data can substitute for a missing required signal", () => {
    // Every optional signal filled in with a plausible value, and each of the
    // four required ones withheld in turn. All four must refuse.
    const richOptional: CountyOpportunityScoreInput = {
      ...BLANK,
      ...CORE,
      priceVelocity3Mo: 2,
      pricePerAcreVs2YrAvg: 6,
      salesVolume90Days: 6,
      domTrend: -12,
      activeListings: 18,
      monthsOfSupply: 5,
      listingCountTrend: -4,
      estimatedInvestorMailingCount: 8,
      recentPriceIncreasePercent: 6,
      populationGrowthRate: 7,
      permitCountTrend: 22,
      distanceToNearestMetroMiles: 65,
      hasRecentInfrastructureAnnouncement: true,
      hasRecentEmployerAnnouncement: true,
      hasLakeOrRiver: true,
      hasNationalForest: true,
      hasRecreationalAmenities: true,
    };
    expect(computeCountyOpportunityScore(richOptional)).not.toBeNull();

    for (const req of REQUIRED_SIGNALS) {
      const withheld = { ...richOptional, [req]: null };
      expect(
        computeCountyOpportunityScore(withheld),
        `withholding ${req} still produced a score`,
      ).toBeNull();
    }
  });

  it("scores a county whose core signals ARE on file", () => {
    const r = computeCountyOpportunityScore({ ...BLANK, ...CORE });
    expect(r).not.toBeNull();
    expect(r!.overallScore).toBeGreaterThan(0);
    expect(r!.marketMomentumScore).not.toBeNull();
    expect(r!.buyerDemandScore).not.toBeNull();
  });
});

describe("an unmeasured signal contributes neither points nor weight", () => {
  /** A county with every signal measured — the comparison baseline. */
  const FULL: CountyOpportunityScoreInput = {
    ...BLANK,
    ...CORE,
    priceVelocity3Mo: 2,
    pricePerAcreVs2YrAvg: 6,
    salesVolume90Days: 6,
    domTrend: -20,
    activeListings: 18,
    monthsOfSupply: 2,
    listingCountTrend: -4,
    estimatedInvestorMailingCount: 2,
    recentPriceIncreasePercent: 6,
    populationGrowthRate: 12,
    permitCountTrend: 25,
    distanceToNearestMetroMiles: 65,
    hasRecentInfrastructureAnnouncement: true,
    hasRecentEmployerAnnouncement: true,
    hasLakeOrRiver: true,
    hasNationalForest: true,
    hasRecreationalAmenities: true,
  };

  it("an unmeasured dimension is null, never 0", () => {
    // Drop the ONE signal the competition dimension has.
    const r = computeCountyOpportunityScore({ ...FULL, estimatedInvestorMailingCount: null });
    expect(r).not.toBeNull();
    expect(r!.investorCompetitionScore).toBeNull();
    expect(r!.dataBasis.dimensionsScored).not.toContain("competition");
    expect(r!.dataBasis.missing).toContain("estimatedInvestorMailingCount");
    // 1 - 0.30 = 0.70 of the model's weight remains.
    expect(r!.dataBasis.weightCoverage).toBeCloseTo(0.7, 5);
  });

  it("dropping one dimension does not move any OTHER dimension's subscore", () => {
    const full = computeCountyOpportunityScore(FULL)!;
    const noCompetition = computeCountyOpportunityScore({
      ...FULL,
      estimatedInvestorMailingCount: null,
    })!;
    expect(noCompetition.marketMomentumScore).toBe(full.marketMomentumScore);
    expect(noCompetition.buyerDemandScore).toBe(full.buyerDemandScore);
    expect(noCompetition.growthPotentialScore).toBe(full.growthPotentialScore);
  });

  it("a dropped dimension is EXCLUDED from the overall, not scored as zero", () => {
    const full = computeCountyOpportunityScore(FULL)!;
    const noCompetition = computeCountyOpportunityScore({
      ...FULL,
      estimatedInvestorMailingCount: null,
    })!;

    // FULL's competition signal (2 investors) scores 100 — the top of the
    // band — so treating it as ABSENT must LOWER the overall if the weight is
    // being zeroed, and must leave the remaining dimensions' weighted average
    // intact if it is being excluded. Compute the excluded average by hand.
    const expected = Math.round(
      (full.marketMomentumScore! * 0.25 +
        full.buyerDemandScore! * 0.3 +
        full.growthPotentialScore! * 0.15) /
        0.7,
    );
    expect(noCompetition.overallScore).toBe(expected);

    // And the zeroing behaviour must NOT be what happens.
    const zeroed = Math.round(
      full.marketMomentumScore! * 0.25 +
        full.buyerDemandScore! * 0.3 +
        0 * 0.3 +
        full.growthPotentialScore! * 0.15,
    );
    expect(noCompetition.overallScore).not.toBe(zeroed);
  });

  /**
   * ONE boolean at a time.
   *
   * The first version of this test flipped `hasRecentInfrastructureAnnouncement`
   * and `hasRecentEmployerAnnouncement` together, and a mutation that removed
   * the null-guard from ONLY the infrastructure field stayed green — the
   * employer field alone still made the two runs differ. Varying one field per
   * case is what makes each guard individually load-bearing.
   */
  const NULLABLE_BOOLEANS = [
    "hasRecentInfrastructureAnnouncement",
    "hasRecentEmployerAnnouncement",
  ] as const;

  it.each(NULLABLE_BOOLEANS)(
    "%s: `false` (checked, none) and `null` (never looked) score differently",
    (field) => {
      const checkedNone = computeCountyOpportunityScore({ ...FULL, [field]: false })!;
      const neverLooked = computeCountyOpportunityScore({ ...FULL, [field]: null })!;

      // "Checked, none announced" is a real negative finding and costs points.
      // "Never looked" narrows the dimension instead of penalising the county.
      expect(
        checkedNone.growthPotentialScore,
        `${field}: null and false produced the same growth score — the guard is gone`,
      ).toBeLessThan(neverLooked.growthPotentialScore!);
      expect(neverLooked.dataBasis.missing).toContain(field);
      expect(checkedNone.dataBasis.measured).toContain(field);
    },
  );

  it.each(NULLABLE_BOOLEANS)(
    "%s: an unmeasured flag never claims its tailwind",
    (field) => {
      const r = computeCountyOpportunityScore({ ...FULL, [field]: null })!;
      const claim =
        field === "hasRecentInfrastructureAnnouncement"
          ? /Infrastructure investment announced/i
          : /Major employer announced/i;
      expect(r.tailwinds.join(" ")).not.toMatch(claim);
    },
  );

  it("an unmeasured amenity set never claims the amenity tailwind", () => {
    const r = computeCountyOpportunityScore({
      ...FULL,
      hasLakeOrRiver: null,
      hasNationalForest: null,
      hasRecreationalAmenities: null,
    })!;
    expect(r.tailwinds.join(" ")).not.toMatch(/Recreational amenities/i);
  });
});

describe("the intelligence report prints absence as absence", () => {
  it("a figure that is not on file is not printed as a number", () => {
    const score = computeCountyOpportunityScore({ ...BLANK, ...CORE })!;
    const md = generateCountyIntelligenceReport("Franklin", "OH", score, {
      avgPricePerAcre12MoAgo: null,
      avgPricePerAcreNow: 4200,
      salesVolume12MoAgo: null,
      salesVolumeNow: 24,
      domNow: 70,
    });
    expect(md).toMatch(/Average price\/acre: \$4,200/);
    // No prior year on file → no YoY claim at all. The old code printed
    // "(+0.0% YoY)", asserting flat prices for a county with no history.
    expect(md).not.toMatch(/YoY/);
    expect(md).not.toMatch(/null/);
    expect(md).not.toMatch(/NaN/);
    expect(md).not.toMatch(/undefined/);
    // The basis line must travel with the score.
    expect(md).toMatch(/Signals measured: \d+ of 21/);
    expect(md).toMatch(/% of the model's weight/);
  });

  it("an unscored dimension prints 'not scored', not '0/100'", () => {
    const score = computeCountyOpportunityScore({ ...BLANK, ...CORE })!;
    expect(score.investorCompetitionScore).toBeNull();
    const md = generateCountyIntelligenceReport("Franklin", "OH", score, {
      avgPricePerAcre12MoAgo: null,
      avgPricePerAcreNow: null,
      salesVolume12MoAgo: null,
      salesVolumeNow: null,
      domNow: null,
    });
    expect(md).toMatch(/\| Low Competition \| not scored \| 30% \|/);
    expect(md).toMatch(/Average days on market: not on file/);
  });
});

describe("the production callers pass measurements, not defaults", () => {
  // The type system accepts a literal for `number | null` and always will —
  // that is deliberate (a caller with a real 90 must be able to pass it). So
  // the "no constants" half is proved against the source of the two live
  // routes, not against the types.
  const CALLERS = [
    "server/routes-epic-services.ts",
    "server/routes-data-intelligence.ts",
  ];

  /**
   * The 21 signal names, taken from the model's own input object rather than
   * retyped, so a signal added to the model is covered here the same day.
   */
  const SIGNAL_NAMES = (Object.keys(BLANK) as string[]).filter(
    (k) => k !== "state" && k !== "county",
  );

  /**
   * A caller may pass `null` (not measured) or an EXPRESSION that reads from
   * data (`num(marketData?.avgDaysOnMarket)`, `permitTrend?.trendPercent ??
   * null`). It may not pass a bare literal — that is a constant presented as a
   * measurement, which is the entire defect.
   *
   * Note the shape of this predicate: it does not enumerate the values that
   * were there before (90, 6, 10, 80, false). It forbids the KIND, so
   * `avgDaysOnMarket: 75` and `hasLakeOrRiver: true` fail exactly as `90` and
   * `false` did.
   */
  const isLiteral = (value: string): boolean =>
    /^-?\d+(\.\d+)?$/.test(value) || /^(true|false)$/.test(value) || /^["'`]/.test(value);

  function literalSignalsIn(rel: string): string[] {
    const src = code(rel);
    const found: string[] = [];
    for (const raw of src.split("\n")) {
      const line = raw.trim();
      const m = line.match(/^([A-Za-z][A-Za-z0-9]*)\s*:\s*(.+?),?$/);
      if (!m) continue;
      if (!SIGNAL_NAMES.includes(m[1])) continue;
      if (isLiteral(m[2].trim())) found.push(`${rel}: ${line}`);
    }
    return found;
  }

  it("vacuity guard: each caller file exists, still calls the model, and the comment stripper left code behind", () => {
    for (const rel of CALLERS) {
      const src = code(rel);
      expect(src, `${rel} no longer calls the model`).toMatch(
        /computeCountyOpportunityScore\(/,
      );
      // If the stripper ever ate the file, every scan below passes vacuously.
      expect(src.length, `${rel} stripped to nothing`).toBeGreaterThan(2000);
      expect(src, `${rel} still contains comment text`).not.toMatch(/used to be written here/);
    }
  });

  it("the predicate itself fires — a literal is detected, an expression is not", () => {
    // Self-test, because a scanner that matches nothing reads identically to
    // a clean repo.
    expect(isLiteral("90")).toBe(true);
    expect(isLiteral("6")).toBe(true);
    expect(isLiteral("2.5")).toBe(true);
    expect(isLiteral("-10")).toBe(true);
    expect(isLiteral("false")).toBe(true);
    expect(isLiteral("true")).toBe(true);
    expect(isLiteral("null")).toBe(false);
    expect(isLiteral("num(marketData?.avgDaysOnMarket)")).toBe(false);
    expect(isLiteral("permitTrend?.trendPercent ?? null")).toBe(false);
    expect(isLiteral("trendData?.oneYearChangePercent ?? null")).toBe(false);
    // And it fires on a real line of the shape the callers use.
    expect(literalSignalsIn("tests/unit/countyOpportunityHonesty.test.ts").length)
      .toBeGreaterThan(0); // this very file contains `avgDaysOnMarket: 70` in CORE
  });

  it("no caller supplies a model signal as a bare literal", () => {
    const offenders = CALLERS.flatMap(literalSignalsIn);
    expect(offenders).toEqual([]);
  });

  it("the epic route refuses rather than reporting on an unknown county", () => {
    const src = code("server/routes-epic-services.ts");
    // A null score must short-circuit BEFORE the report is generated.
    const refuseAt = src.indexOf("no_county_market_data");
    const reportAt = src.indexOf("generateCountyIntelligenceReport(county");
    expect(refuseAt, "the refusal branch is gone").toBeGreaterThan(-1);
    expect(reportAt, "the report call is gone").toBeGreaterThan(-1);
    expect(refuseAt, "the report is generated before the refusal").toBeLessThan(reportAt);
  });

  it("the county ingest no longer persists a placeholder DOM", () => {
    const src = code("server/jobs/countyAssessorIngest.ts");
    // A value written to `county_markets` is read back out as a measurement.
    expect(src).toMatch(/avgDaysOnMarket:\s*null/);
    expect(src).toMatch(/investorDemandScore:\s*null/);
    expect(src).not.toMatch(/avgDaysOnMarket:\s*\d/);
    expect(src).not.toMatch(/investorDemandScore:\s*Math\./);
  });
});
