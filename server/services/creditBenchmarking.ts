import { db } from "../db";
import {
  landCreditScores,
  properties,
} from "@shared/schema";
import { eq, and, lte, sql } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// 2026-06-10 (T0-12, docs/internal/roadmap/elevation-blueprint-2026-06-10.md):
// the fabricated TX/FL/GA "industry benchmark" tables (invented medians,
// default rates, appreciation rates, fake "5,000+ transactions" sample sizes)
// were removed — they violated the platform's truth-immutable / no-fabrication
// discipline. Until real network-cohort percentiles are computed from actual
// scored transactions (Tier-2 item 2A in the elevation blueprint), every
// industry-comparison method returns a typed insufficient-data result. Org-
// portfolio methods (distribution, underperformers) operate on real rows and
// are unaffected. Do NOT reintroduce hardcoded benchmark numbers here.
// ─────────────────────────────────────────────────────────────────────────────

/** Honest absence: no real cohort data exists yet to back this answer. */
export interface BenchmarkUnavailable {
  available: false;
  reason: string;
}

export interface IndustryBenchmarks {
  available: true;
  median: number;
  p25: number;
  p75: number;
  source: string;
  sampleSize: number;
}

export interface IndustryComparison {
  available: true;
  score: number;
  percentile: number;
  vsMedian: number;
  relativePosition: "top_quartile" | "above_median" | "below_median" | "bottom_quartile";
  benchmarks: IndustryBenchmarks;
}

export interface HistoricalPerformance {
  available: true;
  scoreRange: [number, number];
  avgDefaultRate: number;
  avgAppreciationRate: number;
  sampleDescription: string;
}

export interface IndustryTrends {
  available: true;
  state: string;
  trends: Array<{ year: number; medianScore: number; defaultRate: number; appreciationRate: number }>;
  outlook: string;
}

export type BenchmarksResult = IndustryBenchmarks | BenchmarkUnavailable;
export type IndustryComparisonResult = IndustryComparison | BenchmarkUnavailable;
export type HistoricalPerformanceResult = HistoricalPerformance | BenchmarkUnavailable;
export type IndustryTrendsResult = IndustryTrends | BenchmarkUnavailable;

const NO_COHORT_DATA_REASON =
  "Network-wide cohort percentiles are not computed yet — AcreOS only reports benchmarks derived from real scored transactions, and that dataset does not exist yet.";

export class CreditBenchmarkingService {

  /**
   * Industry benchmark scores for a property type in a state.
   *
   * Returns insufficient-data until real network-cohort percentiles exist
   * (Tier-2 item 2A, elevation-blueprint-2026-06-10.md).
   */
  getBenchmarks(_propertyType: string, _state: string): BenchmarksResult {
    return { available: false, reason: NO_COHORT_DATA_REASON };
  }

  /**
   * Compare a land credit score to industry benchmarks.
   *
   * Returns insufficient-data until real network-cohort percentiles exist.
   */
  compareToIndustry(_landCreditScore: number, _propertyType: string, _state: string): IndustryComparisonResult {
    return { available: false, reason: NO_COHORT_DATA_REASON };
  }

  /**
   * Historical default and appreciation rates for a score range.
   *
   * Returns insufficient-data until real cohort outcome data exists.
   */
  getHistoricalPerformance(_minScore: number, _maxScore: number): HistoricalPerformanceResult {
    return { available: false, reason: NO_COHORT_DATA_REASON };
  }

  /**
   * Credit condition trends for a state.
   *
   * Returns insufficient-data until a real historical time-series exists.
   */
  getIndustryTrends(_state: string): IndustryTrendsResult {
    return { available: false, reason: NO_COHORT_DATA_REASON };
  }

  /**
   * Get the distribution (histogram) of credit scores in an org's portfolio.
   * Real data — computed from the org's own scored properties.
   */
  async getScoreDistribution(orgId: number): Promise<{
    buckets: Array<{ range: string; count: number; pct: number }>;
    totalScored: number;
    avgScore: number;
  }> {
    const scores = await db.select()
      .from(landCreditScores)
      .innerJoin(properties, eq(landCreditScores.propertyId, properties.id))
      .where(eq(properties.organizationId, orgId));

    const buckets = [
      { range: "90–100", min: 90, max: 100, count: 0 },
      { range: "80–89", min: 80, max: 89, count: 0 },
      { range: "70–79", min: 70, max: 79, count: 0 },
      { range: "60–69", min: 60, max: 69, count: 0 },
      { range: "50–59", min: 50, max: 59, count: 0 },
      { range: "0–49", min: 0, max: 49, count: 0 },
    ];

    let totalScore = 0;
    for (const row of scores) {
      const score = row.land_credit_scores.overallScore;
      totalScore += score;
      const bucket = buckets.find(b => score >= b.min && score <= b.max);
      if (bucket) bucket.count++;
    }

    const totalScored = scores.length;
    const avgScore = totalScored > 0 ? Math.round(totalScore / totalScored) : 0;

    return {
      buckets: buckets.map(b => ({
        range: b.range,
        count: b.count,
        pct: totalScored > 0 ? Math.round((b.count / totalScored) * 1000) / 10 : 0,
      })),
      totalScored,
      avgScore,
    };
  }

  /**
   * Identify properties in a portfolio that fall below a quality threshold.
   * Real data — computed from the org's own scored properties.
   */
  async identifyUnderperformers(orgId: number, threshold: number = 60): Promise<{
    propertyId: number;
    overallScore: number;
    grade: string;
    vsThreshold: number;
  }[]> {
    const scores = await db.select()
      .from(landCreditScores)
      .innerJoin(properties, eq(landCreditScores.propertyId, properties.id))
      .where(and(
        eq(properties.organizationId, orgId),
        lte(landCreditScores.overallScore, threshold)
      ))
      .orderBy(landCreditScores.overallScore);

    return scores.map(row => ({
      propertyId: row.land_credit_scores.propertyId,
      overallScore: row.land_credit_scores.overallScore,
      grade: row.land_credit_scores.grade,
      vsThreshold: row.land_credit_scores.overallScore - threshold,
    }));
  }

  /**
   * Generate a benchmarking report for an org. Portfolio sections are real
   * (org's own data); the national comparison is honestly absent until
   * network-cohort percentiles exist.
   */
  async generateBenchmarkReport(orgId: number): Promise<{
    orgId: number;
    distribution: Awaited<ReturnType<CreditBenchmarkingService["getScoreDistribution"]>>;
    underperformers: Awaited<ReturnType<CreditBenchmarkingService["identifyUnderperformers"]>>;
    nationalComparison: BenchmarkUnavailable;
    recommendations: string[];
    generatedAt: Date;
  }> {
    const [distribution, underperformers] = await Promise.all([
      this.getScoreDistribution(orgId),
      this.identifyUnderperformers(orgId, 60),
    ]);

    // Recommendations only reference the org's own (real) portfolio data —
    // never an invented national median.
    const recommendations: string[] = [];

    if (underperformers.length > 0) {
      recommendations.push(`${underperformers.length} properties below score 60 — consider targeted improvements or disposition.`);
    }

    const topBandCount = distribution.buckets
      .filter(b => b.range === "80–89" || b.range === "90–100")
      .reduce((sum, b) => sum + b.count, 0);
    if (distribution.totalScored > 0 && topBandCount > distribution.totalScored * 0.4) {
      recommendations.push("Strong portfolio — over 40% of properties in top two score bands.");
    }

    return {
      orgId,
      distribution,
      underperformers,
      nationalComparison: { available: false, reason: NO_COHORT_DATA_REASON },
      recommendations,
      generatedAt: new Date(),
    };
  }

  /**
   * Backtest model scoring against a set of properties. Scores and grades are
   * real (the org's own stored LCS rows); predicted default/appreciation rates
   * are honestly absent until real cohort outcome data exists.
   */
  async backtestScoring(propertyIds: number[]): Promise<{
    results: Array<{
      propertyId: number;
      predictedScore: number;
      grade: string;
      performancePrediction: BenchmarkUnavailable;
    }>;
    summary: { avgPredictedScore: number };
  }> {
    const scores = await db.select()
      .from(landCreditScores)
      .where(sql`${landCreditScores.propertyId} = ANY(${propertyIds})`);

    const results = scores.map(s => ({
      propertyId: s.propertyId,
      predictedScore: s.overallScore,
      grade: s.grade,
      performancePrediction: { available: false as const, reason: NO_COHORT_DATA_REASON },
    }));

    const avgPredictedScore = results.length > 0
      ? Math.round(results.reduce((sum, r) => sum + r.predictedScore, 0) / results.length)
      : 0;

    return { results, summary: { avgPredictedScore } };
  }
}

export const creditBenchmarkingService = new CreditBenchmarkingService();
