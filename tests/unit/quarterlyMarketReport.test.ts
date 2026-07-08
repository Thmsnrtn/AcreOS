/**
 * quarterlyMarketReport.test.ts — Tier 3F quarterly report generator.
 *
 * Honesty contract under test:
 *   - Empty inputs → EXPLICITLY-empty report (insufficientData: true, zero
 *     counties, markdown says so) — never a placeholder market narrative.
 *   - With rollups, every figure is carried VERBATIM from the rollup rows
 *     (latest-period metrics, max cohort) — nothing interpolated or invented.
 *   - Org-null all the way through: no organization linkage in the artifact.
 */

import { describe, it, expect } from "vitest";
import { buildQuarterlyMarketReport } from "../../server/services/dataCoop/quarterlyMarketReport";
import type { CountyRollupMetrics } from "../../server/services/dataCoop/privacyRollup";

function metricsFixture(overrides: Partial<CountyRollupMetrics> = {}): CountyRollupMetrics {
  return {
    askedPricePerAcre: { median: 5000, p25: 4500, p75: 6000, n: 7 },
    acceptedPricePerAcre: { median: 4500, p25: 4000, p75: 5000, n: 5 },
    daysToResponse: { median: 11, p25: 6, p75: 18, n: 6 },
    parcelObservationDensity: { parcelsObserved: 12, observationsInPeriod: 40 },
    lcsGradeDistribution: { total: 12, shares: { A: 25, B: 41.7, C: 33.3 } },
    ...overrides,
  };
}

describe("empty inputs → explicitly-empty report", () => {
  it("flags insufficientData and reports zero counties", () => {
    const { json } = buildQuarterlyMarketReport("2026-Q2", []);
    expect(json.insufficientData).toBe(true);
    expect(json.countiesReported).toBe(0);
    expect(json.counties).toEqual([]);
    expect(json.quarter).toBe("2026-Q2");
    expect(json.privacyFloor).toBe(5);
  });

  it("markdown says 'not enough data' honestly — no fabricated figures", () => {
    const { markdown } = buildQuarterlyMarketReport("2026-Q2", []);
    expect(markdown).toContain("Not enough network data this quarter");
    expect(markdown).toContain("DRAFT — not published");
    // No dollar figures or percentile claims in the report BODY of an empty
    // report. (The methodology section legitimately mentions the $500 bucket.)
    const body = markdown.split("## Methodology")[0];
    expect(body).not.toMatch(/\$\d/);
    expect(body).not.toContain("median");
    expect(body).not.toContain("p25");
  });

  it("methodology is still included so the empty report is self-explaining", () => {
    const { json, markdown } = buildQuarterlyMarketReport("2026-Q1", []);
    expect(json.methodology).toContain("privacy floor");
    expect(markdown).toContain("## Methodology");
  });
});

describe("with rollups — figures carried verbatim", () => {
  const rows = [
    {
      state: "TX",
      county: "Bastrop",
      period: "2026-04",
      cohortSize: 9,
      metrics: metricsFixture({
        askedPricePerAcre: { median: 7000, p25: 6500, p75: 7500, n: 6 },
      }) as unknown as Record<string, unknown>,
    },
    {
      state: "TX",
      county: "Bastrop",
      period: "2026-05",
      cohortSize: 12,
      metrics: metricsFixture() as unknown as Record<string, unknown>,
    },
    {
      state: "AZ",
      county: "Mohave",
      period: "2026-05",
      cohortSize: 6,
      metrics: metricsFixture({
        askedPricePerAcre: null,
        acceptedPricePerAcre: null,
        daysToResponse: null,
        lcsGradeDistribution: null,
        parcelObservationDensity: { parcelsObserved: 6, observationsInPeriod: 8 },
      }) as unknown as Record<string, unknown>,
    },
  ];

  it("groups by county, keeps latest-period metrics and max cohort", () => {
    const { json } = buildQuarterlyMarketReport("2026-Q2", rows);
    expect(json.insufficientData).toBe(false);
    expect(json.countiesReported).toBe(2);

    const bastrop = json.counties.find((c) => c.county === "Bastrop")!;
    expect(bastrop.cohortSize).toBe(12); // max across the quarter
    expect(bastrop.periods).toEqual(["2026-04", "2026-05"]);
    // Latest period (2026-05) metrics verbatim — NOT the April median of 7000.
    expect(bastrop.metrics.askedPricePerAcre!.median).toBe(5000);
    expect(bastrop.metrics.acceptedPricePerAcre!.n).toBe(5);
  });

  it("sorts counties by cohort size descending", () => {
    const { json } = buildQuarterlyMarketReport("2026-Q2", rows);
    expect(json.counties.map((c) => c.county)).toEqual(["Bastrop", "Mohave"]);
  });

  it("null sub-metrics render as 'not enough' lines — never invented numbers", () => {
    const { markdown } = buildQuarterlyMarketReport("2026-Q2", rows);
    expect(markdown).toContain("## Mohave, AZ");
    const mohaveSection = markdown.split("## Mohave, AZ")[1].split("## Methodology")[0];
    expect(mohaveSection).toContain("Asked price per acre: not enough network data this quarter");
    expect(mohaveSection).toContain("Accepted price per acre: not enough network data this quarter");
    expect(mohaveSection).toContain("Land Credit Score grades: not enough scored parcels");
    expect(mohaveSection).not.toMatch(/\$\d/);
  });

  it("present metrics render with the verbatim figures", () => {
    const { markdown } = buildQuarterlyMarketReport("2026-Q2", rows);
    const bastropSection = markdown.split("## Bastrop, TX")[1].split("## Mohave, AZ")[0];
    expect(bastropSection).toContain("median $5,000/acre");
    expect(bastropSection).toContain("n=7");
    expect(bastropSection).toContain("Contributing parcels: 12");
  });

  it("artifact carries NO organization linkage anywhere", () => {
    const { json } = buildQuarterlyMarketReport("2026-Q2", rows);
    const serialized = JSON.stringify(json).toLowerCase();
    expect(serialized).not.toContain("organizationid");
    expect(serialized).not.toContain("organization_id");
    expect(serialized).not.toContain("orgid");
    expect(serialized).not.toContain("org_id");
  });

  it("generatedAt is deterministic when injected", () => {
    const at = new Date("2026-07-01T00:00:00.000Z");
    const { json } = buildQuarterlyMarketReport("2026-Q2", [], at);
    expect(json.generatedAt).toBe("2026-07-01T00:00:00.000Z");
  });
});
