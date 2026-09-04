import { db } from '../db';
import { 
  marketplaceListings, 
  investorProfiles,
  buyerBehaviorEvents,
  properties 
} from '../../shared/schema';
import { eq, and, gte, lte, desc } from 'drizzle-orm';
import { logger } from "../utils/logger";

interface MatchScore {
  listingId: number;
  score: number;
  reasons: string[];
  property: any;
}

/**
 * The subset of an investor profile that may cross an organization boundary.
 *
 * `investor_profiles` groups its own columns with comments — "Public info",
 * "Specialization", "Verification", "Reputation" — and the buyer-match result
 * used to return the WHOLE ROW, including `verificationDocuments`: the
 * counterparty's identity and accreditation paperwork, handed to whoever asked
 * which buyers matched a listing. `isVerified` is the public form of that fact
 * and is what a seller actually needs to see; the documents behind it are not
 * the seller's to read.
 *
 * Written as an explicit pick rather than a delete-list so a column ADDED to
 * the table in future is private by default. That direction matters: an
 * omission here shows up as a missing field, while an omission from a
 * blocklist shows up as a leak.
 */
export interface PublicInvestorFields {
  organizationId: number;
  displayName: string;
  bio: string | null;
  location: string | null;
  website: string | null;
  specialties: string[] | null;
  preferredStates: string[] | null;
  investmentRange: { min: number; max: number } | null;
  isVerified: boolean | null;
  dealsClosed: number | null;
  reliabilityScore: string | null;
  rating: string | null;
  reviewCount: number | null;
}

export interface BuyerMatch {
  profile: PublicInvestorFields;
  score: number;
  reasons: string[];
}

function publicInvestorFields(
  profile: typeof investorProfiles.$inferSelect,
): PublicInvestorFields {
  return {
    organizationId: profile.organizationId,
    displayName: profile.displayName,
    bio: profile.bio,
    location: profile.location,
    website: profile.website,
    specialties: profile.specialties ?? null,
    preferredStates: profile.preferredStates ?? null,
    investmentRange: profile.investmentRange ?? null,
    isVerified: profile.isVerified,
    dealsClosed: profile.dealsClosed,
    reliabilityScore: profile.reliabilityScore,
    rating: profile.rating,
    reviewCount: profile.reviewCount,
  };
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
      logger.error('Failed to find matches for investor', error);
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
    listingId: number,
    sellerOrganizationId: number
  ): Promise<BuyerMatch[]> {
    try {
      // YOU FIND BUYERS FOR YOUR OWN LISTING. This took a bare listingId and
      // matched against it for any authenticated caller, so a member of any
      // organization could enumerate the buyer interest in another tenant's
      // listing. A listing that is not yours reads as absent.
      const listing = await db.query.marketplaceListings.findFirst({
        where: and(
          eq(marketplaceListings.id, listingId),
          eq(marketplaceListings.sellerOrganizationId, sellerOrganizationId),
        ),
      });

      if (!listing) {
        return [];
      }

      // Reading every investor profile is CORRECT here and is the point of a
      // marketplace — the buyers for your listing are, by definition, in other
      // organizations. What is not correct is handing back the whole row.
      // investor_profiles has no status column;
      // TODO(tsc): add an activity/status flag to filter active investors.
      const profiles = await db.query.investorProfiles.findMany({});

      const matches: BuyerMatch[] = [];

      for (const profile of profiles) {
        // An org is not a buyer for its own listing.
        if (profile.organizationId === sellerOrganizationId) continue;

        const score = await this.calculateMatchScore(profile, listing);

        if (score.score > 60) {
          matches.push({
            profile: publicInvestorFields(profile),
            score: score.score,
            reasons: score.reasons,
          });
        }
      }

      // Sort by score
      matches.sort((a, b) => b.score - a.score);

      return matches.slice(0, 10); // Top 10 potential buyers
    } catch (error) {
      logger.error('Failed to find buyers for listing', error);
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
      // Get recent behavior events. buyer_behavior_events is anonymized
      // (county-level, anonymousId only) and has no organizationId/createdAt
      // columns, so we read recent events globally and order by eventDate.
      // TODO(tsc): re-introduce per-org scoping once events carry an org-linked
      // (hashed) identifier we can filter on.
      void organizationId;
      const recentEvents = await db.query.buyerBehaviorEvents.findMany({
        orderBy: [desc(buyerBehaviorEvents.eventDate)],
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

      // Filter and rank by relevance.
      // TODO(tsc): marketplace_listings has no state column (state lives on the
      // related property). Ranking by topState requires a property join; until
      // then the listings keep their createdAt order.
      void topState;

      return listings.slice(0, 10);
    } catch (error) {
      logger.error('Failed to get recommendations', error);
      return [];
    }
  }

  /**
   * Notify matched buyers about a new listing
   */
  async notifyMatchedBuyers(listingId: number, sellerOrganizationId: number): Promise<number> {
    try {
      const matches = await this.findBuyersForListing(listingId, sellerOrganizationId);

      // In production, would send emails/notifications here
      logger.info(`Would notify ${matches.length} matched buyers for listing ${listingId}`);

      return matches.length;
    } catch (error) {
      logger.error('Failed to notify matched buyers', error);
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

      // Similar acreage (sizeAcres is stored as a numeric/string column)
      const acreageDiff = Math.abs(Number(prop1.sizeAcres || 0) - Number(prop2.sizeAcres || 0));
      if (acreageDiff < 5) similarity += 20;
      else if (acreageDiff < 20) similarity += 10;

      // Similar zoning
      if (prop1.zoning === prop2.zoning) similarity += 15;

      // Similar price range
      const price1 = Number(prop1.purchasePrice || 0);
      const price2 = Number(prop2.purchasePrice || 0);
      const priceDiff = Math.abs(price1 - price2);
      const avgPrice = (price1 + price2) / 2;

      if (avgPrice > 0 && priceDiff / avgPrice < 0.2) {
        similarity += 15;
      }

      return Math.min(100, similarity);
    } catch (error) {
      logger.error('Failed to calculate similarity', error);
      return 0;
    }
  }
}

export const matchmaking = new Matchmaking();
