import { Router, type Request, type Response } from 'express';
import { taxResearcher } from './services/taxResearcher';

const router = Router();

function getOrg(req: Request) {
  const org = (req as any).organization;
  if (!org) throw new Error('Organization not found');
  return org;
}

// GET /auctions — upcoming tax sale auctions
router.get('/auctions', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { state, county, startDate, endDate } = req.query;
    const auctions = await taxResearcher.getUpcomingAuctions(org.id, {
      state: state as string | undefined,
      county: county as string | undefined,
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined,
    });
    res.json({ auctions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /auctions/:id/listings — listings in a specific auction
router.get('/auctions/:id/listings', async (req: Request, res: Response) => {
  try {
    const { minAcres, maxBid, zoning } = req.query;
    const listings = await taxResearcher.getAuctionListings(parseInt(req.params.id), {
      minAcres: minAcres ? parseFloat(minAcres as string) : undefined,
      maxBid: maxBid ? parseFloat(maxBid as string) : undefined,
      zoning: zoning as string | undefined,
    });
    res.json({ listings });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /scan — scan auction calendar for a state
router.post('/scan', async (req: Request, res: Response) => {
  try {
    const { state } = req.body;
    const result = await taxResearcher.scanAuctionCalendar(state);
    res.json({ result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /delinquent — track tax delinquent properties
router.get('/delinquent', async (req: Request, res: Response) => {
  try {
    const { state, county, minOweAmount } = req.query;
    const properties = await taxResearcher.trackTaxDelinquentProperties({
      state: state as string | undefined,
      county: county as string | undefined,
      minOweAmount: minOweAmount ? parseFloat(minOweAmount as string) : undefined,
    });
    res.json({ properties });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /alerts — tax sale alerts for org
router.get('/alerts', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const alerts = await taxResearcher.getTaxSaleAlerts(org.id);
    res.json({ alerts });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /alerts — create a tax sale alert
router.post('/alerts', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const alert = await taxResearcher.createTaxSaleAlert({ ...req.body, organizationId: org.id });
    res.json({ alert });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /alerts/:id
router.delete('/alerts/:id', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    await taxResearcher.deleteTaxSaleAlert(parseInt(req.params.id), org.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /watchlist — org's watchlist
router.get('/watchlist', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const watchlist = await taxResearcher.getWatchlist(org.id);
    res.json({ watchlist });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /watchlist — add listing to watchlist
router.post('/watchlist', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { listingId } = req.body;
    await taxResearcher.addToWatchlist(org.id, parseInt(listingId));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /redemption-rates?state= — county redemption rate data
router.get('/redemption-rates', async (req: Request, res: Response) => {
  try {
    const { state } = req.query;
    const rates = await taxResearcher.getCountyRedemptionRates(state as string);
    res.json({ rates });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /surface-to-radar — push tax opportunities into Acquisition Radar
router.post('/surface-to-radar', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const result = await taxResearcher.surfaceTaxOpportunitiesToRadar(org.id);
    res.json({ result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
