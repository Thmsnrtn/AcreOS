/**
 * Deal Feed Enhancements — Items 16-30
 * Map view data, "why not" feedback, email digest, county comparison, etc.
 */

import { db } from "../db";
import { dailyDealFeed, dealFeedInteractions, deals, properties } from "@shared/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { CLOSED_DEAL_STATUSES } from "@shared/lifecycle/pipeline-status";
// Item 17: "Why not?" feedback categories
export type PassReason = "too_expensive" | "wrong_area" | "wrong_size" | "low_quality" | "already_have" | "other";

export async function recordPassReason(orgId: number, opportunityId: string, reason: PassReason): Promise<void> {
  await db.insert(dealFeedInteractions).values({
    organizationId: orgId,
    opportunityId,
    interactionType: "pass_with_reason",
    feedback: reason,
  } as any);
}

// Item 18: Deal feed email digest — top 3 opportunities
export async function generateDealFeedDigest(orgId: number): Promise<Array<{ title: string; score: number; county: string; acreage: number; pricePerAcre: number }>> {
  const feed = await db.select()
    .from(dailyDealFeed)
    .where(eq(dailyDealFeed.organizationId, orgId))
    .orderBy(desc(dailyDealFeed.generatedAt))
    .limit(3);

  return feed.map(item => {
    const top = item.opportunities?.[0];
    const acreage = top?.parcel?.acreage ?? 0;
    const county = top?.parcel?.county ?? "Unknown";
    const estimatedValue = top?.financials?.estimatedValue ?? 0;
    return {
      title: `${acreage || 0} acres in ${county}`,
      score: top?.scores?.composite ?? 0,
      county,
      acreage: Number(acreage) || 0,
      pricePerAcre: acreage > 0 ? Math.round(Number(estimatedValue) / Number(acreage)) : 0,
    };
  });
}

// compareCounties, getHotStreakCounties deleted 2026-08-29 — zero callers, adversarially verified (rule-1 register close-out).

// Item 22: Saved search filters
export interface SavedFilter {
  name: string;
  minAcreage?: number;
  maxAcreage?: number;
  counties?: string[];
  minScore?: number;
  maxPricePerAcre?: number;
}

// Item 24: Stale opportunity detection
export async function flagStaleOpportunities(orgId: number): Promise<number> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const stale = await db.select({ id: dailyDealFeed.id })
    .from(dailyDealFeed)
    .where(and(
      eq(dailyDealFeed.organizationId, orgId),
      sql`${dailyDealFeed.generatedAt} < ${thirtyDaysAgo}`,
    ));
  return stale.length;
}

// Item 27: Similar to wins filter
export async function findSimilarToWins(orgId: number): Promise<any[]> {
  // Get closed deals to establish pattern
  const wins = await db.select({ county: properties.county })
    .from(deals)
    .innerJoin(properties, eq(deals.propertyId, properties.id))
    .where(and(
      eq(deals.organizationId, orgId),
      // WAS `= 'closed_won'`, which is not a deal status and matched no row,
      // ever — so "find similar to wins" had no wins to learn from and
      // returned [] for every organization. The success terminal is `closed`.
      inArray(deals.status, [...CLOSED_DEAL_STATUSES]),
    ))
    .limit(10);

  if (wins.length === 0) return [];

  // Extract average characteristics from winning deals
  const counties = [...new Set(wins.map(d => d.county).filter(Boolean))];

  if (counties.length === 0) return [];

  // Find matching opportunities
  const matches = await db.select()
    .from(dailyDealFeed)
    .where(and(
      eq(dailyDealFeed.organizationId, orgId),
      sql`${dailyDealFeed.generatedAt} > NOW() - INTERVAL '30 days'`,
    ))
    .orderBy(desc(dailyDealFeed.generatedAt))
    .limit(10);

  return matches;
}
