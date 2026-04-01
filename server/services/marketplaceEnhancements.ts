/**
 * Marketplace Enhancements — Items 126-140
 * Listing quality, buyer saved searches, price history, activity indicators, etc.
 */

import { db } from "../db";
import { marketplaceListings } from "@shared/schema";
import { eq, and, sql, desc, gte } from "drizzle-orm";

// Item 126: Listing quality score
export function calculateListingQuality(listing: any): { score: number; missing: string[] } {
  let score = 0;
  const missing: string[] = [];

  if (listing.title) score += 15; else missing.push("title");
  if (listing.description && listing.description.length > 50) score += 20; else missing.push("detailed description");
  if (listing.price) score += 15; else missing.push("price");
  if (listing.acreage) score += 10; else missing.push("acreage");
  if (listing.county && listing.state) score += 10; else missing.push("location");
  if (listing.photos && listing.photos.length > 0) score += 15; else missing.push("photos");
  if (listing.coordinates || listing.latitude) score += 10; else missing.push("coordinates");
  if (listing.sellerFinancing) score += 5;

  return { score, missing };
}

// Item 128: Listing price history detection
export async function hasListingPriceChanged(listingId: number): Promise<{ changed: boolean; previousPrice?: number; currentPrice?: number }> {
  const listing = await db.query.marketplaceListings.findFirst({ where: eq(marketplaceListings.id, listingId) });
  if (!listing) return { changed: false };

  // Check if there's a price change logged
  const { activityLog } = await import("@shared/schema");
  const priceChanges = await db.select()
    .from(activityLog)
    .where(and(
      eq(activityLog.entityType, "marketplace_listing"),
      eq(activityLog.entityId, listingId),
      eq(activityLog.action, "price_change"),
    ))
    .orderBy(desc(activityLog.createdAt))
    .limit(1);

  if (priceChanges.length > 0) {
    const change = priceChanges[0].details as any;
    return { changed: true, previousPrice: change?.previousPrice, currentPrice: change?.newPrice };
  }
  return { changed: false };
}

// Item 131: Auto-archive expired listings
export async function archiveExpiredListings(daysThreshold: number = 90): Promise<number> {
  const cutoff = new Date(Date.now() - daysThreshold * 24 * 60 * 60 * 1000);
  const result = await db.update(marketplaceListings)
    .set({ status: "archived", updatedAt: new Date() } as any)
    .where(and(
      sql`${marketplaceListings.status} = 'active'`,
      sql`${marketplaceListings.createdAt} < ${cutoff}`,
    ))
    .returning({ id: marketplaceListings.id });
  return result.length;
}

// Item 135: Buyer intent scoring
export function scoreBuyerIntent(actions: { views: number; saves: number; offers: number; daysActive: number }): number {
  let score = 0;
  score += Math.min(actions.views * 2, 20);
  score += Math.min(actions.saves * 10, 30);
  score += Math.min(actions.offers * 25, 50);
  if (actions.daysActive < 7) score += 10; // Recent activity bonus
  return Math.min(100, score);
}
