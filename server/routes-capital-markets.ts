import { Router, type Request, type Response } from 'express';
import { capitalMarkets } from './services/capitalMarkets';
import { Errors } from './utils/errors';

const router = Router();


// GET /securities — list available note securities
router.get('/securities', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const securities = await capitalMarkets.listSecurities(org.id);
    res.json({ securities });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// POST /pool-notes — pool multiple notes for securitization analysis
router.post('/pool-notes', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { noteIds } = req.body;
    const pool = await capitalMarkets.poolNotes(org.id, noteIds.map(Number));
    res.json({ pool });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// POST /securitize — create a securitization offering from pooled notes
router.post('/securitize', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { noteIds, offeringDetails } = req.body;
    const security = await capitalMarkets.createSecuritization(org.id, noteIds.map(Number), offeringDetails);
    res.json({ security });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// POST /securities/:id/invest — invest in a security offering
router.post('/securities/:id/invest', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { amount } = req.body;
    const result = await capitalMarkets.investInSecurity(parseInt(req.params.id), org.id, amount);
    res.json({ result });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// GET /lenders — list lender network
router.get('/lenders', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const lenders = await capitalMarkets.getLenderNetwork(org.id);
    res.json({ lenders });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// POST /lenders — add a lender to the network
router.post('/lenders', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { organizationId: _omit, ...lenderData } = req.body;
    const lender = await capitalMarkets.addLender(org.id, lenderData);
    res.json({ lender });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// POST /match-lenders — find lenders matching a specific deal
router.post('/match-lenders', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { propertyId, loanAmount, ltv } = req.body;
    const matches = await capitalMarkets.matchLenders(org.id, propertyId, loanAmount, ltv);
    res.json({ matches });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// GET /raises — list capital raise campaigns
router.get('/raises', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const raises = await capitalMarkets.getCapitalRaises(org.id);
    res.json({ raises });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// POST /raises — create a new capital raise
router.post('/raises', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { organizationId: _omit, ...raiseData } = req.body;
    const raise = await capitalMarkets.createCapitalRaise(org.id, raiseData);
    res.json({ raise });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// GET /efficiency — capital efficiency metrics
router.get('/efficiency', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const metrics = await capitalMarkets.calculateCapitalEfficiency(org.id);
    res.json({ metrics });
  } catch (err) {
    Errors.internal(res, err);
  }
});

export default router;
