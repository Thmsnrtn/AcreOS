import { Router, type Request, type Response } from 'express';
import { capitalMarkets } from './services/capitalMarkets';

const router = Router();

function getOrg(req: Request) {
  const org = (req as any).organization;
  if (!org) throw new Error('Organization not found');
  return org;
}

// GET /securities — list available note securities
router.get('/securities', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const securities = await capitalMarkets.listSecurities(org.id);
    res.json({ securities });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /pool-notes — pool multiple notes for securitization analysis
router.post('/pool-notes', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { noteIds } = req.body;
    const pool = await capitalMarkets.poolNotes(org.id, noteIds.map(Number));
    res.json({ pool });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /securitize — create a securitization offering from pooled notes
router.post('/securitize', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { noteIds, offeringDetails } = req.body;
    const security = await capitalMarkets.createSecuritization(org.id, noteIds.map(Number), offeringDetails);
    res.json({ security });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /securities/:id/invest — invest in a security offering
router.post('/securities/:id/invest', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { amount } = req.body;
    const result = await capitalMarkets.investInSecurity(parseInt(req.params.id), org.id, amount);
    res.json({ result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /lenders — list lender network
router.get('/lenders', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const lenders = await capitalMarkets.getLenderNetwork(org.id);
    res.json({ lenders });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /lenders — add a lender to the network
router.post('/lenders', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { organizationId: _omit, ...lenderData } = req.body;
    const lender = await capitalMarkets.addLender(org.id, lenderData);
    res.json({ lender });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /match-lenders — find lenders matching a specific deal
router.post('/match-lenders', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { propertyId, loanAmount, ltv } = req.body;
    const matches = await capitalMarkets.matchLenders(org.id, propertyId, loanAmount, ltv);
    res.json({ matches });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /raises — list capital raise campaigns
router.get('/raises', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const raises = await capitalMarkets.getCapitalRaises(org.id);
    res.json({ raises });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /raises — create a new capital raise
router.post('/raises', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { organizationId: _omit, ...raiseData } = req.body;
    const raise = await capitalMarkets.createCapitalRaise(org.id, raiseData);
    res.json({ raise });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /efficiency — capital efficiency metrics
router.get('/efficiency', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const metrics = await capitalMarkets.calculateCapitalEfficiency(org.id);
    res.json({ metrics });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
