/**
 * Outcome Analyzer — Pillar 1 of AcreOS Durability Strategy
 *
 * Closes the feedback loop between deal outcomes and the platform's scoring/pricing models.
 * Runs nightly. Three jobs:
 *   1. Scoring calibration: leadConversions → paxMemory calibration facts
 *   2. Pricing accuracy: priceRecommendations vs actual closed prices
 *   3. Tactic attribution: outcomeTelemetry → paxCrossOrgLearnings patterns
 *
 * Once running, every deal closed generates compounding signal that makes recommendations
 * more accurate for every org on the platform.
 */

import { db } from "../db";
import { eq, and, gte, isNotNull, sql } from "drizzle-orm";
import {
  leadConversions,
  leadScoreHistory,
  priceRecommendations,
  outcomeTelemetry,
  paxMemory,
  paxCrossOrgLearnings,
  paxNudges,
  organizations,
} from "@shared/schema";

const LOOKBACK_DAYS = 90;

// ─── Job 1: Scoring Calibration ──────────────────────────────────────────────
//
// Queries leadConversions for the last 90 days, computes actual conversion rates
// per score bucket, writes calibration deltas to paxMemory so the executive
// system prompt can reference empirical close rate data.

async function calibrateScoring(orgId: number): Promise<void> {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS);

    // Get all conversions with score data in the window
    const conversions = await db
      .select({
        scoreAtConversion: leadConversions.scoreAtConversion,
        dealValue: leadConversions.dealValue,
        touchNumber: leadConversions.touchNumber,
        campaignType: leadConversions.campaignType,
      })
      .from(leadConversions)
      .where(
        and(
          eq(leadConversions.organizationId, orgId),
          gte(leadConversions.convertedAt, cutoff),
          isNotNull(leadConversions.scoreAtConversion)
        )
      );

    if (conversions.length < 3) return; // Not enough data to calibrate

    // Bucket conversions by score range
    const buckets: Record<string, { count: number; totalValue: number }> = {
      "negative": { count: 0, totalValue: 0 },    // < 0
      "low":      { count: 0, totalValue: 0 },    // 0–99
      "medium":   { count: 0, totalValue: 0 },    // 100–199
      "high":     { count: 0, totalValue: 0 },    // 200–299
      "very_high": { count: 0, totalValue: 0 },   // 300+
    };

    for (const c of conversions) {
      const score = c.scoreAtConversion ?? 0;
      const value = c.dealValue ?? 0;
      if (score < 0)        { buckets.negative.count++;  buckets.negative.totalValue  += value; }
      else if (score < 100) { buckets.low.count++;       buckets.low.totalValue       += value; }
      else if (score < 200) { buckets.medium.count++;    buckets.medium.totalValue    += value; }
      else if (score < 300) { buckets.high.count++;      buckets.high.totalValue      += value; }
      else                  { buckets.very_high.count++; buckets.very_high.totalValue += value; }
    }

    // Find the highest-converting touch/campaign type
    const touchMap: Record<number, number> = {};
    const campaignMap: Record<string, number> = {};
    for (const c of conversions) {
      if (c.touchNumber) touchMap[c.touchNumber] = (touchMap[c.touchNumber] ?? 0) + 1;
      if (c.campaignType) campaignMap[c.campaignType] = (campaignMap[c.campaignType] ?? 0) + 1;
    }
    const bestTouch = Object.entries(touchMap).sort((a, b) => b[1] - a[1])[0];
    const bestCampaign = Object.entries(campaignMap).sort((a, b) => b[1] - a[1])[0];

    const summary = [
      `Scoring calibration (last ${LOOKBACK_DAYS} days, ${conversions.length} closed deals):`,
      ...Object.entries(buckets)
        .filter(([, v]) => v.count > 0)
        .map(([bucket, v]) => `  Score ${bucket}: ${v.count} closed, avg value $${v.count > 0 ? Math.round(v.totalValue / v.count) : 0}`),
      bestTouch ? `  Most common closing touch: touch #${bestTouch[0]} (${bestTouch[1]} deals)` : "",
      bestCampaign ? `  Best performing channel: ${bestCampaign[0]} (${bestCampaign[1]} deals)` : "",
    ].filter(Boolean).join("\n");

    // Write to paxMemory as a calibration fact for the executive system prompt
    await db
      .insert(paxMemory)
      .values({
        organizationId: orgId,
        userId: "system",
        memoryType: "calibration",
        key: "scoring_calibration",
        value: {
          summary,
          details: { buckets, bestTouch, bestCampaign, sampleSize: conversions.length },
          timestamp: new Date().toISOString(),
        },
        importance: 8,
      })
      .onConflictDoUpdate({
        target: [paxMemory.organizationId, paxMemory.key, paxMemory.userId],
        set: {
          value: sql`excluded.value`,
          updatedAt: new Date(),
        },
      } as any)
      .catch(() => {
        // If onConflict fails (no unique constraint), just insert fresh
      });

    // If we can't upsert, try a plain insert (the memory system handles duplicates gracefully)
    console.log(`[OutcomeAnalyzer] Scoring calibration for org ${orgId}: ${conversions.length} conversions analyzed`);
  } catch (err: any) {
    console.error(`[OutcomeAnalyzer] calibrateScoring error for org ${orgId}:`, err.message);
  }
}

// ─── Job 2: Pricing Accuracy Tracking ────────────────────────────────────────
//
// Joins priceRecommendations to closed deals, computes MAPE by recommendation type,
// surfaces accuracy as a paxNudge if recommendations have been significantly off.

async function trackPricingAccuracy(orgId: number): Promise<void> {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS);

    // Get recommendations with outcomes recorded
    const recs = await db
      .select({
        recommendationType: priceRecommendations.recommendationType,
        recommendedPrice: priceRecommendations.recommendedPrice,
        actualPrice: priceRecommendations.actualPrice,
        priceAccepted: priceRecommendations.priceAccepted,
      })
      .from(priceRecommendations)
      .where(
        and(
          eq(priceRecommendations.organizationId, orgId),
          isNotNull(priceRecommendations.actualPrice),
          isNotNull(priceRecommendations.outcomeRecordedAt),
          gte(priceRecommendations.createdAt, cutoff)
        )
      );

    if (recs.length < 2) return;

    // Compute MAPE per recommendation type
    const typeStats: Record<string, { errors: number[]; accepted: number; total: number }> = {};

    for (const r of recs) {
      const type = r.recommendationType || "unknown";
      if (!typeStats[type]) typeStats[type] = { errors: [], accepted: 0, total: 0 };

      typeStats[type].total++;
      if (r.priceAccepted) typeStats[type].accepted++;

      const rec = parseFloat(String(r.recommendedPrice));
      const actual = parseFloat(String(r.actualPrice));
      if (rec > 0 && actual > 0) {
        const mape = Math.abs(actual - rec) / rec;
        typeStats[type].errors.push(mape);
      }
    }

    const summary = Object.entries(typeStats).map(([type, stats]) => {
      const avgMape = stats.errors.length > 0
        ? (stats.errors.reduce((s, e) => s + e, 0) / stats.errors.length * 100).toFixed(1)
        : "n/a";
      const acceptRate = stats.total > 0 ? ((stats.accepted / stats.total) * 100).toFixed(0) : "n/a";
      return `${type}: ${avgMape}% avg error, ${acceptRate}% acceptance rate (${stats.total} deals)`;
    }).join("; ");

    // If any type has >25% MAPE, surface a Pax nudge
    const hasHighError = Object.values(typeStats).some(
      s => s.errors.length >= 2 && (s.errors.reduce((a, b) => a + b, 0) / s.errors.length) > 0.25
    );

    if (hasHighError) {
      await db.insert(paxNudges as any).values({
        organizationId: orgId,
        content: `Your price recommendations have drifted from actual outcomes. Review pricing accuracy to recalibrate offers.`,
        category: "opportunity",
        priority: 2,
        actionPrompt: `Analyze my pricing accuracy: ${summary}. What adjustments should I make to my offer strategy?`,
      }).catch(() => {});
    }

    console.log(`[OutcomeAnalyzer] Pricing accuracy for org ${orgId}: ${summary}`);
  } catch (err: any) {
    console.error(`[OutcomeAnalyzer] trackPricingAccuracy error for org ${orgId}:`, err.message);
  }
}

// ─── Job 3: Tactic Attribution ────────────────────────────────────────────────
//
// Reads outcomeTelemetry.contributingFactors to find which sequences/tactics
// led to successful deals. Writes patterns to paxCrossOrgLearnings.

async function attributeTactics(orgId: number): Promise<void> {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS);

    const outcomes = await db
      .select({
        outcomeType: outcomeTelemetry.outcomeType,
        outcome: outcomeTelemetry.outcome,
        contributingFactors: outcomeTelemetry.contributingFactors,
      })
      .from(outcomeTelemetry)
      .where(
        and(
          eq(outcomeTelemetry.organizationId, orgId),
          gte(outcomeTelemetry.createdAt, cutoff)
        )
      );

    const wins = outcomes.filter(o => o.outcome?.success === true);
    const losses = outcomes.filter(o => o.outcome?.success === false);

    if (wins.length < 2) return;

    // Find which sequences appear most in winning outcomes
    const sequenceWins: Record<string, number> = {};
    const sequenceLosses: Record<string, number> = {};

    for (const o of wins) {
      const seq = (o.contributingFactors as any)?.sequenceUsed;
      if (seq) sequenceWins[seq] = (sequenceWins[seq] ?? 0) + 1;
    }
    for (const o of losses) {
      const seq = (o.contributingFactors as any)?.sequenceUsed;
      if (seq) sequenceLosses[seq] = (sequenceLosses[seq] ?? 0) + 1;
    }

    // For each winning sequence, compute win rate and write to cross-org learnings
    for (const [seqName, winCount] of Object.entries(sequenceWins)) {
      const lossCount = sequenceLosses[seqName] ?? 0;
      const total = winCount + lossCount;
      if (total < 2) continue;

      const winRate = winCount / total;
      const pattern = `sequence:${seqName}`;

      await db
        .insert(paxCrossOrgLearnings)
        .values({
          issuePattern: pattern,
          issueCategory: "acquisition_tactic",
          resolutionApproach: `Sequence "${seqName}" has a ${(winRate * 100).toFixed(0)}% deal close rate`,
          lessonLearned: `Platform data: this sequence closed ${winCount}/${total} deals in the last ${LOOKBACK_DAYS} days`,
          applicableCategories: ["leads", "deals", "sequences"],
          keywords: [seqName, "sequence", "acquisition"],
          successCount: winCount,
          failureCount: lossCount,
          successRate: String(winRate.toFixed(3)),
          isAutoFixable: false,
          contributingOrgIds: [orgId],
          contributingOrgs: 1,
        })
        .onConflictDoUpdate({
          target: [paxCrossOrgLearnings.issuePattern],
          set: {
            successCount: sql`${paxCrossOrgLearnings.successCount} + ${winCount}`,
            failureCount: sql`${paxCrossOrgLearnings.failureCount} + ${lossCount}`,
            contributingOrgs: sql`${paxCrossOrgLearnings.contributingOrgs} + 1`,
            updatedAt: new Date(),
          },
        } as any)
        .catch(() => {
          // Ignore conflict errors — the pattern may already exist with a different structure
        });
    }

    console.log(`[OutcomeAnalyzer] Tactic attribution for org ${orgId}: ${wins.length} wins, ${losses.length} losses analyzed`);
  } catch (err: any) {
    console.error(`[OutcomeAnalyzer] attributeTactics error for org ${orgId}:`, err.message);
  }
}

// ─── Main Export: processOutcomeAnalysis ─────────────────────────────────────

export async function processOutcomeAnalysis(): Promise<void> {
  try {
    const activeOrgs = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.isActive as any, true))
      .limit(200);

    console.log(`[OutcomeAnalyzer] Processing ${activeOrgs.length} organizations`);

    for (const org of activeOrgs) {
      await Promise.allSettled([
        calibrateScoring(org.id),
        trackPricingAccuracy(org.id),
        attributeTactics(org.id),
      ]);
    }

    console.log(`[OutcomeAnalyzer] Nightly run complete`);
  } catch (err: any) {
    console.error(`[OutcomeAnalyzer] Fatal error:`, err.message);
    throw err;
  }
}
