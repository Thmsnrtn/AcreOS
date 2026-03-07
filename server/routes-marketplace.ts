import { Router, type Request, type Response } from 'express';
import { marketplaceService } from './services/marketplace';
import { matchmaking } from './services/matchmaking';
import { isAuthenticated } from './auth';

const router = Router();

// All marketplace routes require authentication + org
function getOrg(req: Request) {
  const org = (req as any).organization;
  if (!org) throw new Error('Organization not found');
  return org;
}

// =====================
// LISTINGS
// =====================

router.post('/listings', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { propertyId, ...data } = req.body;
    const listing = await marketplaceService.createListing(org.id, propertyId, data);
    res.json({ listing, success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/listings', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { minPrice, maxPrice, state, listingType, limit = '20', offset = '0' } = req.query;

    const listings = await marketplaceService.getListings({
      organizationId: org.id,
      status: 'active',
      listingType: listingType as string | undefined,
      minPrice: minPrice ? parseFloat(minPrice as string) : undefined,
      maxPrice: maxPrice ? parseFloat(maxPrice as string) : undefined,
      states: state ? [state as string] : undefined,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
    });

    res.json({ listings });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/listings/:id', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const listing = await marketplaceService.getListing(
      parseInt(req.params.id),
      org.id
    );
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }
    res.json({ listing });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// =====================
// BIDDING
// =====================

router.post('/listings/:id/bids', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { bidAmount, message, proposedTerms, bidType, partnershipSplit } = req.body;

    const bid = await marketplaceService.placeBid(
      org.id,
      parseInt(req.params.id),
      { bidAmount, message, proposedTerms, bidType, partnershipSplit }
    );

    res.json({ bid, success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/listings/:id/bids', async (req: Request, res: Response) => {
  try {
    const bids = await marketplaceService.getBidsForListing(
      parseInt(req.params.id)
    );
    res.json({ bids });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/bids/:id/accept', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const result = await marketplaceService.respondToBid(
      org.id,
      parseInt(req.params.id),
      'accept',
      { sellerResponse: req.body.message }
    );
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/bids/:id/reject', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const result = await marketplaceService.respondToBid(
      org.id,
      parseInt(req.params.id),
      'reject',
      { sellerResponse: req.body.reason }
    );
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/bids/:id/counter', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { amount, message } = req.body;
    const result = await marketplaceService.respondToBid(
      org.id,
      parseInt(req.params.id),
      'counter',
      { counterOffer: amount, sellerResponse: message }
    );
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// =====================
// TRANSACTIONS
// =====================

router.post('/transactions/complete', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { listingId, salePrice } = req.body;
    const transaction = await marketplaceService.completeTransaction(
      listingId,
      org.id,
      salePrice
    );
    res.json({ transaction, success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// =====================
// INVESTOR PROFILES
// =====================

router.get('/investor-profile', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const profile = await marketplaceService.getInvestorProfile(org.id);
    res.json({ profile });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/investor-profile', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const profile = await marketplaceService.updateInvestorProfile(org.id, req.body);
    res.json({ profile, success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// =====================
// ANALYTICS
// =====================

router.get('/stats', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const stats = await marketplaceService.getMarketplaceStats(org.id);
    res.json({ stats });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/search', async (req: Request, res: Response) => {
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
    res.status(500).json({ error: error.message });
  }
});

// =====================
// MATCHMAKING
// =====================

router.get('/matches', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const matches = await matchmaking.findMatchesForInvestor(org.id);
    res.json({ matches });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/listings/:id/buyers', async (req: Request, res: Response) => {
  try {
    const buyers = await matchmaking.findBuyersForListing(parseInt(req.params.id));
    res.json({ buyers });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// =====================
// DEAL ROOMS
// =====================

router.post('/deal-rooms', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { listingId, sellerOrgId } = req.body;
    const dealRoom = await marketplaceService.createDealRoom(listingId, org.id, sellerOrgId);
    res.json({ dealRoom, success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// =====================
// PREMIUM UPGRADE
// =====================

router.post('/listings/:id/upgrade', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const result = await marketplaceService.upgradeToPremium(org.id, parseInt(req.params.id));
    res.json({ result, success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
