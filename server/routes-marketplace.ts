import { Router, type Request, type Response } from 'express';
import { marketplaceService } from './services/marketplace';
import { matchmaking } from './services/matchmaking';
import { isAuthenticated } from './auth';
import { asyncHandler } from './middleware/asyncHandler';
import { db } from './db';
import { investorProfiles, organizations } from '@shared/schema';
import { eq, desc } from 'drizzle-orm';
import { Errors } from "./utils/errors";

const router = Router();

// All marketplace routes require authentication + org

// =====================
// LISTINGS
// =====================

router.post('/listings', asyncHandler(async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { propertyId, ...data } = req.body;
    const listing = await marketplaceService.createListing(org.id, propertyId, data);
    res.json({ listing, success: true });
  } catch (error: any) {
    Errors.badRequest(res, error.message ?? "Bad request");
  }
}));

router.get('/listings', asyncHandler(async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { minPrice, maxPrice, state, listingType, limit = '20', offset = '0' } = req.query;

    const listings = await marketplaceService.getListings({
      organizationId: org.id,
      status: 'active',
      listingType: listingType as string | undefined,
      minPrice: minPrice ? parseFloat(minPrice as string) : undefined,
      maxPrice: maxPrice ? parseFloat(maxPrice as string) : undefined,
      states: state ? [state as string] : undefined,
      limit: Math.min(parseInt(limit as string) || 20, 100), // Cap at 100 to prevent data scraping
      offset: parseInt(offset as string) || 0,
    });

    res.json({ listings });
  } catch (error: any) {
    Errors.internal(res, error);
  }
}));

router.get('/listings/:id', asyncHandler(async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const listing = await marketplaceService.getListing(
      parseInt(req.params.id),
      org.id
    );
    if (!listing) {
      return Errors.notFound(res, 'Listing');
    }
    res.json({ listing });
  } catch (error: any) {
    Errors.internal(res, error);
  }
}));

router.delete('/listings/:id', asyncHandler(async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const listing = await marketplaceService.deactivateListing(org.id, parseInt(req.params.id));
    res.json({ listing, success: true });
  } catch (error: any) {
    Errors.badRequest(res, error.message ?? "Bad request");
  }
}));

// =====================
// MY ACTIVITY
// =====================

router.get('/my/listings', asyncHandler(async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const listings = await marketplaceService.getMyListings(org.id);
    res.json({ listings });
  } catch (error: any) {
    Errors.internal(res, error);
  }
}));

router.get('/my/bids', asyncHandler(async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const bids = await marketplaceService.getMyBids(org.id);
    res.json({ bids });
  } catch (error: any) {
    Errors.internal(res, error);
  }
}));

// =====================
// BIDDING
// =====================

router.post('/listings/:id/bids', asyncHandler(async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { bidAmount, message, proposedTerms, bidType, partnershipSplit } = req.body;

    const bid = await marketplaceService.placeBid(
      org.id,
      parseInt(req.params.id),
      { bidAmount, message, proposedTerms, bidType, partnershipSplit }
    );

    // Notify seller about new bid
    try {
      const { emailService } = await import('./services/emailService');
      const listing = await marketplaceService.getListing(parseInt(req.params.id), org.id);
      if (listing) {
        const { storage: storageInst } = await import('./storage');
        const sellerOrgId = listing.listing?.sellerOrganizationId ?? (listing as any).sellerOrganizationId;
        if (sellerOrgId) {
          const sellerOrg = await storageInst.getOrganization(sellerOrgId);
          if (sellerOrg) {
            // Try to find the org owner email from the org name or founder email
            const orgEmail = (sellerOrg as any).email || process.env.FOUNDER_EMAIL;
            if (orgEmail) {
              await emailService.sendEmail({
                to: orgEmail,
                subject: `New bid on your listing — $${Number(bidAmount).toLocaleString()}`,
                html: `<p>A new bid of <strong>$${Number(bidAmount).toLocaleString()}</strong> has been placed on your marketplace listing.</p><p><a href="${process.env.APP_URL || ''}/marketplace">View in marketplace</a></p>`,
                text: `New bid of $${Number(bidAmount).toLocaleString()} on your listing. View at ${process.env.APP_URL || ''}/marketplace`,
              }).catch(() => {});
            }
          }
        }
      }
    } catch { /* email not configured — skip silently */ }

    res.json({ bid, success: true });
  } catch (error: any) {
    Errors.badRequest(res, error.message ?? "Bad request");
  }
}));

router.get('/listings/:id/bids', asyncHandler(async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const listingId = parseInt(req.params.id);
    // Task #2: IDOR prevention — only sellers can see all bids (org is seller or buyer)
    const listing = await marketplaceService.getListing(listingId, org.id);
    if (!listing) {
      return Errors.notFound(res, 'Listing');
    }
    const bids = await marketplaceService.getBidsForListing(listingId);
    res.json({ bids });
  } catch (error: any) {
    Errors.internal(res, error);
  }
}));

router.post('/listings/:id/accept/:bidId', asyncHandler(async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const result = await marketplaceService.acceptBid(
      org.id,
      parseInt(req.params.id),
      parseInt(req.params.bidId)
    );
    res.json(result);
  } catch (error: any) {
    Errors.badRequest(res, error.message ?? "Bad request");
  }
}));

router.post('/bids/:id/accept', asyncHandler(async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const result = await marketplaceService.respondToBid(
      org.id,
      parseInt(req.params.id),
      'accept',
      { sellerResponse: req.body.message }
    );
    res.json(result);
  } catch (error: any) {
    Errors.badRequest(res, error.message ?? "Bad request");
  }
}));

router.post('/bids/:id/reject', asyncHandler(async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const result = await marketplaceService.respondToBid(
      org.id,
      parseInt(req.params.id),
      'reject',
      { sellerResponse: req.body.reason }
    );
    res.json(result);
  } catch (error: any) {
    Errors.badRequest(res, error.message ?? "Bad request");
  }
}));

router.post('/bids/:id/counter', asyncHandler(async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { amount, message } = req.body;
    const result = await marketplaceService.respondToBid(
      org.id,
      parseInt(req.params.id),
      'counter',
      { counterOffer: amount, sellerResponse: message }
    );
    res.json(result);
  } catch (error: any) {
    Errors.badRequest(res, error.message ?? "Bad request");
  }
}));

// =====================
// TRANSACTIONS
// =====================

router.post('/transactions/complete', asyncHandler(async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { listingId, salePrice } = req.body;
    const transaction = await marketplaceService.completeTransaction(
      listingId,
      org.id,
      salePrice
    );
    res.json({ transaction, success: true });
  } catch (error: any) {
    Errors.badRequest(res, error.message ?? "Bad request");
  }
}));

// =====================
// INVESTOR PROFILES
// =====================

router.get('/investor-profile', asyncHandler(async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const profile = await marketplaceService.getInvestorProfile(org.id);
    res.json({ profile });
  } catch (error: any) {
    Errors.internal(res, error);
  }
}));

router.post('/investor-profile', asyncHandler(async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const profile = await marketplaceService.updateInvestorProfile(org.id, req.body);
    res.json({ profile, success: true });
  } catch (error: any) {
    Errors.badRequest(res, error.message ?? "Bad request");
  }
}));

// =====================
// ANALYTICS
// =====================

router.get('/stats', asyncHandler(async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const stats = await marketplaceService.getMarketplaceStats(org.id);
    res.json({ stats });
  } catch (error: any) {
    Errors.internal(res, error);
  }
}));

router.get('/search', asyncHandler(async (req: Request, res: Response) => {
  try {
    const { keywords, minPrice, maxPrice, minAcres, maxAcres, sortBy, limit, offset } = req.query;
    const listings = await marketplaceService.searchListings({
      keywords: keywords as string | undefined,
      minPrice: minPrice ? parseFloat(minPrice as string) : undefined,
      maxPrice: maxPrice ? parseFloat(maxPrice as string) : undefined,
      minAcres: minAcres ? parseFloat(minAcres as string) : undefined,
      maxAcres: maxAcres ? parseFloat(maxAcres as string) : undefined,
      sortBy: sortBy as any,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined,
    });
    res.json({ listings });
  } catch (error: any) {
    Errors.internal(res, error);
  }
}));

// =====================
// MATCHMAKING
// =====================

router.get('/matches', asyncHandler(async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const matches = await matchmaking.findMatchesForInvestor(org.id);
    res.json({ matches });
  } catch (error: any) {
    Errors.internal(res, error);
  }
}));

router.get('/listings/:id/buyers', asyncHandler(async (req: Request, res: Response) => {
  try {
    const buyers = await matchmaking.findBuyersForListing(parseInt(req.params.id));
    res.json({ buyers });
  } catch (error: any) {
    Errors.internal(res, error);
  }
}));

// =====================
// DEAL ROOMS
// =====================

router.post('/deal-rooms', asyncHandler(async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { listingId, sellerOrgId } = req.body;
    const dealRoom = await marketplaceService.createDealRoom(listingId, org.id, sellerOrgId);
    res.json({ dealRoom, success: true });
  } catch (error: any) {
    Errors.badRequest(res, error.message ?? "Bad request");
  }
}));

router.get('/deal-rooms/:id', asyncHandler(async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { dealRooms: drTable } = await import('@shared/schema');
    const { eq, or } = await import('drizzle-orm');
    const results = await db.select().from(drTable).where(eq(drTable.id, parseInt(req.params.id))).limit(1);
    if (results.length === 0) {
      return Errors.notFound(res, 'Deal room');
    }
    const room = results[0] as any;
    // Task #2: IDOR prevention — only participants (buyer or seller) can access a deal room
    if (room.buyerOrganizationId !== org.id && room.sellerOrganizationId !== org.id) {
      return Errors.notFound(res, 'Deal room');
    }
    res.json({ dealRoom: room });
  } catch (error: any) {
    Errors.internal(res, error);
  }
}));

// =====================
// INVESTOR DIRECTORY
// =====================

router.get('/investors', asyncHandler(async (req: Request, res: Response) => {
  try {
    const profiles = await db
      .select({
        profile: investorProfiles,
        org: {
          id: organizations.id,
          name: organizations.name,
        },
      })
      .from(investorProfiles)
      .leftJoin(organizations, eq(investorProfiles.organizationId, organizations.id))
      .orderBy(desc(investorProfiles.isVerified), desc(investorProfiles.dealsClosed));
    res.json({ investors: profiles });
  } catch (error: any) {
    Errors.internal(res, error);
  }
}));

router.get('/investors/:id', asyncHandler(async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const results = await db
      .select({
        profile: investorProfiles,
        org: {
          id: organizations.id,
          name: organizations.name,
        },
      })
      .from(investorProfiles)
      .leftJoin(organizations, eq(investorProfiles.organizationId, organizations.id))
      .where(eq(investorProfiles.id, id))
      .limit(1);

    if (results.length === 0) {
      return Errors.notFound(res, 'Investor profile');
    }
    res.json({ investor: results[0] });
  } catch (error: any) {
    Errors.internal(res, error);
  }
}));

router.patch('/investors/me', asyncHandler(async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const data = req.body;

    // Upsert: try update first, then insert if not found
    const existing = await db
      .select({ id: investorProfiles.id })
      .from(investorProfiles)
      .where(eq(investorProfiles.organizationId, org.id))
      .limit(1);

    if (existing.length > 0) {
      const [updated] = await db
        .update(investorProfiles)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(investorProfiles.organizationId, org.id))
        .returning();
      return res.json({ profile: updated, success: true });
    }

    // Create new profile
    const profile = await marketplaceService.getInvestorProfile(org.id);
    const [updated] = await db
      .update(investorProfiles)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(investorProfiles.organizationId, org.id))
      .returning();
    res.json({ profile: updated, success: true });
  } catch (error: any) {
    Errors.badRequest(res, error.message ?? "Bad request");
  }
}));

// =====================
// PREMIUM UPGRADE
// =====================

router.post('/listings/:id/upgrade', asyncHandler(async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const result = await marketplaceService.upgradeToPremium(org.id, parseInt(req.params.id));
    res.json({ result, success: true });
  } catch (error: any) {
    Errors.badRequest(res, error.message ?? "Bad request");
  }
}));

export default router;
