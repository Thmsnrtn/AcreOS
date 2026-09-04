import { db, withTransaction } from "../db";
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
import { logger } from "../utils/logger";

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
      description: data.description || property.description || "",
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

    // F-A01-2: Non-public listings are only visible to the owning org
    if (
      result.listing.visibility !== "public" &&
      result.listing.sellerOrganizationId !== viewerOrgId
    ) {
      return null;
    }

    // Increment view count (only if not seller)
    if (viewerOrgId && result.listing.sellerOrganizationId !== viewerOrgId) {
      await db.update(marketplaceListings)
        .set({ views: sql`${marketplaceListings.views} + 1` })
        .where(eq(marketplaceListings.id, listingId));
    }
    
    // Get bids if seller
    let bids: Awaited<ReturnType<typeof this.getBidsForListing>> = [];
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

    // Task 211: Bid amount must be positive
    if (!data.bidAmount || data.bidAmount <= 0) {
      throw new Error("Bid amount must be greater than $0");
    }

    // Task 212: New bid must exceed the current highest accepted/pending bid
    const existingBids = await db.select({ bidAmount: marketplaceBids.bidAmount })
      .from(marketplaceBids)
      .where(
        and(
          eq(marketplaceBids.listingId, listingId),
          sql`${marketplaceBids.status} IN ('pending', 'accepted')`
        )
      );
    if (existingBids.length > 0) {
      const highestBid = Math.max(...existingBids.map(b => parseFloat(b.bidAmount as string) || 0));
      if (data.bidAmount <= highestBid) {
        throw new Error(
          `Bid of $${data.bidAmount.toLocaleString()} must exceed the current highest bid of $${highestBid.toLocaleString()}`
        );
      }
    }

    // F-A04-2: Bid sanity check — flag bids more than 5× asking price (money-laundering signal)
    const askingPrice = parseFloat(listing[0].askingPrice as string) || 0;
    const flaggedForReview = askingPrice > 0 && data.bidAmount > askingPrice * 5;

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
      status: flaggedForReview ? "flagged_for_review" : "pending",
      expiresAt,
    }).returning();

    if (flaggedForReview) {
      logger.warn(`[marketplace] Bid ${bid.id} flagged for review: $${data.bidAmount} is >5× asking price $${askingPrice} on listing ${listingId}`);
    }
    
    // Update listing inquiry count
    await db.update(marketplaceListings)
      .set({ inquiries: sql`${marketplaceListings.inquiries} + 1` })
      .where(eq(marketplaceListings.id, listingId));
    
    // Notify seller of new bid
    try {
      const bidderOrg = await db.select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, bidderOrgId))
        .limit(1);
      const bidderName = bidderOrg[0]?.name || 'A buyer';

      await storage.createSystemAlert({
        organizationId: listing[0].sellerOrganizationId,
        type: 'marketplace_bid',
        severity: 'info',
        title: 'New bid on your listing',
        message: `${bidderName} placed a $${data.bidAmount.toLocaleString()} bid on your marketplace listing.`,
        metadata: { listingId, bidId: bid.id, bidAmount: data.bidAmount },
      });
    } catch (err) {
      logger.error('Failed to create bid notification', err);
    }
    
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
      // INNER join, and the seller predicate is IN THE WHERE rather than a JS
      // comparison afterwards: the old shape read another organization's bid
      // row into memory and only then decided the caller had no right to it.
      // A row you may not act on is a row you should not have fetched.
      .innerJoin(marketplaceListings, eq(marketplaceBids.listingId, marketplaceListings.id))
      .where(and(
        eq(marketplaceBids.id, bidId),
        eq(marketplaceListings.sellerOrganizationId, sellerOrgId),
      ))
      .limit(1);

    if (results.length === 0) {
      throw new Error("Bid not found, or your organization does not own the listing it was placed on");
    }

    const { bid, listing } = results[0];
    
    if (bid.status !== "pending") {
      throw new Error("Bid is no longer pending");
    }
    
    // DEFECT-0021: Wrap bid update + listing update + deal room creation in a
    // single transaction so all 3 tables are committed or rolled back atomically.
    await withTransaction(async (tx) => {
      // Update bid
      await tx.update(marketplaceBids)
        .set({
          status: action === "accept" ? "accepted" : action === "reject" ? "rejected" : "countered",
          sellerResponse: data?.sellerResponse,
          counterOffer: data?.counterOffer?.toString(),
          respondedAt: new Date(),
        })
        .where(and(
          eq(marketplaceBids.id, bidId),
          eq(marketplaceBids.listingId, listing.id),
        ));

      // If accepted, update listing status and create deal room
      if (action === "accept") {
        await tx.update(marketplaceListings)
          .set({ status: "under_offer" })
          .where(and(
            eq(marketplaceListings.id, listing.id),
            eq(marketplaceListings.sellerOrganizationId, sellerOrgId),
          ));

        // Create deal room inside the same transaction
        await tx.insert(dealRooms).values({
          listingId: listing.id,
          participants: [
            {
              organizationId: listing.sellerOrganizationId,
              role: "seller",
              joinedAt: new Date().toISOString(),
            },
            {
              organizationId: bid.bidderOrganizationId,
              role: "buyer",
              joinedAt: new Date().toISOString(),
            },
          ],
          status: "active",
        });
      }
    });

    // Notify bidder of seller response (non-critical, outside transaction)
    try {
      const actionLabels: Record<string, string> = {
        accept: 'accepted',
        reject: 'declined',
        counter: 'countered',
      };
      await storage.createSystemAlert({
        organizationId: bid.bidderOrganizationId,
        type: 'marketplace_bid_response',
        severity: action === 'accept' ? 'info' : 'warning',
        title: `Your bid was ${actionLabels[action]}`,
        message: action === 'counter'
          ? `The seller countered your bid${data?.counterOffer ? ` at $${data.counterOffer.toLocaleString()}` : ''}.`
          : `The seller ${actionLabels[action]} your bid on the marketplace listing.`,
        metadata: { listingId: listing.id, bidId, action, counterOffer: data?.counterOffer },
      });
    } catch (err) {
      logger.error('Failed to create bid response notification', err);
    }

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
  /**
   * Record a completed sale.
   *
   * AUTHORITY COMES FROM AN ACCEPTED BID, not from the request.
   *
   * This used to take `(listingId, buyerOrgId, salePrice)`, read the listing by
   * id with no ownership or party check, and then mark it sold, write a
   * transaction row and close the deal room. Any authenticated member of any
   * organization could therefore mark ANOTHER TENANT'S listing sold — at a
   * price of their choosing, which also drove the platform fee — and close the
   * counterparties' deal room with it. Nothing established that the caller had
   * ever bid, that a bid had been accepted, or that the listing was even under
   * offer. It was latent only because the marketplace mount fails closed behind
   * `requireLadderFlag("feature_marketplace")` (2026-09-03); the flag is a door,
   * not an authority check, and this is the authority check.
   *
   * An ACCEPTED bid is the one artefact that establishes both parties and the
   * agreed amount: the seller created the listing, the buyer bid on it, and the
   * seller accepted through respondToBid. So the buyer is the bid's own
   * bidderOrganizationId, the seller is the listing's sellerOrganizationId, and
   * the sale price is the accepted amount — the counter-offer if the seller
   * countered and the buyer took it, otherwise the bid. The caller no longer
   * supplies the price at all, which is what made the platform fee a number the
   * caller chose.
   */
  async completeTransaction(
    listingId: number,
    buyerOrgId: number
  ) {
    const [accepted] = await db.select({
      bid: marketplaceBids,
      listing: marketplaceListings,
    })
      .from(marketplaceBids)
      .innerJoin(marketplaceListings, eq(marketplaceBids.listingId, marketplaceListings.id))
      .where(and(
        eq(marketplaceBids.listingId, listingId),
        eq(marketplaceBids.bidderOrganizationId, buyerOrgId),
        eq(marketplaceBids.status, "accepted"),
      ))
      .orderBy(desc(marketplaceBids.respondedAt))
      .limit(1);

    if (!accepted) {
      throw new Error(
        "No accepted bid from your organization on this listing — a sale can only be completed by the buyer whose bid the seller accepted",
      );
    }

    const listing = [accepted.listing];
    const salePrice = Number(accepted.bid.counterOffer ?? accepted.bid.bidAmount);
    if (!Number.isFinite(salePrice) || salePrice <= 0) {
      throw new Error("The accepted bid carries no usable amount");
    }

    const platformFeePercent = 1.5;
    const platformFeeCents = Math.round(salePrice * (platformFeePercent / 100) * 100);

    // No seller payout is computed or recorded here. Founder ruling 2026-07-29
    // ("be the rail, not the provider"): the sale proceeds never reach AcreOS,
    // so there is nothing for AcreOS to pay out. Seller and buyer settle
    // directly; AcreOS charges only its own platform fee, below.

    // DEFECT-0021: Wrap transaction insert + listing update + deal room close
    // in a single DB transaction so all tables stay consistent.
    const transaction = await withTransaction(async (tx) => {
      const [txn] = await tx.insert(marketplaceTransactions).values({
        listingId,
        sellerOrganizationId: listing[0].sellerOrganizationId,
        buyerOrganizationId: buyerOrgId,
        transactionType: listing[0].listingType,
        salePrice: salePrice.toString(),
        platformFeePercent: platformFeePercent.toString(),
        platformFeeCents,
        status: "pending",
        closingDate: new Date(),
      }).returning();

      // Update listing. The seller predicate is redundant given the join
      // above and deliberately present anyway: a mutation that names only an
      // id is indistinguishable from one that forgot to check, both to the
      // next reader and to the tenancy gate.
      await tx.update(marketplaceListings)
        .set({
          status: "sold",
          soldAt: new Date(),
        })
        .where(and(
          eq(marketplaceListings.id, listingId),
          eq(marketplaceListings.sellerOrganizationId, accepted.listing.sellerOrganizationId),
        ));

      // Close deal room
      await tx.update(dealRooms)
        .set({
          status: "closed",
          closedAt: new Date(),
        })
        .where(eq(dealRooms.listingId, listingId));

      return txn;
    });

    // Create Stripe PaymentIntent for the buyer (external API call, outside transaction)
    try {
      const { getUncachableStripeClient } = await import('../stripeClient');
      const stripe = await getUncachableStripeClient();

      const buyerOrg = await db.select({ stripeCustomerId: organizations.stripeCustomerId })
        .from(organizations)
        .where(eq(organizations.id, buyerOrgId))
        .limit(1);

      if (buyerOrg[0]?.stripeCustomerId) {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: platformFeeCents,
          currency: 'usd',
          customer: buyerOrg[0].stripeCustomerId,
          description: `Marketplace platform fee for listing #${listingId}`,
          metadata: {
            type: 'marketplace_transaction',
            transactionId: transaction.id.toString(),
            listingId: listingId.toString(),
          },
        });

        // `marketplace_transactions` has no stripe_payment_intent_id column.
        // This used to be `.set({ stripePaymentIntentId: ... } as any)` — an
        // `as any` over a column that does not exist, which Drizzle would have
        // thrown on inside the swallowing catch below, so the id was NEVER
        // persisted while the code read as if it were. The linkage lives on the
        // Stripe side (metadata.transactionId) and in the log line; the frozen
        // marketplace module does not get a new column for it.
        logger.info('Marketplace platform-fee PaymentIntent created', {
          transactionId: transaction.id,
          listingId,
          paymentIntentId: paymentIntent.id,
          amountCents: platformFeeCents,
        });
      }
    } catch (err) {
      logger.error('Marketplace Stripe payment creation failed (non-blocking)', err);
    }

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
  
  // toggleFavorite was DELETED 2026-09-04. It took an organizationId and
  // ignored it, incremented `marketplace_listings.favorites` on ANY listing by
  // bare id, and returned `{ success: true }` — so it was not a toggle (it only
  // ever incremented), not per-org (its own comment said "in production, would
  // use a separate favorites table"), and not authorised (any org could inflate
  // any tenant's favourite count, a number the listing surface displays). It
  // had no route and no caller anywhere in server/, client/ or tests/; it
  // surfaced when marketplace_listings entered the tenancy gate's population on
  // 2026-09-04 — its tenant key is `seller_organization_id`, which neither the
  // `organization_id` nor the `org_id` spelling had ever matched.
  //
  // Favourites are a real feature when they are per-viewer and reversible, and
  // that needs a table. Deleting the stub rather than scoping it keeps the
  // absence honest: the next author builds the feature instead of inheriting a
  // counter that means nothing.
  
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
   * Get all listings for this org (seller perspective)
   */
  async getMyListings(organizationId: number) {
    return await db.select({
      listing: marketplaceListings,
      property: properties,
    })
      .from(marketplaceListings)
      .leftJoin(properties, eq(marketplaceListings.propertyId, properties.id))
      .where(eq(marketplaceListings.sellerOrganizationId, organizationId))
      .orderBy(desc(marketplaceListings.createdAt));
  }

  /**
   * Get all bids placed by this org (buyer perspective)
   */
  async getMyBids(organizationId: number) {
    return await db.select({
      bid: marketplaceBids,
      listing: marketplaceListings,
      property: properties,
    })
      .from(marketplaceBids)
      .leftJoin(marketplaceListings, eq(marketplaceBids.listingId, marketplaceListings.id))
      .leftJoin(properties, eq(marketplaceListings.propertyId, properties.id))
      .where(eq(marketplaceBids.bidderOrganizationId, organizationId))
      .orderBy(desc(marketplaceBids.createdAt));
  }

  /**
   * Deactivate (cancel) a listing owned by this org
   */
  async deactivateListing(organizationId: number, listingId: number) {
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

    // The guard above already proved ownership; naming the seller here too
    // closes the window between the two statements and, just as importantly,
    // makes the mutation self-evidently scoped to a reader who arrives at this
    // line without the guard in view.
    const [updated] = await db.update(marketplaceListings)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(and(
        eq(marketplaceListings.id, listingId),
        eq(marketplaceListings.sellerOrganizationId, organizationId),
      ))
      .returning();

    return updated;
  }

  /**
   * Accept a specific bid on a listing owned by this org
   */
  async acceptBid(organizationId: number, listingId: number, bidId: number) {
    return await this.respondToBid(organizationId, bidId, "accept");
  }

  /**
   * Calculate platform fee (1.5%)
   */
  calculateFee(amount: number) {
    const fee = amount * 0.015;
    const net = amount * 0.985;
    return { fee, net };
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
      .where(and(
        eq(marketplaceListings.id, listingId),
        eq(marketplaceListings.sellerOrganizationId, organizationId),
      ));
    
    // Deduct premium listing credits (5000 cents = $50 equivalent)
    const PREMIUM_COST_CENTS = 5000;
    try {
      const { creditService } = await import('./credits');
      const deduction = await creditService.deductCredits(
        organizationId,
        PREMIUM_COST_CENTS,
        `Premium marketplace placement for listing #${listingId} (${durationDays} days)`,
        { listingId, durationDays },
      );
      if (!deduction) {
        // Rollback if insufficient credits
        await db.update(marketplaceListings)
          .set({ isPremiumPlacement: false, premiumExpiresAt: null })
          .where(and(
            eq(marketplaceListings.id, listingId),
            eq(marketplaceListings.sellerOrganizationId, organizationId),
          ));
        throw new Error('Insufficient credits for premium placement. Cost: 5,000 credits.');
      }
    } catch (err: any) {
      if (err.message?.includes('Insufficient credits')) throw err;
      logger.error('Credit deduction failed for premium listing', err);
    }
    
    return { success: true, premiumExpiresAt: expiresAt };
  }
}

export const marketplaceService = new MarketplaceService();
