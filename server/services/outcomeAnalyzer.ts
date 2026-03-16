/**
 * Outcome Analyzer — Nightly feedback loop between deal outcomes and AI behavior.
 *
 * Runs at 2am nightly. Three sub-jobs:
 *   1. Scoring calibration  — leadConversions → agentMemory calibration facts
 *   2. Price accuracy       — priceRecommendations vs closed deal actuals → MAPE + nudges
 *   3. Tactic attribution   — outcomeTelemetry win/loss patterns → agentMemory success/failure patterns
 *
 * Master export: runOutcomeAnalysis() iterates all active orgs and calls all three.
 */

import { db } from "../db";
import { eq, and, gte, isNotNull, isNull, sql, desc } from "drizzle-orm";
import {
  leadConversions,
  priceRecommendations,
  outcomeTelemetry,
  agentMemory,
  paxNudges,
  organizations,
  deals,
  properties,
} from "@shared/schema";

// ── Constants ──────────────────────────────────────────────────────────────────

const LOOKBACK_DAYS = 90;

// Expected conversion rates per score bucket (baseline prior).
// These represent empirical industry baselines for land investing.
const EXPECTED_RATES: Record<string, number> = {
  "below_0":   0.02, // <0 score: 2% expected
  "0_to_100":  0.05, // 0–99
  "100_to_200": 0.12, // 100–199
  "200_to_300": 0.22, // 200–299
  "300_plus":  0.35, // 300+
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function scoreTooBucket(score: number): string {
  if (score < 0)   return "below_0";
  if (score < 100) return "0_to_100";
  if (score < 200) return "100_to_200";
  if (score < 300) return "200_to_300";
  return "300_plus";
}

function bucketRange(bucket: string): string {
  const map: Record<string, string> = {
    below_0:      "< 0",
    "0_to_100":   "0–100",
    "100_to_200": "100–200",
    "200_to_300": "200–300",
    "300_plus":   "300+",
  };
  return map[bucket] ?? bucket;
}

async function upsertAgentMemory(
  orgId: number,
  agentType: string,
  memoryType: string,
  key: string,
  value: Record<string, any>,
  confidence: number
): Promise<void> {
  // Try update first, then insert (agentMemory has no unique constraint defined, so we
  // delete any existing record for this org+agentType+key before inserting fresh).
  await db
    .delete(agentMemory)
    .where(
      and(
        eq(agentMemory.organizationId, orgId),
        eq(agentMemory.agentType, agentType),
        eq(agentMemory.key, key)
      )
    );

  await db.insert(agentMemory).values({
    organizationId: orgId,
    agentType,
    memoryType,
    key,
    value,
    confidence: String(confidence),
  });
}

// ── Job 1: Scoring Calibration ─────────────────────────────────────────────────

interface BucketStat {
  range: string;
  expectedRate: number;
  actualRate: number;
  delta: number;
  sampleSize: number;
}

export interface ScoringCalibrationResult {
  orgsCalibrated: number;
  totalConversions: number;
  bucketSummary: BucketStat[];
}

export async function runScoringCalibration(): Promise<ScoringCalibrationResult> {
  console.log("[outcomeAnalyzer] Starting runScoringCalibration");

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS);

  // Get all active orgs
  const activeOrgs = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.subscriptionStatus, "active"));

  let orgsCalibrated = 0;
  let totalConversions = 0;
  const globalBuckets: Record<string, { converted: number; total: number }> = {};

  for (const org of activeOrgs) {
    try {
      // All conversions in the window that have a score
      const conversions = await db
        .select({
          scoreAtConversion: leadConversions.scoreAtConversion,
          dealValue: leadConversions.dealValue,
          conversionType: leadConversions.conversionType,
        })
        .from(leadConversions)
        .where(
          and(
            eq(leadConversions.organizationId, org.id),
            gte(leadConversions.convertedAt, cutoff),
            isNotNull(leadConversions.scoreAtConversion)
          )
        );

      if (conversions.length < 5) continue; // Not enough signal for this org

      totalConversions += conversions.length;

      // Bucket counts: total scored leads (all conversions) and "converted" (closed)
      const bucketData: Record<string, { converted: number; total: number }> = {
        below_0:      { converted: 0, total: 0 },
        "0_to_100":   { converted: 0, total: 0 },
        "100_to_200": { converted: 0, total: 0 },
        "200_to_300": { converted: 0, total: 0 },
        "300_plus":   { converted: 0, total: 0 },
      };

      for (const c of conversions) {
        const score = c.scoreAtConversion ?? 0;
        const bucket = scoreTooBucket(score);
        bucketData[bucket].total++;
        // A "closed" conversion is the terminal positive outcome
        if (c.conversionType === "closed" || c.conversionType === "accepted") {
          bucketData[bucket].converted++;
        }

        // Accumulate for global summary
        if (!globalBuckets[bucket]) globalBuckets[bucket] = { converted: 0, total: 0 };
        globalBuckets[bucket].total++;
        if (c.conversionType === "closed" || c.conversionType === "accepted") {
          globalBuckets[bucket].converted++;
        }
      }

      // Build calibration payload
      const buckets: BucketStat[] = Object.entries(bucketData)
        .filter(([, d]) => d.total > 0)
        .map(([bucket, d]) => {
          const actualRate = d.total > 0 ? d.converted / d.total : 0;
          const expectedRate = EXPECTED_RATES[bucket] ?? 0.05;
          return {
            range: bucketRange(bucket),
            expectedRate,
            actualRate: parseFloat(actualRate.toFixed(4)),
            delta: parseFloat((actualRate - expectedRate).toFixed(4)),
            sampleSize: d.total,
          };
        });

      const totalSamples = conversions.length;
      const confidence = 0.7 + 0.3 * Math.min(totalSamples / 100, 1);

      await upsertAgentMemory(
        org.id,
        "pax",
        "calibration",
        "lead_score_calibration",
        {
          buckets,
          lastUpdated: new Date().toISOString(),
        },
        parseFloat(confidence.toFixed(4))
      );

      orgsCalibrated++;
      console.log(`[outcomeAnalyzer] Scoring calibrated for org ${org.id}: ${totalSamples} samples, confidence=${confidence.toFixed(2)}`);
    } catch (err: any) {
      console.error(`[outcomeAnalyzer] runScoringCalibration error for org ${org.id}:`, err.message);
    }
  }

  // Build global summary
  const bucketSummary: BucketStat[] = Object.entries(globalBuckets)
    .filter(([, d]) => d.total > 0)
    .map(([bucket, d]) => {
      const actualRate = d.converted / d.total;
      const expectedRate = EXPECTED_RATES[bucket] ?? 0.05;
      return {
        range: bucketRange(bucket),
        expectedRate,
        actualRate: parseFloat(actualRate.toFixed(4)),
        delta: parseFloat((actualRate - expectedRate).toFixed(4)),
        sampleSize: d.total,
      };
    });

  console.log(`[outcomeAnalyzer] runScoringCalibration complete: ${orgsCalibrated} orgs calibrated`);
  return { orgsCalibrated, totalConversions, bucketSummary };
}

// ── Job 2: Price Accuracy Tracking ────────────────────────────────────────────

export interface CountyAccuracy {
  county: string;
  state: string;
  mape: number;
  dataPoints: number;
  nudgeCreated: boolean;
}

export interface PriceAccuracyResult {
  orgsChecked: number;
  countiesAnalyzed: number;
  countiesWithHighError: number;
  details: CountyAccuracy[];
}

export async function runPriceAccuracyTracking(): Promise<PriceAccuracyResult> {
  console.log("[outcomeAnalyzer] Starting runPriceAccuracyTracking");

  const activeOrgs = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.subscriptionStatus, "active"));

  let orgsChecked = 0;
  let countiesAnalyzed = 0;
  let countiesWithHighError = 0;
  const allDetails: CountyAccuracy[] = [];

  for (const org of activeOrgs) {
    try {
      // Join priceRecommendations to closed deals on propertyId
      // Also join to properties to get county/state
      const rows = await db
        .select({
          recommendedPrice: priceRecommendations.recommendedPrice,
          county: properties.county,
          state: properties.state,
          dealValue: deals.acceptedAmount,
          closedAt: deals.closingDate,
        })
        .from(priceRecommendations)
        .innerJoin(deals, eq(deals.propertyId, priceRecommendations.propertyId))
        .innerJoin(properties, eq(properties.id, priceRecommendations.propertyId))
        .where(
          and(
            eq(priceRecommendations.organizationId, org.id),
            eq(deals.organizationId, org.id),
            eq(deals.status, "closed"),
            isNotNull(deals.closingDate),
            isNotNull(deals.acceptedAmount)
          )
        );

      if (rows.length === 0) continue;
      orgsChecked++;

      // Group by county+state
      const countyMap: Record<string, { recommended: number; actual: number }[]> = {};
      for (const row of rows) {
        const key = `${row.county}||${row.state}`;
        const recommended = parseFloat(String(row.recommendedPrice));
        const actual = parseFloat(String(row.dealValue));
        if (!recommended || !actual || recommended <= 0 || actual <= 0) continue;
        if (!countyMap[key]) countyMap[key] = [];
        countyMap[key].push({ recommended, actual });
      }

      // Per-county MAPE, only if >= 3 data points
      const countyAccuracyByOrg: Record<string, any> = {};

      for (const [key, points] of Object.entries(countyMap)) {
        if (points.length < 3) continue;
        countiesAnalyzed++;

        const [county, state] = key.split("||");
        const mape =
          (points.reduce((sum, p) => sum + Math.abs(p.actual - p.recommended) / p.recommended, 0) /
            points.length) *
          100;

        const mapeRounded = parseFloat(mape.toFixed(1));
        const nudgeCreated = mape > 25;
        countyAccuracyByOrg[key] = { county, state, mape: mapeRounded, dataPoints: points.length };

        allDetails.push({ county, state, mape: mapeRounded, dataPoints: points.length, nudgeCreated });

        if (nudgeCreated) {
          countiesWithHighError++;
          await db
            .insert(paxNudges as any)
            .values({
              organizationId: org.id,
              content: `Price accuracy for ${county}, ${state} is off by ~${mapeRounded}%. Recent closed deals suggest calibration is needed.`,
              category: "opportunity",
              priority: 2,
              actionPrompt: `Review my pricing accuracy for ${county}, ${state}. MAPE is ${mapeRounded}% across ${points.length} closed deals. How should I adjust my offer strategy?`,
            })
            .catch(() => {});
          console.log(`[outcomeAnalyzer] Created price-accuracy nudge for org ${org.id}: ${county}, ${state} MAPE=${mapeRounded}%`);
        }
      }

      // Store accuracy snapshot in agentMemory
      await upsertAgentMemory(
        org.id,
        "pax",
        "calibration",
        "price_accuracy_by_county",
        {
          counties: Object.values(countyAccuracyByOrg),
          lastUpdated: new Date().toISOString(),
        },
        0.8
      );
    } catch (err: any) {
      console.error(`[outcomeAnalyzer] runPriceAccuracyTracking error for org ${org.id}:`, err.message);
    }
  }

  console.log(`[outcomeAnalyzer] runPriceAccuracyTracking complete: ${countiesAnalyzed} counties analyzed, ${countiesWithHighError} high-error counties`);
  return { orgsChecked, countiesAnalyzed, countiesWithHighError, details: allDetails };
}

// ── Job 3: Tactic Attribution ──────────────────────────────────────────────────

export interface TacticStat {
  sequenceUsed: string;
  wins: number;
  losses: number;
  winRate: number;
  avgTouchToConversion: number;
}

export interface TacticAttributionResult {
  orgsAnalyzed: number;
  totalWins: number;
  totalLosses: number;
  topTactics: TacticStat[];
  topFailures: TacticStat[];
}

export async function runTacticAttribution(): Promise<TacticAttributionResult> {
  console.log("[outcomeAnalyzer] Starting runTacticAttribution");

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS);

  const activeOrgs = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.subscriptionStatus, "active"));

  let orgsAnalyzed = 0;
  let totalWins = 0;
  let totalLosses = 0;

  // Accumulate across all orgs for global top-3
  const globalWinMap: Record<string, { wins: number; losses: number; touches: number[] }> = {};
  const globalLossMap: Record<string, { wins: number; losses: number; touches: number[] }> = {};

  for (const org of activeOrgs) {
    try {
      const outcomes = await db
        .select({
          outcome: outcomeTelemetry.outcome,
          contributingFactors: outcomeTelemetry.contributingFactors,
          sequenceUsed: outcomeTelemetry.sequenceUsed,
          touchNumber: outcomeTelemetry.touchNumber,
        })
        .from(outcomeTelemetry)
        .where(
          and(
            eq(outcomeTelemetry.organizationId, org.id),
            gte(outcomeTelemetry.createdAt, cutoff)
          )
        );

      if (outcomes.length === 0) continue;
      orgsAnalyzed++;

      const wins = outcomes.filter((o) => (o.outcome as any)?.success === true);
      const losses = outcomes.filter((o) => (o.outcome as any)?.success === false);

      totalWins += wins.length;
      totalLosses += losses.length;

      // Aggregate by sequenceUsed
      const orgWinMap: Record<string, { wins: number; losses: number; touches: number[] }> = {};
      const orgLossMap: Record<string, { wins: number; losses: number; touches: number[] }> = {};

      for (const o of wins) {
        const seq =
          o.sequenceUsed ??
          (o.contributingFactors as any)?.sequenceUsed ??
          "unknown";
        const touch = o.touchNumber ?? (o.contributingFactors as any)?.touchNumber ?? 0;
        if (!orgWinMap[seq]) orgWinMap[seq] = { wins: 0, losses: 0, touches: [] };
        orgWinMap[seq].wins++;
        if (touch) orgWinMap[seq].touches.push(touch);

        if (!globalWinMap[seq]) globalWinMap[seq] = { wins: 0, losses: 0, touches: [] };
        globalWinMap[seq].wins++;
        if (touch) globalWinMap[seq].touches.push(touch);
      }

      for (const o of losses) {
        const seq =
          o.sequenceUsed ??
          (o.contributingFactors as any)?.sequenceUsed ??
          "unknown";
        const touch = o.touchNumber ?? (o.contributingFactors as any)?.touchNumber ?? 0;
        if (!orgLossMap[seq]) orgLossMap[seq] = { wins: 0, losses: 0, touches: [] };
        orgLossMap[seq].losses++;
        if (touch) orgLossMap[seq].touches.push(touch);

        if (!globalLossMap[seq]) globalLossMap[seq] = { wins: 0, losses: 0, touches: [] };
        globalLossMap[seq].losses++;
        if (touch) globalLossMap[seq].touches.push(touch);
      }

      // Build org-level top-3 winning and failing tactics
      const buildStats = (
        winMap: typeof orgWinMap,
        lossMap: typeof orgLossMap
      ): TacticStat[] => {
        const allSeqs = new Set([...Object.keys(winMap), ...Object.keys(lossMap)]);
        return Array.from(allSeqs)
          .map((seq) => {
            const w = winMap[seq]?.wins ?? 0;
            const l = lossMap[seq]?.losses ?? 0;
            const touches = winMap[seq]?.touches ?? [];
            const avgTouch =
              touches.length > 0
                ? touches.reduce((a, b) => a + b, 0) / touches.length
                : 0;
            return {
              sequenceUsed: seq,
              wins: w,
              losses: l,
              winRate: w + l > 0 ? parseFloat((w / (w + l)).toFixed(4)) : 0,
              avgTouchToConversion: parseFloat(avgTouch.toFixed(1)),
            };
          })
          .filter((s) => s.wins + s.losses >= 2)
          .sort((a, b) => b.winRate - a.winRate);
      };

      const topWins = buildStats(orgWinMap, orgLossMap).slice(0, 3);
      const topLosses = buildStats(orgWinMap, orgLossMap)
        .sort((a, b) => a.winRate - b.winRate)
        .slice(0, 3);

      // Write success patterns
      if (topWins.length > 0) {
        await upsertAgentMemory(
          org.id,
          "pax",
          "success_pattern",
          "top_conversion_tactics",
          {
            tactics: topWins,
            period: `last_${LOOKBACK_DAYS}_days`,
            lastUpdated: new Date().toISOString(),
          },
          0.75
        );
      }

      // Write failure patterns
      if (topLosses.length > 0) {
        await upsertAgentMemory(
          org.id,
          "pax",
          "failure_pattern",
          "top_failure_tactics",
          {
            tactics: topLosses,
            period: `last_${LOOKBACK_DAYS}_days`,
            lastUpdated: new Date().toISOString(),
          },
          0.75
        );
      }

      console.log(`[outcomeAnalyzer] Tactic attribution for org ${org.id}: ${wins.length} wins, ${losses.length} losses`);
    } catch (err: any) {
      console.error(`[outcomeAnalyzer] runTacticAttribution error for org ${org.id}:`, err.message);
    }
  }

  // Build global summary top-3
  const buildGlobalStats = (
    winMap: typeof globalWinMap,
    lossMap: typeof globalLossMap
  ): TacticStat[] => {
    const allSeqs = new Set([...Object.keys(winMap), ...Object.keys(lossMap)]);
    return Array.from(allSeqs)
      .map((seq) => {
        const w = winMap[seq]?.wins ?? 0;
        const l = lossMap[seq]?.losses ?? 0;
        const touches = winMap[seq]?.touches ?? [];
        const avgTouch =
          touches.length > 0 ? touches.reduce((a, b) => a + b, 0) / touches.length : 0;
        return {
          sequenceUsed: seq,
          wins: w,
          losses: l,
          winRate: w + l > 0 ? parseFloat((w / (w + l)).toFixed(4)) : 0,
          avgTouchToConversion: parseFloat(avgTouch.toFixed(1)),
        };
      })
      .filter((s) => s.wins + s.losses >= 2)
      .sort((a, b) => b.winRate - a.winRate);
  };

  const topTactics = buildGlobalStats(globalWinMap, globalLossMap).slice(0, 3);
  const topFailures = buildGlobalStats(globalWinMap, globalLossMap)
    .sort((a, b) => a.winRate - b.winRate)
    .slice(0, 3);

  console.log(`[outcomeAnalyzer] runTacticAttribution complete: ${orgsAnalyzed} orgs analyzed`);
  return { orgsAnalyzed, totalWins, totalLosses, topTactics, topFailures };
}

// ── Master Function ────────────────────────────────────────────────────────────

export interface OutcomeAnalysisSummary {
  scoringCalibrated: number;
  priceAccuracyChecked: number;
  tacticsAnalyzed: number;
  errors: string[];
}

export async function runOutcomeAnalysis(): Promise<OutcomeAnalysisSummary> {
  console.log("[outcomeAnalyzer] Starting nightly runOutcomeAnalysis");

  const errors: string[] = [];

  const [calibrationResult, priceResult, tacticResult] = await Promise.allSettled([
    runScoringCalibration(),
    runPriceAccuracyTracking(),
    runTacticAttribution(),
  ]);

  const scoringCalibrated =
    calibrationResult.status === "fulfilled" ? calibrationResult.value.orgsCalibrated : 0;
  if (calibrationResult.status === "rejected") {
    errors.push(`Scoring calibration failed: ${calibrationResult.reason?.message ?? "unknown"}`);
    console.error("[outcomeAnalyzer] runScoringCalibration failed:", calibrationResult.reason);
  }

  const priceAccuracyChecked =
    priceResult.status === "fulfilled" ? priceResult.value.orgsChecked : 0;
  if (priceResult.status === "rejected") {
    errors.push(`Price accuracy failed: ${priceResult.reason?.message ?? "unknown"}`);
    console.error("[outcomeAnalyzer] runPriceAccuracyTracking failed:", priceResult.reason);
  }

  const tacticsAnalyzed =
    tacticResult.status === "fulfilled" ? tacticResult.value.orgsAnalyzed : 0;
  if (tacticResult.status === "rejected") {
    errors.push(`Tactic attribution failed: ${tacticResult.reason?.message ?? "unknown"}`);
    console.error("[outcomeAnalyzer] runTacticAttribution failed:", tacticResult.reason);
  }

  const summary: OutcomeAnalysisSummary = {
    scoringCalibrated,
    priceAccuracyChecked,
    tacticsAnalyzed,
    errors,
  };

  console.log(
    `[outcomeAnalyzer] Nightly run complete — scoringCalibrated=${scoringCalibrated}, priceAccuracyChecked=${priceAccuracyChecked}, tacticsAnalyzed=${tacticsAnalyzed}`
  );

  return summary;
}
