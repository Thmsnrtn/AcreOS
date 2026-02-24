import { db } from '../db';
import { 
  marketplaceListings, 
  investorProfiles,
  buyerBehaviorEvents,
  properties 
} from '../../shared/schema';
import { eq, and, gte, lte, desc } from 'drizzle-orm';

interface MatchScore {
  listingId: number;
  score: number;
  reasons: string[];
  property: any;
}

class Matchmaking {
  /**
   * Find matching properties for an investor based on their profile
   */
  async findMatchesForInvestor(
    investorOrgId: number
  ): Promise<MatchScore[]> {
    try {
      const profile = await db.query.investorProfiles.findFirst({
        where: eq(investorProfiles.organizationId, investorOrgId),
      });

      if (!profile) {
        return [];
      }

      // Get active listings
      const listings = await db.query.marketplaceListings.findMany({
        where: eq(marketplaceListings.status, 'active'),
        limit: 100,
      });

      const matches: MatchScore[] = [];

      for (const listing of listings) {
        const score = await this.calculateMatchScore(profile, listing);

        if (score.score > 50) {
          // Only include good matches
          matches.push(score);
        }
      }

      // Sort by score descending
      matches.sort((a, b) => b.score - a.score);

      return matches.slice(0, 20); // Top 20 matches
    } catch (error) {
      console.error('Failed to find matches for investor:', error);
      return [];
    }
  }

  /**
   * Calculate match score between investor profile and listing
   */
  private async calculateMatchScore(
    profile: any,
    listing: any
  ): Promise<MatchScore> {
    let score = 0;
    const reasons: string[] = [];

    // Price match
    if (listing.price >= profile.minInvestment && listing.price <= profile.maxInvestment) {
      score += 30;
      reasons.push('Price fits budget');
    } else if (listing.price > profile.maxInvestment) {
      score -= 20;
      reasons.push('Above budget');
    }

    // Geographic preference
    const preferredStates = profile.preferredStates || [];
    if (preferredStates.includes(listing.state)) {
      score += 20;
      reasons.push(`Preferred state: ${listing.state}`);
    }

    const preferredCounties = profile.preferredCounties || [];
    if (preferredCounties.includes(listing.county)) {
      score += 10;
      reasons.push(`Preferred county: ${listing.county}`);
    }

    // Property type match
    const preferredTypes = profile.preferredPropertyTypes || [];
    if (preferredTypes.length === 0 || preferredTypes.includes(listing.propertyType)) {
      score += 15;
      reasons.push('Property type matches');
    }

    // Acreage preference
    if (profile.minAcres && listing.acres < profile.minAcres) {
      score -= 10;
    } else if (profile.maxAcres && listing.acres > profile.maxAcres) {
      score -= 10;
    } else {
      score += 10;
      reasons.push('Acreage within range');
    }

    // Investment strategy alignment
    const strategies = profile.investmentStrategies || [];
    if (strategies.includes('flip') && listing.pricePerAcre < 5000) {
      score += 15;
      reasons.push('Good flip opportunity (low $/acre)');
    }

    if (strategies.includes('hold') && listing.zoning) {
      score += 10;
      reasons.push('Hold potential with zoning');
    }

    if (strategies.includes('develop') && listing.utilities) {
      score += 15;
      reasons.push('Development-ready with utilities');
    }

    // Time on market (fresh listings are better)
    const daysOnMarket = Math.floor(
      (new Date().getTime() - listing.createdAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysOnMarket < 7) {
      score += 10;
      reasons.push('Fresh listing');
    } else if (daysOnMarket > 90) {
      score += 5;
      reasons.push('Potential negotiation leverage');
    }

    return {
      listingId: listing.id,
      score: Math.min(100, Math.max(0, score)),
      reasons,
      property: listing,
    };
  }

  /**
   * Find potential buyers for a listing
   */
  async findBuyersForListing(
    listingId: number
  ): Promise<any[]> {
    try {
      const listing = await db.query.marketplaceListings.findFirst({
        where: eq(marketplaceListings.id, listingId),
      });

      if (!listing) {
        return [];
      }

      // Get all investor profiles
      const profiles = await db.query.investorProfiles.findMany({
        where: eq(investorProfiles.status, 'active'),
      });

      const matches = [];

      for (const profile of profiles) {
        const score = await this.calculateMatchScore(profile, listing);

        if (score.score > 60) {
          matches.push({
            profile,
            score: score.score,
            reasons: score.reasons,
          });
        }
      }

      // Sort by score
      matches.sort((a, b) => b.score - a.score);

      return matches.slice(0, 10); // Top 10 potential buyers
    } catch (error) {
      console.error('Failed to find buyers for listing:', error);
      return [];
    }
  }

  /**
   * Get personalized listing recommendations based on behavior
   */
  async getRecommendations(
    organizationId: number
  ): Promise<any[]> {
    try {
      // Get recent behavior events
      const recentEvents = await db.query.buyerBehaviorEvents.findMany({
        where: eq(buyerBehaviorEvents.organizationId, organizationId),
        orderBy: [desc(buyerBehaviorEvents.createdAt)],
        limit: 50,
      });

      // Analyze behavior to determine preferences
      const stateFrequency = new Map<string, number>();
      const countyFrequency = new Map<string, number>();

      for (const event of recentEvents) {
        if (event.state) {
          stateFrequency.set(
            event.state,
            (stateFrequency.get(event.state) || 0) + 1
          );
        }
        if (event.county) {
          countyFrequency.set(
            event.county,
            (countyFrequency.get(event.county) || 0) + 1
          );
        }
      }

      // Find top preferences
      const topState = Array.from(stateFrequency.entries())
        .sort((a, b) => b[1] - a[1])[0]?.[0];

      const topCounty = Array.from(countyFrequency.entries())
        .sort((a, b) => b[1] - a[1])[0]?.[0];

      // Get listings matching preferences
      let listings = await db.query.marketplaceListings.findMany({
        where: eq(marketplaceListings.status, 'active'),
        orderBy: [desc(marketplaceListings.createdAt)],
        limit: 20,
      });

      // Filter and rank by relevance
      if (topState) {
        listings = listings.sort((a, b) => {
          if (a.state === topState && b.state !== topState) return -1;
          if (a.state !== topState && b.state === topState) return 1;
          return 0;
        });
      }

      return listings.slice(0, 10);
    } catch (error) {
      console.error('Failed to get recommendations:', error);
      return [];
    }
  }

  /**
   * Notify matched buyers about a new listing
   */
  async notifyMatchedBuyers(listingId: number): Promise<number> {
    try {
      const matches = await this.findBuyersForListing(listingId);

      // In production, would send emails/notifications here
      console.log(`Would notify ${matches.length} matched buyers for listing ${listingId}`);

      return matches.length;
    } catch (error) {
      console.error('Failed to notify matched buyers:', error);
      return 0;
    }
  }

  /**
   * Get similarity score between two properties
   */
  async calculateSimilarity(
    propertyId1: number,
    propertyId2: number
  ): Promise<number> {
    try {
      const prop1 = await db.query.properties.findFirst({
        where: eq(properties.id, propertyId1),
      });

      const prop2 = await db.query.properties.findFirst({
        where: eq(properties.id, propertyId2),
      });

      if (!prop1 || !prop2) {
        return 0;
      }

      let similarity = 0;

      // Same state
      if (prop1.state === prop2.state) similarity += 20;

      // Same county
      if (prop1.county === prop2.county) similarity += 30;

      // Similar acreage
      const acreageDiff = Math.abs((prop1.acres || 0) - (prop2.acres || 0));
      if (acreageDiff < 5) similarity += 20;
      else if (acreageDiff < 20) similarity += 10;

      // Similar zoning
      if (prop1.zoning === prop2.zoning) similarity += 15;

      // Similar price range
      const price1 = prop1.purchasePrice || 0;
      const price2 = prop2.purchasePrice || 0;
      const priceDiff = Math.abs(price1 - price2);
      const avgPrice = (price1 + price2) / 2;

      if (avgPrice > 0 && priceDiff / avgPrice < 0.2) {
        similarity += 15;
      }

      return Math.min(100, similarity);
    } catch (error) {
      console.error('Failed to calculate similarity:', error);
      return 0;
    }
  }
}

export const matchmaking = new Matchmaking();
