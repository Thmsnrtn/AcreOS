import { db } from "../db";
import { storage } from "../storage";
import {
  marketplaceListings,
  marketplaceBids,
  investorProfiles,
  dealRooms,
  marketplaceTransactions,
  organizations,
  properties,
  type InsertMarketplaceListing,
  type InsertMarketplaceBid,
  type InsertInvestorProfile,
  type InsertMarketplaceTransaction,
} from "@shared/schema";
import { eq, and, desc, gte, or, sql, inArray } from "drizzle-orm";

export class MarketplaceService {
  
  /**
   * Create a new marketplace listing
   */
  async createListing(
    organizationId: number,
    propertyId: number,
    data: Partial<InsertMarketplaceListing>
  ) {
    // Verify property ownership
    const property = await storage.getProperty(organizationId, propertyId);
    if (!property) {
      throw new Error("Property not found or you don't have access");
    }
    
    // Check if already listed
    const existing = await db.select()
      .from(marketplaceListings)
      .where(and(
        eq(marketplaceListings.propertyId, propertyId),
        inArray(marketplaceListings.status, ["active", "under_offer"])
      ))
      .limit(1);
    
    if (existing.length > 0) {
      throw new Error("Property is already listed on marketplace");
    }
    
    // Create listing
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90); // 90 day default
    
    const [listing] = await db.insert(marketplaceListings).values({
      sellerOrganizationId: organizationId,
      propertyId,
      listingType: data.listingType || "wholesale",
      title: data.title || `${property.sizeAcres} Acres - ${property.county}, ${property.state}`,
      description: data.description || property.notes || "",
      askingPrice: data.askingPrice || property.listPrice || property.marketValue || "0",
      minAcceptablePrice: data.minAcceptablePrice, // Private
      closingTimelineDays: data.closingTimelineDays || 30,
      isNegotiable: data.isNegotiable ?? true,
      acceptsPartnership: data.acceptsPartnership || false,
      partnershipTerms: data.partnershipTerms,
      visibility: data.visibility || "public",
      isPremiumPlacement: data.isPremiumPlacement || false,
      status: "active",
      expiresAt,
    }).returning();
    
    return listing;
  }
  
  /**
   * Get marketplace listings with filters
   */
  async getListings(filters: {
    organizationId?: number;
    status?: string;
    listingType?: string;
    minPrice?: number;
    maxPrice?: number;
    states?: string[];
    limit?: number;
    offset?: number;
  }) {
    let query = db.select({
      listing: marketplaceListings,
      property: properties,
      seller: {
        id: organizations.id,
        name: organizations.name,
      },
    })
      .from(marketplaceListings)
      .leftJoin(properties, eq(marketplaceListings.propertyId, properties.id))
      .leftJoin(organizations, eq(marketplaceListings.sellerOrganizationId, organizations.id));
    
    const conditions: any[] = [];
    
    if (filters.status) {
      conditions.push(eq(marketplaceListings.status, filters.status));
    } else {
      conditions.push(inArray(marketplaceListings.status, ["active", "under_offer"]));
    }
    
    if (filters.listingType) {
      conditions.push(eq(marketplaceListings.listingType, filters.listingType));
    }
    
    if (filters.minPrice) {
      conditions.push(gte(marketplaceListings.askingPrice, filters.minPrice.toString()));
    }
    
    if (filters.maxPrice) {
      conditions.push(sql`${marketplaceListings.askingPrice}::numeric <= ${filters.maxPrice}`);
    }
    
    if (filters.states && filters.states.length > 0) {
      conditions.push(inArray(properties.state, filters.states));
    }
    
    // Exclude own listings
    if (filters.organizationId) {
      conditions.push(sql`${marketplaceListings.sellerOrganizationId} != ${filters.organizationId}`);
    }
    
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }
    
    // Order by premium placement first, then newest
    query = query
      .orderBy(
        desc(marketplaceListings.isPremiumPlacement),
        desc(marketplaceListings.createdAt)
      ) as any;
    
    if (filters.limit) {
      query = query.limit(filters.limit) as any;
    }
    
    if (filters.offset) {
      query = query.offset(filters.offset) as any;
    }
    
    return await query;
  }
  
  /**
   * Get single listing details
   */
  async getListing(listingId: number, viewerOrgId?: number) {
    const results = await db.select({
      listing: marketplaceListings,
      property: properties,
      seller: organizations,
    })
      .from(marketplaceListings)
      .leftJoin(properties, eq(marketplaceListings.propertyId, properties.id))
      .leftJoin(organizations, eq(marketplaceListings.sellerOrganizationId, organizations.id))
      .where(eq(marketplaceListings.id, listingId))
      .limit(1);
    
    if (results.length === 0) {
      return null;
    }
    
    const result = results[0];
    
    // Increment view count (only if not seller)
    if (viewerOrgId && result.listing.sellerOrganizationId !== viewerOrgId) {
      await db.update(marketplaceListings)
        .set({ views: sql`${marketplaceListings.views} + 1` })
        .where(eq(marketplaceListings.id, listingId));
    }
    
    // Get bids if seller
    let bids = [];
    if (viewerOrgId && result.listing.sellerOrganizationId === viewerOrgId) {
      bids = await this.getBidsForListing(listingId);
    }
    
    return {
      ...result,
      bids,
    };
  }
  
  /**
   * Place a bid on a listing
   */
  async placeBid(
    bidderOrgId: number,
    listingId: number,
    data: {
      bidAmount: number;
      message?: string;
      proposedTerms?: string;
      bidType?: string;
      partnershipSplit?: number;
    }
  ) {
    // Get listing
    const listing = await db.select()
      .from(marketplaceListings)
      .where(eq(marketplaceListings.id, listingId))
      .limit(1);
    
    if (listing.length === 0) {
      throw new Error("Listing not found");
    }
    
    if (listing[0].sellerOrganizationId === bidderOrgId) {
      throw new Error("Cannot bid on your own listing");
    }
    
    if (listing[0].status !== "active") {
      throw new Error("Listing is not active");
    }
    
    // Create bid
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 day expiry
    
    const [bid] = await db.insert(marketplaceBids).values({
      listingId,
      bidderOrganizationId: bidderOrgId,
      bidAmount: data.bidAmount.toString(),
      message: data.message,
      proposedTerms: data.proposedTerms,
      bidType: data.bidType || "purchase",
      partnershipSplit: data.partnershipSplit?.toString(),
      status: "pending",
      expiresAt,
    }).returning();
    
    // Update listing inquiry count
    await db.update(marketplaceListings)
      .set({ inquiries: sql`${marketplaceListings.inquiries} + 1` })
      .where(eq(marketplaceListings.id, listingId));
    
    // TODO: Send notification to seller
    
    return bid;
  }
  
  /**
   * Get bids for a listing (seller only)
   */
  async getBidsForListing(listingId: number) {
    return await db.select({
      bid: marketplaceBids,
      bidder: {
        id: organizations.id,
        name: organizations.name,
      },
    })
      .from(marketplaceBids)
      .leftJoin(organizations, eq(marketplaceBids.bidderOrganizationId, organizations.id))
      .where(eq(marketplaceBids.listingId, listingId))
      .orderBy(desc(marketplaceBids.bidAmount), desc(marketplaceBids.createdAt));
  }
  
  /**
   * Respond to a bid (seller)
   */
  async respondToBid(
    sellerOrgId: number,
    bidId: number,
    action: "accept" | "reject" | "counter",
    data?: {
      counterOffer?: number;
      sellerResponse?: string;
    }
  ) {
    // Get bid with listing
    const results = await db.select({
      bid: marketplaceBids,
      listing: marketplaceListings,
    })
      .from(marketplaceBids)
      .leftJoin(marketplaceListings, eq(marketplaceBids.listingId, marketplaceListings.id))
      .where(eq(marketplaceBids.id, bidId))
      .limit(1);
    
    if (results.length === 0) {
      throw new Error("Bid not found");
    }
    
    const { bid, listing } = results[0];
    
    if (!listing || listing.sellerOrganizationId !== sellerOrgId) {
      throw new Error("You don't have permission to respond to this bid");
    }
    
    if (bid.status !== "pending") {
      throw new Error("Bid is no longer pending");
    }
    
    // Update bid
    await db.update(marketplaceBids)
      .set({
        status: action === "accept" ? "accepted" : action === "reject" ? "rejected" : "countered",
        sellerResponse: data?.sellerResponse,
        counterOffer: data?.counterOffer?.toString(),
        respondedAt: new Date(),
      })
      .where(eq(marketplaceBids.id, bidId));
    
    // If accepted, update listing status and create deal room
    if (action === "accept") {
      await db.update(marketplaceListings)
        .set({ status: "under_offer" })
        .where(eq(marketplaceListings.id, listing.id));
      
      // Create deal room
      await this.createDealRoom(listing.id, bid.bidderOrganizationId, listing.sellerOrganizationId);
    }
    
    // TODO: Send notification to bidder
    
    return { success: true, action };
  }
  
  /**
   * Create a deal room for accepted bid
   */
  async createDealRoom(
    listingId: number,
    buyerOrgId: number,
    sellerOrgId: number
  ) {
    const [room] = await db.insert(dealRooms).values({
      listingId,
      participants: [
        {
          organizationId: sellerOrgId,
          role: "seller",
          joinedAt: new Date().toISOString(),
        },
        {
          organizationId: buyerOrgId,
          role: "buyer",
          joinedAt: new Date().toISOString(),
        },
      ],
      status: "active",
    }).returning();
    
    return room;
  }
  
  /**
   * Complete a marketplace transaction
   */
  async completeTransaction(
    listingId: number,
    buyerOrgId: number,
    salePrice: number
  ) {
    const listing = await db.select()
      .from(marketplaceListings)
      .where(eq(marketplaceListings.id, listingId))
      .limit(1);
    
    if (listing.length === 0) {
      throw new Error("Listing not found");
    }
    
    const platformFeePercent = 1.5;
    const platformFeeCents = Math.round(salePrice * (platformFeePercent / 100) * 100);
    const sellerPayoutAmount = salePrice - (platformFeeCents / 100);
    
    const [transaction] = await db.insert(marketplaceTransactions).values({
      listingId,
      sellerOrganizationId: listing[0].sellerOrganizationId,
      buyerOrganizationId: buyerOrgId,
      transactionType: listing[0].listingType,
      salePrice: salePrice.toString(),
      platformFeePercent: platformFeePercent.toString(),
      platformFeeCents,
      sellerPayoutAmount: sellerPayoutAmount.toString(),
      sellerPayoutStatus: "pending",
      status: "pending",
      closingDate: new Date(),
    }).returning();
    
    // Update listing
    await db.update(marketplaceListings)
      .set({
        status: "sold",
        soldAt: new Date(),
      })
      .where(eq(marketplaceListings.id, listingId));
    
    // Close deal room
    await db.update(dealRooms)
      .set({
        status: "closed",
        closedAt: new Date(),
      })
      .where(eq(dealRooms.listingId, listingId));
    
    // TODO: Process Stripe payment and payout
    
    return transaction;
  }
  
  /**
   * Get or create investor profile
   */
  async getInvestorProfile(organizationId: number) {
    const existing = await db.select()
      .from(investorProfiles)
      .where(eq(investorProfiles.organizationId, organizationId))
      .limit(1);
    
    if (existing.length > 0) {
      return existing[0];
    }
    
    // Get org info
    const org = await db.select()
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    
    if (org.length === 0) {
      throw new Error("Organization not found");
    }
    
    // Create default profile
    const [profile] = await db.insert(investorProfiles).values({
      organizationId,
      displayName: org[0].name,
      bio: "",
      location: "",
      isVerified: false,
      dealsClosed: 0,
      reliabilityScore: "75",
      rating: "4.5",
      reviewCount: 0,
    }).returning();
    
    return profile;
  }
  
  /**
   * Update investor profile
   */
  async updateInvestorProfile(
    organizationId: number,
    data: Partial<InsertInvestorProfile>
  ) {
    const [updated] = await db.update(investorProfiles)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(investorProfiles.organizationId, organizationId))
      .returning();
    
    return updated;
  }
  
  /**
   * Add property to favorites
   */
  async toggleFavorite(organizationId: number, listingId: number) {
    // In production, would use a separate favorites table
    // For now, just increment favorites count
    await db.update(marketplaceListings)
      .set({ favorites: sql`${marketplaceListings.favorites} + 1` })
      .where(eq(marketplaceListings.id, listingId));
    
    return { success: true };
  }
  
  /**
   * Get marketplace statistics
   */
  async getMarketplaceStats(organizationId?: number) {
    const activeListingsQuery = db.select({ count: sql<number>`count(*)` })
      .from(marketplaceListings)
      .where(eq(marketplaceListings.status, "active"));
    
    const totalTransactionsQuery = db.select({ 
      count: sql<number>`count(*)`,
      totalVolume: sql<number>`sum(${marketplaceTransactions.salePrice}::numeric)`,
    })
      .from(marketplaceTransactions)
      .where(eq(marketplaceTransactions.status, "completed"));
    
    const [activeListings] = await activeListingsQuery;
    const [transactions] = await totalTransactionsQuery;
    
    let myStats = null;
    if (organizationId) {
      const myListings = await db.select({ count: sql<number>`count(*)` })
        .from(marketplaceListings)
        .where(eq(marketplaceListings.sellerOrganizationId, organizationId));
      
      const myTransactions = await db.select({ count: sql<number>`count(*)` })
        .from(marketplaceTransactions)
        .where(or(
          eq(marketplaceTransactions.sellerOrganizationId, organizationId),
          eq(marketplaceTransactions.buyerOrganizationId, organizationId)
        ));
      
      myStats = {
        activeListings: myListings[0]?.count || 0,
        completedTransactions: myTransactions[0]?.count || 0,
      };
    }
    
    return {
      marketplace: {
        activeListings: activeListings?.count || 0,
        totalTransactions: transactions?.count || 0,
        totalVolume: transactions?.totalVolume || 0,
      },
      myStats,
    };
  }
  
  /**
   * Search marketplace with advanced filters
   */
  async searchListings(query: {
    keywords?: string;
    propertyTypes?: string[];
    minAcres?: number;
    maxAcres?: number;
    minPrice?: number;
    maxPrice?: number;
    states?: string[];
    counties?: string[];
    sortBy?: "price" | "newest" | "popular";
    limit?: number;
    offset?: number;
  }) {
    // This would integrate with ElasticSearch in production
    // For now, basic SQL search
    
    const filters: any = {
      status: "active",
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      states: query.states,
      limit: query.limit || 20,
      offset: query.offset || 0,
    };
    
    return await this.getListings(filters);
  }
  
  /**
   * Upgrade listing to premium placement
   */
  async upgradeToPremium(organizationId: number, listingId: number, durationDays: number = 30) {
    const listing = await db.select()
      .from(marketplaceListings)
      .where(and(
        eq(marketplaceListings.id, listingId),
        eq(marketplaceListings.sellerOrganizationId, organizationId)
      ))
      .limit(1);
    
    if (listing.length === 0) {
      throw new Error("Listing not found or you don't have access");
    }
    
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + durationDays);
    
    await db.update(marketplaceListings)
      .set({
        isPremiumPlacement: true,
        premiumExpiresAt: expiresAt,
      })
      .where(eq(marketplaceListings.id, listingId));
    
    // TODO: Charge $50 via Stripe
    
    return { success: true, premiumExpiresAt: expiresAt };
  }
}

export const marketplaceService = new MarketplaceService();
