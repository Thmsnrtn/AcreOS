/**
 * Mobile Experience Enhancements — Items 181-200
 * Push notifications, offline cache manifest, widget data, etc.
 */

import { db } from "../db";
import { organizations, deals, notes, payments, properties } from "@shared/schema";
import { eq, and, sql, desc, gte } from "drizzle-orm";

// Item 189: Push notification payload for seller responses
export function buildSellerResponseNotification(leadName: string, preview: string): {
  title: string;
  body: string;
  data: Record<string, any>;
} {
  return {
    title: `${leadName} responded`,
    body: preview.substring(0, 100),
    data: { type: "seller_response", leadName },
  };
}

// Item 190: Push notification for payment received
export function buildPaymentNotification(amount: number, borrowerName: string): {
  title: string;
  body: string;
  data: Record<string, any>;
} {
  return {
    title: "Payment received",
    body: `$${amount.toFixed(2)} from ${borrowerName}`,
    data: { type: "payment_received", amount, borrowerName },
  };
}

// Item 188: iOS widget data — today's top opportunity
export async function getWidgetData(orgId: number): Promise<{
  topOpportunity: { title: string; score: number } | null;
  pendingTasks: number;
  unreadMessages: number;
}> {
  const { dailyDealFeed } = await import("@shared/schema");
  const [feed] = await db.select()
    .from(dailyDealFeed)
    .where(eq(dailyDealFeed.organizationId, orgId))
    .orderBy(desc(dailyDealFeed.generatedAt))
    .limit(1);

  // compositeScore/acreage/county live inside the opportunities jsonb, not as
  // top-level columns. Pick the highest-composite opportunity from the feed.
  const topOpp = feed?.opportunities
    ?.slice()
    .sort((a, b) => (b.scores?.composite ?? 0) - (a.scores?.composite ?? 0))[0];

  return {
    topOpportunity: topOpp ? {
      title: `${topOpp.parcel?.acreage || 0} ac in ${topOpp.parcel?.county || "Unknown"}`,
      score: topOpp.scores?.composite || 0,
    } : null,
    pendingTasks: 0,
    unreadMessages: 0,
  };
}

// Item 186: Offline property cache manifest
export async function getOfflineCacheManifest(orgId: number, counties: string[]): Promise<{
  propertyCount: number;
  estimatedSizeMB: number;
  counties: string[];
}> {
  let totalCount = 0;
  for (const county of counties) {
    const [result] = await db.select({ count: sql<number>`COUNT(*)` })
      .from(properties)
      .where(and(
        eq(properties.organizationId, orgId),
        sql`LOWER(${properties.county}) = LOWER(${county})`,
      ));
    totalCount += Number(result?.count || 0);
  }

  return {
    propertyCount: totalCount,
    estimatedSizeMB: Math.round(totalCount * 0.002 * 100) / 100, // ~2KB per property
    counties,
  };
}

// Item 200: Mobile data usage mode
export function getReducedDataConfig(): {
  imageQuality: "thumbnail" | "medium" | "full";
  mapTiles: "low" | "standard";
  preloadPages: number;
  enableAnimations: boolean;
} {
  return {
    imageQuality: "thumbnail",
    mapTiles: "low",
    preloadPages: 1,
    enableAnimations: false,
  };
}
