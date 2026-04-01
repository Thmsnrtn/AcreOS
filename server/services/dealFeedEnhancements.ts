/**
 * Deal Feed Enhancements — Items 16-30
 * Map view data, "why not" feedback, email digest, county comparison, etc.
 */

import { db } from "../db";
import { dailyDealFeed, dealFeedInteractions, deals, properties } from "@shared/schema";
import { eq, and, gte, count, sql, desc } from "drizzle-orm";

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

  return feed.map(item => ({
    title: `${item.opportunities?.[0]?.acreage || 0} acres in ${item.opportunities?.[0]?.county || "Unknown"}`,
    score: item.opportunities?.[0]?.compositeScore || 0,
    county: item.opportunities?.[0]?.county || "Unknown",
    acreage: Number(item.opportunities?.[0]?.acreage) || 0,
    pricePerAcre: Number(item.opportunities?.[0]?.estimatedPricePerAcre) || 0,
  }));
}

// Item 19: County comparison
export async function compareCounties(counties: string[]): Promise<Array<{ county: string; dealCount: number; avgScore: number }>> {
  const results = [];
  for (const county of counties.slice(0, 5)) {
    const [countResult] = await db.select({ count: count() })
      .from(deals)
      .where(sql`LOWER(${deals.county}) = LOWER(${county})`);
    const [scoreResult] = await db.select({ avg: sql<number>`AVG(composite_score)` })
      .from(dailyDealFeed)
      .where(sql`LOWER(county) = LOWER(${county})`);
    results.push({
      county,
      dealCount: countResult?.count || 0,
      avgScore: Math.round(Number(scoreResult?.avg) || 0),
    });
  }
  return results;
}

// Item 22: Saved search filters
export interface SavedFilter {
  name: string;
  minAcreage?: number;
  maxAcreage?: number;
  counties?: string[];
  minScore?: number;
  maxPricePerAcre?: number;
}

// Item 23: Hot streak detection
export async function getHotStreakCounties(days: number = 30): Promise<string[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const results = await db.select({
    county: deals.county,
    count: count(),
  })
    .from(deals)
    .where(and(
      gte(deals.createdAt, since),
      sql`${deals.status} = 'closed_won'`,
    ))
    .groupBy(deals.county)
    .having(sql`COUNT(*) >= 3`);

  return results.map(r => r.county).filter(Boolean);
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
  const wins = await db.select()
    .from(deals)
    .where(and(
      eq(deals.organizationId, orgId),
      sql`${deals.status} = 'closed_won'`,
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
